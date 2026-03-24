import type { Invariant } from "../generators/invariants";

export interface CheckViolation {
  filePath: string;
  line?: number;
  message: string;
}

export interface CheckResult {
  invariant: Invariant;
  status: "pass" | "fail" | "skipped" | "tested" | "enforced";
  violations: CheckViolation[];
  message?: string;
}

export interface CheckerContext {
  projectPath: string;
  config: BantayConfig;
}

export interface BantayConfig {
  sourceDirectories: string[];
  routeDirectories?: string[];
  schemaPath?: string;
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
