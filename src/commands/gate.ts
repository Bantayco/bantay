/**
 * gate command — the transition gate.
 *
 * An agent building against an aide may only move the application through
 * transitions the aide declares (`tr_*` — the closed transition vocabulary,
 * SPEC §5.7). Before applying a change, the agent describes it; the decision
 * oracle (Jev, or whatever provider is configured) classifies the proposal
 * against that vocabulary and against the invariants, and plain code decides:
 *
 *   allow     — one declared transition, high confidence, no invariant at risk
 *   escalate  — oracle not confident enough: a human (the organizer) decides
 *   reject    — out of vocabulary, or an invariant would be violated
 *
 * Exit codes: allow 0, reject 1, escalate 2.
 */

import { read, tryResolveAidePath, type AideTree } from "@bantay/aide/node";
import { loadConfig } from "../config";
import {
  createDecisionModel,
  expectAnswer,
  DecisionError,
  type ChoiceQuestion,
  type DecisionModel,
  type NoulQuestion,
  type Question,
} from "../decision";

export const OUT_OF_VOCABULARY = "out_of_vocabulary";

export type GateDecision = "allow" | "escalate" | "reject";

export interface GateOptions {
  /** Plain-language description of the change the agent wants to make. */
  proposal: string;
  /** Current state id (st_*). When given, the transition must start there. */
  from?: string;
  aide?: string;
  json?: boolean;
  /** Inject a model (tests). Overrides config. */
  decisionModel?: DecisionModel;
  threshold?: number;
}

export interface GateResult {
  decision: GateDecision;
  reason: string;
  proposal: string;
  transition?: { id: string; from: string; to: string; action: string };
  confidence: number;
  probabilities: Record<string, number>;
  /** Invariants the oracle thinks are at risk (P(violated) > 1 - threshold). */
  invariantsAtRisk: Array<{ id: string; statement: string; probability: number }>;
  provider: string;
  model: string;
  threshold: number;
}

interface Vocabulary {
  transitions: Record<string, { from: string; to: string; action: string; guard?: string }>;
  states: Record<string, { screen: string; variants: Record<string, string>; initial: boolean }>;
  invariants: Record<string, string>;
}

/** Extract the closed vocabulary from an aide. */
export function extractVocabulary(tree: AideTree): Vocabulary {
  const v: Vocabulary = { transitions: {}, states: {}, invariants: {} };
  for (const [id, e] of Object.entries(tree.entities)) {
    const p = e.props ?? {};
    if (id.startsWith("tr_") && typeof p.from === "string" && typeof p.to === "string") {
      v.transitions[id] = {
        from: p.from,
        to: p.to,
        action: typeof p.action === "string" ? p.action : id,
        guard: typeof p.guard === "string" ? p.guard : undefined,
      };
    } else if (id.startsWith("st_")) {
      const variants: Record<string, string> = {};
      for (const [k, val] of Object.entries(p)) {
        if (k.startsWith("comp_") && typeof val === "string") variants[k] = val;
      }
      v.states[id] = {
        screen: typeof p.screen === "string" ? p.screen : "",
        variants,
        initial: p.initial === true,
      };
    } else if (id.startsWith("inv_") && typeof p.statement === "string") {
      v.invariants[id] = p.statement;
    }
  }
  return v;
}

/** Build the oracle request for a proposal. Exported so tests can inspect it. */
export function buildGateQuestions(vocab: Vocabulary, from?: string): Record<string, Question> {
  const criteria: Record<string, string> = {};
  for (const [id, t] of Object.entries(vocab.transitions)) {
    if (from && t.from !== from) continue;
    criteria[id] = `${t.action}: ${t.from} → ${t.to}${t.guard ? ` (guard: ${t.guard})` : ""}`;
  }
  criteria[OUT_OF_VOCABULARY] =
    "The proposal is not any single declared transition: it adds new behavior, combines several transitions, or changes the specification itself.";

  const questions: Record<string, Question> = {
    transition: {
      type: "choice",
      instructions:
        "Which declared transition does `proposal` perform? Pick out_of_vocabulary unless the proposal is exactly one declared transition.",
      criteria,
    } satisfies ChoiceQuestion,
  };

  for (const [id, statement] of Object.entries(vocab.invariants)) {
    questions[id] = {
      type: "noul",
      instructions: `Would performing \`proposal\` violate this invariant? ${statement}`,
      criteria: {
        true: "Performing the proposal would break the invariant.",
        false: "The invariant is untouched or preserved.",
      },
    } satisfies NoulQuestion;
  }
  return questions;
}

/**
 * Gate a proposal against the aide's transition vocabulary and invariants.
 */
