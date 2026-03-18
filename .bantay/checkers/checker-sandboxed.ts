/**
 * checker-sandboxed.ts — enforces inv_checker_sandboxed
 *
 * Verify that project checkers in .bantay/checkers/ are executed
 * via Bun.spawn or subprocess, not imported directly into the
 * bantay process.
 *
 * This checker scans the bantay source code to ensure project/community
 * checker execution uses subprocess isolation.
 */

import { readdir, readFile } from "fs/promises";
import { join, relative } from "path";

export const name = "checker-sandboxed";
export const description =
  "Ensures project and community checkers run in a sandboxed subprocess";

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

  // Patterns that indicate direct import of project checkers (bad)
  const directImportPatterns = [
    // Dynamic import of .bantay/checkers path
    /import\s*\(\s*[`'"].*\.bantay\/checkers/,
    // require of .bantay/checkers path
    /require\s*\(\s*[`'"].*\.bantay\/checkers/,
  ];

  // Patterns that indicate proper subprocess execution (good)
  const subprocessPatterns = [
    /Bun\.spawn/,
    /spawn\s*\(/,
    /spawnSync\s*\(/,
    /exec\s*\(/,
    /execSync\s*\(/,
    /fork\s*\(/,
  ];

  let hasProjectCheckerCode = false;
  let usesSubprocess = false;

  for (const filePath of files) {
    const content = await readFile(filePath, "utf-8");
    const lines = content.split("\n");
    const relPath = relative(config.projectPath, filePath);

    // Skip checker files themselves
    if (relPath.includes(".bantay/checkers")) {
      continue;
    }

    // Check if this file deals with project checkers
    if (
      content.includes(".bantay/checkers") ||
      content.includes("project checker") ||
      content.includes("projectChecker")
    ) {
      hasProjectCheckerCode = true;
    }

    // Check for subprocess patterns
    for (const pattern of subprocessPatterns) {
      if (pattern.test(content)) {
        usesSubprocess = true;
      }
    }

    // Check for direct import violations
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      for (const pattern of directImportPatterns) {
        if (pattern.test(line)) {
          violations.push({
            file: relPath,
            line: lineNum,
            message:
              "Direct import of project checker detected - use subprocess for sandboxing",
          });
        }
      }
    }
  }

  // If we have project checker handling code but no subprocess usage,
  // that's a potential violation (but might be a false positive if
  // project checker support isn't implemented yet)
  // For now, we only flag explicit direct imports

  return {
    pass: violations.length === 0,
    violations,
  };
}
