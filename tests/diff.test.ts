/**
 * diff.test.ts — enforces bantay diff command
 *
 * bantay diff wraps bantay aide diff with entity type classification
 * based on parent chain, not ID prefix.
 *
 * @scenario sc_diff_classified
 */

import { describe, test, expect } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { spawn } from "bun";
import { tmpdir } from "os";

describe("bantay diff", () => {
  const projectPath = process.cwd();
  const cliPath = join(projectPath, "src", "cli.ts");

  async function createTestDir(): Promise<string> {
    const dir = join(tmpdir(), `bantay-diff-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  describe("entity type classification by parent chain", () => {
    test("classifies scenario by CUJ parent", async () => {
      const testDir = await createTestDir();

      try {
        const aideContent = `entities:
  cujs:
    display: table
    props:
      title: CUJs
  cuj_flow_writing:
    parent: cujs
    props:
      feature: Flow writing feature
relationships: []
`;
        await writeFile(join(testDir, "bantay.aide"), aideContent);

        // Generate lock
        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "lock"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        // Add a scenario under the CUJ
        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "add", "sc_timer_display", "--parent", "cuj_flow_writing", "--prop", "name=Timer display"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        // Run bantay diff (new command)
        const proc = spawn({
          cmd: [process.execPath, "run", cliPath, "diff"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        });

        const [, stdout] = await Promise.all([
          proc.exited,
          new Response(proc.stdout).text(),
        ]);

        // Should show "ADDED scenario: sc_timer_display (parent: cuj_flow_writing)"
        expect(stdout).toContain("ADDED scenario: sc_timer_display (parent: cuj_flow_writing)");
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    test("classifies invariant by invariants parent", async () => {
      const testDir = await createTestDir();

      try {
        const aideContent = `entities:
  invariants:
    display: checklist
    props:
      title: Invariants
relationships: []
`;
        await writeFile(join(testDir, "bantay.aide"), aideContent);

        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "lock"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "add", "inv_timer_live", "--parent", "invariants", "--prop", "statement=Timer updates live"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        const proc = spawn({
          cmd: [process.execPath, "run", cliPath, "diff"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        });

        const [, stdout] = await Promise.all([
          proc.exited,
          new Response(proc.stdout).text(),
        ]);

        expect(stdout).toContain("ADDED invariant: inv_timer_live (parent: invariants)");
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    test("classifies constraint by constraints parent", async () => {
      const testDir = await createTestDir();

      try {
        const aideContent = `entities:
  constraints:
    display: list
    props:
      title: Constraints
relationships: []
`;
        await writeFile(join(testDir, "bantay.aide"), aideContent);

        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "lock"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "add", "con_design_system", "--parent", "constraints", "--prop", "text=Use design system"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        const proc = spawn({
          cmd: [process.execPath, "run", cliPath, "diff"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        });

        const [, stdout] = await Promise.all([
          proc.exited,
          new Response(proc.stdout).text(),
        ]);

        expect(stdout).toContain("ADDED constraint: con_design_system (parent: constraints)");
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    test("classifies foundation by foundations parent", async () => {
      const testDir = await createTestDir();

      try {
        const aideContent = `entities:
  foundations:
    display: list
    props:
      title: Foundations
relationships: []
`;
        await writeFile(join(testDir, "bantay.aide"), aideContent);

        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "lock"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "add", "found_simplicity", "--parent", "foundations", "--prop", "text=Keep it simple"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        const proc = spawn({
          cmd: [process.execPath, "run", cliPath, "diff"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        });

        const [, stdout] = await Promise.all([
          proc.exited,
          new Response(proc.stdout).text(),
        ]);

        expect(stdout).toContain("ADDED foundation: found_simplicity (parent: foundations)");
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    test("classifies wisdom by wisdom parent", async () => {
      const testDir = await createTestDir();

      try {
        const aideContent = `entities:
  wisdom:
    display: list
    props:
      title: Wisdom
relationships: []
`;
        await writeFile(join(testDir, "bantay.aide"), aideContent);

        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "lock"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "add", "wis_test_first", "--parent", "wisdom", "--prop", "text=Test first"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        const proc = spawn({
          cmd: [process.execPath, "run", cliPath, "diff"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        });

        const [, stdout] = await Promise.all([
          proc.exited,
          new Response(proc.stdout).text(),
        ]);

        expect(stdout).toContain("ADDED wisdom: wis_test_first (parent: wisdom)");
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    test("classifies relationship changes", async () => {
      const testDir = await createTestDir();

      try {
        const aideContent = `entities:
  scenarios:
    display: table
    props:
      title: Scenarios
  invariants:
    display: checklist
    props:
      title: Invariants
  sc_test:
    parent: scenarios
    props:
      description: Test
  inv_test:
    parent: invariants
    props:
      statement: Test
relationships: []
`;
        await writeFile(join(testDir, "bantay.aide"), aideContent);

        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "lock"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        // Add a relationship
        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "link", "sc_test", "inv_test", "--type", "protected_by"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        const proc = spawn({
          cmd: [process.execPath, "run", cliPath, "diff"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        });

        const [exitCode, stdout] = await Promise.all([
          proc.exited,
          new Response(proc.stdout).text(),
        ]);

        expect(exitCode).toBe(1);
        expect(stdout).toContain("ADDED relationship: sc_test → inv_test");
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    test("defaults to entity type when no known parent", async () => {
      const testDir = await createTestDir();

      try {
        const aideContent = `entities:
  myproject:
    display: page
    props:
      title: My Project
relationships: []
`;
        await writeFile(join(testDir, "bantay.aide"), aideContent);

        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "lock"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "add", "custom_thing", "--parent", "myproject", "--prop", "name=Thing"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        const proc = spawn({
          cmd: [process.execPath, "run", cliPath, "diff"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        });

        const [, stdout] = await Promise.all([
          proc.exited,
          new Response(proc.stdout).text(),
        ]);

        expect(stdout).toContain("ADDED entity: custom_thing (parent: myproject)");
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });

  describe("--json flag", () => {
    test("JSON output includes type, action, entity_id, parent", async () => {
      const testDir = await createTestDir();

      try {
        const aideContent = `entities:
  cujs:
    display: table
    props:
      title: CUJs
  cuj_flow:
    parent: cujs
    props:
      feature: Flow
  invariants:
    display: checklist
    props:
      title: Invariants
relationships: []
`;
        await writeFile(join(testDir, "bantay.aide"), aideContent);

        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "lock"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "add", "sc_timer", "--parent", "cuj_flow", "--prop", "name=Timer"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "add", "inv_speed", "--parent", "invariants", "--prop", "statement=Fast"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        const proc = spawn({
          cmd: [process.execPath, "run", cliPath, "diff", "--json"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        });

        const [, stdout] = await Promise.all([
          proc.exited,
          new Response(proc.stdout).text(),
        ]);

        const output = JSON.parse(stdout);

        // Check structure
        expect(output.changes).toBeDefined();
        expect(Array.isArray(output.changes)).toBe(true);

        // Find the scenario
        const scenarioEntry = output.changes.find((e: { entity_id: string }) => e.entity_id === "sc_timer");
        expect(scenarioEntry).toBeDefined();
        expect(scenarioEntry.type).toBe("scenario");
        expect(scenarioEntry.action).toBe("ADDED");
        expect(scenarioEntry.parent).toBe("cuj_flow");

        // Find the invariant
        const invariantEntry = output.changes.find((e: { entity_id: string }) => e.entity_id === "inv_speed");
        expect(invariantEntry).toBeDefined();
        expect(invariantEntry.type).toBe("invariant");
        expect(invariantEntry.action).toBe("ADDED");
        expect(invariantEntry.parent).toBe("invariants");
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    test("JSON output includes relationship changes", async () => {
      const testDir = await createTestDir();

      try {
        const aideContent = `entities:
  scenarios:
    display: table
    props:
      title: Scenarios
  invariants:
    display: checklist
    props:
      title: Invariants
  sc_test:
    parent: scenarios
    props:
      description: Test
  inv_test:
    parent: invariants
    props:
      statement: Test
relationships: []
`;
        await writeFile(join(testDir, "bantay.aide"), aideContent);

        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "lock"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "link", "sc_test", "inv_test", "--type", "protected_by"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        const proc = spawn({
          cmd: [process.execPath, "run", cliPath, "diff", "--json"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        });

        const [, stdout] = await Promise.all([
          proc.exited,
          new Response(proc.stdout).text(),
        ]);

        const output = JSON.parse(stdout);

        // Find the relationship
        const relEntry = output.changes.find((e: { type: string }) => e.type === "relationship");
        expect(relEntry).toBeDefined();
        expect(relEntry.action).toBe("ADDED");
        expect(relEntry.from).toBe("sc_test");
        expect(relEntry.to).toBe("inv_test");
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });

  describe("modified and removed entities", () => {
    test("shows MODIFIED for changed entities", async () => {
      const testDir = await createTestDir();

      try {
        const aideContent = `entities:
  invariants:
    display: checklist
    props:
      title: Invariants
  inv_existing:
    parent: invariants
    props:
      statement: Original statement
relationships: []
`;
        await writeFile(join(testDir, "bantay.aide"), aideContent);

        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "lock"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "update", "inv_existing", "--prop", "statement=Modified statement"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        const proc = spawn({
          cmd: [process.execPath, "run", cliPath, "diff"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        });

        const [, stdout] = await Promise.all([
          proc.exited,
          new Response(proc.stdout).text(),
        ]);

        expect(stdout).toContain("MODIFIED invariant: inv_existing (parent: invariants)");
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    test("shows REMOVED for deleted entities", async () => {
      const testDir = await createTestDir();

      try {
        const aideContent = `entities:
  constraints:
    display: list
    props:
      title: Constraints
  con_to_remove:
    parent: constraints
    props:
      text: Will be removed
relationships: []
`;
        await writeFile(join(testDir, "bantay.aide"), aideContent);

        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "lock"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "remove", "con_to_remove", "--force"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        const proc = spawn({
          cmd: [process.execPath, "run", cliPath, "diff"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        });

        const [, stdout] = await Promise.all([
          proc.exited,
          new Response(proc.stdout).text(),
        ]);

        expect(stdout).toContain("REMOVED constraint: con_to_remove");
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });

  describe("exit codes", () => {
    test("exits 0 when no changes", async () => {
      const testDir = await createTestDir();

      try {
        const aideContent = `entities:
  invariants:
    display: checklist
    props:
      title: Invariants
  inv_test:
    parent: invariants
    props:
      statement: Test
relationships: []
`;
        await writeFile(join(testDir, "bantay.aide"), aideContent);

        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "lock"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        const proc = spawn({
          cmd: [process.execPath, "run", cliPath, "diff"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        });

        const exitCode = await proc.exited;
        expect(exitCode).toBe(0);
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    test("exits 1 when changes exist", async () => {
      const testDir = await createTestDir();

      try {
        const aideContent = `entities:
  invariants:
    display: checklist
    props:
      title: Invariants
relationships: []
`;
        await writeFile(join(testDir, "bantay.aide"), aideContent);

        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "lock"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "add", "inv_new", "--parent", "invariants", "--prop", "statement=New"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        const proc = spawn({
          cmd: [process.execPath, "run", cliPath, "diff"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        });

        const exitCode = await proc.exited;
        expect(exitCode).toBe(1);
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });

  describe("no changes", () => {
    test("outputs 'No changes' when aide matches lock", async () => {
      const testDir = await createTestDir();

      try {
        const aideContent = `entities:
  invariants:
    display: checklist
    props:
      title: Invariants
  inv_test:
    parent: invariants
    props:
      statement: Test
relationships: []
`;
        await writeFile(join(testDir, "bantay.aide"), aideContent);

        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "lock"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        const proc = spawn({
          cmd: [process.execPath, "run", cliPath, "diff"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        });

        const [, stdout] = await Promise.all([
          proc.exited,
          new Response(proc.stdout).text(),
        ]);

        expect(stdout).toContain("No changes");
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });
});
