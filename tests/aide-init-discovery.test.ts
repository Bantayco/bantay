import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, readFile, readdir } from "fs/promises";
import { tmpdir, homedir } from "os";
import { join, basename } from "path";
import { spawn } from "bun";
import { existsSync } from "fs";

const CLI_PATH = join(import.meta.dir, "../src/cli.ts");
const BUN_PATH = join(homedir(), ".bun", "bin", "bun");

// @scenario sc_aide_init
describe("Aide Init Command", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "aide-init-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function runCli(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const proc = spawn({
      cmd: [BUN_PATH, "run", CLI_PATH, ...args],
      stdout: "pipe",
      stderr: "pipe",
      cwd: cwd || tempDir,
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    return { stdout, stderr, exitCode };
  }

  test("aide init creates <dirname>.aide with correct skeleton", async () => {
    const { stdout, exitCode } = await runCli(["aide", "init"]);

    expect(exitCode).toBe(0);

    // Should create file named after directory
    const dirName = basename(tempDir);
    const aidePath = join(tempDir, `${dirName}.aide`);
    expect(existsSync(aidePath)).toBe(true);

    // Verify skeleton structure
    const content = await readFile(aidePath, "utf-8");
    expect(content).toContain("entities:");
    expect(content).toContain("display: page");
    expect(content).toContain("cujs:");
    expect(content).toContain("invariants:");
    expect(content).toContain("constraints:");
    expect(content).toContain("foundations:");
    expect(content).toContain("wisdom:");
    expect(content).toContain("relationships:");

    expect(stdout).toContain(`Created ${dirName}.aide`);
  });

  test("aide init --name myapp creates myapp.aide", async () => {
    const { stdout, exitCode } = await runCli(["aide", "init", "--name", "myapp"]);

    expect(exitCode).toBe(0);

    const aidePath = join(tempDir, "myapp.aide");
    expect(existsSync(aidePath)).toBe(true);

    // Verify skeleton structure has correct title
    const content = await readFile(aidePath, "utf-8");
    expect(content).toContain("title: myapp");

    expect(stdout).toContain("Created myapp.aide");
  });

  test("aide init when .aide exists warns and doesn't overwrite", async () => {
    // Create an existing aide file
    const existingPath = join(tempDir, "existing.aide");
    const existingContent = `entities:
  existing_entity:
    props:
      custom: true
relationships: []
`;
    await writeFile(existingPath, existingContent);

    const { stderr, exitCode } = await runCli(["aide", "init"]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("already exists");
    expect(stderr).toContain("existing.aide");

    // Verify file was NOT overwritten
    const content = await readFile(existingPath, "utf-8");
    expect(content).toContain("existing_entity");
    expect(content).toContain("custom: true");
  });

  test("aide init --name when that name already exists warns and doesn't overwrite", async () => {
    // Create an existing aide file with that name
    const existingPath = join(tempDir, "myapp.aide");
    const existingContent = `entities:
  custom_entity:
    props:
      original: true
relationships: []
`;
    await writeFile(existingPath, existingContent);

    const { stderr, exitCode } = await runCli(["aide", "init", "--name", "myapp"]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("already exists");
    expect(stderr).toContain("myapp.aide");

    // Verify file was NOT overwritten
    const content = await readFile(existingPath, "utf-8");
    expect(content).toContain("custom_entity");
    expect(content).toContain("original: true");
  });
});

// @scenario sc_aide_discovery
describe("Aide File Discovery", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "aide-discovery-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function runCli(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const proc = spawn({
      cmd: [BUN_PATH, "run", CLI_PATH, ...args],
      stdout: "pipe",
      stderr: "pipe",
      cwd: cwd || tempDir,
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    return { stdout, stderr, exitCode };
  }

  test("aide show finds the only .aide file automatically", async () => {
    // Create a single aide file
    const aidePath = join(tempDir, "myproject.aide");
    await writeFile(
      aidePath,
      `entities:
  root:
    display: page
    props:
      title: My Project
relationships: []
`
    );

    const { stdout, exitCode } = await runCli(["aide", "show"]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("root");
  });

  test("aide show errors when multiple .aide files exist", async () => {
    // Create multiple aide files
    await writeFile(
      join(tempDir, "project1.aide"),
      `entities:
  root1:
    display: page
relationships: []
`
    );
    await writeFile(
      join(tempDir, "project2.aide"),
      `entities:
  root2:
    display: page
relationships: []
`
    );

    const { stderr, exitCode } = await runCli(["aide", "show"]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Multiple .aide files found");
    expect(stderr).toContain("--aide");
  });

  test("aide show --aide specific.aide uses the specified file", async () => {
    // Create multiple aide files
    await writeFile(
      join(tempDir, "project1.aide"),
      `entities:
  root_one:
    display: page
    props:
      title: Project One
relationships: []
`
    );
    await writeFile(
      join(tempDir, "project2.aide"),
      `entities:
  root_two:
    display: page
    props:
      title: Project Two
relationships: []
`
    );

    const { stdout, exitCode } = await runCli(["aide", "show", "--aide", "project2.aide"]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("root_two");
    expect(stdout).not.toContain("root_one");
  });

  test("aide show errors when no .aide file found", async () => {
    // Don't create any aide files

    const { stderr, exitCode } = await runCli(["aide", "show"]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("No .aide file found");
    expect(stderr).toContain("bantay aide init");
  });

  test("aide validate auto-discovers single .aide file", async () => {
    // Create a single aide file
    const aidePath = join(tempDir, "discovered.aide");
    await writeFile(
      aidePath,
      `entities:
  root:
    display: page
    props:
      title: Discovered
relationships: []
`
    );

    const { stdout, exitCode } = await runCli(["aide", "validate"]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Aide file is valid");
  });

  test("aide add auto-discovers single .aide file", async () => {
    // Create a single aide file
    const aidePath = join(tempDir, "auto.aide");
    await writeFile(
      aidePath,
      `entities:
  root:
    display: page
  invariants:
    parent: root
    display: checklist
relationships: []
`
    );

    const { stdout, exitCode } = await runCli([
      "aide", "add", "inv_test",
      "--parent", "invariants",
      "--prop", "statement=Test invariant",
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Added entity: inv_test");

    // Verify entity was added to the auto-discovered file
    const content = await readFile(aidePath, "utf-8");
    expect(content).toContain("inv_test");
  });
});
