import type { Checker, CheckResult, CheckerContext, StructuralChecker, StructuralCheckResult } from "./types";
import type { Invariant } from "../generators/invariants";
import { authChecker } from "./auth";
import { schemaChecker } from "./schema";
import { loggingChecker } from "./logging";
import { wireframeExistsChecker, wireframeStructuralChecker } from "./wireframe-exists";

const checkers: Map<string, Checker> = new Map();
const structuralCheckers: StructuralChecker[] = [];

export function registerChecker(checker: Checker): void {
  checkers.set(checker.category, checker);
}

export function registerStructuralChecker(checker: StructuralChecker): void {
  structuralCheckers.push(checker);
}

export function getChecker(category: string): Checker | undefined {
  return checkers.get(category);
}

export function hasChecker(category: string): boolean {
  return checkers.has(category);
}

export function getAllCategories(): string[] {
  return Array.from(checkers.keys());
}

export function getStructuralCheckers(): StructuralChecker[] {
  return [...structuralCheckers];
}

export async function runChecker(
  invariant: Invariant,
  context: CheckerContext
): Promise<CheckResult> {
  const checker = getChecker(invariant.category);

  if (!checker) {
    return {
      invariant,
      status: "skipped",
      violations: [],
      message: `No checker registered for category "${invariant.category}"`,
    };
  }

  return checker.check(invariant, context);
}

/**
 * Run all structural checkers that should run for this project.
 */
export async function runStructuralCheckers(
  context: CheckerContext
): Promise<StructuralCheckResult[]> {
  const results: StructuralCheckResult[] = [];

  for (const checker of structuralCheckers) {
    if (await checker.shouldRun(context)) {
      const result = await checker.check(context);
      results.push(result);
    }
  }

  return results;
}

// Register built-in checkers
registerChecker(authChecker);
registerChecker(schemaChecker);
registerChecker(loggingChecker);
registerChecker(wireframeExistsChecker);

// Register structural checkers
registerStructuralChecker(wireframeStructuralChecker);
