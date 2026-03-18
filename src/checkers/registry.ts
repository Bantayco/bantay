import type { Checker, CheckResult, CheckerContext } from "./types";
import type { Invariant } from "../generators/invariants";
import { authChecker } from "./auth";
import { schemaChecker } from "./schema";
import { loggingChecker } from "./logging";

const checkers: Map<string, Checker> = new Map();

export function registerChecker(checker: Checker): void {
  checkers.set(checker.category, checker);
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

// Register built-in checkers
registerChecker(authChecker);
registerChecker(schemaChecker);
registerChecker(loggingChecker);
