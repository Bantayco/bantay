import { describe, test, expect } from "bun:test";
import {
  SystemOneModel,
  GenerativeDecisionModel,
  MockDecisionModel,
  createDecisionModel,
  resolveDecisionConfig,
  buildPrompt,
  DecisionError,
  expectAnswer,
} from "../src/decision";
import { parseYamlConfig } from "../src/config";

function fakeFetch(handler: (url: string, init: RequestInit) => unknown, status = 200) {
  const calls: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: String(url), body, headers: (init?.headers as Record<string, string>) ?? {} });
    const payload = handler(String(url), init ?? {});
    return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

describe("SystemOneModel (Jev wire format)", () => {
  test("posts TypeSafe System One request and normalizes answers", async () => {
    const { fetch, calls } = fakeFetch(() => ({
      model: "jev-2026-10",
      answers: {
        is_billing: { type: "noul", noul: 0.91 },
        dept: { type: "choice", choice: "billing", confidence: 0.83, probabilities: { billing: 0.9, tech: 0.1 } },
        urgency: { type: "score", score: 1.4, confidence: 0.6, legend: { "0": "low", "1": "mid", "2": "high" }, probabilities: { "0": 0.1, "1": 0.4, "2": 0.5 } },
      },
      usage: { input_tokens: 120, output_tokens: 0 },
    }));
    const m = new SystemOneModel({ name: "jev", apiKey: "k", fetchImpl: fetch });
    const r = await m.decide({
      state: "charged twice",
      questions: {
        is_billing: { type: "noul", instructions: "billing?" },
        dept: { type: "choice", criteria: { billing: "b", tech: "t" } },
        urgency: { type: "score", criteria: ["low", "mid", "high"] },
      },
    });

    expect(calls[0].url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(calls[0].headers.Authorization).toBe("Bearer k");
    expect(calls[0].body).toEqual({
      model: "jev-latest",
      state: "charged twice",
      questions: {
        is_billing: { type: "noul", instructions: "billing?" },
        dept: { type: "choice", criteria: { billing: "b", tech: "t" } },
        urgency: { type: "score", criteria: ["low", "mid", "high"] },
      },
    });
    expect(r.model).toBe("jev-2026-10");
    expect(expectAnswer(r, "is_billing", "noul").probability).toBe(0.91);
    expect(expectAnswer(r, "dept", "choice").choice).toBe("billing");
    expect(expectAnswer(r, "urgency", "score").score).toBe(1.4);
    expect(r.usage?.input_tokens).toBe(120);
  });

  test("honors a gateway baseUrl and the boolean alias used by gateways", async () => {
    const { fetch, calls } = fakeFetch(() => ({
      model: "openjev", answers: { q: { type: "boolean", probability: 0.2 } },
    }));
    const m = new SystemOneModel({ baseUrl: "https://gw.example.com/ai-gateway/typesafe", model: "openjev-qwen35-4b", fetchImpl: fetch });
    const r = await m.decide({ state: {}, questions: { q: { type: "noul", instructions: "?" } } });
    expect(calls[0].url).toBe("https://gw.example.com/ai-gateway/typesafe/v1/systemone");
    expect(calls[0].body.model).toBe("openjev-qwen35-4b");
    expect(expectAnswer(r, "q", "noul").probability).toBe(0.2);
  });

  test("surfaces HTTP errors as DecisionError with status", async () => {
    const { fetch } = fakeFetch(() => ({ detail: "bad key" }), 401);
    const m = new SystemOneModel({ apiKey: "k", fetchImpl: fetch });
    await expect(m.decide({ state: "", questions: { q: { type: "noul", instructions: "?" } } }))
      .rejects.toMatchObject({ name: "DecisionError", status: 401 });
  });
});

describe("GenerativeDecisionModel (LLM coerced into the interface)", () => {
  test("derives choice/score/confidence from model-emitted probabilities", async () => {
    const m = new GenerativeDecisionModel("ollama", "llama3.1", async (prompt) => {
      expect(prompt).toContain("QUESTIONS:");
      expect(prompt).toContain("- go (choice)");
      return "```json\n" + JSON.stringify({
        ok: { probability: 1.7 },
        go: { probabilities: { left: 3, right: 1 } },
        sev: { probabilities: { "0": 0, "1": 0.5, "2": 0.5 } },
      }) + "\n```";
    });
    const r = await m.decide({
      state: { x: 1 },
      questions: {
        ok: { type: "noul", instructions: "ok?" },
        go: { type: "choice", criteria: { left: "L", right: "R" } },
        sev: { type: "score", criteria: ["a", "b", "c"] },
      },
    });
    expect(expectAnswer(r, "ok", "noul").probability).toBe(1); // clamped
    const go = expectAnswer(r, "go", "choice");
    expect(go.choice).toBe("left");
    expect(go.probabilities.left).toBeCloseTo(0.75);
    expect(go.confidence).toBeCloseTo(0.5);
    expect(expectAnswer(r, "sev", "score").score).toBeCloseTo(1.5);
  });

  test("rejects non-JSON output", async () => {
    const m = new GenerativeDecisionModel("x", "x", async () => "I think yes");
    await expect(m.decide({ state: "", questions: { q: { type: "noul", instructions: "?" } } }))
      .rejects.toBeInstanceOf(DecisionError);
  });

  test("buildPrompt lists choice options and score levels", () => {
    const p = buildPrompt({
      state: "s",
      questions: { c: { type: "choice", instructions: "which", criteria: { a: "A", b: "B" } } },
    });
    expect(p).toContain("- a: A");
    expect(p).toContain("- b: B");
  });
});

describe("provider resolution", () => {
  test("none when nothing configured", () => {
    expect(createDecisionModel(undefined, {}).model).toBeNull();
  });

  test("jev needs TYPESAFE_API_KEY", () => {
    expect(() => createDecisionModel({ provider: "jev" }, {})).toThrow(/TYPESAFE_API_KEY/);
    const r = createDecisionModel({ provider: "jev" }, { TYPESAFE_API_KEY: "k" });
    expect(r.model?.name).toBe("jev");
    expect(r.threshold).toBe(0.8);
  });

  test("env overrides config (the swap is one env var)", () => {
    const c = resolveDecisionConfig({ provider: "jev", threshold: 0.9 }, {
      BANTAY_DECISION_PROVIDER: "ollama",
      BANTAY_DECISION_MODEL: "qwen3:8b",
      BANTAY_DECISION_BASE_URL: "https://ollama.bantay.co",
    });
    expect(c).toMatchObject({ provider: "ollama", model: "qwen3:8b", baseUrl: "https://ollama.bantay.co", threshold: 0.9 });
    expect(createDecisionModel({ provider: "jev" }, { BANTAY_DECISION_PROVIDER: "mock" }).model).toBeInstanceOf(MockDecisionModel);
  });

  test("systemone works without a key (self-hosted)", () => {
    const r = createDecisionModel({ provider: "systemone", baseUrl: "http://localhost:8000" }, {});
    expect(r.model?.name).toBe("systemone");
  });

  test("bantay.config.yml decision block parses", () => {
    const c = parseYamlConfig(`
sourceDirectories:
  - src
routeDirectories:
  - app/api
schemaPath: prisma/schema.prisma
decision:
  provider: jev
  model: jev-latest
  threshold: 0.85
`);
    expect(c.sourceDirectories).toEqual(["src"]);
    expect(c.routeDirectories).toEqual(["app/api"]);
    expect(c.schemaPath).toBe("prisma/schema.prisma");
    expect(c.decision).toEqual({ provider: "jev", model: "jev-latest", threshold: 0.85 });
  });
});
