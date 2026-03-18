/**
 * false-negatives.test.ts — enforces inv_no_false_negatives
 *
 * Create a fixture project with a known violation.
 * Run bantay check. Assert the violation is caught.
 * A PASS here means bantay is lying.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { spawn } from "bun";
import { tmpdir } from "os";

describe("inv_no_false_negatives", () => {
  const testDir = join(tmpdir(), `bantay-false-neg-test-${Date.now()}`);
  const projectPath = process.cwd();

  beforeAll(async () => {
    // Create a fixture project with a known violation
    await mkdir(testDir, { recursive: true });
    await mkdir(join(testDir, "src"), { recursive: true });
    await mkdir(join(testDir, ".bantay", "checkers"), { recursive: true });

    // Create package.json WITHOUT bin field - this will fail inv_cli_invocable
    await writeFile(
      join(testDir, "package.json"),
      JSON.stringify(
        {
          name: "test-violation-project",
          version: "1.0.0",
          // Intentionally missing bin field
        },
        null,
        2
      )
    );

    // Create bantay.config.yml
    await writeFile(
      join(testDir, "bantay.config.yml"),
      "sourceDirectories:\n  - src\n"
    );

    // Create invariants.md with the bin-field invariant
    await writeFile(
      join(testDir, "invariants.md"),
      `# Invariants

## Prerequisites

- [ ] **inv_cli_invocable**: bantay command resolves to the CLI entry point via bin field in package.json
`
    );

    // Create bantay.aide with the invariant and checker reference
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
      checker: ./bin-field
relationships: []
`
    );

    // Copy the bin-field checker
    const binFieldChecker = await Bun.file(
      join(projectPath, ".bantay", "checkers", "bin-field.ts")
    ).text();
    await writeFile(
      join(testDir, ".bantay", "checkers", "bin-field.ts"),
      binFieldChecker
    );
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("bantay check catches a known violation (missing bin field)", async () => {
    const cliPath = join(projectPath, "src", "cli.ts");

    const proc = spawn({
      cmd: [process.execPath, "run", cliPath, "check"],
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Read streams concurrently with process exit
    const [exitCode, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stderr).text(),
    ]);

    // The check should FAIL because package.json has no bin field
    expect(exitCode).not.toBe(0);
  });

  test("bantay check does not report PASS for violated invariant", async () => {
    const cliPath = join(projectPath, "src", "cli.ts");

    const proc = spawn({
      cmd: [process.execPath, "run", cliPath, "check"],
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Read streams concurrently with process exit
    const [, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stderr).text(),
    ]);

    // Should NOT contain PASS for inv_cli_invocable
    const lines = stderr.split("\n");
    const invLine = lines.find((l) => l.includes("inv_cli_invocable"));
    expect(invLine).toBeDefined();
    expect(invLine).not.toContain("PASS");
  });
});
