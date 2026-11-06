/**
 * Decision model abstraction.
 *
 * Bantay never asks a model for prose. It asks typed questions about a state
 * and gets back calibrated, bounded answers it can act on in plain code. The
 * vocabulary mirrors TypeSafe's System One API (Jev) — noul / choice / score —
 * so Jev is the zero-translation provider, and any other model (an open-weight
 * decision model behind a gateway, or a generative LLM coerced into the same
 * shape) plugs in behind the same interface.
 *
 * Swap providers in bantay.config.yml:
 *
 *   decision:
 *     provider: jev            # jev | systemone | ollama | anthropic | mock | none
 *     model: jev-latest
 *     threshold: 0.8           # confidence below this → escalate to a human
 */

export type DecisionState = string | Record<string, unknown> | unknown[];

/** Yes/no. Answer is P(true). */
export interface NoulQuestion {
  type: "noul";
  instructions: string;
  criteria?: { true: string; false: string };
}

/** Pick one of a closed set. */
export interface ChoiceQuestion {
  type: "choice";
  instructions?: string;
  /** name → description. 1–255 entries. */
  criteria: Record<string, string>;
}

/** Place the state on an ordered rubric. */
export interface ScoreQuestion {
  type: "score";
  instructions?: string;
  /** Ordered level descriptions. 1–10 entries. Position = score. */
  criteria: string[];
}

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export interface NoulAnswer {
  type: "noul";
  /** Probability of "yes", 0–1. */
  probability: number;
}

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  /** 0–1. */
  confidence: number;
  probabilities: Record<string, number>;
}

export interface ScoreAnswer {
  type: "score";
  /** Probability-weighted position on the rubric; may be non-integer. */
  score: number;
  confidence: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
}

export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface DecisionRequest {
  state: DecisionState;
  questions: Record<string, Question>;
}

export interface DecisionResponse {
  /** Model that actually answered. */
  model: string;
  answers: Record<string, Answer>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface DecisionModel {
  /** Provider name, for logs and JSON output. */
  readonly name: string;
  decide(request: DecisionRequest): Promise<DecisionResponse>;
}

export type DecisionProvider =
  | "jev"
  | "systemone"
  | "ollama"
  | "anthropic"
  | "mock"
  | "none";

export interface DecisionConfig {
  provider: DecisionProvider;
  model?: string;
  /** Override endpoint (gateway, self-hosted open-weight decision model, Ollama host). */
  baseUrl?: string;
  /** Env var holding the API key. Defaults per provider. */
  apiKeyEnv?: string;
  /** Confidence below this escalates to a human. Default 0.8. */
  threshold?: number;
  /** For `mock`: scripted answers keyed by question name. */
  answers?: Record<string, Answer>;
}

export const DEFAULT_THRESHOLD = 0.8;

export class DecisionError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "DecisionError";
  }
}

/** Assert an answer is of the expected type (programming-error guard). */
export function expectAnswer<T extends Answer["type"]>(
  response: DecisionResponse,
  key: string,
  type: T
): Extract<Answer, { type: T }> {
  const a = response.answers[key];
  if (!a) {
    throw new DecisionError(`Model returned no answer for "${key}"`, response.model);
  }
  if (a.type !== type) {
    throw new DecisionError(
      `Answer "${key}" is ${a.type}, expected ${type}`,
      response.model
    );
  }
  return a as Extract<Answer, { type: T }>;
}
