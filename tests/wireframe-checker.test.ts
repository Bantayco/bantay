import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";

const BUN_PATH = process.execPath;
const PROJECT_ROOT = join(import.meta.dir, "..");
const TEST_DIR = "/tmp/bantay-wireframe-checker-test";

async function runBantay(
  args: string[],
  cwd: string = TEST_DIR
): Promise<{
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

// Structural checker tests - wireframe check runs automatically when aide has comp_* entities
describe("Wireframe Structural Checker", () => {
  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("runs wireframe check even without design_integrity invariant in invariants.md", async () => {
    // Aide has component entities
    const aideContent = `
entities:
  my_project:
    display: page
  components:
    parent: my_project
  comp_header:
    parent: components
    props:
      name: Header
relationships: []
`;
    await writeFile(join(TEST_DIR, "test.aide"), aideContent);

    // invariants.md has NO design_integrity invariant
    await writeFile(
      join(TEST_DIR, "invariants.md"),
      `# Project Invariants

## Auth

- [INV-001] auth | All routes must check auth
`
    );

    await writeFile(join(TEST_DIR, "bantay.config.yml"), `sourceDirectories:\n  - src\n`);

    // No wireframes directory - should fail the structural check

    const { stderr, exitCode } = await runBantay(["check"]);

    // Should report the missing wireframe even though there's no design_integrity invariant
    expect(stderr).toContain("wireframe");
    expect(stderr).toContain("comp_header");
    expect(exitCode).not.toBe(0);
  });

  test("PASS structural check when all wireframes exist without invariant", async () => {
    const aideContent = `
entities:
  my_project:
    display: page
  components:
    parent: my_project
  comp_nav:
    parent: components
    props:
      name: Navigation
relationships: []
`;
    await writeFile(join(TEST_DIR, "test.aide"), aideContent);

    // No design_integrity invariant
    await writeFile(
      join(TEST_DIR, "invariants.md"),
      `# Project Invariants

## Security

- [INV-001] security | No hardcoded secrets
`
    );

    await writeFile(join(TEST_DIR, "bantay.config.yml"), `sourceDirectories:\n  - src\n`);

    // Create the wireframe file
    await mkdir(join(TEST_DIR, "wireframes"), { recursive: true });
    await writeFile(join(TEST_DIR, "wireframes/comp_nav.html"), `<nav>Nav wireframe</nav>`);

    const { stderr, exitCode } = await runBantay(["check"]);

    // Should pass - wireframe exists
    expect(stderr).toContain("Wireframe");
    expect(stderr).toContain("PASS");
    expect(exitCode).toBe(0);
  });

  test("structural check runs even with empty invariants.md", async () => {
    const aideContent = `
entities:
  my_project:
    display: page
  components:
    parent: my_project
  comp_sidebar:
    parent: components
    props:
      name: Sidebar
relationships: []
`;
    await writeFile(join(TEST_DIR, "test.aide"), aideContent);

    // Empty invariants.md (just header)
    await writeFile(join(TEST_DIR, "invariants.md"), `# Project Invariants\n`);

    await writeFile(join(TEST_DIR, "bantay.config.yml"), `sourceDirectories:\n  - src\n`);

    // No wireframes

    const { stderr, exitCode } = await runBantay(["check"]);

    // Should still check wireframes
    expect(stderr).toContain("wireframe");
    expect(stderr).toContain("comp_sidebar");
    expect(exitCode).not.toBe(0);
  });

  test("no structural check when aide has no comp_* entities", async () => {
    const aideContent = `
entities:
  my_project:
    display: page
  cujs:
    parent: my_project
  cuj_login:
    parent: cujs
    props:
      feature: Login
relationships: []
`;
    await writeFile(join(TEST_DIR, "test.aide"), aideContent);

    await writeFile(join(TEST_DIR, "invariants.md"), `# Project Invariants\n`);
    await writeFile(join(TEST_DIR, "bantay.config.yml"), `sourceDirectories:\n  - src\n`);

    const { stderr, exitCode } = await runBantay(["check"]);

    // No wireframe check should run since no comp_* entities
    expect(stderr).not.toContain("wireframe");
    expect(exitCode).toBe(0);
  });
});

// sc_check_wireframe_exists: Checker verifies wireframe file exists for each component
describe("Wireframe Exists Checker", () => {
  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("PASS when all component entities have wireframe files", async () => {
    // Create aide file with component entities
    const aideContent = `
entities:
  my_project:
    display: page
  components:
    parent: my_project
  comp_header:
    parent: components
    props:
      name: Header
      description: Site header
  comp_footer:
    parent: components
    props:
      name: Footer
      description: Site footer
relationships: []
`;
    await writeFile(join(TEST_DIR, "test.aide"), aideContent);

    // Create invariants.md with the wireframe invariant
    await writeFile(
      join(TEST_DIR, "invariants.md"),
      `# Project Invariants

## Design Integrity

- [INV-100] design_integrity | Every component entity must have a wireframe file
`
    );

    // Create bantay.config.yml
    await writeFile(join(TEST_DIR, "bantay.config.yml"), `sourceDirectories:\n  - src\n`);

    // Create wireframe files for all components
    await mkdir(join(TEST_DIR, "wireframes"), { recursive: true });
    await writeFile(join(TEST_DIR, "wireframes/comp_header.html"), `<div>Header wireframe</div>`);
    await writeFile(join(TEST_DIR, "wireframes/comp_footer.html"), `<div>Footer wireframe</div>`);

    const { stderr, exitCode } = await runBantay(["check"]);

    expect(stderr).toContain("PASS");
    expect(exitCode).toBe(0);
  });

  test("FAIL when component entity is missing wireframe file", async () => {
    const aideContent = `
entities:
  my_project:
    display: page
  components:
    parent: my_project
  comp_header:
    parent: components
    props:
      name: Header
      description: Site header
  comp_sidebar:
    parent: components
    props:
      name: Sidebar
      description: Navigation sidebar
relationships: []
`;
    await writeFile(join(TEST_DIR, "test.aide"), aideContent);

    await writeFile(
      join(TEST_DIR, "invariants.md"),
      `# Project Invariants

## Design Integrity

- [INV-100] design_integrity | Every component entity must have a wireframe file
`
    );

    await writeFile(join(TEST_DIR, "bantay.config.yml"), `sourceDirectories:\n  - src\n`);

    // Only create one wireframe file
    await mkdir(join(TEST_DIR, "wireframes"), { recursive: true });
    await writeFile(join(TEST_DIR, "wireframes/comp_header.html"), `<div>Header wireframe</div>`);
    // comp_sidebar.html is missing!

    const { stderr, exitCode } = await runBantay(["check"]);

    expect(stderr).toContain("FAIL");
    expect(stderr).toContain("comp_sidebar");
    expect(stderr).toContain("wireframes/comp_sidebar.html");
    expect(exitCode).not.toBe(0);
  });

  test("FAIL when wireframes directory does not exist", async () => {
    const aideContent = `
entities:
  my_project:
    display: page
  components:
    parent: my_project
  comp_modal:
    parent: components
    props:
      name: Modal
      description: Popup modal
relationships: []
`;
    await writeFile(join(TEST_DIR, "test.aide"), aideContent);

    await writeFile(
      join(TEST_DIR, "invariants.md"),
      `# Project Invariants

## Design Integrity

- [INV-100] design_integrity | Every component entity must have a wireframe file
`
    );

    await writeFile(join(TEST_DIR, "bantay.config.yml"), `sourceDirectories:\n  - src\n`);

    // No wireframes directory at all

    const { stderr, exitCode } = await runBantay(["check"]);

    expect(stderr).toContain("FAIL");
    expect(stderr).toContain("comp_modal");
    expect(exitCode).not.toBe(0);
  });

  test("PASS when no component entities exist in aide", async () => {
    const aideContent = `
entities:
  my_project:
    display: page
  cujs:
    parent: my_project
  cuj_login:
    parent: cujs
    props:
      feature: User login
relationships: []
`;
    await writeFile(join(TEST_DIR, "test.aide"), aideContent);

    await writeFile(
      join(TEST_DIR, "invariants.md"),
      `# Project Invariants

## Design Integrity

- [INV-100] design_integrity | Every component entity must have a wireframe file
`
    );

    await writeFile(join(TEST_DIR, "bantay.config.yml"), `sourceDirectories:\n  - src\n`);

    const { stderr, exitCode } = await runBantay(["check"]);

    expect(stderr).toContain("PASS");
    expect(exitCode).toBe(0);
  });

  test("reports all missing wireframes in one check", async () => {
    const aideContent = `
entities:
  my_project:
    display: page
  components:
    parent: my_project
  comp_nav:
    parent: components
    props:
      name: Navigation
  comp_search:
    parent: components
    props:
      name: Search
  comp_cart:
    parent: components
    props:
      name: Cart
relationships: []
`;
    await writeFile(join(TEST_DIR, "test.aide"), aideContent);

    await writeFile(
      join(TEST_DIR, "invariants.md"),
      `# Project Invariants

## Design Integrity

- [INV-100] design_integrity | Every component entity must have a wireframe file
`
    );

    await writeFile(join(TEST_DIR, "bantay.config.yml"), `sourceDirectories:\n  - src\n`);

    // No wireframes at all
    await mkdir(join(TEST_DIR, "wireframes"), { recursive: true });

    const { stderr, exitCode } = await runBantay(["check"]);

    expect(stderr).toContain("FAIL");
    expect(stderr).toContain("comp_nav");
    expect(stderr).toContain("comp_search");
    expect(stderr).toContain("comp_cart");
    expect(exitCode).not.toBe(0);
  });
});
