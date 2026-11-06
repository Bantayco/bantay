import type { Invariant } from "../generators/invariants";
import type { DecisionConfig } from "../decision/types";

export interface CheckViolation {
  filePath: string;
  line?: number;
  message: string;
}

export interface CheckResult {
  invariant: Invariant;
  status: CheckStatus;
  violations: CheckViolation[];
  message?: string;
  /** Present when the result came from the decision oracle. */
  oracle?: OracleVerdict;
}

/**
 * - review: the decision oracle was not confident enough to decide; a human
 *   (the organizer) must look.
 */
export type CheckStatus = "pass" | "fail" | "skipped" | "tested" | "enforced" | "review";

export interface OracleVerdict {
  provider: string;
  model: string;
  /** P(violated) for this invariant, from a noul question. */
  violationProbability: number;
  threshold: number;
}

export interface CheckerContext {
  projectPath: string;
  config: BantayConfig;
}

export interface BantayConfig {
  sourceDirectories: string[];
  routeDirectories?: string[];
  schemaPath?: string;
  decision?: DecisionConfig;
}

export interface Checker {
  category: string;
  check(invariant: Invariant, context: CheckerContext): Promise<CheckResult>;
}

/**
 * Structural checker result - independent of invariants
 */
export interface StructuralCheckResult {
  name: string;
  status: "pass" | "fail";
  violations: CheckViolation[];
  message?: string;
}

/**
 * Structural checker - runs based on aide structure, not invariants
 */
export interface StructuralChecker {
  name: string;
  description: string;
  /**
   * Check if this structural checker should run for the given project.
   * Returns true if relevant (e.g., aide has comp_* entities for wireframe checker).
   */
  shouldRun(context: CheckerContext): Promise<boolean>;
  /**
   * Run the structural check.
   */
  check(context: CheckerContext): Promise<StructuralCheckResult>;
}
