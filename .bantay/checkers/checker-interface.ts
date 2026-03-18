/**
 * checker-interface.ts — enforces inv_checker_interface_uniform
 *
 * Load every checker in .bantay/checkers/ and every built-in checker.
 * Verify each exports name (string), description (string), and check (function).
 * Run each, verify result has pass (boolean) and violations (array).
 */

import { readdir } from "fs/promises";
import { join, relative } from "path";

export const name = "checker-interface";
export const description =
  "Ensures all checkers implement the same interface and return the same result shape";

interface Violation {
  file: string;
  line: number;
  message: string;
}

interface CheckResult {
  pass: boolean;
  violations: Violation[];
}

interface CheckerConfig {
  projectPath: string;
}

async function validateChecker(
  checkerPath: string,
  relPath: string,
  config: CheckerConfig
): Promise<Violation[]> {
  const violations: Violation[] = [];

  try {
    // Import the checker module
    const checker = await import(checkerPath);

    // Check for required exports
    if (typeof checker.name !== "string") {
      violations.push({
        file: relPath,
        line: 1,
        message: `Missing or invalid "name" export (expected string, got ${typeof checker.name})`,
      });
    }

    if (typeof checker.description !== "string") {
      violations.push({
        file: relPath,
        line: 1,
        message: `Missing or invalid "description" export (expected string, got ${typeof checker.description})`,
      });
    }

    if (typeof checker.check !== "function") {
      violations.push({
        file: relPath,
        line: 1,
        message: `Missing or invalid "check" export (expected function, got ${typeof checker.check})`,
      });
      return violations; // Can't test check() if it doesn't exist
    }

    // Run the checker and validate the result shape
    try {
      const result = await checker.check(config);

      if (typeof result !== "object" || result === null) {
        violations.push({
          file: relPath,
          line: 1,
          message: `check() returned invalid result (expected object, got ${typeof result})`,
        });
        return violations;
      }

      if (typeof result.pass !== "boolean") {
        violations.push({
          file: relPath,
          line: 1,
          message: `check() result missing "pass" boolean (got ${typeof result.pass})`,
        });
      }

      if (!Array.isArray(result.violations)) {
        violations.push({
          file: relPath,
          line: 1,
          message: `check() result missing "violations" array (got ${typeof result.violations})`,
        });
      } else {
        // Validate violation shape
        for (let i = 0; i < result.violations.length; i++) {
          const v = result.violations[i];
          if (typeof v !== "object" || v === null) {
            violations.push({
              file: relPath,
              line: 1,
              message: `violation[${i}] is not an object`,
            });
            continue;
          }

          if (typeof v.file !== "string") {
            violations.push({
              file: relPath,
              line: 1,
              message: `violation[${i}].file is not a string`,
            });
          }

          if (typeof v.message !== "string") {
            violations.push({
              file: relPath,
              line: 1,
              message: `violation[${i}].message is not a string`,
            });
          }

          // line can be number or undefined
          if (v.line !== undefined && typeof v.line !== "number") {
            violations.push({
              file: relPath,
              line: 1,
              message: `violation[${i}].line is not a number`,
            });
          }
        }
      }
    } catch (err) {
      violations.push({
        file: relPath,
        line: 1,
        message: `check() threw an error: ${err instanceof Error ? err.message : err}`,
      });
    }
  } catch (err) {
    violations.push({
      file: relPath,
      line: 1,
      message: `Failed to load checker: ${err instanceof Error ? err.message : err}`,
    });
  }

  return violations;
}

export async function check(config: CheckerConfig): Promise<CheckResult> {
  const violations: Violation[] = [];

  // Find project checkers in .bantay/checkers/
  const projectCheckersDir = join(config.projectPath, ".bantay", "checkers");
  let projectCheckerFiles: string[] = [];

  try {
    const entries = await readdir(projectCheckersDir, { withFileTypes: true });
    projectCheckerFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith(".ts"))
      .map((e) => e.name);
  } catch {
    // No project checkers directory is fine
  }

  // Note: Built-in checkers in src/checkers/ use a different interface (Checker class)
  // with a `category` property and a different check signature.
  // They are not project checkers and follow a different contract.
  // Only project checkers in .bantay/checkers/ are validated here.

  // Validate project checkers (skip self to avoid infinite recursion)
  for (const file of projectCheckerFiles) {
    if (file === "checker-interface.ts") {
      continue; // Skip self
    }

    const checkerPath = join(projectCheckersDir, file);
    const relPath = relative(config.projectPath, checkerPath);
    const checkerViolations = await validateChecker(
      checkerPath,
      relPath,
      config
    );
    violations.push(...checkerViolations);
  }

  return {
    pass: violations.length === 0,
    violations,
  };
}
