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
    test("embeds CSS variables from type=token entities in style block", async () => {
      // This tests the pattern where entities have props.type="token"
      // and each other prop becomes a CSS variable
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
      type: token
      text: "#292929"
      accent: "#1A8917"
      background: "#FAFAFA"
  ds_typography:
    parent: design_system
    props:
      type: token
      serif: "Charter, Georgia, serif"
      sans: "-apple-system, BlinkMacSystemFont, sans-serif"
  ds_spacing:
    parent: design_system
    props:
      type: token
      base: 8px
      sm: 4px
      lg: 16px
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

      // Should have CSS variables from ds_colors entity
      expect(html).toContain("--ds-colors-text: #292929");
      expect(html).toContain("--ds-colors-accent: #1A8917");
      expect(html).toContain("--ds-colors-background: #FAFAFA");

      // Should have CSS variables from ds_typography entity
      expect(html).toContain("--ds-typography-serif: Charter, Georgia, serif");
      expect(html).toContain("--ds-typography-sans: -apple-system, BlinkMacSystemFont, sans-serif");

      // Should have CSS variables from ds_spacing entity
      expect(html).toContain("--ds-spacing-base: 8px");
      expect(html).toContain("--ds-spacing-sm: 4px");
      expect(html).toContain("--ds-spacing-lg: 16px");
    });

    test("embeds CSS variables from design token entities with value prop", async () => {
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

    test("embeds dark mode CSS variables from type=token-dark entities", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  design_system:
    parent: my_project
  ds_colors:
    parent: design_system
    props:
      type: token
      text: "#292929"
      background: "#FAFAFA"
  ds_colors_dark:
    parent: design_system
    props:
      type: token-dark
      text: "#e8e6e1"
      background: "#1a1a1a"
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

      // Should have light mode variables in :root
      expect(html).toContain("--ds-colors-text: #292929");
      expect(html).toContain("--ds-colors-background: #FAFAFA");

      // Should have dark mode variables in @media block
      expect(html).toContain("@media(prefers-color-scheme:dark)");
      expect(html).toContain("--ds-colors-text: #e8e6e1");
      expect(html).toContain("--ds-colors-background: #1a1a1a");
    });

    test("dark mode entity ID suffix stripped for variable namespace", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  design_system:
    parent: my_project
  ds_spacing_dark:
    parent: design_system
    props:
      type: token-dark
      base: 8px
      lg: 16px
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

      // ds_spacing_dark should generate --ds-spacing-* variables (not --ds-spacing-dark-*)
      expect(html).toContain("--ds-spacing-base: 8px");
      expect(html).toContain("--ds-spacing-lg: 16px");
      // Should be inside dark mode block
      expect(html).toMatch(/@media\(prefers-color-scheme:dark\)[^}]*:root[^}]*--ds-spacing-base/);
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

  describe("walkthrough mode renders wireframe screens", () => {
    test("walkthrough has screenHtmlMap with pre-rendered screen HTML", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
      components: comp_header,comp_content
  components:
    parent: my_project
  comp_header:
    parent: components
    props:
      name: Header
      description: Site header
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
  sc_view_home:
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

      // Create wireframes
      await mkdir(join(testDir, "wireframes"), { recursive: true });
      await writeFile(
        join(testDir, "wireframes", "comp_header.html"),
        `<div class="header-wireframe">Header Content</div>`
      );
      await writeFile(
        join(testDir, "wireframes", "comp_content.html"),
        `<div class="content-wireframe">Main Content</div>`
      );

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Walkthrough should have a screenHtmlMap object with pre-rendered HTML
      expect(html).toContain("const screenHtmlMap");
      // The pre-rendered HTML should include wireframe content
      expect(html).toContain("header-wireframe");
      expect(html).toContain("content-wireframe");
    });

    test("renderStep uses screenHtmlMap to inject pre-rendered HTML", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_editor:
    parent: screens
    props:
      name: Editor
      components: comp_toolbar
  components:
    parent: my_project
  comp_toolbar:
    parent: components
    props:
      name: Toolbar
      description: Editor toolbar
  cujs:
    display: table
    parent: my_project
  cuj_edit:
    parent: cujs
    props:
      feature: Edit content
  sc_open_editor:
    parent: cuj_edit
    props:
      name: Open editor
      given: User on home
      when: User clicks edit
      then: Editor opens
      screen: editor
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // renderStep should use getScreenHtml which caches renderScreenForStep for variant support
      expect(html).toContain("getScreenHtml(screenId,sc)");
    });

    test("screenHtmlMap includes same content as map view screens", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_profile:
    parent: screens
    props:
      name: Profile
      components: comp_avatar
  components:
    parent: my_project
  comp_avatar:
    parent: components
    props:
      name: Avatar
      description: User avatar
  cujs:
    display: table
    parent: my_project
  cuj_profile:
    parent: cujs
    props:
      feature: View profile
  sc_view_profile:
    parent: cuj_profile
    props:
      name: View profile
      given: User logged in
      when: User clicks profile
      then: Profile shown
      screen: profile
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await mkdir(join(testDir, "wireframes"), { recursive: true });
      await writeFile(
        join(testDir, "wireframes", "comp_avatar.html"),
        `<img src="avatar.png" class="avatar-img" />`
      );

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // The screenHtmlMap should contain the same content as map view
      expect(html).toContain("avatar-img");
      // Map view should have comp_avatar
      expect(html).toContain("comp_avatar");
      // screenHtmlMap should be keyed by screen_profile
      expect(html).toContain("screen_profile");
    });

    test("renderStep handles full screen ID in scenario screen prop", async () => {
      // Bug: if scenario's screen prop is "screen_flow_mode" (full ID),
      // the code was prepending "screen_" making "screen_screen_flow_mode"
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_flow_mode:
    parent: screens
    props:
      name: Flow Mode
      components: comp_editor
  components:
    parent: my_project
  comp_editor:
    parent: components
    props:
      name: Editor
      description: Flow editor
  cujs:
    display: table
    parent: my_project
  cuj_write:
    parent: cujs
    props:
      feature: Write content
  sc_enter_flow:
    parent: cuj_write
    props:
      name: Enter flow mode
      given: User on editor
      when: User clicks flow
      then: Flow mode active
      screen: screen_flow_mode
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await mkdir(join(testDir, "wireframes"), { recursive: true });
      await writeFile(
        join(testDir, "wireframes", "comp_editor.html"),
        `<div class="flow-editor-wireframe">Editor</div>`
      );

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // The renderStep should use sc.screen directly as the key
      // Not prepend "screen_" to get "screen_screen_flow_mode"
      expect(html).toContain("const screenId=sc.screen");
      // screenHtmlMap should have the full screen ID as key
      expect(html).toContain('"screen_flow_mode"');
    });
  });

  describe("component box styling", () => {
    test("component boxes have no dashed border", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
      components: comp_header
  components:
    parent: my_project
  comp_header:
    parent: components
    props:
      name: Header
      description: Site header
  cujs:
    display: table
    parent: my_project
  cuj_test:
    parent: cujs
    props:
      feature: Test
  sc_test:
    parent: cuj_test
    props:
      name: Test scenario
      given: User on home
      when: User views
      then: Header shown
      screen: home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Base .comp-box should NOT have dashed borders (only debug-mode adds them)
      expect(html).toContain(".comp-box {");
      // The base rule should not include border
      expect(html).toMatch(/\.comp-box\s*\{[^}]*padding:\s*4px\s+0[^}]*position:\s*relative/);
      // Debug mode can have dashed borders, that's expected
      expect(html).toContain(".app.debug-mode .comp-box { border:1px dashed");
    });

    test("component label is 8px with low opacity", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
      components: comp_nav
  components:
    parent: my_project
  comp_nav:
    parent: components
    props:
      name: Navigation
  cujs:
    display: table
    parent: my_project
  cuj_test:
    parent: cujs
    props:
      feature: Test
  sc_test:
    parent: cuj_test
    props:
      name: Test
      given: Given
      when: When
      then: Then
      screen: home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Component label should be 8px
      expect(html).toMatch(/\.comp-label\s*\{[^}]*font-size:\s*8px/);
      // Component label should have low opacity
      expect(html).toMatch(/\.comp-label\s*\{[^}]*opacity:\s*0\.[4-6]/);
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

  describe("wireframe variants", () => {
    test("walkthrough renders variant wireframe when scenario has comp_ prop", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_draft:
    parent: screens
    props:
      name: Draft
      components: comp_timer
  components:
    parent: my_project
  comp_timer:
    parent: components
    props:
      name: Timer
      description: Countdown timer
  cujs:
    display: table
    parent: my_project
  cuj_write:
    parent: cujs
    props:
      feature: Write content
  sc_idle_timer:
    parent: cuj_write
    props:
      name: Timer is idle
      given: User on draft
      when: Timer not started
      then: Timer shows idle state
      screen: screen_draft
      comp_timer: idle
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await mkdir(join(testDir, "wireframes"), { recursive: true });
      // Default wireframe
      await writeFile(
        join(testDir, "wireframes", "comp_timer.html"),
        `<div class="timer-default">00:00</div>`
      );
      // Variant wireframe
      await writeFile(
        join(testDir, "wireframes", "comp_timer--idle.html"),
        `<div class="timer-idle-variant">IDLE</div>`
      );

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Should have variantHtmlMap with the idle variant
      expect(html).toContain("variantHtmlMap");
      expect(html).toContain("comp_timer--idle");
      expect(html).toContain("timer-idle-variant");
    });

    test("walkthrough falls back to default wireframe when no variant specified", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_draft:
    parent: screens
    props:
      name: Draft
      components: comp_timer
  components:
    parent: my_project
  comp_timer:
    parent: components
    props:
      name: Timer
      description: Countdown timer
  cujs:
    display: table
    parent: my_project
  cuj_write:
    parent: cujs
    props:
      feature: Write content
  sc_default_timer:
    parent: cuj_write
    props:
      name: Timer default state
      given: User on draft
      when: Timer shows
      then: Timer displays
      screen: screen_draft
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await mkdir(join(testDir, "wireframes"), { recursive: true });
      await writeFile(
        join(testDir, "wireframes", "comp_timer.html"),
        `<div class="timer-default-wf">DEFAULT TIMER</div>`
      );
      await writeFile(
        join(testDir, "wireframes", "comp_timer--idle.html"),
        `<div class="timer-idle-wf">IDLE</div>`
      );

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // walkthrough should render default when no comp_timer prop in scenario
      // screenHtmlMap for screen_draft should have default wireframe
      expect(html).toContain("timer-default-wf");
    });

    test("walkthrough falls back to default when variant file missing", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_draft:
    parent: screens
    props:
      name: Draft
      components: comp_timer
  components:
    parent: my_project
  comp_timer:
    parent: components
    props:
      name: Timer
      description: Countdown timer
  cujs:
    display: table
    parent: my_project
  cuj_write:
    parent: cujs
    props:
      feature: Write content
  sc_nonexistent_variant:
    parent: cuj_write
    props:
      name: Timer with missing variant
      given: User on draft
      when: Timer shows
      then: Timer displays
      screen: screen_draft
      comp_timer: nonexistent
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await mkdir(join(testDir, "wireframes"), { recursive: true });
      // Only default wireframe, no --nonexistent variant
      await writeFile(
        join(testDir, "wireframes", "comp_timer.html"),
        `<div class="timer-fallback-default">FALLBACK</div>`
      );

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Should not error, should have fallback content
      expect(html).toContain("timer-fallback-default");
      // Scenario data should include the comp_timer prop for walkthrough to use
      expect(html).toContain('"comp_timer":"nonexistent"');
    });

    test("map view uses default wireframes only (no variants)", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_draft:
    parent: screens
    props:
      name: Draft
      components: comp_timer
  components:
    parent: my_project
  comp_timer:
    parent: components
    props:
      name: Timer
      description: Countdown timer
  cujs:
    display: table
    parent: my_project
  cuj_write:
    parent: cujs
    props:
      feature: Write content
  sc_with_variant:
    parent: cuj_write
    props:
      name: Timer variant scenario
      given: User on draft
      when: Timer shows
      then: Timer displays
      screen: screen_draft
      comp_timer: idle
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await mkdir(join(testDir, "wireframes"), { recursive: true });
      await writeFile(
        join(testDir, "wireframes", "comp_timer.html"),
        `<div class="map-default-timer">MAP DEFAULT</div>`
      );
      await writeFile(
        join(testDir, "wireframes", "comp_timer--idle.html"),
        `<div class="map-idle-timer">MAP IDLE</div>`
      );

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // screenHtmlMap (used by map view) should have the DEFAULT wireframe
      // The map view HTML rendering uses screenHtmlMap directly
      expect(html).toContain("map-default-timer");
      // screenHtmlMap should NOT contain the variant (variants are in variantHtmlMap)
      const screenHtmlMapMatch = html.match(/const screenHtmlMap\s*=\s*(\{[^}]+\})/);
      if (screenHtmlMapMatch) {
        expect(screenHtmlMapMatch[1]).not.toContain("map-idle-timer");
      }
    });

    test("walkthrough shows variant name in component label", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_draft:
    parent: screens
    props:
      name: Draft
      components: comp_editor
  components:
    parent: my_project
  comp_editor:
    parent: components
    props:
      name: Editor
      description: Text editor
  cujs:
    display: table
    parent: my_project
  cuj_write:
    parent: cujs
    props:
      feature: Write
  sc_empty_editor:
    parent: cuj_write
    props:
      name: Editor empty
      given: User on draft
      when: Editor shows
      then: Editor empty
      screen: screen_draft
      comp_editor: empty
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await mkdir(join(testDir, "wireframes"), { recursive: true });
      await writeFile(
        join(testDir, "wireframes", "comp_editor.html"),
        `<div class="editor-default">Editor</div>`
      );
      await writeFile(
        join(testDir, "wireframes", "comp_editor--empty.html"),
        `<div class="editor-empty-state">Empty</div>`
      );

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // The renderScreenForStep function should show variant in label
      // Check that the generated JS builds labels with variant suffix
      expect(html).toContain("comp.id+'--'+variant");
    });
  });

  describe("walkthrough scenario list", () => {
    test("walkthrough shows all CUJs grouped by area in sidebar", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  cujs:
    display: table
    parent: my_project
  cuj_auth:
    parent: cujs
    props:
      feature: Authentication
      area: auth
  cuj_profile:
    parent: cujs
    props:
      feature: Profile Management
      area: settings
  sc_login:
    parent: cuj_auth
    props:
      name: User logs in
      given: User on login page
      when: User enters credentials
      then: User authenticated
      screen: screen_home
  sc_logout:
    parent: cuj_auth
    props:
      name: User logs out
      given: User logged in
      when: User clicks logout
      then: User logged out
      screen: screen_home
  sc_edit_profile:
    parent: cuj_profile
    props:
      name: Edit profile
      given: User on profile
      when: User edits info
      then: Profile updated
      screen: screen_home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Should have a shared sidebar element with scenario list
      expect(html).toContain('id="sidebar"');
      // Should have CUJ groupings
      expect(html).toContain("cuj-group");
      // Should show area labels
      expect(html).toContain("area-label");
    });

    test("walkthrough highlights current scenario in sidebar", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  cujs:
    display: table
    parent: my_project
  cuj_test:
    parent: cujs
    props:
      feature: Test Feature
      area: test
  sc_step1:
    parent: cuj_test
    props:
      name: Step 1
      given: Start
      when: Action
      then: Result
      screen: screen_home
  sc_step2:
    parent: cuj_test
    props:
      name: Step 2
      given: Step 1 done
      when: Next action
      then: Next result
      screen: screen_home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Should have CSS for current/active scenario highlighting
      expect(html).toContain(".scenario-item.current");
      // Should have logic to update current class
      expect(html).toContain("scenario-item");
    });

    test("clicking scenario in sidebar jumps to that step", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  cujs:
    display: table
    parent: my_project
  cuj_test:
    parent: cujs
    props:
      feature: Test
      area: test
  sc_first:
    parent: cuj_test
    props:
      name: First scenario
      given: Start
      when: Action
      then: Done
      screen: screen_home
  sc_second:
    parent: cuj_test
    props:
      name: Second scenario
      given: First done
      when: Next
      then: Complete
      screen: screen_home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Should have click handler for scenario items that calls selectScenario
      expect(html).toContain("selectScenario");
      // Scenario items should be clickable
      expect(html).toContain("onclick");
    });

    test("sidebar shows scenarios under their parent CUJ", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  cujs:
    display: table
    parent: my_project
  cuj_checkout:
    parent: cujs
    props:
      feature: Checkout Flow
      area: commerce
  sc_add_to_cart:
    parent: cuj_checkout
    props:
      name: Add item to cart
      given: User on product page
      when: User clicks add to cart
      then: Item in cart
      screen: screen_home
  sc_view_cart:
    parent: cuj_checkout
    props:
      name: View cart
      given: Item in cart
      when: User opens cart
      then: Cart displayed
      screen: screen_home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // CUJ name should appear in sidebar
      expect(html).toContain("Checkout Flow");
      // Scenario names should appear
      expect(html).toContain("Add item to cart");
      expect(html).toContain("View cart");
    });
  });

  describe("map view sidebar", () => {
    test("sc_map_sidebar_list: map view shows CUJ and scenario list in left sidebar", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  cujs:
    display: table
    parent: my_project
  cuj_auth:
    parent: cujs
    props:
      feature: Authentication
      area: auth
  cuj_profile:
    parent: cujs
    props:
      feature: Profile Management
      area: settings
  sc_login:
    parent: cuj_auth
    props:
      name: User logs in
      given: User on login
      when: User enters creds
      then: User authenticated
      screen: screen_home
  sc_edit_profile:
    parent: cuj_profile
    props:
      name: Edit profile
      given: User on profile
      when: User edits
      then: Profile updated
      screen: screen_home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Should have a shared sidebar element
      expect(html).toContain('id="sidebar"');
      // Should have area labels in sidebar
      expect(html).toContain("auth");
      expect(html).toContain("settings");
      // Should have CUJ names
      expect(html).toContain("Authentication");
      expect(html).toContain("Profile Management");
    });

    test("sc_map_click_scenario_highlights: clicking scenario highlights screen and arrow", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  screen_profile:
    parent: screens
    props:
      name: Profile
  cujs:
    display: table
    parent: my_project
  cuj_nav:
    parent: cujs
    props:
      feature: Navigation
      area: nav
  sc_go_to_profile:
    parent: cuj_nav
    props:
      name: Go to profile
      given: User on home
      when: User clicks profile
      then: Profile displayed
      screen: screen_home
  sc_view_profile:
    parent: cuj_nav
    props:
      name: View profile details
      given: User on profile
      when: Profile loads
      then: Details shown
      screen: screen_profile
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Should have select/highlight function for scenarios
      expect(html).toContain("selectScenario");
      // Should have CSS for highlighted screen
      expect(html).toContain(".screen.highlighted");
      // Should have CSS for highlighted arrow
      expect(html).toContain(".arrow-highlighted");
    });
  });

  // sc_map_linear_layout: Storyboard shows unique screen states, not one card per scenario
  describe("sc_map_linear_layout", () => {
    test("storyboard deduplicates scenarios with same screen state to one card", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_editor:
    parent: screens
    props:
      name: Editor
      components: comp_timer
  components:
    parent: my_project
  comp_timer:
    parent: components
    props:
      name: Timer
      description: Countdown timer
  cujs:
    display: table
    parent: my_project
  cuj_flow:
    parent: cujs
    props:
      feature: Timer Flow
      area: timer
  sc_idle:
    parent: cuj_flow
    props:
      name: Timer idle
      given: User opens editor
      when: Editor loads
      then: Timer shows idle
      screen: screen_editor
      comp_timer: idle
  sc_running:
    parent: cuj_flow
    props:
      name: Timer running
      given: User clicks start
      when: Timer starts
      then: Timer shows running
      screen: screen_editor
      comp_timer: running
  sc_paused:
    parent: cuj_flow
    props:
      name: Timer paused
      given: User clicks pause
      when: Timer pauses
      then: Timer shows paused
      screen: screen_editor
      comp_timer: paused
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Should have a function to get state key for deduplication
      expect(html).toContain("getStateKey");
      // Should deduplicate scenarios by state key
      expect(html).toMatch(/stateCards|uniqueStates/);
      // Should show all scenario names that map to a card
      expect(html).toMatch(/scenarios.*map|\.scenarios\./);
    });

    test("clicking scenario in storyboard mode highlights that scenario's card by index", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_editor:
    parent: screens
    props:
      name: Editor
      components: comp_timer
  components:
    parent: my_project
  comp_timer:
    parent: components
    props:
      name: Timer
      description: Countdown timer
  cujs:
    display: table
    parent: my_project
  cuj_flow:
    parent: cujs
    props:
      feature: Timer Flow
      area: timer
  sc_idle:
    parent: cuj_flow
    props:
      name: Timer idle
      given: User opens editor
      when: Editor loads
      then: Timer shows idle
      screen: screen_editor
      comp_timer: idle
  sc_running:
    parent: cuj_flow
    props:
      name: Timer running
      given: User clicks start
      when: Timer starts
      then: Timer shows running
      screen: screen_editor
      comp_timer: running
  sc_paused:
    parent: cuj_flow
    props:
      name: Timer paused
      given: User clicks pause
      when: Timer pauses
      then: Timer shows paused
      screen: screen_editor
      comp_timer: paused
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // selectScenario calls highlightStoryboardCard when in storyboard mode
      expect(html).toContain("highlightStoryboardCard");
      // Should have CSS for highlighted storyboard card
      expect(html).toContain(".storyboard-card.highlighted");
      // highlightStoryboardCard should add class to storyboard-{cardIdx} element (maps scenario to card)
      expect(html).toMatch(/getElementById\('storyboard-'\+cardIdx\)/);
    });

    test("all storyboard arrows stay visible when CUJ selected", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_editor:
    parent: screens
    props:
      name: Editor
  cujs:
    display: table
    parent: my_project
  cuj_flow:
    parent: cujs
    props:
      feature: Flow
      area: flow
  sc_step1:
    parent: cuj_flow
    props:
      name: Step 1
      given: Start
      when: Action
      then: Done
      screen: screen_editor
  sc_step2:
    parent: cuj_flow
    props:
      name: Step 2
      given: On editor
      when: Next
      then: Continue
      screen: screen_editor
  sc_step3:
    parent: cuj_flow
    props:
      name: Step 3
      given: Continuing
      when: Finish
      then: Complete
      screen: screen_editor
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // drawStoryboardArrows should always draw all arrows
      expect(html).toContain("drawStoryboardArrows");
      // Should redraw arrows when highlighting (not clear them)
      expect(html).toMatch(/highlightStoryboardCard.*drawStoryboardArrows/s);
    });

    test("only the arrow entering highlighted card is emphasized", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_editor:
    parent: screens
    props:
      name: Editor
  cujs:
    display: table
    parent: my_project
  cuj_flow:
    parent: cujs
    props:
      feature: Flow
      area: flow
  sc_step1:
    parent: cuj_flow
    props:
      name: Step 1
      given: Start
      when: Action
      then: Done
      screen: screen_editor
  sc_step2:
    parent: cuj_flow
    props:
      name: Step 2
      given: On editor
      when: Next
      then: Continue
      screen: screen_editor
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // drawStoryboardArrows should accept highlighted index parameter
      expect(html).toContain("drawStoryboardArrows(scenarios,highlightedStoryboardIdx)");
      // Should check if arrow target matches highlighted index
      expect(html).toMatch(/i\+1===highlightedStoryboardIdx/);
    });

    test("auto-pans to center highlighted storyboard card", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_editor:
    parent: screens
    props:
      name: Editor
  cujs:
    display: table
    parent: my_project
  cuj_flow:
    parent: cujs
    props:
      feature: Flow
      area: flow
  sc_step1:
    parent: cuj_flow
    props:
      name: Step 1
      given: Start
      when: Action
      then: Done
      screen: screen_editor
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Should have function to pan to a storyboard card
      expect(html).toContain("panToCard");
      // highlightStoryboardCard should call panToCard
      expect(html).toMatch(/highlightStoryboardCard.*panToCard/s);
    });
  });

  // sc_map_default_all_screens: Default view shows one screen per screen entity
  describe("sc_map_default_all_screens", () => {
    test("default view shows deduplicated screens (one per entity)", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_a:
    parent: screens
    props:
      name: Screen A
  screen_b:
    parent: screens
    props:
      name: Screen B
  cujs:
    display: table
    parent: my_project
  cuj_flow:
    parent: cujs
    props:
      feature: Flow
      area: flow
  sc_step1:
    parent: cuj_flow
    props:
      name: Step 1
      given: Start
      when: Action
      then: Done
      screen: screen_a
  sc_step2:
    parent: cuj_flow
    props:
      name: Step 2
      given: On A
      when: Navigate
      then: On B
      screen: screen_b
  sc_step3:
    parent: cuj_flow
    props:
      name: Step 3
      given: On B
      when: Return
      then: Back to A
      screen: screen_a
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Should have default state of null CUJ selection
      expect(html).toContain("selectedMapCuj=null");
      // Should have function to show default deduplicated screens
      expect(html).toContain("showDefaultScreens");
      // Default view shows static screen entities, storyboard hidden
      expect(html).toContain("default-screens");
    });
  });

  // sc_map_screen_min_height: Map screens use mobile portrait aspect ratio
  describe("sc_map_screen_min_height", () => {
    test("screen cards have 476px min-height", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  cujs:
    display: table
    parent: my_project
  cuj_test:
    parent: cujs
    props:
      feature: Test
      area: test
  sc_test:
    parent: cuj_test
    props:
      name: Test scenario
      given: Start
      when: Action
      then: Done
      screen: screen_home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Should have min-height of 476px on screen cards
      expect(html).toMatch(/\.screen\s*\{[^}]*min-height:\s*476px/);
    });

    test("walk-screen matches map card dimensions (220px width, 476px min-height)", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  cujs:
    display: table
    parent: my_project
  cuj_test:
    parent: cujs
    props:
      feature: Test
      area: test
  sc_test:
    parent: cuj_test
    props:
      name: Test scenario
      given: Start
      when: Action
      then: Done
      screen: screen_home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // walk-screen should have same dimensions as map screen cards
      expect(html).toMatch(/\.walk-screen\s*\{[^}]*width:\s*220px/);
      expect(html).toMatch(/\.walk-screen\s*\{[^}]*min-height:\s*476px/);
    });
  });

  // sc_map_resizable_panels: Map sidebar width is adjustable
  describe("sc_map_resizable_panels", () => {
    test("map has resizable sidebar with drag handle", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  cujs:
    display: table
    parent: my_project
  cuj_test:
    parent: cujs
    props:
      feature: Test
      area: test
  sc_test:
    parent: cuj_test
    props:
      name: Test scenario
      given: Start
      when: Action
      then: Done
      screen: screen_home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Should have resize handle element
      expect(html).toContain("resize-handle");
      // Should have cursor:col-resize style for drag handle
      expect(html).toContain("cursor:col-resize");
      // Should have resize handler function (shared sidebar)
      expect(html).toContain("initResize");
    });
  });

  // sc_walk_resizable_panels: Walkthrough panel widths are adjustable
  describe("sc_walk_resizable_panels", () => {
    test("walkthrough has resizable panels with drag handles", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  cujs:
    display: table
    parent: my_project
  cuj_test:
    parent: cujs
    props:
      feature: Test
      area: test
  sc_test:
    parent: cuj_test
    props:
      name: Test scenario
      given: Start
      when: Action
      then: Done
      screen: screen_home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Should have walk resize handles
      expect(html).toContain("walk-resize-handle");
      // Should have resize handler function for walkthrough
      expect(html).toContain("initWalkResize");
    });
  });

  // sc_view_switch_preserves_selection: Switching views preserves selected scenario
  describe("sc_view_switch_preserves_selection", () => {
    test("switching between map and walkthrough preserves selection", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  cujs:
    display: table
    parent: my_project
  cuj_test:
    parent: cujs
    props:
      feature: Test
      area: test
  sc_test:
    parent: cuj_test
    props:
      name: Test scenario
      given: Start
      when: Action
      then: Done
      screen: screen_home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Selection is preserved via curCuj and curStep variables
      expect(html).toContain("curCuj");
      expect(html).toContain("curStep");
      // setMode calls renderStep to update walkthrough with current selection
      expect(html).toMatch(/setMode.*renderStep/s);
      // updateSidebarHighlight keeps sidebar selection in sync
      expect(html).toContain("updateSidebarHighlight");
    });
  });

  // sc_panels_full_height: Panels extend full window height
  describe("sc_panels_full_height", () => {
    test("panels use full viewport height minus mode bar", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  cujs:
    display: table
    parent: my_project
  cuj_test:
    parent: cujs
    props:
      feature: Test
      area: test
  sc_test:
    parent: cuj_test
    props:
      name: Test scenario
      given: Start
      when: Action
      then: Done
      screen: screen_home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // html and body should have 100% height
      expect(html).toMatch(/html\s*,\s*body\s*\{[^}]*height:\s*100%/);
      // app container should use 100vh (no mode bar to subtract)
      expect(html).toMatch(/\.app\s*\{[^}]*height:\s*100vh/);
    });
  });

  // sc_sidebar_independent_scroll: Sidebar scrolls independently from canvas
  describe("sc_sidebar_independent_scroll", () => {
    test("sidebar has independent scroll that doesn't zoom canvas", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  cujs:
    display: table
    parent: my_project
  cuj_test:
    parent: cujs
    props:
      feature: Test
      area: test
  sc_test:
    parent: cuj_test
    props:
      name: Test scenario
      given: Start
      when: Action
      then: Done
      screen: screen_home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Sidebar should stop wheel event propagation
      expect(html).toContain("sidebar");
      expect(html).toMatch(/sidebar.*addEventListener.*wheel.*stopPropagation/s);
    });
  });

  // sc_map_sidebar_list (updated): Persistent sidebar shared between map and walkthrough
  describe("sc_map_sidebar_list: Persistent sidebar shared between views", () => {
    test("has ONE sidebar element shared between map and walkthrough views", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  cujs:
    display: table
    parent: my_project
  cuj_test:
    parent: cujs
    props:
      feature: Test
      area: test
  sc_test:
    parent: cuj_test
    props:
      name: Test scenario
      given: Start
      when: Action
      then: Done
      screen: screen_home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Should have ONE shared sidebar with id="sidebar"
      expect(html).toContain('id="sidebar"');
      // Should NOT have separate map-sidebar and walk-sidebar
      expect(html).not.toContain('id="map-sidebar"');
      expect(html).not.toContain('id="walk-sidebar"');
    });

    test("sidebar populates once and does not rebuild on mode switch", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  cujs:
    display: table
    parent: my_project
  cuj_test:
    parent: cujs
    props:
      feature: Test
      area: test
  sc_test:
    parent: cuj_test
    props:
      name: Test scenario
      given: Start
      when: Action
      then: Done
      screen: screen_home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Should have a single initSidebar function that populates once
      expect(html).toContain("initSidebar");
      // setMode should NOT rebuild the sidebar
      expect(html).not.toMatch(/setMode[^}]*initSidebar/s);
      // Should NOT have separate initMapSidebar or initWalkSidebar
      expect(html).not.toContain("initMapSidebar");
    });

    test("sidebar updates whichever view is active when scenario clicked", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  cujs:
    display: table
    parent: my_project
  cuj_test:
    parent: cujs
    props:
      feature: Test
      area: test
  sc_test:
    parent: cuj_test
    props:
      name: Test scenario
      given: Start
      when: Action
      then: Done
      screen: screen_home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Should have a shared selectScenario function
      expect(html).toContain("selectScenario");
      // Scenario items should call selectScenario, not view-specific functions
      expect(html).toMatch(/scenario-item.*onclick.*selectScenario/s);
    });
  });

  // sc_mode_toggle_in_canvas: Map/Walkthrough toggle lives inside the canvas panel
  describe("sc_mode_toggle_in_canvas: Mode toggle inside canvas panel", () => {
    test("mode toggle is inside canvas-toolbar, not top-level mode-bar", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  cujs:
    display: table
    parent: my_project
  cuj_test:
    parent: cujs
    props:
      feature: Test
      area: test
  sc_test:
    parent: cuj_test
    props:
      name: Test scenario
      given: Start
      when: Action
      then: Done
      screen: screen_home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Should have canvas-toolbar with mode toggle
      expect(html).toContain("canvas-toolbar");
      // Should NOT have top-level mode-bar
      expect(html).not.toContain('class="mode-bar"');
    });

    test("layout has sidebar higher in hierarchy than canvas toggle", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  cujs:
    display: table
    parent: my_project
  cuj_test:
    parent: cujs
    props:
      feature: Test
      area: test
  sc_test:
    parent: cuj_test
    props:
      name: Test scenario
      given: Start
      when: Action
      then: Done
      screen: screen_home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Layout: sidebar comes before canvas-panel in DOM (sidebar is left, full height)
      expect(html).toMatch(/<div[^>]*class="sidebar"[^>]*id="sidebar"[^>]*>.*<div[^>]*class="canvas-panel"/s);
      // App container uses flexbox for layout
      expect(html).toMatch(/\.app\s*\{[^}]*display:\s*flex/);
    });

    test("canvas-panel contains both map-canvas and walk-canvas", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  cujs:
    display: table
    parent: my_project
  cuj_test:
    parent: cujs
    props:
      feature: Test
      area: test
  sc_test:
    parent: cuj_test
    props:
      name: Test scenario
      given: Start
      when: Action
      then: Done
      screen: screen_home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Both canvas views should be inside canvas-panel
      expect(html).toMatch(/canvas-panel.*id="map-canvas".*id="walk-canvas"/s);
      // setMode toggles visibility of map-canvas vs walk-canvas
      expect(html).toMatch(/setMode.*map-canvas.*display.*walk-canvas.*display/s);
    });

    test("viewport uses full height (100vh)", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  cujs:
    display: table
    parent: my_project
  cuj_test:
    parent: cujs
    props:
      feature: Test
      area: test
  sc_test:
    parent: cuj_test
    props:
      name: Test scenario
      given: Start
      when: Action
      then: Done
      screen: screen_home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // App should use 100vh (no mode bar to subtract)
      expect(html).toMatch(/\.app\s*\{[^}]*height:\s*100vh/);
    });
  });

  // sc_map_labels_hidden_default: Screen and component IDs hidden by default
  describe("sc_map_labels_hidden_default", () => {
    test("screen IDs (s-tag) are hidden by default", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  cujs:
    display: table
    parent: my_project
  cuj_test:
    parent: cujs
    props:
      feature: Test
      area: test
  sc_test:
    parent: cuj_test
    props:
      name: Test scenario
      given: Start
      when: Action
      then: Done
      screen: screen_home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // s-tag should be display:none by default
      expect(html).toMatch(/\.s-tag\s*\{[^}]*display:\s*none/);
    });

    test("component labels (comp-label) are hidden by default", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  cujs:
    display: table
    parent: my_project
  cuj_test:
    parent: cujs
    props:
      feature: Test
      area: test
  sc_test:
    parent: cuj_test
    props:
      name: Test scenario
      given: Start
      when: Action
      then: Done
      screen: screen_home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // comp-label should be display:none by default
      expect(html).toMatch(/\.comp-label\s*\{[^}]*display:\s*none/);
    });
  });

  // sc_map_debug_overlay: Debug overlay toggle shows IDs and bounding boxes
  describe("sc_map_debug_overlay", () => {
    test("debug toggle button exists in canvas-toolbar", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  cujs:
    display: table
    parent: my_project
  cuj_test:
    parent: cujs
    props:
      feature: Test
      area: test
  sc_test:
    parent: cuj_test
    props:
      name: Test scenario
      given: Start
      when: Action
      then: Done
      screen: screen_home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Should have a debug toggle button in toolbar
      expect(html).toContain("debug-toggle");
      // Toggle should call toggleDebug function
      expect(html).toContain("toggleDebug");
    });

    test("debug mode shows s-tag and comp-label", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  cujs:
    display: table
    parent: my_project
  cuj_test:
    parent: cujs
    props:
      feature: Test
      area: test
  sc_test:
    parent: cuj_test
    props:
      name: Test scenario
      given: Start
      when: Action
      then: Done
      screen: screen_home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // In debug mode, s-tag should be visible
      expect(html).toMatch(/\.app\.debug-mode\s+\.s-tag\s*\{[^}]*display:\s*block/);
      // In debug mode, comp-label should be visible
      expect(html).toMatch(/\.app\.debug-mode\s+\.comp-label\s*\{[^}]*display:\s*block/);
    });

    test("debug mode adds dashed border to comp-box", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  cujs:
    display: table
    parent: my_project
  cuj_test:
    parent: cujs
    props:
      feature: Test
      area: test
  sc_test:
    parent: cuj_test
    props:
      name: Test scenario
      given: Start
      when: Action
      then: Done
      screen: screen_home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // In debug mode, comp-box should have dashed border
      expect(html).toMatch(/\.app\.debug-mode\s+\.comp-box\s*\{[^}]*border:[^}]*dashed/);
    });

    test("debug mode adds semi-transparent overlay to screens", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  cujs:
    display: table
    parent: my_project
  cuj_test:
    parent: cujs
    props:
      feature: Test
      area: test
  sc_test:
    parent: cuj_test
    props:
      name: Test scenario
      given: Start
      when: Action
      then: Done
      screen: screen_home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // In debug mode, screens should have ::after overlay
      expect(html).toMatch(/\.app\.debug-mode\s+\.screen::after/);
      // Walk screen should also have overlay
      expect(html).toMatch(/\.app\.debug-mode\s+\.walk-screen::after/);
    });

    test("toggleDebug function toggles debug-mode class on app", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  cujs:
    display: table
    parent: my_project
  cuj_test:
    parent: cujs
    props:
      feature: Test
      area: test
  sc_test:
    parent: cuj_test
    props:
      name: Test scenario
      given: Start
      when: Action
      then: Done
      screen: screen_home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // toggleDebug should toggle debug-mode class on app element
      expect(html).toMatch(/toggleDebug.*\.app.*classList.*toggle.*debug-mode/s);
    });
  });

  // sc_single_screen_instance: Map and walkthrough share a single screen DOM element
  describe("sc_single_screen_instance", () => {
    test("screen pool caches and returns DOM elements by key", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  cujs:
    display: table
    parent: my_project
  cuj_test:
    parent: cujs
    props:
      feature: Test
      area: test
  sc_test:
    parent: cuj_test
    props:
      name: Test scenario
      given: Start
      when: Action
      then: Done
      screen: screen_home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Should have a screenHtmlCache object for caching HTML strings
      expect(html).toContain("screenHtmlCache");
      // Should have getScreenHtml function that returns cached HTML
      expect(html).toContain("getScreenHtml");
    });

    test("switching modes uses innerHTML with cached HTML strings", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  cujs:
    display: table
    parent: my_project
  cuj_test:
    parent: cujs
    props:
      feature: Test
      area: test
  sc_test:
    parent: cuj_test
    props:
      name: Test scenario
      given: Start
      when: Action
      then: Done
      screen: screen_home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // renderStep should use getScreenHtml with innerHTML (not appendChild)
      expect(html).toMatch(/renderStep.*getScreenHtml/s);
      expect(html).toMatch(/\.innerHTML\s*=\s*getScreenHtml/s);
    });

    test("storyboard uses getScreenHtml for each scenario", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  cujs:
    display: table
    parent: my_project
  cuj_test:
    parent: cujs
    props:
      feature: Test
      area: test
  sc_test:
    parent: cuj_test
    props:
      name: Test scenario
      given: Start
      when: Action
      then: Done
      screen: screen_home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // renderStoryboard should use getScreenHtml
      expect(html).toMatch(/renderStoryboard.*getScreenHtml/s);
    });
  });

  describe("screen header shows name not ID", () => {
    test("s-head displays screen.name instead of screen ID", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_onboarding:
    parent: screens
    props:
      name: Onboarding Flow
  cujs:
    display: table
    parent: my_project
  cuj_signup:
    parent: cujs
    props:
      feature: User signup
      area: auth
  sc_welcome:
    parent: cuj_signup
    props:
      name: Welcome screen
      given: User opens app
      when: App loads
      then: Welcome screen shown
      screen: screen_onboarding
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Should have a helper function to get screen name from ID
      expect(html).toContain("getScreenName");

      // The ws-head and s-head should use getScreenName to look up the screen's name
      // NOT display the screen ID directly
      expect(html).toMatch(/getScreenName\s*\(/);

      // ws-head header should use getScreenName to look up the screen name
      expect(html).toMatch(/ws-head.*getScreenName|getScreenName.*ws-head/s);
    });

    test("storyboard card s-head uses screen name not ID", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_dashboard:
    parent: screens
    props:
      name: Dashboard
  cujs:
    display: table
    parent: my_project
  cuj_view:
    parent: cujs
    props:
      feature: View dashboard
      area: main
  sc_open:
    parent: cuj_view
    props:
      name: Open dashboard
      given: User logged in
      when: User clicks dashboard
      then: Dashboard opens
      screen: screen_dashboard
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // storyboard card s-head should use getScreenName
      expect(html).toMatch(/storyboard-card.*s-head.*getScreenName|s-head.*getScreenName.*storyboard/s);
    });
  });

  describe("screen content caching with HTML strings", () => {
    test("getScreenHtml returns cached HTML string not DOM element", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  cujs:
    display: table
    parent: my_project
  cuj_test:
    parent: cujs
    props:
      feature: Test
      area: test
  sc_step1:
    parent: cuj_test
    props:
      name: Step 1
      given: Start
      when: Action
      then: Done
      screen: screen_home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Should use getScreenHtml that returns HTML string (not getOrCreateScreen with DOM)
      expect(html).toContain("getScreenHtml");
      expect(html).toContain("screenHtmlCache");
      // Should NOT have getOrCreateScreen anymore
      expect(html).not.toContain("getOrCreateScreen");
    });

    test("storyboard uses innerHTML with cached HTML string", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  cujs:
    display: table
    parent: my_project
  cuj_test:
    parent: cujs
    props:
      feature: Test
      area: test
  sc_step1:
    parent: cuj_test
    props:
      name: Step 1
      given: Start
      when: Action
      then: Done
      screen: screen_home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Storyboard should use innerHTML with getScreenHtml (not appendChild)
      expect(html).toMatch(/s-body.*\.innerHTML\s*=\s*getScreenHtml/s);
    });

    test("walkthrough uses innerHTML with cached HTML string", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  cujs:
    display: table
    parent: my_project
  cuj_test:
    parent: cujs
    props:
      feature: Test
      area: test
  sc_step1:
    parent: cuj_test
    props:
      name: Step 1
      given: Start
      when: Action
      then: Done
      screen: screen_home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Walkthrough should use innerHTML with getScreenHtml (not appendChild)
      expect(html).toMatch(/ws-body.*\.innerHTML\s*=\s*getScreenHtml/s);
    });

    test("getScreenHtml returns only body content without header", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  cujs:
    display: table
    parent: my_project
  cuj_test:
    parent: cujs
    props:
      feature: Test
      area: test
  sc_step1:
    parent: cuj_test
    props:
      name: Step 1
      given: Start
      when: Action
      then: Done
      screen: screen_home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // getScreenHtml should return renderScreenForStep directly (no ws-head wrapper)
      expect(html).toMatch(/getScreenHtml.*renderScreenForStep\(screenId,\s*scenario\)/s);
      // The cached content should NOT include ws-head
      expect(html).not.toMatch(/screenHtmlCache\[key\]\s*=.*ws-head/);
    });
  });

  describe("sc_map_click_scenario_highlights", () => {
    test("clicking scenario auto-selects CUJ and renders storyboard", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  cujs:
    display: table
    parent: my_project
  cuj_test:
    parent: cujs
    props:
      feature: Test
      area: test
  sc_step1:
    parent: cuj_test
    props:
      name: Step 1
      given: Start
      when: Action
      then: Done
      screen: screen_home
  sc_step2:
    parent: cuj_test
    props:
      name: Step 2
      given: Step 1 done
      when: Continue
      then: Finished
      screen: screen_home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // selectScenario should auto-select CUJ in else branch
      expect(html).toContain("selectedMapCuj=cujId");
      // Then render the storyboard
      expect(html).toContain("renderStoryboard(cujId)");
    });

    test("selectScenario highlights card after rendering storyboard", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  cujs:
    display: table
    parent: my_project
  cuj_test:
    parent: cujs
    props:
      feature: Test
      area: test
  sc_step1:
    parent: cuj_test
    props:
      name: Step 1
      given: Start
      when: Action
      then: Done
      screen: screen_home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // After rendering storyboard, selectScenario should highlight the card
      expect(html).toContain("highlightStoryboardCard(stepIdx)");
    });
  });

  describe("sc_map_keyboard_nav", () => {
    test("ArrowRight in map mode with storyboard navigates to next scenario", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  cujs:
    display: table
    parent: my_project
  cuj_test:
    parent: cujs
    props:
      feature: Test
      area: test
  sc_step1:
    parent: cuj_test
    props:
      name: Step 1
      given: Start
      when: Action
      then: Done
      screen: screen_home
  sc_step2:
    parent: cuj_test
    props:
      name: Step 2
      given: Step 1 done
      when: Continue
      then: Finished
      screen: screen_home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Keydown handler should check for map mode with active storyboard
      expect(html).toContain("currentMode==='map'");
      expect(html).toContain("selectedMapCuj");
      // Should handle ArrowRight to increment highlightedStoryboardIdx
      expect(html).toMatch(/ArrowRight.*highlightedStoryboardIdx/s);
    });

    test("ArrowLeft in map mode navigates to previous scenario", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  cujs:
    display: table
    parent: my_project
  cuj_test:
    parent: cujs
    props:
      feature: Test
      area: test
  sc_step1:
    parent: cuj_test
    props:
      name: Step 1
      given: Start
      when: Action
      then: Done
      screen: screen_home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Should handle ArrowLeft to decrement highlightedStoryboardIdx
      expect(html).toMatch(/ArrowLeft.*highlightedStoryboardIdx/s);
    });

    test("keyboard nav calls highlightStoryboardCard and updateSidebarHighlight", async () => {
      const aideContent = `
entities:
  my_project:
    display: page
  screens:
    parent: my_project
  screen_home:
    parent: screens
    props:
      name: Home
  cujs:
    display: table
    parent: my_project
  cuj_test:
    parent: cujs
    props:
      feature: Test
      area: test
  sc_step1:
    parent: cuj_test
    props:
      name: Step 1
      given: Start
      when: Action
      then: Done
      screen: screen_home
relationships: []
`;
      await writeFile(join(testDir, "test.aide"), aideContent);

      await runBantay(["visualize"], testDir);

      const html = await readFile(join(testDir, "visualizer.html"), "utf-8");

      // Keyboard nav should call highlightStoryboardCard and updateSidebarHighlight
      expect(html).toMatch(/keydown.*highlightStoryboardCard/s);
      expect(html).toMatch(/keydown.*updateSidebarHighlight/s);
    });
  });
});
