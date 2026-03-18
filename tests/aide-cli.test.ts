import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "fs/promises";
import { tmpdir, homedir } from "os";
import { join } from "path";
import { spawn } from "bun";

const CLI_PATH = join(import.meta.dir, "../src/cli.ts");
const BUN_PATH = join(homedir(), ".bun", "bin", "bun");

describe("Aide CLI Integration", () => {
  let tempDir: string;
  let aidePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "aide-cli-test-"));
    aidePath = join(tempDir, "test.aide");

    // Create a test aide file
    await writeFile(
      aidePath,
      `entities:
  root:
    display: page
    props:
      title: Test Root

  invariants:
    parent: root
    display: checklist
    props:
      title: Invariants

  cujs:
    parent: root
    display: table
    props:
      title: CUJs

  cuj_init:
    parent: cujs
    props:
      feature: Initialize the project

  sc_init_prerequisites:
    parent: cuj_init
    props:
      name: Verify prerequisites before init

relationships: []
`
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const proc = spawn({
      cmd: [BUN_PATH, "run", CLI_PATH, ...args],
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    return { stdout, stderr, exitCode };
  }

  test("bantay aide validate reports valid file", async () => {
    const { stdout, exitCode } = await runCli(["aide", "validate", "--aide", aidePath]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Aide file is valid");
    expect(stdout).toContain("Entities: 5");
    expect(stdout).toContain("Relationships: 0");
  });

  test("bantay aide add creates new entity", async () => {
    const { stdout, exitCode } = await runCli([
      "aide", "add", "inv_test",
      "--aide", aidePath,
      "--parent", "invariants",
      "--prop", "statement=Test invariant",
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Added entity: inv_test");

    // Verify the entity was added
    const content = await readFile(aidePath, "utf-8");
    expect(content).toContain("inv_test");
  });

  test("bantay aide add auto-generates ID for invariants parent", async () => {
    const { stdout, exitCode } = await runCli([
      "aide", "add",
      "--aide", aidePath,
      "--parent", "invariants",
      "--prop", "statement=Auto-named invariant",
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/Added entity: inv_/);
  });

  test("bantay aide link creates relationship", async () => {
    // First add an invariant
    await runCli([
      "aide", "add", "inv_bun_available",
      "--aide", aidePath,
      "--parent", "invariants",
      "--prop", "statement=Bun must be available",
    ]);

    // Then link it
    const { stdout, exitCode } = await runCli([
      "aide", "link", "sc_init_prerequisites", "inv_bun_available",
      "--aide", aidePath,
      "--type", "protected_by",
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Added relationship");
    expect(stdout).toContain("sc_init_prerequisites");
    expect(stdout).toContain("inv_bun_available");
    expect(stdout).toContain("protected_by");
  });

  test("bantay aide remove deletes entity", async () => {
    // Add then remove
    await runCli([
      "aide", "add", "inv_temp",
      "--aide", aidePath,
      "--parent", "invariants",
    ]);

    const { stdout, exitCode } = await runCli([
      "aide", "remove", "inv_temp",
      "--aide", aidePath,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Removed entity: inv_temp");

    // Verify it's gone
    const content = await readFile(aidePath, "utf-8");
    expect(content).not.toContain("inv_temp");
  });

  test("bantay aide remove fails when relationships exist without force", async () => {
    // Add entity and link it
    await runCli([
      "aide", "add", "inv_linked",
      "--aide", aidePath,
      "--parent", "invariants",
    ]);

    await runCli([
      "aide", "link", "sc_init_prerequisites", "inv_linked",
      "--aide", aidePath,
      "--type", "protected_by",
    ]);

    // Try to remove without force
    const { exitCode } = await runCli([
      "aide", "remove", "inv_linked",
      "--aide", aidePath,
    ]);

    expect(exitCode).toBe(1);
  });

  test("bantay aide remove with force removes entity and relationships", async () => {
    // Add entity and link it
    await runCli([
      "aide", "add", "inv_linked",
      "--aide", aidePath,
      "--parent", "invariants",
    ]);

    await runCli([
      "aide", "link", "sc_init_prerequisites", "inv_linked",
      "--aide", aidePath,
      "--type", "protected_by",
    ]);

    // Remove with force
    const { stdout, exitCode } = await runCli([
      "aide", "remove", "inv_linked",
      "--aide", aidePath,
      "--force",
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Removed entity: inv_linked");
  });

  test("bantay aide show displays tree", async () => {
    const { stdout, exitCode } = await runCli(["aide", "show", "--aide", aidePath]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Entities:");
    expect(stdout).toContain("root");
    expect(stdout).toContain("invariants");
  });

  test("bantay aide show --format json outputs JSON", async () => {
    const { stdout, exitCode } = await runCli([
      "aide", "show",
      "--aide", aidePath,
      "--format", "json",
    ]);

    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout.split("\n").filter((l) => !l.includes("Checking")).join("\n"));
    expect(parsed.entities).toBeDefined();
    expect(parsed.relationships).toBeDefined();
  });

  test("bantay aide lock generates lock file", async () => {
    const { stdout, exitCode } = await runCli(["aide", "lock", "--aide", aidePath]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Lock file generated");

    // Verify lock file exists
    const lockContent = await readFile(`${aidePath}.lock`, "utf-8");
    expect(lockContent).toContain("bantay.aide.lock");
    expect(lockContent).toContain("entities:");
  });

  test("full workflow: add invariant and link to scenario", async () => {
    // Add inv_bun_available
    const addResult = await runCli([
      "aide", "add", "inv_bun_available",
      "--aide", aidePath,
      "--parent", "invariants",
      "--prop", "statement=Bantay verifies Bun runtime is available",
      "--prop", "category=prerequisites",
    ]);

    expect(addResult.exitCode).toBe(0);
    expect(addResult.stdout).toContain("Added entity: inv_bun_available");

    // Link to sc_init_prerequisites
    const linkResult = await runCli([
      "aide", "link", "sc_init_prerequisites", "inv_bun_available",
      "--aide", aidePath,
      "--type", "protected_by",
    ]);

    expect(linkResult.exitCode).toBe(0);

    // Validate
    const validateResult = await runCli(["aide", "validate", "--aide", aidePath]);

    expect(validateResult.exitCode).toBe(0);
    expect(validateResult.stdout).toContain("Aide file is valid");
    expect(validateResult.stdout).toContain("Relationships: 1");
  });
});
