/**
 * Tests for bantay ci command
 *
 * @scenario sc_ci_github
 * @scenario sc_ci_gitlab
 * @scenario sc_ci_generic
 * @scenario sc_ci_existing_workflow
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, writeFile, readFile, access } from "fs/promises";
import { join } from "path";

const BUN_PATH = process.execPath;
const PROJECT_ROOT = join(import.meta.dir, "..");
const TEST_DIR = "/tmp/bantay-ci-test";

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

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// sc_ci_github: Generate GitHub Actions workflow
describe("GitHub Actions Workflow Generation", () => {
  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("creates .github/workflows/bantay.yml", async () => {
    const { exitCode } = await runBantay(["ci", "--github-actions"]);

    expect(exitCode).toBe(0);

    const workflowPath = join(TEST_DIR, ".github/workflows/bantay.yml");
    expect(await fileExists(workflowPath)).toBe(true);
  });

  test("workflow runs bantay check on PR", async () => {
    await runBantay(["ci", "--github-actions"]);

    const workflowPath = join(TEST_DIR, ".github/workflows/bantay.yml");
    const content = await readFile(workflowPath, "utf-8");

    expect(content).toContain("pull_request");
    expect(content).toContain("bantay");
    expect(content).toContain("check");
  });

  test("workflow installs via bunx", async () => {
    await runBantay(["ci", "--github-actions"]);

    const workflowPath = join(TEST_DIR, ".github/workflows/bantay.yml");
    const content = await readFile(workflowPath, "utf-8");

    expect(content).toContain("bunx @bantay/cli");
  });

  test("workflow is valid YAML", async () => {
    await runBantay(["ci", "--github-actions"]);

    const workflowPath = join(TEST_DIR, ".github/workflows/bantay.yml");
    const content = await readFile(workflowPath, "utf-8");

    // Should have proper YAML structure
    expect(content).toContain("name:");
    expect(content).toContain("on:");
    expect(content).toContain("jobs:");
    expect(content).toContain("steps:");
  });
});

// sc_ci_gitlab: Generate GitLab CI config
describe("GitLab CI Generation", () => {
  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("creates .gitlab-ci.bantay.yml", async () => {
    const { exitCode } = await runBantay(["ci", "--gitlab"]);

    expect(exitCode).toBe(0);

    const configPath = join(TEST_DIR, ".gitlab-ci.bantay.yml");
    expect(await fileExists(configPath)).toBe(true);
  });

  test("config contains bantay stage", async () => {
    await runBantay(["ci", "--gitlab"]);

    const configPath = join(TEST_DIR, ".gitlab-ci.bantay.yml");
    const content = await readFile(configPath, "utf-8");

    expect(content).toContain("bantay:");
    expect(content).toContain("stage:");
    expect(content).toContain("script:");
  });

  test("config runs on merge requests", async () => {
    await runBantay(["ci", "--gitlab"]);

    const configPath = join(TEST_DIR, ".gitlab-ci.bantay.yml");
    const content = await readFile(configPath, "utf-8");

    expect(content).toContain("merge_request");
  });
});

// sc_ci_generic: Generic CI instructions
describe("Generic CI Instructions", () => {
  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("prints shell commands when no provider specified", async () => {
    const { stdout, exitCode } = await runBantay(["ci"]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("bunx @bantay/cli check");
  });

  test("includes Bun installation instructions", async () => {
    const { stdout } = await runBantay(["ci"]);

    expect(stdout).toContain("bun.sh/install");
  });

  test("shows exit code documentation", async () => {
    const { stdout } = await runBantay(["ci"]);

    expect(stdout).toContain("Exit code");
    expect(stdout).toMatch(/0.*pass/i);
  });
});

// sc_ci_existing_workflow: CI generation when workflow already exists
describe("Existing Workflow Handling", () => {
  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("does NOT overwrite existing workflow by default", async () => {
    // Create existing workflow
    await mkdir(join(TEST_DIR, ".github/workflows"), { recursive: true });
    const existingContent = "name: My Existing Workflow\n";
    await writeFile(
      join(TEST_DIR, ".github/workflows/bantay.yml"),
      existingContent
    );

    const { exitCode, stderr } = await runBantay(["ci", "--github-actions"]);

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("already exists");

    // Verify content unchanged
    const content = await readFile(
      join(TEST_DIR, ".github/workflows/bantay.yml"),
      "utf-8"
    );
    expect(content).toBe(existingContent);
  });

  test("warns and suggests --force", async () => {
    await mkdir(join(TEST_DIR, ".github/workflows"), { recursive: true });
    await writeFile(
      join(TEST_DIR, ".github/workflows/bantay.yml"),
      "existing content"
    );

    const { stderr } = await runBantay(["ci", "--github-actions"]);

    expect(stderr).toContain("--force");
  });

  test("overwrites with --force flag", async () => {
    await mkdir(join(TEST_DIR, ".github/workflows"), { recursive: true });
    await writeFile(
      join(TEST_DIR, ".github/workflows/bantay.yml"),
      "old content"
    );

    const { exitCode } = await runBantay(["ci", "--github-actions", "--force"]);

    expect(exitCode).toBe(0);

    const content = await readFile(
      join(TEST_DIR, ".github/workflows/bantay.yml"),
      "utf-8"
    );
    expect(content).toContain("Bantay Invariant Check");
    expect(content).not.toContain("old content");
  });
});
