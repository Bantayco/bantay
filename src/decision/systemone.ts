/**
 * System One protocol adapter.
 *
 * Speaks TypeSafe's `POST /v1/systemone` wire format. Covers:
 *   - Jev direct:            https://api.typesafe.ai/v1/systemone
 *   - gateways that proxy the same format (Vercel AI Gateway, Databricks
 *     `/ai-gateway/typesafe/v1/systemone`, …)
 *   - self-hosted open-weight decision models that implement the protocol
 *
 * Wire format (request):
 *   { model, state, questions: { key: { type, instructions?, criteria? } } }
 * Wire format (response):
 *   { model, answers: { key: NoulAnswer | ChoiceAnswer | ScoreAnswer }, usage }
 *   where noul on the wire is { type: "noul", noul: <p> } — we map `noul` → `probability`.
 */

import {
  DecisionError,
  type Answer,
  type DecisionModel,
  type DecisionRequest,
  type DecisionResponse,
} from "./types";

export interface SystemOneOptions {
  name?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  /** Extra headers (e.g. a gateway's own auth). */
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export const JEV_BASE_URL = "https://api.typesafe.ai";
export const JEV_DEFAULT_MODEL = "jev-latest";

export class SystemOneModel implements DecisionModel {
  readonly name: string;
  private readonly url: string;
  private readonly model: string;
  private readonly apiKey?: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: SystemOneOptions = {}) {
    this.name = options.name ?? "systemone";
    const base = (options.baseUrl ?? JEV_BASE_URL).replace(/\/+$/, "");
    this.url = base.endsWith("/systemone") ? base : `${base}/v1/systemone`;
    this.model = options.model ?? JEV_DEFAULT_MODEL;
    this.apiKey = options.apiKey;
    this.headers = options.headers ?? {};
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async decide(request: DecisionRequest): Promise<DecisionResponse> {
    const body = {
      model: this.model,
      state: request.state,
      questions: request.questions,
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.headers,
    };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await this.fetchImpl(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new DecisionError(
        `${this.name}: request failed: ${err instanceof Error ? err.message : String(err)}`,
        this.name
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      let detail = "";
      try {
        const j = (await res.json()) as { detail?: unknown };
        detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail ?? j);
      } catch {
        detail = await res.text().catch(() => "");
      }
      throw new DecisionError(
        `${this.name}: HTTP ${res.status}${detail ? `: ${detail}` : ""}`,
        this.name,
        res.status
      );
    }

    const json = (await res.json()) as {
      model?: string;
      answers?: Record<string, Record<string, unknown>>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    return {
      model: json.model ?? this.model,
      answers: normalizeAnswers(json.answers ?? {}, this.name),
      usage: json.usage,
    };
  }
}

/** Map wire answers to the internal Answer shape. */
export function normalizeAnswers(
  raw: Record<string, Record<string, unknown>>,
  provider: string
): Record<string, Answer> {
  const out: Record<string, Answer> = {};
  for (const [key, a] of Object.entries(raw)) {
    switch (a.type) {
      case "noul":
      case "boolean": {
        const p = (a.noul ?? a.probability ?? a.boolean) as number | undefined;
        if (typeof p !== "number") {
          throw new DecisionError(`Malformed noul answer for "${key}"`, provider);
        }
        out[key] = { type: "noul", probability: p };
        break;
      }
      case "choice":
        out[key] = {
          type: "choice",
          choice: String(a.choice),
          confidence: Number(a.confidence ?? 0),
          probabilities: (a.probabilities as Record<string, number>) ?? {},
        };
        break;
      case "score":
        out[key] = {
          type: "score",
          score: Number(a.score),
          confidence: Number(a.confidence ?? 0),
          legend: (a.legend as Record<string, string>) ?? {},
          probabilities: (a.probabilities as Record<string, number>) ?? {},
        };
        break;
      default:
        throw new DecisionError(`Unknown answer type "${String(a.type)}" for "${key}"`, provider);
    }
  }
  return out;
}
