/**
 * no-inline-shell.ts — enforces inv_no_inline_shell
 *
 * Scan invariants.md for any line starting with "check:" — fail if found.
 * Also check for other patterns that might indicate executable commands.
 */

import { readFile } from "fs/promises";
import { join } from "path";

export const name = "no-inline-shell";
export const description =
  "Ensures invariants.md never contains executable shell commands";

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

// Patterns that indicate inline shell commands
const DANGEROUS_PATTERNS = [
  { pattern: /^\s*check:\s*\S/, message: "Found 'check:' field with command" },
  { pattern: /^\s*run:\s*\S/, message: "Found 'run:' field with command" },
  { pattern: /^\s*exec:\s*\S/, message: "Found 'exec:' field with command" },
  { pattern: /^\s*command:\s*\S/, message: "Found 'command:' field" },
  { pattern: /^\s*script:\s*\S/, message: "Found 'script:' field" },
  { pattern: /^\s*shell:\s*\S/, message: "Found 'shell:' field" },
  {
    pattern: /`[^`]*\$\([^)]+\)[^`]*`/,
    message: "Found command substitution in backticks",
  },
  { pattern: /^\s*```(bash|sh|shell|zsh)\s*$/i, message: "Found shell code block" },
];

export async function check(config: CheckerConfig): Promise<CheckResult> {
  const violations: Violation[] = [];
  const invariantsPath = join(config.projectPath, "invariants.md");

  let content: string;
  try {
    content = await readFile(invariantsPath, "utf-8");
  } catch {
    // No invariants.md is fine
    return { pass: true, violations: [] };
  }

  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    for (const { pattern, message } of DANGEROUS_PATTERNS) {
      if (pattern.test(line)) {
        violations.push({
          file: "invariants.md",
          line: lineNum,
          message: `${message} - inline shell commands are forbidden`,
        });
      }
    }
  }

  return {
    pass: violations.length === 0,
    violations,
  };
}
