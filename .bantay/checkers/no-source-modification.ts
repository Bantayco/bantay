/**
 * no-source-modification.ts — enforces inv_no_source_modification
 *
 * Scan src/checkers/ for fs.writeFile, fs.writeSync, Bun.write,
 * or any write operation. Built-in checker modules must be read-only.
 * They should never write to the filesystem.
 */

import { readdir, readFile } from "fs/promises";
import { join, relative } from "path";

export const name = "no-source-modification";
export const description =
  "Ensures built-in checkers never modify project source files";

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

const WRITE_PATTERNS = [
  { pattern: /\bfs\.writeFile\b/, message: "fs.writeFile is forbidden in checker modules" },
  { pattern: /\bfs\.writeFileSync\b/, message: "fs.writeFileSync is forbidden in checker modules" },
  { pattern: /\bfs\.writeSync\b/, message: "fs.writeSync is forbidden in checker modules" },
  { pattern: /\bfs\.appendFile\b/, message: "fs.appendFile is forbidden in checker modules" },
  { pattern: /\bfs\.appendFileSync\b/, message: "fs.appendFileSync is forbidden in checker modules" },
  { pattern: /\bfs\.mkdir\b/, message: "fs.mkdir is forbidden in checker modules" },
  { pattern: /\bfs\.mkdirSync\b/, message: "fs.mkdirSync is forbidden in checker modules" },
  { pattern: /\bfs\.rm\b/, message: "fs.rm is forbidden in checker modules" },
  { pattern: /\bfs\.rmSync\b/, message: "fs.rmSync is forbidden in checker modules" },
  { pattern: /\bfs\.unlink\b/, message: "fs.unlink is forbidden in checker modules" },
  { pattern: /\bfs\.unlinkSync\b/, message: "fs.unlinkSync is forbidden in checker modules" },
  { pattern: /\bfs\.rename\b/, message: "fs.rename is forbidden in checker modules" },
  { pattern: /\bfs\.renameSync\b/, message: "fs.renameSync is forbidden in checker modules" },
  { pattern: /\bfs\.copyFile\b/, message: "fs.copyFile is forbidden in checker modules" },
  { pattern: /\bfs\.copyFileSync\b/, message: "fs.copyFileSync is forbidden in checker modules" },
  { pattern: /\bBun\.write\b/, message: "Bun.write is forbidden in checker modules" },
  { pattern: /\bwriteFile\s*\(/, message: "writeFile() is forbidden in checker modules" },
  { pattern: /\bwriteFileSync\s*\(/, message: "writeFileSync() is forbidden in checker modules" },
  { pattern: /\bwriteSync\s*\(/, message: "writeSync() is forbidden in checker modules" },
];

async function getFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await getFiles(fullPath)));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".js")) {
      files.push(fullPath);
    }
  }

  return files;
}

export async function check(config: CheckerConfig): Promise<CheckResult> {
  const violations: Violation[] = [];
  const checkersDir = join(config.projectPath, "src", "checkers");

  let files: string[];
  try {
    files = await getFiles(checkersDir);
  } catch {
    return { pass: true, violations: [] };
  }

  for (const filePath of files) {
    const content = await readFile(filePath, "utf-8");
    const lines = content.split("\n");
    const relPath = relative(config.projectPath, filePath);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Skip comments
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) {
        continue;
      }

      for (const { pattern, message } of WRITE_PATTERNS) {
        if (pattern.test(line)) {
          violations.push({
            file: relPath,
            line: lineNum,
            message,
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
