/**
 * Deterministic decision model for tests and dry runs.
 *
 * Answers come from a script keyed by question name; unscripted questions get
 * a neutral answer (noul 0.5, uniform choice, mid score). Every request is
 * recorded so tests can assert on what Bantay asked.
 */

import type {
  Answer,
  DecisionModel,
  DecisionRequest,
  DecisionResponse,
} from "./types";

export class MockDecisionModel implements DecisionModel {
  readonly name = "mock";
  readonly requests: DecisionRequest[] = [];

  constructor(private script: Record<string, Answer> = {}) {}

  /** Replace scripted answers. */
  answerWith(script: Record<string, Answer>): void {
    this.script = script;
  }

  async decide(request: DecisionRequest): Promise<DecisionResponse> {
    this.requests.push(request);
    const answers: Record<string, Answer> = {};
    for (const [key, q] of Object.entries(request.questions)) {
      const scripted = this.script[key];
      if (scripted) {
        answers[key] = scripted;
        continue;
      }
      switch (q.type) {
        case "noul":
          answers[key] = { type: "noul", probability: 0.5 };
          break;
        case "choice": {
          const keys = Object.keys(q.criteria);
          const probabilities: Record<string, number> = {};
          for (const k of keys) probabilities[k] = 1 / keys.length;
          answers[key] = { type: "choice", choice: keys[0], confidence: 0, probabilities };
          break;
        }
        case "score": {
          const legend: Record<string, string> = {};
          const probabilities: Record<string, number> = {};
          q.criteria.forEach((d, i) => {
            legend[String(i)] = d;
            probabilities[String(i)] = 1 / q.criteria.length;
          });
          answers[key] = {
            type: "score",
            score: (q.criteria.length - 1) / 2,
            confidence: 0,
            legend,
            probabilities,
          };
          break;
        }
      }
    }
    return { model: "mock", answers };
  }
}
