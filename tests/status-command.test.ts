import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { runStatus, type StatusResult, type ScenarioStatus } from "../src/commands/status";

describe("Status Command", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "bantay-status-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("Scenario Extraction", () => {
    test("extracts all sc_* entities from aide file", async () => {
      const aideContent = `entities:
  cuj_init:
    parent: cujs
    props:
      feature: Developer initializes Bantay
  sc_init_prerequisites:
    parent: cuj_init
    props:
      name: Verify prerequisites
  sc_init_binary:
    parent: cuj_init
    props:
      name: CLI is invocable
  cuj_check:
    parent: cujs
    props:
      feature: Developer checks invariants
  sc_check_full:
    parent: cuj_check
    props:
      name: Full invariant check
`;
      await writeFile(join(testDir, "bantay.aide"), aideContent);

      const result = await runStatus(testDir);

      expect(result.scenarios).toHaveLength(3);
      expect(result.scenarios.map((s) => s.id)).toContain("sc_init_prerequisites");
      expect(result.scenarios.map((s) => s.id)).toContain("sc_init_binary");
      expect(result.scenarios.map((s) => s.id)).toContain("sc_check_full");
    });

    test("groups scenarios by parent CUJ", async () => {
      const aideContent = `entities:
  cuj_init:
    parent: cujs
    props:
      feature: Developer initializes Bantay
  sc_init_prerequisites:
    parent: cuj_init
    props:
      name: Verify prerequisites
  sc_init_binary:
    parent: cuj_init
    props:
      name: CLI is invocable
  cuj_check:
    parent: cujs
    props:
      feature: Developer checks invariants
  sc_check_full:
    parent: cuj_check
    props:
      name: Full invariant check
`;
      await writeFile(join(testDir, "bantay.aide"), aideContent);

      const result = await runStatus(testDir);

      const initScenarios = result.scenarios.filter((s) => s.parentCuj === "cuj_init");
      const checkScenarios = result.scenarios.filter((s) => s.parentCuj === "cuj_check");

      expect(initScenarios).toHaveLength(2);
      expect(checkScenarios).toHaveLength(1);
    });

    test("extracts scenario name from props", async () => {
      const aideContent = `entities:
  cuj_init:
    parent: cujs
    props:
      feature: Developer initializes Bantay
  sc_init_prerequisites:
    parent: cuj_init
    props:
      name: Verify prerequisites before init
`;
      await writeFile(join(testDir, "bantay.aide"), aideContent);

      const result = await runStatus(testDir);

      expect(result.scenarios[0].name).toBe("Verify prerequisites before init");
    });
  });

  describe("Test Matching", () => {
    test("matches scenario to test file by ID in filename", async () => {
      const aideContent = `entities:
  cuj_init:
    parent: cujs
    props:
      feature: Developer initializes Bantay
  sc_init_prerequisites:
    parent: cuj_init
    props:
      name: Verify prerequisites
`;
      await writeFile(join(testDir, "bantay.aide"), aideContent);
      await mkdir(join(testDir, "tests"));
      await writeFile(
        join(testDir, "tests", "prerequisites.test.ts"),
        `describe("sc_init_prerequisites", () => { test("works", () => {}) });`
      );

      const result = await runStatus(testDir);

      expect(result.scenarios[0].testFile).toBe("tests/prerequisites.test.ts");
      expect(result.scenarios[0].status).toBe("implemented");
    });

    test("matches scenario to test file by describe block", async () => {
      const aideContent = `entities:
  cuj_check:
    parent: cujs
    props:
      feature: Developer checks invariants
  sc_check_full:
    parent: cuj_check
    props:
      name: Full invariant check
`;
      await writeFile(join(testDir, "bantay.aide"), aideContent);
      await mkdir(join(testDir, "tests"));
      await writeFile(
        join(testDir, "tests", "check-command.test.ts"),
        `describe("Check Command", () => {
  describe("sc_check_full", () => {
    test("evaluates all invariants", () => {});
  });
});`
      );

      const result = await runStatus(testDir);

      expect(result.scenarios[0].testFile).toBe("tests/check-command.test.ts");
      expect(result.scenarios[0].status).toBe("implemented");
    });

    test("matches scenario to test file by substring in test name", async () => {
      const aideContent = `entities:
  cuj_init:
    parent: cujs
    props:
      feature: Developer initializes Bantay
  sc_init_speed:
    parent: cuj_init
    props:
      name: Init completes quickly
`;
      await writeFile(join(testDir, "bantay.aide"), aideContent);
      await mkdir(join(testDir, "tests"));
      await writeFile(
        join(testDir, "tests", "init-command.test.ts"),
        `describe("Init Command", () => {
  test("completes in under 1 second for simple project", () => {});
});`
      );

      // This should NOT match because the substring matching should be strict
      const result = await runStatus(testDir);

      expect(result.scenarios[0].status).toBe("missing");
    });

    test("reports missing when no matching test found", async () => {
      const aideContent = `entities:
  cuj_ci:
    parent: cujs
    props:
      feature: CI integration
  sc_ci_github:
    parent: cuj_ci
    props:
      name: Generate GitHub Actions workflow
`;
      await writeFile(join(testDir, "bantay.aide"), aideContent);
      await mkdir(join(testDir, "tests"));

      const result = await runStatus(testDir);

      expect(result.scenarios[0].status).toBe("missing");
      expect(result.scenarios[0].testFile).toBeUndefined();
    });

    test("extracts line number from matching test", async () => {
      const aideContent = `entities:
  cuj_init:
    parent: cujs
    props:
      feature: Developer initializes Bantay
  sc_init_prerequisites:
    parent: cuj_init
    props:
      name: Verify prerequisites
`;
      await writeFile(join(testDir, "bantay.aide"), aideContent);
      await mkdir(join(testDir, "tests"));
      await writeFile(
        join(testDir, "tests", "prerequisites.test.ts"),
        `// Line 1
// Line 2
describe("sc_init_prerequisites", () => {
  test("works", () => {});
});`
      );

      const result = await runStatus(testDir);

      expect(result.scenarios[0].line).toBe(3);
    });
  });

  describe("Summary Statistics", () => {
    test("counts implemented vs missing scenarios", async () => {
      const aideContent = `entities:
  cuj_init:
    parent: cujs
    props:
      feature: Developer initializes Bantay
  sc_init_prerequisites:
    parent: cuj_init
    props:
      name: Verify prerequisites
  sc_init_binary:
    parent: cuj_init
    props:
      name: CLI is invocable
`;
      await writeFile(join(testDir, "bantay.aide"), aideContent);
      await mkdir(join(testDir, "tests"));
      await writeFile(
        join(testDir, "tests", "prerequisites.test.ts"),
        `describe("sc_init_prerequisites", () => { test("works", () => {}) });`
      );

      const result = await runStatus(testDir);

      expect(result.summary.implemented).toBe(1);
      expect(result.summary.missing).toBe(1);
      expect(result.summary.total).toBe(2);
    });
  });

  describe("JSON Output", () => {
    test("returns structured JSON when requested", async () => {
      const aideContent = `entities:
  cuj_init:
    parent: cujs
    props:
      feature: Developer initializes Bantay
  sc_init_prerequisites:
    parent: cuj_init
    props:
      name: Verify prerequisites
`;
      await writeFile(join(testDir, "bantay.aide"), aideContent);
      await mkdir(join(testDir, "tests"));
      await writeFile(
        join(testDir, "tests", "prerequisites.test.ts"),
        `describe("sc_init_prerequisites", () => { test("works", () => {}) });`
      );

      const result = await runStatus(testDir, { json: true });

      expect(result.scenarios[0]).toHaveProperty("id");
      expect(result.scenarios[0]).toHaveProperty("name");
      expect(result.scenarios[0]).toHaveProperty("parentCuj");
      expect(result.scenarios[0]).toHaveProperty("status");
      expect(result.scenarios[0]).toHaveProperty("testFile");
    });
  });

  describe("Edge Cases", () => {
    test("handles missing aide file", async () => {
      const result = await runStatus(testDir);

      expect(result.error).toBe("bantay.aide not found");
      expect(result.scenarios).toHaveLength(0);
    });

    test("handles empty tests directory", async () => {
      const aideContent = `entities:
  cuj_init:
    parent: cujs
    props:
      feature: Developer initializes Bantay
  sc_init_prerequisites:
    parent: cuj_init
    props:
      name: Verify prerequisites
`;
      await writeFile(join(testDir, "bantay.aide"), aideContent);

      const result = await runStatus(testDir);

      expect(result.scenarios[0].status).toBe("missing");
    });

    test("handles malformed aide YAML", async () => {
      await writeFile(join(testDir, "bantay.aide"), "not: valid: yaml: [");

      const result = await runStatus(testDir);

      expect(result.error).toContain("parse");
    });
  });

  describe("CUJ Information", () => {
    test("includes CUJ feature name in output", async () => {
      const aideContent = `entities:
  cuj_init:
    parent: cujs
    props:
      feature: Developer initializes Bantay in an existing project
  sc_init_prerequisites:
    parent: cuj_init
    props:
      name: Verify prerequisites
`;
      await writeFile(join(testDir, "bantay.aide"), aideContent);

      const result = await runStatus(testDir);

      expect(result.cujs).toBeDefined();
      expect(result.cujs!["cuj_init"]).toBe("Developer initializes Bantay in an existing project");
    });
  });
});
