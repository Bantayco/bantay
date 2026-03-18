/**
 * bin-field.ts — enforces inv_cli_invocable
 *
 * Read package.json, verify "bantay" exists in the bin object,
 * verify the target file exists.
 */

import { readFile, stat } from "fs/promises";
import { join } from "path";

export const name = "bin-field";
export const description =
  "Ensures bantay command resolves to the CLI entry point via bin field in package.json";

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

export async function check(config: CheckerConfig): Promise<CheckResult> {
  const violations: Violation[] = [];
  const packagePath = join(config.projectPath, "package.json");

  let packageJson: {
    bin?: Record<string, string> | string;
    name?: string;
  };

  try {
    const content = await readFile(packagePath, "utf-8");
    packageJson = JSON.parse(content);
  } catch (err) {
    violations.push({
      file: "package.json",
      line: 1,
      message: `Cannot read package.json: ${err instanceof Error ? err.message : err}`,
    });
    return { pass: false, violations };
  }

  // Check if bin field exists
  if (!packageJson.bin) {
    violations.push({
      file: "package.json",
      line: 1,
      message: 'Missing "bin" field - CLI cannot be invoked by name',
    });
    return { pass: false, violations };
  }

  // Handle string bin (single command using package name)
  if (typeof packageJson.bin === "string") {
    // Check if the file exists
    const binPath = join(config.projectPath, packageJson.bin);
    try {
      await stat(binPath);
    } catch {
      violations.push({
        file: "package.json",
        line: 1,
        message: `bin target "${packageJson.bin}" does not exist`,
      });
    }
    return { pass: violations.length === 0, violations };
  }

  // Handle object bin
  if (!packageJson.bin.bantay) {
    violations.push({
      file: "package.json",
      line: 1,
      message: 'Missing "bantay" in bin object - CLI cannot be invoked as "bantay"',
    });
    return { pass: false, violations };
  }

  // Verify the target file exists
  const binTarget = packageJson.bin.bantay;
  const binPath = join(config.projectPath, binTarget);

  try {
    await stat(binPath);
  } catch {
    violations.push({
      file: "package.json",
      line: 1,
      message: `bin target "${binTarget}" does not exist`,
    });
  }

  return {
    pass: violations.length === 0,
    violations,
  };
}
