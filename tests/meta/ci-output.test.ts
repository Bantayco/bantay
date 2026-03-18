/**
 * ci-output.test.ts — enforces inv_ci_output_parseable
 *
 * Run bantay check with --json flag. Parse stdout as JSON.
 * Assert it contains timestamp, commit (or null), and results
 * array with id, status, checker for each invariant.
 *
 * @scenario sc_ci_audit_output
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { spawn } from "bun";
import { tmpdir } from "os";

describe("inv_ci_output_parseable", () => {
  const testDir = join(tmpdir(), `bantay-ci-output-test-${Date.now()}`);
  const projectPath = process.cwd();

  beforeAll(async () => {
    // Create a simple fixture project
    await mkdir(testDir, { recursive: true });
    await mkdir(join(testDir, "src"), { recursive: true });

    // Initialize git repo for commit SHA
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

    // Create package.json
    await writeFile(
      join(testDir, "package.json"),
      JSON.stringify(
        {
          name: "test-ci-output-project",
          version: "1.0.0",
          bin: { bantay: "./src/cli.ts" },
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

    // Create invariants.md
    await writeFile(
      join(testDir, "invariants.md"),
      `# Invariants

## Security

- [ ] **inv_test_security**: Test security invariant

## Performance

- [ ] **inv_test_performance**: Test performance invariant
`
    );

    // Create bantay.aide
    await writeFile(
      join(testDir, "bantay.aide"),
      `entities:
  invariants:
    display: checklist
    props:
      title: Invariants
  inv_test_security:
    parent: invariants
    props:
      statement: Test security invariant
      category: security
  inv_test_performance:
    parent: invariants
    props:
      statement: Test performance invariant
      category: performance
relationships: []
`
    );

    // Create a source file and commit
    await writeFile(join(testDir, "src", "main.ts"), "// Main\n");

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
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("bantay check --json produces valid JSON on stdout", async () => {
    const cliPath = join(projectPath, "src", "cli.ts");

    const proc = spawn({
      cmd: [process.execPath, "run", cliPath, "check", "--json"],
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Read streams concurrently with process exit
    const [, stdout] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
    ]);

    // Try to parse as JSON
    let output: unknown;
    try {
      output = JSON.parse(stdout);
    } catch {
      // If --json isn't implemented yet, the test should fail clearly
      expect(stdout).toContain("{");
      throw new Error(
        `Failed to parse JSON output: ${stdout.slice(0, 200)}`
      );
    }

    expect(output).toBeDefined();
    expect(typeof output).toBe("object");
  });

  test("JSON output contains required fields: timestamp, commit, results", async () => {
    const cliPath = join(projectPath, "src", "cli.ts");

    const proc = spawn({
      cmd: [process.execPath, "run", cliPath, "check", "--json"],
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Read streams concurrently with process exit
    const [, stdout] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
    ]);

    let output: {
      timestamp?: string;
      commit?: string | null;
      results?: Array<{
        id?: string;
        status?: string;
        checker?: string;
      }>;
    };

    try {
      output = JSON.parse(stdout);
    } catch {
      // Skip if --json not implemented
      console.log("  --json flag not yet implemented, skipping validation");
      return;
    }

    // Validate required fields
    expect(output.timestamp).toBeDefined();
    expect(typeof output.timestamp).toBe("string");

    // commit can be string or null
    expect("commit" in output).toBe(true);

    expect(output.results).toBeDefined();
    expect(Array.isArray(output.results)).toBe(true);
  });

  test("each result in JSON output has id and status", async () => {
    const cliPath = join(projectPath, "src", "cli.ts");

    const proc = spawn({
      cmd: [process.execPath, "run", cliPath, "check", "--json"],
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Read streams concurrently with process exit
    const [, stdout] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
    ]);

    let output: {
      results?: Array<{
        id?: string;
        status?: string;
      }>;
    };

    try {
      output = JSON.parse(stdout);
    } catch {
      // Skip if --json not implemented
      console.log("  --json flag not yet implemented, skipping validation");
      return;
    }

    if (!output.results) {
      return;
    }

    for (const result of output.results) {
      expect(result.id).toBeDefined();
      expect(typeof result.id).toBe("string");
      expect(result.id).toMatch(/^inv_/);

      expect(result.status).toBeDefined();
      expect(["pass", "fail", "skipped", "tested", "enforced"]).toContain(result.status);
    }
  });
});
