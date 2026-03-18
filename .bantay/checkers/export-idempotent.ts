/**
 * export-idempotent.ts — enforces inv_export_idempotent
 *
 * Run bantay export all twice, diff the outputs, fail if any byte differs.
 */

import { readFile } from "fs/promises";
import { join } from "path";
import { spawn } from "bun";

export const name = "export-idempotent";
export const description = "Ensures running bantay export twice produces identical output";

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

const OUTPUT_FILES = ["invariants.md", "CLAUDE.md", ".cursorrules"];

async function readOutputFiles(
  projectPath: string
): Promise<Map<string, string>> {
  const contents = new Map<string, string>();

  for (const file of OUTPUT_FILES) {
    try {
      const content = await readFile(join(projectPath, file), "utf-8");
      contents.set(file, content);
    } catch {
      // File doesn't exist, that's fine
    }
  }

  return contents;
}

async function runExport(projectPath: string): Promise<boolean> {
  const cliPath = join(projectPath, "src", "cli.ts");

  const proc = spawn({
    cmd: [process.execPath, "run", cliPath, "export", "all"],
    cwd: projectPath,
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;
  return exitCode === 0;
}

export async function check(config: CheckerConfig): Promise<CheckResult> {
  const violations: Violation[] = [];

  // Run first export
  const firstExportSuccess = await runExport(config.projectPath);
  if (!firstExportSuccess) {
    violations.push({
      file: "export",
      line: 0,
      message: "First export failed",
    });
    return { pass: false, violations };
  }

  // Read outputs after first export
  const firstOutputs = await readOutputFiles(config.projectPath);

  // Run second export
  const secondExportSuccess = await runExport(config.projectPath);
  if (!secondExportSuccess) {
    violations.push({
      file: "export",
      line: 0,
      message: "Second export failed",
    });
    return { pass: false, violations };
  }

  // Read outputs after second export
  const secondOutputs = await readOutputFiles(config.projectPath);

  // Compare outputs
  for (const file of OUTPUT_FILES) {
    const first = firstOutputs.get(file);
    const second = secondOutputs.get(file);

    if (first === undefined && second === undefined) {
      // Neither exists, that's fine
      continue;
    }

    if (first === undefined || second === undefined) {
      violations.push({
        file,
        line: 0,
        message: `File existence changed between exports`,
      });
      continue;
    }

    if (first !== second) {
      // Find first differing line
      const firstLines = first.split("\n");
      const secondLines = second.split("\n");
      let diffLine = 1;

      for (let i = 0; i < Math.max(firstLines.length, secondLines.length); i++) {
        if (firstLines[i] !== secondLines[i]) {
          diffLine = i + 1;
          break;
        }
      }

      violations.push({
        file,
        line: diffLine,
        message: `Output differs between consecutive exports (not idempotent)`,
      });
    }
  }

  return {
    pass: violations.length === 0,
    violations,
  };
}
