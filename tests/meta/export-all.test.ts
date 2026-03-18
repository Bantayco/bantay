/**
 * export-all.test.ts — enforces inv_export_all_success
 *
 * Run bantay export all. Assert every expected output file
 * exists and is non-empty.
 *
 * @scenario sc_export_claude
 * @scenario sc_export_cursor
 * @scenario sc_export_codex
 * @scenario sc_export_idempotent
 * @scenario sc_export_no_clobber
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm, stat, readFile } from "fs/promises";
import { join } from "path";
import { spawn } from "bun";
import { tmpdir } from "os";

describe("inv_export_all_success", () => {
  const testDir = join(tmpdir(), `bantay-export-all-test-${Date.now()}`);
  const projectPath = process.cwd();

  beforeAll(async () => {
    // Create a fixture project
    await mkdir(testDir, { recursive: true });
    await mkdir(join(testDir, "src"), { recursive: true });

    // Create package.json
    await writeFile(
      join(testDir, "package.json"),
      JSON.stringify(
        {
          name: "test-export-all-project",
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

    // Create a complete bantay.aide with all entity types
    await writeFile(
      join(testDir, "bantay.aide"),
      `entities:
  test_project:
    display: page
    props:
      title: Test Project
      description: A test project for export validation
  cujs:
    display: table
    parent: test_project
    props:
      title: Critical User Journeys
  invariants:
    display: checklist
    parent: test_project
    props:
      title: Invariants
  constraints:
    display: list
    parent: test_project
    props:
      title: Constraints
  foundations:
    display: list
    parent: test_project
    props:
      title: Design Foundations
  cuj_init:
    parent: cujs
    props:
      feature: User initializes project
      tier: primary
      area: init
  inv_test_auth:
    parent: invariants
    props:
      statement: All routes require authentication
      category: security
  con_static_only:
    parent: constraints
    props:
      text: Static analysis only
      domain: security
      rationale: Safety by construction
  found_simple:
    parent: foundations
    props:
      text: Keep it simple
relationships:
  - from: cuj_init
    to: inv_test_auth
    type: protected_by
`
    );
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("bantay export all succeeds with exit code 0", async () => {
    const cliPath = join(projectPath, "src", "cli.ts");

    const proc = spawn({
      cmd: [process.execPath, "run", cliPath, "export", "all"],
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Read streams concurrently with process exit
    const [exitCode, stdout] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Exported all targets");
  });

  test("invariants.md is created and non-empty", async () => {
    const cliPath = join(projectPath, "src", "cli.ts");

    await spawn({
      cmd: [process.execPath, "run", cliPath, "export", "all"],
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    }).exited;

    const filePath = join(testDir, "invariants.md");
    const stats = await stat(filePath);
    expect(stats.size).toBeGreaterThan(0);

    const content = await readFile(filePath, "utf-8");
    expect(content).toContain("# Invariants");
    expect(content).toContain("inv_test_auth");
  });

  test("CLAUDE.md is created and non-empty", async () => {
    const cliPath = join(projectPath, "src", "cli.ts");

    await spawn({
      cmd: [process.execPath, "run", cliPath, "export", "all"],
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    }).exited;

    const filePath = join(testDir, "CLAUDE.md");
    const stats = await stat(filePath);
    expect(stats.size).toBeGreaterThan(0);

    const content = await readFile(filePath, "utf-8");
    expect(content).toContain("<!-- bantay:start -->");
    expect(content).toContain("<!-- bantay:end -->");
  });

  test(".cursorrules is created and non-empty", async () => {
    const cliPath = join(projectPath, "src", "cli.ts");

    await spawn({
      cmd: [process.execPath, "run", cliPath, "export", "all"],
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    }).exited;

    const filePath = join(testDir, ".cursorrules");
    const stats = await stat(filePath);
    expect(stats.size).toBeGreaterThan(0);

    const content = await readFile(filePath, "utf-8");
    expect(content).toContain("<!-- bantay:start -->");
  });

  test("AGENTS.md is created and non-empty", async () => {
    const cliPath = join(projectPath, "src", "cli.ts");

    await spawn({
      cmd: [process.execPath, "run", cliPath, "export", "all"],
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    }).exited;

    const filePath = join(testDir, "AGENTS.md");
    const stats = await stat(filePath);
    expect(stats.size).toBeGreaterThan(0);

    const content = await readFile(filePath, "utf-8");
    expect(content).toContain("<!-- bantay:start -->");
    expect(content).toContain("<!-- bantay:end -->");
  });

  test("all export files have consistent content", async () => {
    const cliPath = join(projectPath, "src", "cli.ts");

    await spawn({
      cmd: [process.execPath, "run", cliPath, "export", "all"],
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    }).exited;

    // All files should contain the test invariant
    const invariantsMd = await readFile(join(testDir, "invariants.md"), "utf-8");
    const claudeMd = await readFile(join(testDir, "CLAUDE.md"), "utf-8");
    const cursorrules = await readFile(join(testDir, ".cursorrules"), "utf-8");

    // The invariant should appear in all files
    expect(invariantsMd).toContain("inv_test_auth");
    expect(claudeMd).toContain("inv_test_auth");
    expect(cursorrules).toContain("inv_test_auth");

    // Constraints should appear in CLAUDE.md and .cursorrules
    expect(claudeMd).toContain("con_static_only");
    expect(cursorrules).toContain("con_static_only");
  });
});

// sc_export_idempotent: Export is idempotent
describe("inv_export_idempotent", () => {
  const testDir = join(tmpdir(), `bantay-idempotent-test-${Date.now()}`);
  const projectPath = process.cwd();

  beforeAll(async () => {
    await mkdir(testDir, { recursive: true });

    await writeFile(
      join(testDir, "bantay.config.yml"),
      "sourceDirectories:\n  - src\n"
    );

    await writeFile(
      join(testDir, "bantay.aide"),
      `entities:
  test_project:
    display: page
    props:
      title: Test
  invariants:
    display: checklist
    parent: test_project
    props:
      title: Invariants
  inv_test:
    parent: invariants
    props:
      statement: Test invariant
      category: test
`
    );
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("running export twice produces byte-identical output", async () => {
    const cliPath = join(projectPath, "src", "cli.ts");

    // First export
    await spawn({
      cmd: [process.execPath, "run", cliPath, "export", "claude"],
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    }).exited;

    const firstExport = await readFile(join(testDir, "CLAUDE.md"), "utf-8");

    // Second export
    await spawn({
      cmd: [process.execPath, "run", cliPath, "export", "claude"],
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    }).exited;

    const secondExport = await readFile(join(testDir, "CLAUDE.md"), "utf-8");

    // Should be byte-identical
    expect(secondExport).toBe(firstExport);
  });

  test("no spurious git diffs after repeated exports", async () => {
    const cliPath = join(projectPath, "src", "cli.ts");

    // Export three times
    for (let i = 0; i < 3; i++) {
      await spawn({
        cmd: [process.execPath, "run", cliPath, "export", "all"],
        cwd: testDir,
        stdout: "pipe",
        stderr: "pipe",
      }).exited;
    }

    const claudeMd = await readFile(join(testDir, "CLAUDE.md"), "utf-8");
    const cursorrules = await readFile(join(testDir, ".cursorrules"), "utf-8");

    // Run export one more time
    await spawn({
      cmd: [process.execPath, "run", cliPath, "export", "all"],
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    }).exited;

    const claudeMdAfter = await readFile(join(testDir, "CLAUDE.md"), "utf-8");
    const cursorrulesAfter = await readFile(join(testDir, ".cursorrules"), "utf-8");

    expect(claudeMdAfter).toBe(claudeMd);
    expect(cursorrulesAfter).toBe(cursorrules);
  });
});

// sc_export_no_clobber: Export never destroys user content
describe("inv_no_clobber", () => {
  const testDir = join(tmpdir(), `bantay-no-clobber-test-${Date.now()}`);
  const projectPath = process.cwd();

  beforeAll(async () => {
    await mkdir(testDir, { recursive: true });

    await writeFile(
      join(testDir, "bantay.config.yml"),
      "sourceDirectories:\n  - src\n"
    );

    await writeFile(
      join(testDir, "bantay.aide"),
      `entities:
  test_project:
    display: page
    props:
      title: Test
  invariants:
    display: checklist
    parent: test_project
    props:
      title: Invariants
  inv_test:
    parent: invariants
    props:
      statement: Test invariant
      category: test
`
    );
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("preserves user content before bantay section", async () => {
    const cliPath = join(projectPath, "src", "cli.ts");

    // Create CLAUDE.md with user content
    const userContent = `# My Project

This is my custom documentation.

## Setup Instructions

1. Install dependencies
2. Run the app

`;
    await writeFile(join(testDir, "CLAUDE.md"), userContent);

    // Run export
    await spawn({
      cmd: [process.execPath, "run", cliPath, "export", "claude"],
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    }).exited;

    const content = await readFile(join(testDir, "CLAUDE.md"), "utf-8");

    // User content should be preserved
    expect(content).toContain("# My Project");
    expect(content).toContain("This is my custom documentation.");
    expect(content).toContain("## Setup Instructions");
    expect(content).toContain("1. Install dependencies");

    // Bantay section should also exist
    expect(content).toContain("<!-- bantay:start -->");
    expect(content).toContain("<!-- bantay:end -->");
  });

  test("preserves user content after bantay section", async () => {
    const cliPath = join(projectPath, "src", "cli.ts");

    // Create CLAUDE.md with bantay section and content after
    const initialContent = `# Header

<!-- bantay:start -->
Old bantay content
<!-- bantay:end -->

## User Section After

This content comes after the bantay section.
`;
    await writeFile(join(testDir, "CLAUDE.md"), initialContent);

    // Run export
    await spawn({
      cmd: [process.execPath, "run", cliPath, "export", "claude"],
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    }).exited;

    const content = await readFile(join(testDir, "CLAUDE.md"), "utf-8");

    // User content before should be preserved
    expect(content).toContain("# Header");

    // User content after should be preserved
    expect(content).toContain("## User Section After");
    expect(content).toContain("This content comes after the bantay section.");

    // Old bantay content should be replaced
    expect(content).not.toContain("Old bantay content");

    // New bantay content should exist
    expect(content).toContain("inv_test");
  });

  test("appends section when no existing bantay markers", async () => {
    const cliPath = join(projectPath, "src", "cli.ts");

    // Create CLAUDE.md without bantay section
    const userContent = `# My Documentation

Some content here.
`;
    await writeFile(join(testDir, "CLAUDE.md"), userContent);

    // Run export
    await spawn({
      cmd: [process.execPath, "run", cliPath, "export", "claude"],
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    }).exited;

    const content = await readFile(join(testDir, "CLAUDE.md"), "utf-8");

    // Original content preserved
    expect(content).toContain("# My Documentation");
    expect(content).toContain("Some content here.");

    // Bantay section appended
    expect(content).toContain("<!-- bantay:start -->");
    expect(content).toContain("<!-- bantay:end -->");
  });
});
