/**
 * stable-ids.ts — enforces inv_stable_ids
 *
 * Parse invariants.md, collect all IDs. Verify each invariant has
 * a unique stable ID. IDs should follow the pattern inv_*.
 */

import { readFile } from "fs/promises";
import { join } from "path";

export const name = "stable-ids";
export const description =
  "Ensures each invariant in invariants.md has a unique stable ID that persists across edits";

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

// Match invariant lines like:
// - [ ] **inv_no_network**: statement
// - **inv_no_network**: statement
// - [inv_no_network] category | statement
const INVARIANT_PATTERNS = [
  /^\s*-\s*\[\s*[x ]?\s*\]\s*\*\*([a-z_][a-z0-9_]*)\*\*:/i,
  /^\s*-\s*\*\*([a-z_][a-z0-9_]*)\*\*:/i,
  /^\s*-\s*\[([a-z_][a-z0-9_]*)\]/i,
];

export async function check(config: CheckerConfig): Promise<CheckResult> {
  const violations: Violation[] = [];
  const invariantsPath = join(config.projectPath, "invariants.md");

  let content: string;
  try {
    content = await readFile(invariantsPath, "utf-8");
  } catch {
    // No invariants.md is fine for this check
    return { pass: true, violations: [] };
  }

  const lines = content.split("\n");
  const seenIds = new Map<string, number>(); // id -> first line number

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Try to match invariant patterns
    for (const pattern of INVARIANT_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        const id = match[1];

        // Check ID format
        if (!id.startsWith("inv_")) {
          violations.push({
            file: "invariants.md",
            line: lineNum,
            message: `Invariant ID "${id}" does not follow inv_* naming convention`,
          });
        }

        // Check for duplicates
        if (seenIds.has(id)) {
          const firstLine = seenIds.get(id)!;
          violations.push({
            file: "invariants.md",
            line: lineNum,
            message: `Duplicate invariant ID "${id}" (first seen on line ${firstLine})`,
          });
        } else {
          seenIds.set(id, lineNum);
        }

        // Check ID stability (no special characters that might cause issues)
        if (!/^[a-z][a-z0-9_]*$/.test(id)) {
          violations.push({
            file: "invariants.md",
            line: lineNum,
            message: `Invariant ID "${id}" contains invalid characters (use lowercase, numbers, underscores only)`,
          });
        }

        break; // Only match one pattern per line
      }
    }
  }

  // If no invariants found, that might be okay for an empty project
  // but warn if the file exists but has no parseable invariants
  if (seenIds.size === 0 && content.trim().length > 0) {
    // Check if the file has any content that looks like it should have invariants
    if (content.includes("##") && content.includes("-")) {
      violations.push({
        file: "invariants.md",
        line: 1,
        message:
          "No valid invariant IDs found - ensure each invariant has an ID like inv_name",
      });
    }
  }

  return {
    pass: violations.length === 0,
    violations,
  };
}
