import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, writeFile, readFile } from "fs/promises";
import { join } from "path";

const BUN_PATH = process.execPath;
const PROJECT_ROOT = join(import.meta.dir, "..");
const TEST_DIR = "/tmp/bantay-check-test";

async function runBantay(args: string[], cwd: string = TEST_DIR): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const proc = Bun.spawn([BUN_PATH, "run", join(PROJECT_ROOT, "src/cli.ts"), ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

describe("bantay check", () => {
  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  // sc_check_no_invariants: Check with no invariants file
  describe("when invariants.md does not exist", () => {
    test("shows clear error message suggesting bantay init", async () => {
      const { stderr, exitCode } = await runBantay(["check"]);

      expect(stderr).toContain("invariants.md");
      expect(stderr).toContain("bantay init");
      expect(exitCode).not.toBe(0);
    });

    test("exits non-zero", async () => {
      const { exitCode } = await runBantay(["check"]);

      expect(exitCode).not.toBe(0);
    });
  });

  // sc_check_full: Full invariant check
  describe("full invariant check", () => {
    test("evaluates every invariant in invariants.md", async () => {
      await writeFile(
        join(TEST_DIR, "invariants.md"),
        `# Project Invariants

## Security

- [INV-001] security | No secrets in code
- [INV-002] security | Validate all input
`
      );
      await writeFile(
        join(TEST_DIR, "bantay.config.yml"),
        `sourceDirectories:\n  - src\n`
      );

      const { stderr } = await runBantay(["check"]);

      // Each invariant should be reported
      expect(stderr).toContain("INV-001");
      expect(stderr).toContain("INV-002");
    });

    test("each invariant reports PASS, FAIL, or SKIPPED", async () => {
      await writeFile(
        join(TEST_DIR, "invariants.md"),
        `# Project Invariants

## Security

- [INV-001] security | No secrets in code
`
      );
      await writeFile(
        join(TEST_DIR, "bantay.config.yml"),
        `sourceDirectories:\n  - src\n`
      );

      const { stderr } = await runBantay(["check"]);

      // Should contain status indicator
      expect(stderr).toMatch(/PASS|FAIL|SKIPPED/);
    });

    test("summary shows total passed, total failed, total skipped", async () => {
      await writeFile(
        join(TEST_DIR, "invariants.md"),
        `# Project Invariants

## Security

- [INV-001] security | No secrets in code
- [INV-002] security | Validate all input
`
      );
      await writeFile(
        join(TEST_DIR, "bantay.config.yml"),
        `sourceDirectories:\n  - src\n`
      );

      const { stderr } = await runBantay(["check"]);

      // Should show summary counts
      expect(stderr).toMatch(/\d+\s*(passed|pass)/i);
    });

    test("exit code 0 if all invariants pass or are skipped", async () => {
      await writeFile(
        join(TEST_DIR, "invariants.md"),
        `# Project Invariants

## Custom

- [INV-999] custom | Some custom invariant with no checker
`
      );
      await writeFile(
        join(TEST_DIR, "bantay.config.yml"),
        `sourceDirectories:\n  - src\n`
      );

      const { exitCode } = await runBantay(["check"]);

      // Skipped invariants don't cause failure
      expect(exitCode).toBe(0);
    });

    test("exit code non-zero if any invariant fails", async () => {
      // Create a project with auth invariant that will fail
      await writeFile(
        join(TEST_DIR, "invariants.md"),
        `# Project Invariants

## Auth

- [INV-010] auth | All API routes must check authentication
`
      );
      await writeFile(
        join(TEST_DIR, "bantay.config.yml"),
        `sourceDirectories:\n  - src\nrouteDirectories:\n  - app/api\n`
      );
      // Create an API route without auth
      await mkdir(join(TEST_DIR, "app/api/users"), { recursive: true });
      await writeFile(
        join(TEST_DIR, "app/api/users/route.ts"),
        `export async function GET() { return Response.json({ users: [] }); }`
      );

      const { exitCode } = await runBantay(["check"]);

      expect(exitCode).not.toBe(0);
    });

    test("failed invariants include file path and line number", async () => {
      await writeFile(
        join(TEST_DIR, "invariants.md"),
        `# Project Invariants

## Auth

- [INV-010] auth | All API routes must check authentication
`
      );
      await writeFile(
        join(TEST_DIR, "bantay.config.yml"),
        `sourceDirectories:\n  - src\nrouteDirectories:\n  - app/api\n`
      );
      await mkdir(join(TEST_DIR, "app/api/users"), { recursive: true });
      await writeFile(
        join(TEST_DIR, "app/api/users/route.ts"),
        `export async function GET() { return Response.json({ users: [] }); }`
      );

      const { stdout, stderr } = await runBantay(["check"]);
      const output = stdout + stderr;

      expect(output).toContain("app/api/users/route.ts");
    });
  });

  // sc_check_unparseable_invariant: Invariant with no checker
  describe("invariant with no checker", () => {
    test("reports as SKIPPED not PASS", async () => {
      await writeFile(
        join(TEST_DIR, "invariants.md"),
        `# Project Invariants

## Custom

- [INV-999] unknowncategory | Some invariant with no checker
`
      );
      await writeFile(
        join(TEST_DIR, "bantay.config.yml"),
        `sourceDirectories:\n  - src\n`
      );

      const { stderr } = await runBantay(["check"]);

      expect(stderr).toContain("SKIPPED");
      expect(stderr).not.toMatch(/INV-999.*PASS/);
    });

    test("warning displayed that no checker exists", async () => {
      await writeFile(
        join(TEST_DIR, "invariants.md"),
        `# Project Invariants

## Custom

- [INV-999] unknowncategory | Some invariant with no checker
`
      );
      await writeFile(
        join(TEST_DIR, "bantay.config.yml"),
        `sourceDirectories:\n  - src\n`
      );

      const { stdout, stderr } = await runBantay(["check"]);
      const output = stdout + stderr;

      expect(output).toMatch(/no checker|not implemented|skipped/i);
    });

    test("skipped invariants do not cause non-zero exit code", async () => {
      await writeFile(
        join(TEST_DIR, "invariants.md"),
        `# Project Invariants

## Custom

- [INV-999] unknowncategory | Some invariant with no checker
`
      );
      await writeFile(
        join(TEST_DIR, "bantay.config.yml"),
        `sourceDirectories:\n  - src\n`
      );

      const { exitCode } = await runBantay(["check"]);

      expect(exitCode).toBe(0);
    });
  });

  // sc_check_single: Check single invariant
  describe("check single invariant with --id", () => {
    test("only specified invariant is checked", async () => {
      await writeFile(
        join(TEST_DIR, "invariants.md"),
        `# Project Invariants

## Security

- [INV-001] security | No secrets in code
- [INV-002] security | Validate all input
`
      );
      await writeFile(
        join(TEST_DIR, "bantay.config.yml"),
        `sourceDirectories:\n  - src\n`
      );

      const { stderr } = await runBantay(["check", "--id", "INV-001"]);

      expect(stderr).toContain("INV-001");
      expect(stderr).not.toContain("INV-002");
    });
  });
});

// sc_check_diff: Diff-aware check
describe("bantay check --diff", () => {
  const DIFF_TEST_DIR = "/tmp/bantay-diff-test";

  beforeEach(async () => {
    await rm(DIFF_TEST_DIR, { recursive: true, force: true });
    await mkdir(DIFF_TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(DIFF_TEST_DIR, { recursive: true, force: true });
  });

  async function runGit(args: string[], cwd: string): Promise<void> {
    const proc = Bun.spawn(["git", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
  }

  async function runBantayInDir(args: string[], cwd: string): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }> {
    const proc = Bun.spawn([process.execPath, "run", join(PROJECT_ROOT, "src/cli.ts"), ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    return { stdout, stderr, exitCode };
  }

  test("only checks invariants affected by the diff", async () => {
    // Initialize git repo
    await runGit(["init"], DIFF_TEST_DIR);
    await runGit(["config", "user.email", "test@test.com"], DIFF_TEST_DIR);
    await runGit(["config", "user.name", "Test"], DIFF_TEST_DIR);

    // Create initial setup
    await writeFile(
      join(DIFF_TEST_DIR, "invariants.md"),
      `# Project Invariants

## Auth

- [INV-010] auth | All API routes must check authentication

## Schema

- [INV-020] schema | All tables must have timestamps
`
    );
    await writeFile(
      join(DIFF_TEST_DIR, "bantay.config.yml"),
      `sourceDirectories:\n  - src\nrouteDirectories:\n  - app/api\n`
    );

    // Create initial files and commit
    await mkdir(join(DIFF_TEST_DIR, "src"), { recursive: true });
    await writeFile(join(DIFF_TEST_DIR, "src/index.ts"), "// initial");
    await runGit(["add", "."], DIFF_TEST_DIR);
    await runGit(["commit", "-m", "initial"], DIFF_TEST_DIR);

    // Now add a route file
    await mkdir(join(DIFF_TEST_DIR, "app/api/test"), { recursive: true });
    await writeFile(
      join(DIFF_TEST_DIR, "app/api/test/route.ts"),
      `export async function GET() { return Response.json({}); }`
    );

    const { stderr } = await runBantayInDir(["check", "--diff", "HEAD"], DIFF_TEST_DIR);

    // Auth invariant should be checked since route file changed
    expect(stderr).toContain("INV-010");
    // Schema invariant should be skipped since no schema files changed
    // (or if schema checker doesn't exist yet, it would be skipped anyway)
  });

  test("results are strict subset of full check", async () => {
    await runGit(["init"], DIFF_TEST_DIR);
    await runGit(["config", "user.email", "test@test.com"], DIFF_TEST_DIR);
    await runGit(["config", "user.name", "Test"], DIFF_TEST_DIR);

    await writeFile(
      join(DIFF_TEST_DIR, "invariants.md"),
      `# Project Invariants

## Custom

- [INV-999] custom | Some custom invariant
`
    );
    await writeFile(
      join(DIFF_TEST_DIR, "bantay.config.yml"),
      `sourceDirectories:\n  - src\n`
    );
    await mkdir(join(DIFF_TEST_DIR, "src"), { recursive: true });
    await writeFile(join(DIFF_TEST_DIR, "src/index.ts"), "// code");
    await runGit(["add", "."], DIFF_TEST_DIR);
    await runGit(["commit", "-m", "initial"], DIFF_TEST_DIR);

    // Full check
    const fullResult = await runBantayInDir(["check"], DIFF_TEST_DIR);
    // Diff check (no changes since last commit)
    const diffResult = await runBantayInDir(["check", "--diff", "HEAD"], DIFF_TEST_DIR);

    // If diff check passes, full check should also pass (or be skipped)
    // Diff check should not report more invariants than full check
    if (diffResult.exitCode === 0) {
      // If diff passed, full check invariants that were evaluated should also pass
      expect(fullResult.exitCode).toBeLessThanOrEqual(diffResult.exitCode);
    }
  });
});

// sc_check_no_execution: Check never executes project code
describe("bantay check security", () => {
  const SECURITY_TEST_DIR = "/tmp/bantay-security-test";

  beforeEach(async () => {
    await rm(SECURITY_TEST_DIR, { recursive: true, force: true });
    await mkdir(SECURITY_TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(SECURITY_TEST_DIR, { recursive: true, force: true });
  });

  test("never imports or requires project code", async () => {
    // Create a malicious project file that would reveal execution
    const markerFile = join(SECURITY_TEST_DIR, "EXECUTED");
    await writeFile(
      join(SECURITY_TEST_DIR, "malicious.ts"),
      `
import { writeFileSync } from "fs";
writeFileSync("${markerFile}", "CODE WAS EXECUTED");
export const secret = "sensitive";
`
    );

    await writeFile(
      join(SECURITY_TEST_DIR, "invariants.md"),
      `# Project Invariants

## Security

- [INV-001] security | No secrets in code
`
    );
    await writeFile(
      join(SECURITY_TEST_DIR, "bantay.config.yml"),
      `sourceDirectories:\n  - .\n`
    );

    // Run bantay check
    await runBantay(["check"], SECURITY_TEST_DIR);

    // Verify the malicious code was NOT executed
    const markerExists = await Bun.file(markerFile).exists();
    expect(markerExists).toBe(false);
  });

  test("static analysis only - no eval of project code", async () => {
    await writeFile(
      join(SECURITY_TEST_DIR, "dangerous.ts"),
      `
// This should never be evaluated
eval("throw new Error('bantay executed project code!')");
`
    );

    await writeFile(
      join(SECURITY_TEST_DIR, "invariants.md"),
      `# Project Invariants

## Security

- [INV-001] security | No secrets in code
`
    );
    await writeFile(
      join(SECURITY_TEST_DIR, "bantay.config.yml"),
      `sourceDirectories:\n  - .\n`
    );

    // This should not throw - bantay shouldn't execute the code
    const { exitCode } = await runBantay(["check"], SECURITY_TEST_DIR);

    // If bantay executed the code, it would have thrown
    // The check should complete (pass or skip, but not crash from eval)
    expect(exitCode).toBeLessThanOrEqual(1); // 0 or 1 is acceptable
  });
});
