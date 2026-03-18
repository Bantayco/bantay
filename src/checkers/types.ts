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
