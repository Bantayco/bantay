/**
 * Generative fallback: coerce a text-generating LLM into the decision-model
 * interface. Slower, pricier, and less calibrated than a real decision model,
 * but it makes the provider truly swappable — Ollama on a home box, Anthropic
 * BYOK, or anything with a `complete(prompt) → text` function.
 *
 * The model is asked for one JSON object with per-question probability
 * distributions; we derive choice/score/confidence from those in code, so the
 * downstream logic is identical regardless of provider.
 */

import {
  DecisionError,
  type Answer,
  type ChoiceQuestion,
  type DecisionModel,
  type DecisionRequest,
  type DecisionResponse,
  type Question,
  type ScoreQuestion,
} from "./types";

export type CompleteFn = (prompt: string) => Promise<string>;

export class GenerativeDecisionModel implements DecisionModel {
  constructor(
    readonly name: string,
    private readonly modelName: string,
    private readonly complete: CompleteFn
  ) {}

  async decide(request: DecisionRequest): Promise<DecisionResponse> {
    const prompt = buildPrompt(request);
    const text = await this.complete(prompt);
    const parsed = parseJson(text, this.name);
    const answers: Record<string, Answer> = {};
    for (const [key, q] of Object.entries(request.questions)) {
      answers[key] = coerceAnswer(key, q, parsed[key], this.name);
    }
    return { model: this.modelName, answers };
  }
}

export function buildPrompt(request: DecisionRequest): string {
  const lines: string[] = [];
  lines.push(
    "You are a decision model. You do not write prose. You answer typed questions about STATE with calibrated probabilities.",
    "Return ONLY a single JSON object, no markdown, keyed by question name. Shapes:",
    '  noul:   {"probability": <0..1 that the answer is yes>}',
    '  choice: {"probabilities": {<option>: <0..1>, ...}}   (all options, summing to 1)',
    '  score:  {"probabilities": {"0": <0..1>, "1": <0..1>, ...}}   (one key per level index, summing to 1)',
    "",
    "STATE:",
    typeof request.state === "string" ? request.state : JSON.stringify(request.state, null, 2),
    "",
    "QUESTIONS:"
  );
  for (const [key, q] of Object.entries(request.questions)) {
    lines.push(`- ${key} (${q.type}): ${q.instructions ?? ""}`);
    if (q.type === "choice") {
      for (const [name, desc] of Object.entries(q.criteria)) {
        lines.push(`    - ${name}: ${desc}`);
      }
    } else if (q.type === "score") {
      q.criteria.forEach((desc, i) => lines.push(`    - ${i}: ${desc}`));
    } else if (q.criteria) {
      lines.push(`    - true: ${q.criteria.true}`, `    - false: ${q.criteria.false}`);
    }
  }
  lines.push("", "JSON:");
  return lines.join("\n");
}

function parseJson(text: string, provider: string): Record<string, Record<string, unknown>> {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new DecisionError(`${provider}: model did not return JSON`, provider);
  }
  try {
    return JSON.parse(stripped.slice(start, end + 1));
  } catch (err) {
    throw new DecisionError(
      `${provider}: invalid JSON from model: ${err instanceof Error ? err.message : err}`,
      provider
    );
  }
}

function normalize(probs: Record<string, number>, keys: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  let sum = 0;
  for (const k of keys) {
    const v = Number(probs?.[k]);
    out[k] = Number.isFinite(v) && v > 0 ? v : 0;
    sum += out[k];
  }
  if (sum <= 0) {
    for (const k of keys) out[k] = 1 / keys.length;
    return out;
  }
  for (const k of keys) out[k] = out[k] / sum;
  return out;
}

/** Confidence = top probability minus runner-up, like a margin. */
function margin(probs: Record<string, number>): number {
  const sorted = Object.values(probs).sort((a, b) => b - a);
  return sorted.length < 2 ? 1 : sorted[0] - sorted[1];
}

export function coerceAnswer(
  key: string,
  q: Question,
  raw: Record<string, unknown> | undefined,
  provider: string
): Answer {
  if (!raw || typeof raw !== "object") {
    throw new DecisionError(`${provider}: no answer for "${key}"`, provider);
  }
  switch (q.type) {
    case "noul": {
      let p = Number(raw.probability ?? raw.noul);
      if (!Number.isFinite(p)) {
        throw new DecisionError(`${provider}: noul "${key}" has no probability`, provider);
      }
      p = Math.min(1, Math.max(0, p));
      return { type: "noul", probability: p };
    }
    case "choice": {
      const keys = Object.keys((q as ChoiceQuestion).criteria);
      const probabilities = normalize(raw.probabilities as Record<string, number>, keys);
      const choice =
        typeof raw.choice === "string" && keys.includes(raw.choice)
          ? raw.choice
          : keys.reduce((a, b) => (probabilities[a] >= probabilities[b] ? a : b));
      return { type: "choice", choice, confidence: margin(probabilities), probabilities };
    }
    case "score": {
      const levels = (q as ScoreQuestion).criteria;
      const keys = levels.map((_, i) => String(i));
      const probabilities = normalize(raw.probabilities as Record<string, number>, keys);
      const score = keys.reduce((acc, k) => acc + Number(k) * probabilities[k], 0);
      const legend: Record<string, string> = {};
      levels.forEach((d, i) => (legend[String(i)] = d));
      return { type: "score", score, confidence: margin(probabilities), legend, probabilities };
    }
  }
}

// ---- Completion backends ----

export interface OllamaOptions {
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

export function ollamaComplete(options: OllamaOptions = {}): CompleteFn {
  const base = (options.baseUrl ?? "http://localhost:11434").replace(/\/+$/, "");
  const model = options.model ?? "llama3.1";
  const f = options.fetchImpl ?? fetch;
  return async (prompt) => {
    const res = await f(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        options: { temperature: 0 },
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new DecisionError(`ollama: HTTP ${res.status}`, "ollama", res.status);
    const json = (await res.json()) as { message?: { content?: string } };
    return json.message?.content ?? "";
  };
}

export interface AnthropicOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export function anthropicComplete(options: AnthropicOptions): CompleteFn {
  const base = (options.baseUrl ?? "https://api.anthropic.com").replace(/\/+$/, "");
  const model = options.model ?? "claude-haiku-5-5";
  const f = options.fetchImpl ?? fetch;
  return async (prompt) => {
    const res = await f(`${base}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": options.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new DecisionError(`anthropic: HTTP ${res.status}`, "anthropic", res.status);
    const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    return json.content?.filter((c) => c.type === "text").map((c) => c.text ?? "").join("") ?? "";
  };
}
