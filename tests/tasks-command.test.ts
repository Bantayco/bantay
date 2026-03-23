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

  // @scenario sc_tasks_entity_level
  describe("Tasks generated for individual entity changes", () => {
    test("new scenario under existing CUJ generates task for that scenario", async () => {
      // Create an aide file with an existing CUJ and a new scenario
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
  sc_existing:
    parent: cuj_existing
    props:
      name: Existing scenario
      given: Precondition
      when: Action
      then: Result
  sc_new:
    parent: cuj_existing
    props:
      name: New scenario added
      given: New precondition
      when: New action
      then: New result
relationships: []
`;
      await writeFile(join(tempDir, "myapp.aide"), aideContent);

      // Create a lock file that has cuj_existing AND sc_existing, but NOT sc_new
      const lockContent = `# myapp.aide.lock
entities:
  myapp: abc123
  cujs: def456
  cuj_existing: ghi789
  sc_existing: jkl012

relationships:
`;
      await writeFile(join(tempDir, "myapp.aide.lock"), lockContent);

      const { stdout, exitCode } = await runCli(["tasks"]);

      expect(exitCode).toBe(0);
      expect(existsSync(join(tempDir, "tasks.md"))).toBe(true);

      const tasksContent = await readFile(join(tempDir, "tasks.md"), "utf-8");
      // Should include the new scenario as a task
      expect(tasksContent).toContain("sc_new");
      expect(tasksContent).toContain("New scenario added");
      // Should NOT include unchanged existing scenario in task list
      // (but may appear as context under its CUJ)
    });

    test("modified scenario generates task for that scenario", async () => {
      // Create an aide file with a modified scenario (same ID, different hash)
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
  sc_modified:
    parent: cuj_existing
    props:
      name: Modified scenario
      given: Updated precondition
      when: Updated action
      then: Updated result
relationships: []
`;
      await writeFile(join(tempDir, "myapp.aide"), aideContent);

      // Create a lock file with an OLD hash for sc_modified
      const lockContent = `# myapp.aide.lock
entities:
  myapp: abc123
  cujs: def456
  cuj_existing: ghi789
  sc_modified: old_hash_000

relationships:
`;
      await writeFile(join(tempDir, "myapp.aide.lock"), lockContent);

      const { stdout, exitCode } = await runCli(["tasks"]);

      expect(exitCode).toBe(0);

      const tasksContent = await readFile(join(tempDir, "tasks.md"), "utf-8");
      // Should include the modified scenario as a task
      expect(tasksContent).toContain("sc_modified");
      expect(tasksContent).toContain("Modified scenario");
    });
  });

  // @scenario sc_tasks_design_token
  // @scenario sc_tasks_all_entity_types
  describe("Entity type task routing", () => {
    test("design_token changes generate apply tokens task", async () => {
      const aideContent = `entities:
  myapp:
    display: page
    props:
      title: My App
  design_system:
    display: list
    parent: myapp
    props:
      title: Design System
  color_primary:
    parent: design_system
    props:
      value: "#007bff"
relationships: []
`;
      await writeFile(join(tempDir, "myapp.aide"), aideContent);

      const lockContent = `# myapp.aide.lock
entities:
  myapp: abc123
  design_system: def456

relationships:
`;
      await writeFile(join(tempDir, "myapp.aide.lock"), lockContent);

      const { exitCode } = await runCli(["tasks"]);

      expect(exitCode).toBe(0);

      const tasksContent = await readFile(join(tempDir, "tasks.md"), "utf-8");

      expect(tasksContent).toContain("color_primary");
      expect(tasksContent).toContain("apply tokens to code");
    });

    test("constraint changes generate enforce task", async () => {
      const aideContent = `entities:
  myapp:
    display: page
    props:
      title: My App
  constraints:
    display: list
    parent: myapp
    props:
      title: Constraints
  con_new_rule:
    parent: constraints
    props:
      text: New constraint rule
relationships: []
`;
      await writeFile(join(tempDir, "myapp.aide"), aideContent);

      const lockContent = `# myapp.aide.lock
entities:
  myapp: abc123
  constraints: def456

relationships:
`;
      await writeFile(join(tempDir, "myapp.aide.lock"), lockContent);

      const { exitCode } = await runCli(["tasks"]);

      expect(exitCode).toBe(0);

      const tasksContent = await readFile(join(tempDir, "tasks.md"), "utf-8");

      expect(tasksContent).toContain("con_new_rule");
      expect(tasksContent).toContain("enforce in codebase");
    });

    test("foundation changes generate apply task", async () => {
      const aideContent = `entities:
  myapp:
    display: page
    props:
      title: My App
  foundations:
    display: list
    parent: myapp
    props:
      title: Foundations
  found_simplicity:
    parent: foundations
    props:
      text: Keep it simple
relationships: []
`;
      await writeFile(join(tempDir, "myapp.aide"), aideContent);

      const lockContent = `# myapp.aide.lock
entities:
  myapp: abc123
  foundations: def456

relationships:
`;
      await writeFile(join(tempDir, "myapp.aide.lock"), lockContent);

      const { exitCode } = await runCli(["tasks"]);

      expect(exitCode).toBe(0);

      const tasksContent = await readFile(join(tempDir, "tasks.md"), "utf-8");

      expect(tasksContent).toContain("found_simplicity");
      expect(tasksContent).toContain("apply to project");
    });

    test("invariant changes generate write checker task", async () => {
      const aideContent = `entities:
  myapp:
    display: page
    props:
      title: My App
  invariants:
    display: checklist
    parent: myapp
    props:
      title: Invariants
  inv_new_rule:
    parent: invariants
    props:
      statement: New invariant rule
relationships: []
`;
      await writeFile(join(tempDir, "myapp.aide"), aideContent);

      const lockContent = `# myapp.aide.lock
entities:
  myapp: abc123
  invariants: def456

relationships:
`;
      await writeFile(join(tempDir, "myapp.aide.lock"), lockContent);

      const { exitCode } = await runCli(["tasks"]);

      expect(exitCode).toBe(0);

      const tasksContent = await readFile(join(tempDir, "tasks.md"), "utf-8");

      expect(tasksContent).toContain("inv_new_rule");
      expect(tasksContent).toContain("write checker");
    });

    test("wisdom changes generate update exports task", async () => {
      const aideContent = `entities:
  myapp:
    display: page
    props:
      title: My App
  wisdom:
    display: list
    parent: myapp
    props:
      title: Wisdom
  wis_new_insight:
    parent: wisdom
    props:
      text: New wisdom insight
relationships: []
`;
      await writeFile(join(tempDir, "myapp.aide"), aideContent);

      const lockContent = `# myapp.aide.lock
entities:
  myapp: abc123
  wisdom: def456

relationships:
`;
      await writeFile(join(tempDir, "myapp.aide.lock"), lockContent);

      const { exitCode } = await runCli(["tasks"]);

      expect(exitCode).toBe(0);

      const tasksContent = await readFile(join(tempDir, "tasks.md"), "utf-8");

      expect(tasksContent).toContain("wis_new_insight");
      expect(tasksContent).toContain("update exports");
    });

    test("relationship changes generate verify connection task", async () => {
      const aideContent = `entities:
  myapp:
    display: page
    props:
      title: My App
  invariants:
    display: checklist
    parent: myapp
    props:
      title: Invariants
  inv_test:
    parent: invariants
    props:
      statement: Test invariant
  cujs:
    display: table
    parent: myapp
    props:
      title: CUJs
  cuj_test:
    parent: cujs
    props:
      feature: Test feature
  sc_test:
    parent: cuj_test
    props:
      name: Test scenario
relationships:
  - from: sc_test
    to: inv_test
    type: protected_by
    cardinality: many_to_many
`;
      await writeFile(join(tempDir, "myapp.aide"), aideContent);

      // Lock file WITHOUT the relationship
      const lockContent = `# myapp.aide.lock
entities:
  myapp: abc123
  invariants: def456
  inv_test: ghi789
  cujs: jkl012
  cuj_test: mno345
  sc_test: pqr678

relationships:
`;
      await writeFile(join(tempDir, "myapp.aide.lock"), lockContent);

      const { exitCode } = await runCli(["tasks"]);

      expect(exitCode).toBe(0);

      const tasksContent = await readFile(join(tempDir, "tasks.md"), "utf-8");

      // Should include the relationship task
      expect(tasksContent).toContain("sc_test");
      expect(tasksContent).toContain("inv_test");
      expect(tasksContent).toContain("verify connection");
    });
  });

  // @scenario sc_tasks_metadata_only
  describe("Metadata-only changes do not trigger implementation tasks", () => {
    test("scenario with only screen prop added does not generate implementation task", async () => {
      // Step 1: Create an aide file WITHOUT the screen prop
      const initialAideContent = `entities:
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
  sc_metadata_change:
    parent: cuj_existing
    props:
      name: Scenario with metadata
      given: Precondition
      when: Action
      then: Result
relationships: []
`;
      await writeFile(join(tempDir, "myapp.aide"), initialAideContent);

      // Step 2: Generate lock file with bantay aide lock
      await runCli(["aide", "lock"]);

      // Step 3: Modify aide file to ADD the screen prop (metadata-only change)
      const modifiedAideContent = `entities:
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
  sc_metadata_change:
    parent: cuj_existing
    props:
      name: Scenario with metadata
      given: Precondition
      when: Action
      then: Result
      screen: login
relationships: []
`;
      await writeFile(join(tempDir, "myapp.aide"), modifiedAideContent);

      // Step 4: Run bantay tasks
      const { exitCode } = await runCli(["tasks"]);

      expect(exitCode).toBe(0);

      const tasksContent = await readFile(join(tempDir, "tasks.md"), "utf-8");
      // Should NOT include implementation task for metadata-only change
      expect(tasksContent).not.toContain("sc_metadata_change");
      expect(tasksContent).not.toContain("Scenario with metadata");
    });

    test("scenario with only tier/area prop changed does not generate implementation task", async () => {
      // Step 1: Create an aide file WITHOUT tier/area props on scenario
      const initialAideContent = `entities:
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
  sc_tier_change:
    parent: cuj_existing
    props:
      name: Scenario with tier change
      given: Precondition
      when: Action
      then: Result
relationships: []
`;
      await writeFile(join(tempDir, "myapp.aide"), initialAideContent);

      // Step 2: Generate lock file
      await runCli(["aide", "lock"]);

      // Step 3: Modify aide file to ADD tier/area props
      const modifiedAideContent = `entities:
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
  sc_tier_change:
    parent: cuj_existing
    props:
      name: Scenario with tier change
      given: Precondition
      when: Action
      then: Result
      tier: secondary
      area: new_area
relationships: []
`;
      await writeFile(join(tempDir, "myapp.aide"), modifiedAideContent);

      const { exitCode } = await runCli(["tasks"]);

      expect(exitCode).toBe(0);

      const tasksContent = await readFile(join(tempDir, "tasks.md"), "utf-8");
      // Should NOT include implementation task for metadata-only change
      expect(tasksContent).not.toContain("sc_tier_change");
    });

    test("scenario with only underscore-prefixed prop changed does not generate implementation task", async () => {
      // Step 1: Create an aide file WITHOUT the underscore prop
      const initialAideContent = `entities:
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
  sc_underscore_change:
    parent: cuj_existing
    props:
      name: Scenario with underscore prop
      given: Precondition
      when: Action
      then: Result
relationships: []
`;
      await writeFile(join(tempDir, "myapp.aide"), initialAideContent);

      // Step 2: Generate lock file
      await runCli(["aide", "lock"]);

      // Step 3: Modify aide file to ADD underscore prop
      const modifiedAideContent = `entities:
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
  sc_underscore_change:
    parent: cuj_existing
    props:
      name: Scenario with underscore prop
      given: Precondition
      when: Action
      then: Result
      _internal_note: "Some internal note"
relationships: []
`;
      await writeFile(join(tempDir, "myapp.aide"), modifiedAideContent);

      const { exitCode } = await runCli(["tasks"]);

      expect(exitCode).toBe(0);

      const tasksContent = await readFile(join(tempDir, "tasks.md"), "utf-8");
      // Should NOT include implementation task for underscore prop change
      expect(tasksContent).not.toContain("sc_underscore_change");
    });

    test("scenario with behavioral prop (given) changed DOES generate implementation task", async () => {
      // Step 1: Create an aide file with original given value
      const initialAideContent = `entities:
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
  sc_given_change:
    parent: cuj_existing
    props:
      name: Scenario with given change
      given: OLD precondition
      when: Action
      then: Result
relationships: []
`;
      await writeFile(join(tempDir, "myapp.aide"), initialAideContent);

      // Step 2: Generate lock file
      await runCli(["aide", "lock"]);

      // Step 3: Modify aide file to CHANGE the given prop (behavioral change)
      const modifiedAideContent = `entities:
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
  sc_given_change:
    parent: cuj_existing
    props:
      name: Scenario with given change
      given: NEW precondition changed
      when: Action
      then: Result
relationships: []
`;
      await writeFile(join(tempDir, "myapp.aide"), modifiedAideContent);

      const { exitCode } = await runCli(["tasks"]);

      expect(exitCode).toBe(0);

      const tasksContent = await readFile(join(tempDir, "tasks.md"), "utf-8");
      // SHOULD include implementation task for behavioral prop change
      expect(tasksContent).toContain("sc_given_change");
      expect(tasksContent).toContain("NEW precondition changed");
    });

    test("scenario with behavioral prop (name) changed DOES generate implementation task", async () => {
      // Step 1: Create an aide file with original name value
      const initialAideContent = `entities:
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
  sc_name_change:
    parent: cuj_existing
    props:
      name: OLD scenario name
      given: Precondition
      when: Action
      then: Result
relationships: []
`;
      await writeFile(join(tempDir, "myapp.aide"), initialAideContent);

      // Step 2: Generate lock file
      await runCli(["aide", "lock"]);

      // Step 3: Modify aide file to CHANGE the name prop (behavioral change)
      const modifiedAideContent = `entities:
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
  sc_name_change:
    parent: cuj_existing
    props:
      name: NEW scenario name changed
      given: Precondition
      when: Action
      then: Result
relationships: []
`;
      await writeFile(join(tempDir, "myapp.aide"), modifiedAideContent);

      const { exitCode } = await runCli(["tasks"]);

      expect(exitCode).toBe(0);

      const tasksContent = await readFile(join(tempDir, "tasks.md"), "utf-8");
      // SHOULD include implementation task for name change
      expect(tasksContent).toContain("sc_name_change");
      expect(tasksContent).toContain("NEW scenario name changed");
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
