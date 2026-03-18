/**
 * diff-subset.test.ts — enforces inv_diff_subset
 *
 * Run bantay check full and bantay check --diff against the same fixture.
 * Assert every failure in diff mode also appears in full mode.
 * Assert diff mode never finds something full mode misses.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { spawn } from "bun";
import { tmpdir } from "os";

describe("inv_diff_subset", () => {
  const testDir = join(tmpdir(), `bantay-diff-subset-test-${Date.now()}`);
  const projectPath = process.cwd();

  beforeAll(async () => {
    // Create a fixture project that's a git repo with some changes
    await mkdir(testDir, { recursive: true });
    await mkdir(join(testDir, "src"), { recursive: true });

    // Initialize git repo
    await spawn({
      cmd: ["git", "init"],
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    }).exited;

    await spawn({
      cmd: ["git", "config", "user.email", "test@test.com"],
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    }).exited;

    await spawn({
      cmd: ["git", "config", "user.name", "Test"],
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    }).exited;

    // Create package.json with bin field
    await writeFile(
      join(testDir, "package.json"),
      JSON.stringify(
        {
          name: "test-diff-project",
          version: "1.0.0",
          bin: { bantay: "./src/cli.ts" },
        },
        null,
        2
      )
    );

    // Create a source file
    await writeFile(join(testDir, "src", "cli.ts"), "console.log('hello');");

    // Create bantay.config.yml
    await writeFile(
      join(testDir, "bantay.config.yml"),
      "sourceDirectories:\n  - src\n"
    );

    // Create invariants.md
    await writeFile(
      join(testDir, "invariants.md"),
      `# Invariants

## Prerequisites

- [ ] **inv_cli_invocable**: bantay command resolves to the CLI entry point via bin field in package.json
`
    );

    // Create minimal bantay.aide
    await writeFile(
      join(testDir, "bantay.aide"),
      `entities:
  invariants:
    display: checklist
    props:
      title: Invariants
  inv_cli_invocable:
    parent: invariants
    props:
      statement: bantay command resolves to the CLI entry point via bin field in package.json
      category: prerequisites
relationships: []
`
    );

    // Initial commit
    await spawn({
      cmd: ["git", "add", "-A"],
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    }).exited;

    await spawn({
      cmd: ["git", "commit", "-m", "initial"],
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    }).exited;

    // Make a change (add a new source file)
    await writeFile(
      join(testDir, "src", "new-file.ts"),
      "export const x = 1;"
    );
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("diff mode results are a subset of full mode results", async () => {
    const cliPath = join(projectPath, "src", "cli.ts");

    // Run full check
    const fullProc = spawn({
      cmd: [process.execPath, "run", cliPath, "check"],
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    // Read streams concurrently with process exit
    const [, fullOutput] = await Promise.all([
      fullProc.exited,
      new Response(fullProc.stderr).text(),
    ]);

    // Run diff check
    const diffProc = spawn({
      cmd: [process.execPath, "run", cliPath, "check", "--diff", "HEAD"],
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    // Read streams concurrently with process exit
    const [, diffOutput] = await Promise.all([
      diffProc.exited,
      new Response(diffProc.stderr).text(),
    ]);

    // Parse results from both outputs
    const parseResults = (output: string) => {
      const results = new Map<string, string>();
      const lines = output.split("\n");
      for (const line of lines) {
        const match = line.match(/\[(inv_[a-z_]+)\]\s+(PASS|FAIL|SKIPPED)/);
        if (match) {
          results.set(match[1], match[2]);
        }
      }
      return results;
    };

    const fullResults = parseResults(fullOutput);
    const diffResults = parseResults(diffOutput);

    // Every failure in diff mode must also be a failure in full mode
    for (const [id, status] of diffResults) {
      if (status === "FAIL") {
        const fullStatus = fullResults.get(id);
        expect(fullStatus).toBe(
          "FAIL",
          `Invariant ${id} failed in diff mode but not in full mode`
        );
      }
    }

    // Diff mode should not catch more failures than full mode
    // (it's a subset, so it may catch fewer or the same)
    const diffFailures = [...diffResults.values()].filter(
      (s) => s === "FAIL"
    ).length;
    const fullFailures = [...fullResults.values()].filter(
      (s) => s === "FAIL"
    ).length;

    expect(diffFailures).toBeLessThanOrEqual(fullFailures);
  });

  test("diff mode never finds violations that full mode misses", async () => {
    const cliPath = join(projectPath, "src", "cli.ts");

    // Run full check
    const fullProc = spawn({
      cmd: [process.execPath, "run", cliPath, "check"],
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    // Read streams concurrently with process exit
    const [, fullOutput] = await Promise.all([
      fullProc.exited,
      new Response(fullProc.stderr).text(),
    ]);

    // Run diff check
    const diffProc = spawn({
      cmd: [process.execPath, "run", cliPath, "check", "--diff", "HEAD"],
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    // Read streams concurrently with process exit
    const [, diffOutput] = await Promise.all([
      diffProc.exited,
      new Response(diffProc.stderr).text(),
    ]);

    // Extract violation details (file paths mentioned)
    const extractViolations = (output: string) => {
      const violations: string[] = [];
      const lines = output.split("\n");
      for (const line of lines) {
        // Lines starting with "  - " are violations
        if (line.match(/^\s+-\s+\S+:\d+:/)) {
          violations.push(line.trim());
        }
      }
      return violations;
    };

    const fullViolations = extractViolations(fullOutput);
    const diffViolations = extractViolations(diffOutput);

    // Every violation in diff mode should be in full mode
    for (const violation of diffViolations) {
      expect(fullViolations).toContain(violation);
    }
  });
});
