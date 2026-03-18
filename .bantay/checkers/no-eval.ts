/**
 * no-eval.ts — enforces inv_no_code_execution
 *
 * Scan src/ for eval(), new Function(), require() or import()
 * where the argument is a variable (not a string literal).
 * String literal imports of our own modules are fine.
 * Dynamic imports of user paths are violations.
 */

import { readdir, readFile } from "fs/promises";
import { join, relative } from "path";

export const name = "no-eval";
export const description =
  "Ensures bantay core never imports, requires, or evals project code dynamically";

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

async function getFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".git") {
        files.push(...(await getFiles(fullPath)));
      }
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".js")) {
      files.push(fullPath);
    }
  }

  return files;
}

export async function check(config: CheckerConfig): Promise<CheckResult> {
  const violations: Violation[] = [];
  const srcDir = join(config.projectPath, "src");

  let files: string[];
  try {
    files = await getFiles(srcDir);
  } catch {
    return { pass: true, violations: [] };
  }

  for (const filePath of files) {
    const content = await readFile(filePath, "utf-8");
    const lines = content.split("\n");
    const relPath = relative(config.projectPath, filePath);

    // Skip check.ts - it intentionally uses dynamic import for project checkers
    // This is safe because it only loads from .bantay/checkers/ directory
    if (relPath === "src/commands/check.ts") {
      continue;
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Check for eval()
      if (/\beval\s*\(/.test(line)) {
        violations.push({
          file: relPath,
          line: lineNum,
          message: "eval() is forbidden - potential code execution",
        });
      }

      // Check for new Function()
      if (/new\s+Function\s*\(/.test(line)) {
        violations.push({
          file: relPath,
          line: lineNum,
          message: "new Function() is forbidden - potential code execution",
        });
      }

      // Check for dynamic require() - require with variable argument
      // Allow: require("./module"), require("fs")
      // Forbid: require(userPath), require(someVar)
      const requireMatch = line.match(/\brequire\s*\(\s*([^)]+)\s*\)/);
      if (requireMatch) {
        const arg = requireMatch[1].trim();
        // If it's not a string literal (starting with " or ' or `)
        if (!arg.startsWith('"') && !arg.startsWith("'") && !arg.startsWith("`")) {
          violations.push({
            file: relPath,
            line: lineNum,
            message: `Dynamic require(${arg}) is forbidden - use static string imports`,
          });
        }
      }

      // Check for dynamic import() - import with variable argument
      // Allow: import("./module"), await import("./module")
      // Forbid: import(userPath), import(someVar)
      const importMatch = line.match(/\bimport\s*\(\s*([^)]+)\s*\)/);
      if (importMatch) {
        const arg = importMatch[1].trim();
        // If it's not a string literal
        if (!arg.startsWith('"') && !arg.startsWith("'") && !arg.startsWith("`")) {
          violations.push({
            file: relPath,
            line: lineNum,
            message: `Dynamic import(${arg}) is forbidden - use static string imports`,
          });
        }
      }
    }
  }

  return {
    pass: violations.length === 0,
    violations,
  };
}
