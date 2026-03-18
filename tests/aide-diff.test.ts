/**
 * aide-diff.test.ts — enforces aide diff functionality
 *
 * Compare bantay.aide against bantay.aide.lock
 * Classify changes as ADDED, REMOVED, MODIFIED
 * Compare relationships
 * Exit code 0 if no changes, 1 if changes
 *
 * @scenario sc_aide_diff
 */

import { describe, test, expect } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { spawn } from "bun";
import { tmpdir } from "os";

describe("bantay aide diff", () => {
  const projectPath = process.cwd();
  const cliPath = join(projectPath, "src", "cli.ts");

  // Helper to create unique test directory for each test
  async function createTestDir(): Promise<string> {
    const dir = join(tmpdir(), `bantay-aide-diff-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  // Base aide content with proper parent hierarchy
  function baseAide(extraEntities = ""): string {
    return `entities:
  invariants:
    display: checklist
    props:
      title: Invariants
  scenarios:
    display: table
    props:
      title: Scenarios
  cujs:
    display: table
    props:
      title: CUJs
${extraEntities}relationships: []
`;
  }

  describe("when no changes", () => {
    test("exits with code 0 when aide matches lock", async () => {
      const testDir = await createTestDir();

      try {
        const aideContent = baseAide(`  inv_test:
    parent: invariants
    props:
      statement: Test invariant
      category: test
`);
        await writeFile(join(testDir, "bantay.aide"), aideContent);

        // Generate lock file
        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "lock"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        // Now diff should show no changes
        const proc = spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "diff"],
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

    test("outputs 'No changes' message", async () => {
      const testDir = await createTestDir();

      try {
        const aideContent = baseAide(`  inv_test:
    parent: invariants
    props:
      statement: Test invariant
      category: test
`);
        await writeFile(join(testDir, "bantay.aide"), aideContent);

        // Generate lock file
        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "lock"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        // Now diff should show no changes
        const proc = spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "diff"],
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

  describe("when entities added", () => {
    test("exits with code 1 when new entity added", async () => {
      const testDir = await createTestDir();

      try {
        const aideContent = baseAide(`  inv_existing:
    parent: invariants
    props:
      statement: Existing invariant
      category: test
`);
        await writeFile(join(testDir, "bantay.aide"), aideContent);

        // Generate lock
        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "lock"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        // Add a new entity
        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "add", "inv_new", "--parent", "invariants", "--prop", "statement=New invariant"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        // Check diff
        const proc = spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "diff"],
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

    test("shows added entity with + prefix", async () => {
      const testDir = await createTestDir();

      try {
        const aideContent = baseAide(`  inv_existing:
    parent: invariants
    props:
      statement: Existing invariant
      category: test
`);
        await writeFile(join(testDir, "bantay.aide"), aideContent);

        // Generate lock
        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "lock"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        // Add a new entity
        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "add", "inv_new", "--parent", "invariants", "--prop", "statement=New invariant"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        // Check diff
        const proc = spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "diff"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        });

        const [, stdout] = await Promise.all([
          proc.exited,
          new Response(proc.stdout).text(),
        ]);

        expect(stdout).toContain("ADDED");
        expect(stdout).toContain("+ inv_new");
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    test("classifies entity type from ID prefix", async () => {
      const testDir = await createTestDir();

      try {
        // Start with just containers
        const aideContent = baseAide("");
        await writeFile(join(testDir, "bantay.aide"), aideContent);

        // Generate lock
        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "lock"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        // Add entities with different prefixes
        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "add", "sc_new_scenario", "--parent", "scenarios", "--prop", "description=New scenario"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "add", "cuj_new_journey", "--parent", "cujs", "--prop", "feature=New journey"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        // Check diff
        const proc = spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "diff"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        });

        const [, stdout] = await Promise.all([
          proc.exited,
          new Response(proc.stdout).text(),
        ]);

        expect(stdout).toContain("scenario");
        expect(stdout).toContain("cuj");
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });

  describe("when entities removed", () => {
    test("exits with code 1 when entity removed", async () => {
      const testDir = await createTestDir();

      try {
        const aideContent = baseAide(`  inv_remaining:
    parent: invariants
    props:
      statement: Remaining invariant
  inv_removed:
    parent: invariants
    props:
      statement: Will be removed
`);
        await writeFile(join(testDir, "bantay.aide"), aideContent);

        // Generate lock
        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "lock"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        // Remove an entity
        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "remove", "inv_removed", "--force"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        // Check diff
        const proc = spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "diff"],
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

    test("shows removed entity with - prefix", async () => {
      const testDir = await createTestDir();

      try {
        const aideContent = baseAide(`  inv_remaining:
    parent: invariants
    props:
      statement: Remaining invariant
  inv_removed:
    parent: invariants
    props:
      statement: Will be removed
`);
        await writeFile(join(testDir, "bantay.aide"), aideContent);

        // Generate lock
        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "lock"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        // Remove an entity
        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "remove", "inv_removed", "--force"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        // Check diff
        const proc = spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "diff"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        });

        const [, stdout] = await Promise.all([
          proc.exited,
          new Response(proc.stdout).text(),
        ]);

        expect(stdout).toContain("REMOVED");
        expect(stdout).toContain("- inv_removed");
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });

  describe("when entities modified", () => {
    test("exits with code 1 when entity hash changed", async () => {
      const testDir = await createTestDir();

      try {
        const aideContent = baseAide(`  inv_changed:
    parent: invariants
    props:
      statement: Original statement
      category: test
`);
        await writeFile(join(testDir, "bantay.aide"), aideContent);

        // Generate lock
        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "lock"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        // Modify the entity
        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "update", "inv_changed", "--prop", "statement=Modified statement"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        // Check diff
        const proc = spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "diff"],
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

    test("shows modified entity with ~ prefix", async () => {
      const testDir = await createTestDir();

      try {
        const aideContent = baseAide(`  inv_changed:
    parent: invariants
    props:
      statement: Original statement
      category: test
`);
        await writeFile(join(testDir, "bantay.aide"), aideContent);

        // Generate lock
        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "lock"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        // Modify the entity
        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "update", "inv_changed", "--prop", "statement=Modified statement"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        // Check diff
        const proc = spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "diff"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        });

        const [, stdout] = await Promise.all([
          proc.exited,
          new Response(proc.stdout).text(),
        ]);

        expect(stdout).toContain("MODIFIED");
        expect(stdout).toContain("~ inv_changed");
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });

  describe("relationships", () => {
    test("detects added relationship", async () => {
      const testDir = await createTestDir();

      try {
        const aideContent = baseAide(`  sc_test:
    parent: scenarios
    props:
      description: Test
  inv_test:
    parent: invariants
    props:
      statement: Test
`);
        await writeFile(join(testDir, "bantay.aide"), aideContent);

        // Generate lock
        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "lock"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        // Now add a relationship
        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "link", "sc_test", "inv_test", "--type", "protected_by"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        // Check diff
        const proc = spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "diff"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        });

        const [exitCode, stdout] = await Promise.all([
          proc.exited,
          new Response(proc.stdout).text(),
        ]);

        expect(exitCode).toBe(1);
        expect(stdout).toContain("RELATIONSHIPS");
        expect(stdout).toContain("+ sc_test");
        expect(stdout).toContain("protected_by");
        expect(stdout).toContain("inv_test");
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    test("detects removed relationship", async () => {
      const testDir = await createTestDir();

      try {
        // Create aide with relationship
        const aideContentWithRel = `entities:
  invariants:
    display: checklist
    props:
      title: Invariants
  scenarios:
    display: table
    props:
      title: Scenarios
  sc_test:
    parent: scenarios
    props:
      description: Test
  inv_test:
    parent: invariants
    props:
      statement: Test
relationships:
  - from: sc_test
    to: inv_test
    type: protected_by
    cardinality: many_to_many
`;
        await writeFile(join(testDir, "bantay.aide"), aideContentWithRel);

        // Generate lock
        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "lock"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        // Now write aide without the relationship
        const aideContentWithoutRel = baseAide(`  sc_test:
    parent: scenarios
    props:
      description: Test
  inv_test:
    parent: invariants
    props:
      statement: Test
`);
        await writeFile(join(testDir, "bantay.aide"), aideContentWithoutRel);

        // Check diff
        const proc = spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "diff"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        });

        const [exitCode, stdout] = await Promise.all([
          proc.exited,
          new Response(proc.stdout).text(),
        ]);

        expect(exitCode).toBe(1);
        expect(stdout).toContain("RELATIONSHIPS");
        expect(stdout).toContain("-");
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });

  describe("--json flag", () => {
    test("outputs valid JSON when --json flag is used", async () => {
      const testDir = await createTestDir();

      try {
        const aideContent = baseAide("");
        await writeFile(join(testDir, "bantay.aide"), aideContent);

        // Generate lock
        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "lock"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        // Add entity
        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "add", "inv_new", "--parent", "invariants", "--prop", "statement=New invariant"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        // Check diff with JSON
        const proc = spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "diff", "--json"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        });

        const [, stdout] = await Promise.all([
          proc.exited,
          new Response(proc.stdout).text(),
        ]);

        const output = JSON.parse(stdout);
        expect(output).toBeDefined();
        expect(typeof output).toBe("object");
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    test("JSON output contains added, removed, modified arrays", async () => {
      const testDir = await createTestDir();

      try {
        const aideContent = baseAide(`  inv_old:
    parent: invariants
    props:
      statement: Old invariant
`);
        await writeFile(join(testDir, "bantay.aide"), aideContent);

        // Generate lock
        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "lock"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        // Remove old, add new
        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "remove", "inv_old", "--force"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "add", "inv_new", "--parent", "invariants", "--prop", "statement=New invariant"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        // Check diff with JSON
        const proc = spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "diff", "--json"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        });

        const [, stdout] = await Promise.all([
          proc.exited,
          new Response(proc.stdout).text(),
        ]);

        const output = JSON.parse(stdout);
        expect(output.added).toBeDefined();
        expect(Array.isArray(output.added)).toBe(true);
        expect(output.removed).toBeDefined();
        expect(Array.isArray(output.removed)).toBe(true);
        expect(output.modified).toBeDefined();
        expect(Array.isArray(output.modified)).toBe(true);
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    test("JSON output contains relationships changes", async () => {
      const testDir = await createTestDir();

      try {
        const aideContent = baseAide(`  sc_test:
    parent: scenarios
    props:
      description: Test
  inv_test:
    parent: invariants
    props:
      statement: Test
`);
        await writeFile(join(testDir, "bantay.aide"), aideContent);

        // Generate lock
        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "lock"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        // Add relationship
        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "link", "sc_test", "inv_test", "--type", "protected_by"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        // Check diff with JSON
        const proc = spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "diff", "--json"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        });

        const [, stdout] = await Promise.all([
          proc.exited,
          new Response(proc.stdout).text(),
        ]);

        const output = JSON.parse(stdout);
        expect(output.relationships).toBeDefined();
        expect(output.relationships.added).toBeDefined();
        expect(output.relationships.removed).toBeDefined();
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });

  describe("summary", () => {
    test("shows summary with counts", async () => {
      const testDir = await createTestDir();

      try {
        const aideContent = baseAide(`  inv_modified:
    parent: invariants
    props:
      statement: Original
  inv_removed:
    parent: invariants
    props:
      statement: Will be removed
`);
        await writeFile(join(testDir, "bantay.aide"), aideContent);

        // Generate lock
        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "lock"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        // Add two new entities
        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "add", "inv_new1", "--parent", "invariants", "--prop", "statement=New 1"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "add", "inv_new2", "--parent", "invariants", "--prop", "statement=New 2"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        // Modify one entity
        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "update", "inv_modified", "--prop", "statement=Modified"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        // Remove one entity
        await spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "remove", "inv_removed", "--force"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        }).exited;

        // Check diff
        const proc = spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "diff"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        });

        const [, stdout] = await Promise.all([
          proc.exited,
          new Response(proc.stdout).text(),
        ]);

        expect(stdout).toContain("Summary");
        expect(stdout).toContain("2 added");
        expect(stdout).toContain("1 modified");
        expect(stdout).toContain("1 removed");
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });

  describe("missing files", () => {
    test("errors gracefully when bantay.aide missing", async () => {
      const testDir = await createTestDir();

      try {
        // No aide file, only lock
        const lockContent = `# bantay.aide.lock
entities:
  inv_test: hash123

relationships:
`;

        await writeFile(join(testDir, "bantay.aide.lock"), lockContent);

        const proc = spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "diff"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        });

        const [exitCode, , stderr] = await Promise.all([
          proc.exited,
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);

        expect(exitCode).not.toBe(0);
        expect(stderr).toContain("bantay.aide");
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    test("errors gracefully when bantay.aide.lock missing", async () => {
      const testDir = await createTestDir();

      try {
        const aideContent = baseAide(`  inv_test:
    parent: invariants
    props:
      statement: Test
`);
        await writeFile(join(testDir, "bantay.aide"), aideContent);

        const proc = spawn({
          cmd: [process.execPath, "run", cliPath, "aide", "diff"],
          cwd: testDir,
          stdout: "pipe",
          stderr: "pipe",
        });

        const [exitCode, , stderr] = await Promise.all([
          proc.exited,
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);

        expect(exitCode).not.toBe(0);
        expect(stderr).toContain("bantay.aide.lock");
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });
});
