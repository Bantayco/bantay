import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "fs/promises";
import { tmpdir, homedir } from "os";
import { join } from "path";
import { spawn } from "bun";
import { existsSync } from "fs";

const CLI_PATH = join(import.meta.dir, "../src/cli.ts");
const BUN_PATH = join(homedir(), ".bun", "bin", "bun");

describe("Tasks Command", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tasks-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const proc = spawn({
      cmd: [BUN_PATH, "run", CLI_PATH, ...args],
      stdout: "pipe",
      stderr: "pipe",
      cwd: tempDir,
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    return { stdout, stderr, exitCode };
  }

  // @scenario sc_tasks_all
  describe("Generate tasks for full aide", () => {
    test("bantay tasks --all generates task list for every CUJ", async () => {
      // Create an aide file with CUJs
      const aideContent = `entities:
  myapp:
    display: page
    props:
      title: My App
  cujs:
    display: table
    parent: myapp
  cuj_auth:
    parent: cujs
    props:
      feature: User authenticates
      tier: primary
      area: auth
  cuj_dashboard:
    parent: cujs
    props:
      feature: User views dashboard
      tier: primary
      area: main
  sc_login:
    parent: cuj_auth
    props:
      name: User logs in
      given: User has account
      when: User enters credentials
      then: User is authenticated
  sc_view_stats:
    parent: cuj_dashboard
    props:
      name: View statistics
      given: User is logged in
      when: User opens dashboard
      then: Statistics displayed
relationships:
  - from: cuj_dashboard
    to: cuj_auth
    type: depends_on
    cardinality: many_to_many
`;
      await writeFile(join(tempDir, "myapp.aide"), aideContent);

      const { stdout, exitCode } = await runCli(["tasks", "--all"]);

      expect(exitCode).toBe(0);
      expect(existsSync(join(tempDir, "tasks.md"))).toBe(true);

      const tasksContent = await readFile(join(tempDir, "tasks.md"), "utf-8");
      expect(tasksContent).toContain("cuj_auth");
      expect(tasksContent).toContain("cuj_dashboard");
      expect(tasksContent).toContain("User authenticates");
      expect(tasksContent).toContain("User views dashboard");
    });
  });

  // @scenario sc_tasks_diff
  describe("Generate tasks from diff", () => {
    test("bantay tasks generates tasks only for added/modified entities", async () => {
      // Create an aide file
      const aideContent = `entities:
  myapp:
    display: page
    props:
      title: My App
  cujs:
    display: table
    parent: myapp
  cuj_existing:
    parent: cujs
    props:
      feature: Existing journey
      tier: primary
      area: core
  cuj_new:
    parent: cujs
    props:
      feature: New journey added
      tier: primary
      area: new
relationships: []
`;
      await writeFile(join(tempDir, "myapp.aide"), aideContent);

      // Create a lock file that only has cuj_existing (simulating cuj_new being added)
      const lockContent = `# myapp.aide.lock
entities:
  myapp: abc123
  cujs: def456
  cuj_existing: ghi789

relationships:
`;
      await writeFile(join(tempDir, "myapp.aide.lock"), lockContent);

      const { stdout, exitCode } = await runCli(["tasks"]);

      expect(exitCode).toBe(0);
      expect(existsSync(join(tempDir, "tasks.md"))).toBe(true);

      const tasksContent = await readFile(join(tempDir, "tasks.md"), "utf-8");
      // Should include new CUJ
      expect(tasksContent).toContain("cuj_new");
      // Should NOT include existing unchanged CUJ
      expect(tasksContent).not.toContain("cuj_existing");
    });
  });

  // @scenario sc_tasks_phases
  describe("Tasks ordered into phases by dependencies", () => {
    test("CUJs with no dependencies come first, dependent CUJs come after", async () => {
      const aideContent = `entities:
  myapp:
    display: page
    props:
      title: My App
  cujs:
    display: table
    parent: myapp
  cuj_base:
    parent: cujs
    props:
      feature: Base functionality
      tier: primary
      area: core
  cuj_middle:
    parent: cujs
    props:
      feature: Middle layer
      tier: primary
      area: core
  cuj_top:
    parent: cujs
    props:
      feature: Top layer
      tier: primary
      area: core
relationships:
  - from: cuj_middle
    to: cuj_base
    type: depends_on
    cardinality: many_to_many
  - from: cuj_top
    to: cuj_middle
    type: depends_on
    cardinality: many_to_many
`;
      await writeFile(join(tempDir, "myapp.aide"), aideContent);

      const { exitCode } = await runCli(["tasks", "--all"]);

      expect(exitCode).toBe(0);

      const tasksContent = await readFile(join(tempDir, "tasks.md"), "utf-8");

      // Check phase ordering - base should appear before middle, middle before top
      const baseIndex = tasksContent.indexOf("cuj_base");
      const middleIndex = tasksContent.indexOf("cuj_middle");
      const topIndex = tasksContent.indexOf("cuj_top");

      expect(baseIndex).toBeLessThan(middleIndex);
      expect(middleIndex).toBeLessThan(topIndex);

      // Should have phase markers
      expect(tasksContent).toContain("Phase 1");
      expect(tasksContent).toContain("Phase 2");
      expect(tasksContent).toContain("Phase 3");
    });
  });

  // @scenario sc_tasks_output
  describe("Tasks written to tasks.md", () => {
    test("tasks.md has phases, scenarios as acceptance criteria, and checklist format", async () => {
      const aideContent = `entities:
  myapp:
    display: page
    props:
      title: My App
  cujs:
    display: table
    parent: myapp
  cuj_feature:
    parent: cujs
    props:
      feature: Main feature
      tier: primary
      area: main
  sc_happy_path:
    parent: cuj_feature
    props:
      name: Happy path works
      given: Normal conditions
      when: User does action
      then: Expected result
  sc_error_case:
    parent: cuj_feature
    props:
      name: Error handling
      given: Error conditions
      when: Something fails
      then: Graceful error
relationships: []
`;
      await writeFile(join(tempDir, "myapp.aide"), aideContent);

      const { exitCode } = await runCli(["tasks", "--all"]);

      expect(exitCode).toBe(0);

      const tasksContent = await readFile(join(tempDir, "tasks.md"), "utf-8");

      // Should have checklist format
      expect(tasksContent).toMatch(/- \[ \]/);

      // Should include scenarios as acceptance criteria
      expect(tasksContent).toContain("Happy path works");
      expect(tasksContent).toContain("Error handling");

      // Should have acceptance criteria section
      expect(tasksContent).toMatch(/Acceptance|Scenarios|Criteria/i);
    });

    test("tasks.md is created in project root", async () => {
      const aideContent = `entities:
  myapp:
    display: page
  cujs:
    parent: myapp
  cuj_simple:
    parent: cujs
    props:
      feature: Simple task
relationships: []
`;
      await writeFile(join(tempDir, "myapp.aide"), aideContent);

      await runCli(["tasks", "--all"]);

      expect(existsSync(join(tempDir, "tasks.md"))).toBe(true);
    });
  });

  describe("Edge cases", () => {
    test("errors when no aide file found", async () => {
      const { stderr, exitCode } = await runCli(["tasks"]);

      expect(exitCode).toBe(1);
      expect(stderr).toContain("No .aide file found");
    });

    test("errors when no lock file and no --all flag", async () => {
      const aideContent = `entities:
  myapp:
    display: page
  cujs:
    parent: myapp
relationships: []
`;
      await writeFile(join(tempDir, "myapp.aide"), aideContent);

      const { stderr, exitCode } = await runCli(["tasks"]);

      expect(exitCode).toBe(1);
      expect(stderr).toContain("lock");
    });
  });
});