export async function gateProposal(
  tree: AideTree,
  oracle: DecisionModel,
  options: { proposal: string; from?: string; threshold: number }
): Promise<GateResult> {
  const { proposal, from, threshold } = options;
  const vocab = extractVocabulary(tree);
  const base = {
    proposal,
    confidence: 0,
    probabilities: {} as Record<string, number>,
    invariantsAtRisk: [] as GateResult["invariantsAtRisk"],
    provider: oracle.name,
    model: "",
    threshold,
  };

  if (Object.keys(vocab.transitions).length === 0) {
    return {
      ...base,
      decision: "escalate",
      reason: "Aide declares no transitions (tr_*); every change is out of vocabulary until the state machine is specified.",
    };
  }
  if (from && !vocab.states[from] && !Object.values(vocab.transitions).some((t) => t.from === from)) {
    return { ...base, decision: "reject", reason: `Unknown current state "${from}".` };
  }

  const questions = buildGateQuestions(vocab, from);
  const state = {
    proposal,
    current_state: from ?? null,
    states: vocab.states,
    transitions: vocab.transitions,
  };

  const response = await oracle.decide({ state, questions });
  const t = expectAnswer(response, "transition", "choice");

  const invariantsAtRisk: GateResult["invariantsAtRisk"] = [];
  let invariantViolated = false;
  for (const [id, statement] of Object.entries(vocab.invariants)) {
    const a = response.answers[id];
    if (!a || a.type !== "noul") continue;
    if (a.probability > 1 - threshold) {
      invariantsAtRisk.push({ id, statement, probability: a.probability });
    }
    if (a.probability >= threshold) invariantViolated = true;
  }
  invariantsAtRisk.sort((x, y) => y.probability - x.probability);

  const result: GateResult = {
    ...base,
    decision: "escalate",
    reason: "",
    confidence: t.confidence,
    probabilities: t.probabilities,
    invariantsAtRisk,
    model: response.model,
  };

  if (t.choice === OUT_OF_VOCABULARY) {
    if (t.confidence >= threshold) {
      return { ...result, decision: "reject", reason: "Proposal is not a declared transition (out of vocabulary). Add a tr_* to the aide first, or ask the organizer." };
    }
    return { ...result, decision: "escalate", reason: `Oracle leans out-of-vocabulary (confidence ${t.confidence.toFixed(2)} < ${threshold}); organizer must decide.` };
  }

  const chosen = vocab.transitions[t.choice];
  if (!chosen) {
    return { ...result, decision: "escalate", reason: `Oracle chose unknown transition "${t.choice}".` };
  }
  result.transition = { id: t.choice, ...chosen };

  if (from && chosen.from !== from) {
    return { ...result, decision: "reject", reason: `Transition ${t.choice} starts at ${chosen.from}, not current state ${from}.` };
  }
  if (invariantViolated) {
    const worst = invariantsAtRisk[0];
    return { ...result, decision: "reject", reason: `Would violate ${worst.id} (P=${worst.probability.toFixed(2)}): ${worst.statement}` };
  }
  if (t.confidence < threshold) {
    return { ...result, decision: "escalate", reason: `Matched ${t.choice} with confidence ${t.confidence.toFixed(2)} < ${threshold}; organizer must confirm.` };
  }
  if (invariantsAtRisk.length > 0) {
    const worst = invariantsAtRisk[0];
    return { ...result, decision: "escalate", reason: `Matched ${t.choice}, but ${worst.id} may be at risk (P=${worst.probability.toFixed(2)}); organizer must confirm.` };
  }
  return { ...result, decision: "allow", reason: `Proposal is declared transition ${t.choice} (${chosen.action}).` };
}

export async function runGate(projectPath: string, options: GateOptions): Promise<GateResult> {
  const resolved = await tryResolveAidePath(projectPath, options.aide);
  if (!resolved) {
    throw new Error("No .aide file found. Run 'bantay aide init' to create one.");
  }
  const tree = await read(resolved.path);
  const config = await loadConfig(projectPath);

  let oracle = options.decisionModel ?? null;
  let threshold = options.threshold ?? config.decision?.threshold ?? 0.8;
  if (!oracle) {
    const r = createDecisionModel(config.decision);
    oracle = r.model;
    threshold = options.threshold ?? r.threshold;
    if (!oracle) {
      throw new DecisionError(
        "No decision provider configured. Set `decision.provider` in bantay.config.yml (jev | systemone | ollama | anthropic) or BANTAY_DECISION_PROVIDER.",
        "none"
      );
    }
  }

  return gateProposal(tree, oracle, { proposal: options.proposal, from: options.from, threshold });
}

export function exitCodeFor(decision: GateDecision): number {
  return decision === "allow" ? 0 : decision === "reject" ? 1 : 2;
}

export function formatGateResult(r: GateResult): string {
  const icon = r.decision === "allow" ? "✓" : r.decision === "reject" ? "✗" : "?";
  const lines = [`${icon} ${r.decision.toUpperCase()} — ${r.reason}`];
  if (r.transition) {
    lines.push(`  transition: ${r.transition.id}  (${r.transition.from} → ${r.transition.to})`);
  }
  lines.push(`  confidence: ${r.confidence.toFixed(2)}  threshold: ${r.threshold}  oracle: ${r.provider}${r.model ? `/${r.model}` : ""}`);
  for (const inv of r.invariantsAtRisk) {
    lines.push(`  at risk: ${inv.id} P=${inv.probability.toFixed(2)} — ${inv.statement}`);
  }
  return lines.join("\n");
}
