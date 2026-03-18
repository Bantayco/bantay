/**
 * benchmark.test.ts — enforces inv_check_speed
 *
 * Generate a fixture with 50 invariants and a 500-line diff.
 * Time bantay check --diff. Assert under 5 seconds.
 *
 * @scenario sc_check_speed
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { spawn } from "bun";
import { tmpdir } from "os";

describe("inv_check_speed", () => {
  const testDir = join(tmpdir(), `bantay-benchmark-test-${Date.now()}`);
  const projectPath = process.cwd();
  const INVARIANT_COUNT = 50;
  const DIFF_LINES = 500;
  const MAX_TIME_MS = 5000;

  beforeAll(async () => {
    // Create a fixture project with 50 invariants
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

    // Create package.json
    await writeFile(
      join(testDir, "package.json"),
      JSON.stringify(
        {
          name: "test-benchmark-project",
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

    // Generate 50 invariants
    const categories = [
      "auth",
      "security",
      "performance",
      "data",
      "logging",
      "api",
      "ui",
      "validation",
      "testing",
      "infra",
    ];

    let invariantsMd = "# Invariants\n\n";

    for (const category of categories) {
      invariantsMd += `## ${category.charAt(0).toUpperCase() + category.slice(1)}\n\n`;

      const count = Math.ceil(INVARIANT_COUNT / categories.length);
      for (let i = 0; i < count; i++) {
        const id = `inv_${category}_${String(i).padStart(3, "0")}`;
        invariantsMd += `- [ ] **${id}**: Test invariant ${i} for ${category}\n`;
      }
      invariantsMd += "\n";
    }

    await writeFile(join(testDir, "invariants.md"), invariantsMd);

    // Generate bantay.aide with 50 invariants
    let aideContent = `entities:
  invariants:
    display: checklist
    props:
      title: Invariants
`;

    for (const category of categories) {
      const count = Math.ceil(INVARIANT_COUNT / categories.length);
      for (let i = 0; i < count; i++) {
        const id = `inv_${category}_${String(i).padStart(3, "0")}`;
        aideContent += `  ${id}:
    parent: invariants
    props:
      statement: Test invariant ${i} for ${category}
      category: ${category}
`;
      }
    }

    aideContent += "relationships: []\n";
    await writeFile(join(testDir, "bantay.aide"), aideContent);

    // Create initial source file
    await writeFile(join(testDir, "src", "main.ts"), "// Initial file\n");

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

    // Create a 500-line diff
    let largeFile = "";
    for (let i = 0; i < DIFF_LINES; i++) {
      largeFile += `export const line${i} = "${i}";\n`;
    }
    await writeFile(join(testDir, "src", "large-change.ts"), largeFile);
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test(`bantay check --diff completes in under ${MAX_TIME_MS / 1000} seconds with ${INVARIANT_COUNT} invariants and ${DIFF_LINES}-line diff`, async () => {
    const cliPath = join(projectPath, "src", "cli.ts");

    const startTime = performance.now();

    const proc = spawn({
      cmd: [process.execPath, "run", cliPath, "check", "--diff", "HEAD"],
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    await proc.exited;

    const endTime = performance.now();
    const duration = endTime - startTime;

    console.log(`\n  Diff check completed in ${duration.toFixed(0)}ms`);
    console.log(`  Invariants: ${INVARIANT_COUNT}, Diff lines: ${DIFF_LINES}`);

    expect(duration).toBeLessThan(MAX_TIME_MS);
  });

  test("full check completes in reasonable time", async () => {
    const cliPath = join(projectPath, "src", "cli.ts");

    const startTime = performance.now();

    const proc = spawn({
      cmd: [process.execPath, "run", cliPath, "check"],
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    await proc.exited;

    const endTime = performance.now();
    const duration = endTime - startTime;

    console.log(`\n  Full check completed in ${duration.toFixed(0)}ms`);

    // Full check can take longer but should still be reasonable
    expect(duration).toBeLessThan(MAX_TIME_MS * 2);
  });
});
