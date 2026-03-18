/**
 * init-no-overwrite.ts — enforces inv_init_no_overwrite
 *
 * Create an invariants.md with custom content. Run bantay init.
 * Fail if the file was modified.
 */

import { mkdir, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { spawn } from "bun";
import { tmpdir } from "os";

export const name = "init-no-overwrite";
export const description =
  "Ensures bantay init never overwrites an existing invariants.md";

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

const CUSTOM_INVARIANTS = `# My Custom Invariants

This file was hand-written and should never be overwritten by bantay init.

## Security

- [inv_custom_001] security | All passwords must be hashed with bcrypt
- [inv_custom_002] security | API keys must never be logged

## Data

- [inv_custom_003] data | All timestamps must be stored in UTC

Custom notes: These are my team's specific rules.
`;

export async function check(config: CheckerConfig): Promise<CheckResult> {
  const violations: Violation[] = [];
  const testDir = join(tmpdir(), `bantay-init-no-overwrite-test-${Date.now()}`);

  try {
    // Create test project structure
    await mkdir(testDir, { recursive: true });
    await mkdir(join(testDir, "src"), { recursive: true });

    // Create a minimal package.json to look like a project
    await writeFile(
      join(testDir, "package.json"),
      JSON.stringify(
        {
          name: "test-project",
          version: "1.0.0",
          dependencies: {},
        },
        null,
        2
      )
    );

    // Create the custom invariants.md
    await writeFile(join(testDir, "invariants.md"), CUSTOM_INVARIANTS);

    // Record the original content
    const originalContent = await readFile(
      join(testDir, "invariants.md"),
      "utf-8"
    );

    // Run bantay init
    const cliPath = join(config.projectPath, "src", "cli.ts");
    const proc = spawn({
      cmd: [process.execPath, "run", cliPath, "init"],
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    await proc.exited;

    // Read the content after init
    const afterContent = await readFile(
      join(testDir, "invariants.md"),
      "utf-8"
    );

    // Check if the file was modified
    if (originalContent !== afterContent) {
      violations.push({
        file: "invariants.md",
        line: 1,
        message:
          "bantay init modified existing invariants.md - this violates inv_init_no_overwrite",
      });
    }
  } catch (error) {
    violations.push({
      file: "init-no-overwrite.ts",
      line: 0,
      message: `Test failed: ${error instanceof Error ? error.message : error}`,
    });
  } finally {
    // Cleanup
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }

  return {
    pass: violations.length === 0,
    violations,
  };
}
