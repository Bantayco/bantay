import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const BUN_PATH = process.execPath;
const PROJECT_ROOT = join(import.meta.dir, "..");

async function runBantay(args: string[], cwd: string): Promise<{
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

describe("bantay export css", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "bantay-export-css-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  // sc_export_css_from_tokens: Generate CSS variables from design token entities
  describe("sc_export_css_from_tokens", () => {
    test("generates CSS file with :root variables from design_system entities", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
    props:
      title: My Project
  design_system:
    display: list
    parent: my_project
    props:
      title: Design System
  ds_colors:
    parent: design_system
    props:
      type: colors
  ds_colors_text:
    parent: ds_colors
    props:
      value: "#292929"
  ds_colors_accent:
    parent: ds_colors
    props:
      value: "#1A8917"
  ds_spacing:
    parent: design_system
    props:
      type: spacing
  ds_spacing_base:
    parent: ds_spacing
    props:
      value: 8px
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      const { exitCode } = await runBantay(["export", "css"], testDir);

      expect(exitCode).toBe(0);

      const cssPath = join(testDir, "bantay-tokens.css");
      const cssExists = await Bun.file(cssPath).exists();
      expect(cssExists).toBe(true);

      const css = await readFile(cssPath, "utf-8");
      expect(css).toContain(":root {");
      expect(css).toContain("--ds-colors-text: #292929;");
      expect(css).toContain("--ds-colors-accent: #1A8917;");
      expect(css).toContain("--ds-spacing-base: 8px;");
    });

    test("handles color tokens with hex values", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  design_system:
    parent: my_project
  ds_colors:
    parent: design_system
    props:
      type: colors
  ds_colors_primary:
    parent: ds_colors
    props:
      value: "#2563eb"
  ds_colors_secondary:
    parent: ds_colors
    props:
      value: "rgb(124, 58, 237)"
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["export", "css"], testDir);

      const css = await readFile(join(testDir, "bantay-tokens.css"), "utf-8");
      expect(css).toContain("--ds-colors-primary: #2563eb;");
      expect(css).toContain("--ds-colors-secondary: rgb(124, 58, 237);");
    });

    test("handles spacing tokens with various units", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  design_system:
    parent: my_project
  ds_spacing:
    parent: design_system
    props:
      type: spacing
  ds_spacing_xs:
    parent: ds_spacing
    props:
      value: 4px
  ds_spacing_sm:
    parent: ds_spacing
    props:
      value: 0.5rem
  ds_spacing_md:
    parent: ds_spacing
    props:
      value: 1rem
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["export", "css"], testDir);

      const css = await readFile(join(testDir, "bantay-tokens.css"), "utf-8");
      expect(css).toContain("--ds-spacing-xs: 4px;");
      expect(css).toContain("--ds-spacing-sm: 0.5rem;");
      expect(css).toContain("--ds-spacing-md: 1rem;");
    });

    test("handles typography tokens", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  design_system:
    parent: my_project
  ds_typography:
    parent: design_system
    props:
      type: typography
  ds_typography_font_family:
    parent: ds_typography
    props:
      value: "Charter, Georgia, serif"
  ds_typography_font_size_base:
    parent: ds_typography
    props:
      value: 16px
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["export", "css"], testDir);

      const css = await readFile(join(testDir, "bantay-tokens.css"), "utf-8");
      expect(css).toContain("--ds-typography-font-family: Charter, Georgia, serif;");
      expect(css).toContain("--ds-typography-font-size-base: 16px;");
    });

    test("entity ID becomes variable namespace with underscores replaced by dashes", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  design_system:
    parent: my_project
  ds_colors:
    parent: design_system
    props:
      type: colors
  ds_colors_background_primary:
    parent: ds_colors
    props:
      value: "#FAFAFA"
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["export", "css"], testDir);

      const css = await readFile(join(testDir, "bantay-tokens.css"), "utf-8");
      expect(css).toContain("--ds-colors-background-primary: #FAFAFA;");
    });
  });

  // sc_export_css_idempotent: CSS export is idempotent
  describe("sc_export_css_idempotent", () => {
    test("running export css twice produces identical output when tokens unchanged", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  design_system:
    parent: my_project
  ds_colors:
    parent: design_system
    props:
      type: colors
  ds_colors_text:
    parent: ds_colors
    props:
      value: "#292929"
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      // First export
      await runBantay(["export", "css"], testDir);
      const css1 = await readFile(join(testDir, "bantay-tokens.css"), "utf-8");

      // Second export
      await runBantay(["export", "css"], testDir);
      const css2 = await readFile(join(testDir, "bantay-tokens.css"), "utf-8");

      expect(css1).toBe(css2);
    });
  });

  describe("export all includes css", () => {
    test("bantay export all includes css target", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
    props:
      title: My Project
  cujs:
    display: table
    parent: my_project
    props:
      title: Critical User Journeys
  invariants:
    display: checklist
    parent: my_project
  constraints:
    display: list
    parent: my_project
  foundations:
    display: list
    parent: my_project
  design_system:
    parent: my_project
  ds_colors:
    parent: design_system
    props:
      type: colors
  ds_colors_text:
    parent: ds_colors
    props:
      value: "#333333"
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      const { stdout } = await runBantay(["export", "all"], testDir);

      expect(stdout).toContain("css:");
      expect(stdout).toContain("bantay-tokens.css");

      const cssExists = await Bun.file(join(testDir, "bantay-tokens.css")).exists();
      expect(cssExists).toBe(true);
    });
  });

  describe("no design tokens", () => {
    test("generates empty or no css file when no design tokens exist", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
    props:
      title: My Project
  cujs:
    display: table
    parent: my_project
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      const { exitCode } = await runBantay(["export", "css"], testDir);

      // Should still succeed, just with empty/minimal output
      expect(exitCode).toBe(0);
    });
  });
});
