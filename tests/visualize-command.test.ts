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

describe("bantay visualize", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "bantay-visualize-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  // sc_visualize_output_file: Output is a single self-contained HTML file
  describe("sc_visualize_output_file", () => {
    test("generates a single HTML file", async () => {
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
  cuj_login:
    parent: cujs
    props:
      feature: User logs in
      tier: primary
      area: auth
  sc_enter_email:
    parent: cuj_login
    props:
      name: Enter email
      given: User on login page
      when: User enters email
      then: Email is validated
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const htmlPath = join(testDir, "visualizer.html");
      const htmlExists = await Bun.file(htmlPath).exists();
      expect(htmlExists).toBe(true);

      const html = await readFile(htmlPath, "utf-8");
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<html");
      expect(html).toContain("</html>");
    });

    test("HTML has zero external dependencies", async () => {
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
  cuj_test:
    parent: cujs
    props:
      feature: Test feature
      tier: primary
      area: test
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      expect(html).not.toMatch(/<link[^>]+href=["']https?:\/\//);
      expect(html).not.toMatch(/<script[^>]+src=["']https?:\/\//);
      expect(html).not.toMatch(/@import\s+url\s*\(\s*["']?https?:\/\//);
      expect(html).toContain("<style>");
      expect(html).toMatch(/<script>[\s\S]+<\/script>/);
    });
  });

  // sc_visualize_without_screens: Generate visualizer from aide without screen entities
  describe("sc_visualize_without_screens", () => {
    test("infers screens from scenario given/then states when no screen entities exist", async () => {
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
  cuj_checkout:
    parent: cujs
    props:
      feature: User completes checkout
      tier: primary
      area: checkout
  sc_view_cart:
    parent: cuj_checkout
    props:
      name: View cart
      given: User has items in cart
      when: User clicks cart icon
      then: Cart contents displayed
  sc_enter_payment:
    parent: cuj_checkout
    props:
      name: Enter payment
      given: User viewing cart
      when: User clicks checkout
      then: Payment form displayed
  sc_confirm_order:
    parent: cuj_checkout
    props:
      name: Confirm order
      given: User on payment form
      when: User submits payment
      then: Order confirmation displayed
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");
      expect(html).toContain("Cart");
      expect(html).toContain("Payment");
      expect(html).toContain("Order");
    });
  });

  // sc_visualize_with_screens: Generate visualizer from aide with screen entities
  describe("sc_visualize_with_screens", () => {
    test("renders screen wireframes from screen entities", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
    props:
      title: My Project
  screens:
    display: list
    parent: my_project
    props:
      title: Screens
  screen_login:
    parent: screens
    props:
      name: Login Screen
      description: User authentication screen
  screen_dashboard:
    parent: screens
    props:
      name: Dashboard
      description: Main dashboard view
  cujs:
    display: table
    parent: my_project
    props:
      title: Critical User Journeys
  cuj_auth:
    parent: cujs
    props:
      feature: User authenticates
      tier: primary
      area: auth
  sc_login:
    parent: cuj_auth
    props:
      name: User logs in
      given: User on login screen
      when: User enters credentials
      then: User sees dashboard
      screen: login
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");
      expect(html).toContain("Login");
      expect(html).toContain("Dashboard");
    });
  });

  describe("con_visualize_mode_toggle: Mode bar at top", () => {
    test("has Map and Walkthrough mode toggle bar", async () => {
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
  cuj_test:
    parent: cujs
    props:
      feature: Test
      tier: primary
      area: test
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");
      expect(html).toContain("Map");
      expect(html).toContain("Walkthrough");
      expect(html).toMatch(/Map.*active|active.*Map/s);
    });
  });

  // sc_map_view_screens: View all screens on canvas
  describe("sc_map_view_screens", () => {
    test("renders screens as cards on pannable canvas with transition arrows", async () => {
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
  cuj_flow:
    parent: cujs
    props:
      feature: User flow
      tier: primary
      area: flow
  sc_step1:
    parent: cuj_flow
    props:
      name: Step 1
      given: User on page A
      when: User clicks button
      then: User sees page B
  sc_step2:
    parent: cuj_flow
    props:
      name: Step 2
      given: User on page B
      when: User submits form
      then: User sees confirmation
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");
      expect(html).toContain("screen");
      expect(html).toContain("<svg");
      expect(html).toContain("pan");
    });
  });

  // sc_map_zoom: Zoom in and out
  describe("sc_map_zoom", () => {
    test("has zoom controls", async () => {
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
  cuj_test:
    parent: cujs
    props:
      feature: Test
      tier: primary
      area: test
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");
      expect(html).toContain("zoom");
      expect(html).toContain("toolbar");
    });
  });

  // sc_walk_pick_cuj: Pick a CUJ to walk through
  describe("sc_walk_pick_cuj", () => {
    test("walkthrough mode has CUJ picker", async () => {
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
  cuj_login:
    parent: cujs
    props:
      feature: User logs in
      tier: primary
      area: auth
  cuj_signup:
    parent: cujs
    props:
      feature: User signs up
      tier: secondary
      area: auth
  sc_enter_email:
    parent: cuj_login
    props:
      name: Enter email
      given: User on login page
      when: User enters email
      then: Email validated
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");
      expect(html).toContain("User logs in");
      expect(html).toContain("User signs up");
    });
  });

  // sc_walk_step_forward: Step forward through scenarios
  // sc_walk_step_back: Step backward through scenarios
  describe("sc_walk_step_forward and sc_walk_step_back", () => {
    test("has navigation buttons for stepping through scenarios", async () => {
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
  cuj_test:
    parent: cujs
    props:
      feature: Test flow
      tier: primary
      area: test
  sc_step1:
    parent: cuj_test
    props:
      name: First step
      given: Start state
      when: Action 1
      then: Result 1
  sc_step2:
    parent: cuj_test
    props:
      name: Second step
      given: Result 1
      when: Action 2
      then: Result 2
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");
      expect(html).toContain("Next");
      expect(html).toContain("Back");
    });
  });

  // sc_walk_progress_dots: Progress dots show position in journey
  describe("sc_walk_progress_dots", () => {
    test("has progress dots in walkthrough mode", async () => {
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
  cuj_test:
    parent: cujs
    props:
      feature: Test
      tier: primary
      area: test
  sc_step1:
    parent: cuj_test
    props:
      name: Step 1
      given: A
      when: B
      then: C
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");
      expect(html).toContain("progress");
      expect(html).toContain("dot");
    });
  });

  // sc_walk_invariants_shown: Invariants displayed for each scenario
  describe("sc_walk_invariants_shown", () => {
    test("shows linked invariants in walkthrough detail panel", async () => {
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
    props:
      title: Invariants
  inv_auth_required:
    parent: invariants
    props:
      statement: All routes require authentication
      category: security
  cuj_auth:
    parent: cujs
    props:
      feature: User authenticates
      tier: primary
      area: auth
  sc_login:
    parent: cuj_auth
    props:
      name: User logs in
      given: User on login page
      when: User submits credentials
      then: User is authenticated
relationships:
  - from: sc_login
    to: inv_auth_required
    type: protected_by
    cardinality: many_to_many
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");
      expect(html).toContain("inv_auth_required");
      expect(html).toContain("Protected");
    });
  });

  describe("inv_visualize_aide_agnostic: Works with any valid aide", () => {
    test("renders bantay's own aide file", async () => {
      const bantayAide = await readFile(join(PROJECT_ROOT, "bantay.aide"), "utf-8");
      await writeFile(join(testDir, "bantay.aide"), bantayAide);

      await runBantay(["visualize"], testDir);

      const htmlExists = await Bun.file(join(testDir, "visualizer.html")).exists();
      expect(htmlExists).toBe(true);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");
      expect(html).toContain("Developer initializes");
    });

    test("does not hardcode product-specific content", async () => {
      const aideContent = `
entities:
  totally_different_project:
    display: page
    props:
      title: Totally Different Project
  cujs:
    display: table
    parent: totally_different_project
    props:
      title: Critical User Journeys
  cuj_unique:
    parent: cujs
    props:
      feature: Unique feature only in this aide
      tier: primary
      area: unique
  sc_unique:
    parent: cuj_unique
    props:
      name: Unique scenario
      given: Unique given
      when: Unique when
      then: Unique then
relationships: []
`;
      await writeFile(join(testDir, "unique.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");
      expect(html).toContain("Unique feature only in this aide");
      expect(html).toContain("Unique scenario");
      expect(html).not.toContain("spout");
      expect(html).not.toContain("flow mode");
    });
  });

  // sc_map_drag_screen: Drag screen to reposition
  describe("sc_map_drag_screen", () => {
    test("screens are draggable with snap-to-grid", async () => {
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
  cuj_test:
    parent: cujs
    props:
      feature: Test
      tier: primary
      area: test
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);
      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");
      expect(html).toContain("dragging");
      expect(html).toContain("snap");
    });
  });

  // sc_map_pan: Pan the canvas
  describe("sc_map_pan", () => {
    test("canvas supports panning", async () => {
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
  cuj_test:
    parent: cujs
    props:
      feature: Test
      tier: primary
      area: test
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);
      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");
      expect(html).toContain("isPanning");
      expect(html).toContain("panX");
      expect(html).toContain("panY");
    });
  });

  // sc_map_arrows_component_level: Arrows connect to specific components
  describe("sc_map_arrows_component_level", () => {
    test("arrow drawing connects screens", async () => {
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
  cuj_test:
    parent: cujs
    props:
      feature: Test
      tier: primary
      area: test
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);
      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");
      expect(html).toContain("drawEdge");
      expect(html).toContain("getAnchor");
    });
  });

  // sc_map_self_loops: Same-screen actions shown as self-loops
  describe("sc_map_self_loops", () => {
    test("supports self-loop arrow rendering", async () => {
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
  cuj_test:
    parent: cujs
    props:
      feature: Test
      tier: primary
      area: test
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);
      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");
      expect(html).toContain("drawArrows");
      expect(html).toContain("transitions");
    });
  });

  // sc_map_external_labels: Screen IDs and invariants shown as external labels
  describe("sc_map_external_labels", () => {
    test("screens have external ID labels", async () => {
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
  cuj_test:
    parent: cujs
    props:
      feature: Test
      tier: primary
      area: test
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);
      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");
      expect(html).toContain("s-tag");
    });
  });

  // sc_walk_screen_transition: Screen transitions animate on navigation change
  describe("sc_walk_screen_transition", () => {
    test("walkthrough has screen transition animation", async () => {
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
  cuj_test:
    parent: cujs
    props:
      feature: Test
      tier: primary
      area: test
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);
      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");
      expect(html).toContain("transition");
      expect(html).toContain("walk-screen");
    });
  });

  describe("CLI behavior", () => {
    test("exits with error if no aide file found", async () => {
      const { exitCode, stderr } = await runBantay(["visualize"], testDir);

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("aide");
    });

    test("accepts --aide flag to specify aide file", async () => {
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
  cuj_test:
    parent: cujs
    props:
      feature: Test
      tier: primary
      area: test
relationships: []
`;
      await mkdir(join(testDir, "subdir"), { recursive: true });
      await writeFile(join(testDir, "subdir", "custom.aide"), aideContent);

      await runBantay(["visualize", "--aide", "subdir/custom.aide"], testDir);

      const htmlExists = await Bun.file(join(testDir, "visualizer.html")).exists();
      expect(htmlExists).toBe(true);
    });

    test("accepts --output flag to specify output path", async () => {
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
  cuj_test:
    parent: cujs
    props:
      feature: Test
      tier: primary
      area: test
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);
      await mkdir(join(testDir, "docs"), { recursive: true });

      await runBantay(["visualize", "--output", "docs/map.html"], testDir);

      const htmlExists = await Bun.file(join(testDir, "docs", "map.html")).exists();
      expect(htmlExists).toBe(true);
    });
  });

  describe("Component wireframes", () => {
    test("MAP VIEW renders component boxes from screen's components prop", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
    props:
      title: My Project
  screens:
    display: list
    parent: my_project
  screen_flow:
    parent: screens
    props:
      name: Flow Screen
      components: comp_timer,comp_editor
      nav: standard
  components:
    display: list
    parent: my_project
  comp_timer:
    parent: components
    props:
      name: Timer
      description: Countdown timer with pause button
  comp_editor:
    parent: components
    props:
      name: Editor
      description: Writing surface with serif font
  cujs:
    display: table
    parent: my_project
  cuj_flow:
    parent: cujs
    props:
      feature: Flow writing
      tier: primary
      area: writing
  sc_start_flow:
    parent: cuj_flow
    props:
      name: Start flow session
      given: User on flow screen
      when: User starts timer
      then: Timer begins countdown
      screen: flow
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Should have comp-box CSS
      expect(html).toContain(".comp-box");
      expect(html).toContain(".comp-label");
      expect(html).toContain(".comp-desc");

      // Should render component boxes in MAP view
      expect(html).toContain("comp_timer");
      expect(html).toContain("comp_editor");
      expect(html).toContain("Countdown timer");
      expect(html).toContain("Writing surface");
    });

    test("MAP VIEW renders nav bar when nav prop is standard", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    display: list
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
      components: comp_feed
      nav: standard
  components:
    display: list
    parent: my_project
  comp_feed:
    parent: components
    props:
      name: Feed
      description: Content feed
  cujs:
    display: table
    parent: my_project
  cuj_browse:
    parent: cujs
    props:
      feature: Browse content
  sc_view:
    parent: cuj_browse
    props:
      name: View feed
      given: User on home
      when: User scrolls
      then: Feed loads
      screen: home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Should render nav bar
      expect(html).toContain("nav-bar");
    });

    test("MAP VIEW renders immersive footer when nav is none", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    display: list
    parent: my_project
  screen_immersive:
    parent: screens
    props:
      name: Immersive
      components: comp_content
      nav: none
  components:
    display: list
    parent: my_project
  comp_content:
    parent: components
    props:
      name: Content
      description: Full screen content
  cujs:
    display: table
    parent: my_project
  cuj_view:
    parent: cujs
    props:
      feature: View content
  sc_view:
    parent: cuj_view
    props:
      name: View immersive
      given: User viewing
      when: User focuses
      then: Immersive mode
      screen: immersive
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Should show immersive indicator
      expect(html).toContain("immersive");
    });

    test("WALKTHROUGH VIEW renders component boxes", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    display: list
    parent: my_project
  screen_editor:
    parent: screens
    props:
      name: Editor Screen
      components: comp_toolbar,comp_canvas
      nav: standard
  components:
    display: list
    parent: my_project
  comp_toolbar:
    parent: components
    props:
      name: Toolbar
      description: Drawing tools
  comp_canvas:
    parent: components
    props:
      name: Canvas
      description: Drawing surface
  cujs:
    display: table
    parent: my_project
  cuj_draw:
    parent: cujs
    props:
      feature: Draw content
  sc_draw:
    parent: cuj_draw
    props:
      name: Draw on canvas
      given: User on editor
      when: User draws
      then: Content appears
      screen: editor
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // The walkthrough JS should include component rendering
      // Check that screen data includes components
      expect(html).toContain("comp_toolbar");
      expect(html).toContain("comp_canvas");
    });
  });

  // sc_visualize_injects_tokens: Visualizer injects CSS variables into generated HTML
  describe("sc_visualize_injects_tokens", () => {
    test("embeds CSS variables from design token entities in style block", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
    props:
      title: My Project
  design_system:
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
  cujs:
    display: table
    parent: my_project
    props:
      title: Critical User Journeys
  cuj_test:
    parent: cujs
    props:
      feature: Test
      tier: primary
      area: test
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Should have CSS variables embedded in style block
      expect(html).toContain("--ds-colors-text: #292929");
      expect(html).toContain("--ds-colors-accent: #1A8917");
      expect(html).toContain("--ds-spacing-base: 8px");
    });

    test("wireframes can reference token CSS variables", async () => {
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
  cujs:
    display: table
    parent: my_project
  cuj_test:
    parent: cujs
    props:
      feature: Test
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Should be able to use var(--ds-colors-primary) in CSS
      expect(html).toContain("--ds-colors-primary: #2563eb");
    });
  });

  // sc_visualize_renders_wireframes: Visualizer renders wireframe HTML files inside component boxes
  describe("sc_visualize_renders_wireframes", () => {
    test("injects wireframe HTML from wireframes/<comp_id>.html into component box", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    display: list
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
      components: comp_header,comp_content
  components:
    display: list
    parent: my_project
  comp_header:
    parent: components
    props:
      name: Header
      description: Top navigation
  comp_content:
    parent: components
    props:
      name: Content
      description: Main content area
  cujs:
    display: table
    parent: my_project
  cuj_browse:
    parent: cujs
    props:
      feature: Browse content
  sc_view:
    parent: cuj_browse
    props:
      name: View home
      given: User opens app
      when: Home loads
      then: Home displayed
      screen: home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      // Create wireframes directory with HTML files
      await mkdir(join(testDir, "wireframes"), { recursive: true });
      await writeFile(
        join(testDir, "wireframes", "comp_header.html"),
        `<div class="header-wireframe"><span>Logo</span><nav>Menu</nav></div>`
      );

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Should inject the wireframe HTML for comp_header
      expect(html).toContain("header-wireframe");
      expect(html).toContain("<span>Logo</span>");
      expect(html).toContain("<nav>Menu</nav>");
    });

    test("wireframe HTML replaces description text in component box", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    display: list
    parent: my_project
  screen_editor:
    parent: screens
    props:
      name: Editor
      components: comp_toolbar
  components:
    display: list
    parent: my_project
  comp_toolbar:
    parent: components
    props:
      name: Toolbar
      description: This description should be replaced
  cujs:
    display: table
    parent: my_project
  cuj_edit:
    parent: cujs
    props:
      feature: Edit
  sc_edit:
    parent: cuj_edit
    props:
      name: Edit content
      given: User on editor
      when: User edits
      then: Content saved
      screen: editor
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await mkdir(join(testDir, "wireframes"), { recursive: true });
      await writeFile(
        join(testDir, "wireframes", "comp_toolbar.html"),
        `<div class="toolbar-buttons"><button>Bold</button><button>Italic</button></div>`
      );

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Should have wireframe content
      expect(html).toContain("toolbar-buttons");
      expect(html).toContain("<button>Bold</button>");
    });
  });

  // sc_visualize_fallback: Visualizer falls back to description when no wireframe file exists
  describe("sc_visualize_fallback", () => {
    test("shows component name and description when no wireframe file exists", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    display: list
    parent: my_project
  screen_settings:
    parent: screens
    props:
      name: Settings
      components: comp_form
  components:
    display: list
    parent: my_project
  comp_form:
    parent: components
    props:
      name: Settings Form
      description: User preference settings form
  cujs:
    display: table
    parent: my_project
  cuj_settings:
    parent: cujs
    props:
      feature: Settings
  sc_view_settings:
    parent: cuj_settings
    props:
      name: View settings
      given: User on settings
      when: Settings load
      then: Form displayed
      screen: settings
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      // No wireframes directory created

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Should fall back to showing description
      expect(html).toContain("comp_form");
      expect(html).toContain("User preference settings form");
    });

    test("uses description fallback when wireframes dir exists but file is missing", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    display: list
    parent: my_project
  screen_profile:
    parent: screens
    props:
      name: Profile
      components: comp_avatar,comp_bio
  components:
    display: list
    parent: my_project
  comp_avatar:
    parent: components
    props:
      name: Avatar
      description: User profile picture
  comp_bio:
    parent: components
    props:
      name: Bio
      description: User biography text
  cujs:
    display: table
    parent: my_project
  cuj_profile:
    parent: cujs
    props:
      feature: Profile
  sc_view_profile:
    parent: cuj_profile
    props:
      name: View profile
      given: User on profile
      when: Profile loads
      then: Profile displayed
      screen: profile
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      // Create wireframes directory with only one of the components
      await mkdir(join(testDir, "wireframes"), { recursive: true });
      await writeFile(
        join(testDir, "wireframes", "comp_avatar.html"),
        `<img src="avatar.png" alt="User Avatar" />`
      );
      // Note: comp_bio.html is NOT created

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // comp_avatar should have wireframe
      expect(html).toContain('alt="User Avatar"');

      // comp_bio should fall back to description
      expect(html).toContain("comp_bio");
      expect(html).toContain("User biography text");
    });
  });
});
