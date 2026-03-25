import { join, basename, dirname } from "path";
import { readFile, writeFile } from "fs/promises";
import * as yaml from "js-yaml";
import { resolveAidePath } from "../aide/discovery";
import { extractDesignTokens, tokenIdToCssVar } from "../export/css";

interface DesignToken {
  id: string;
  value: string;
}

interface TokenVar {
  name: string;
  value: string;
}

interface WireframeMap {
  [compId: string]: string;
}

/**
 * Extract CSS variables from entities with props.type === "token".
 * Each prop (except "type" and "text" description) becomes a CSS variable.
 * Pattern: --{entity_id}-{prop_key}: {prop_value};
 */
function extractTokenTypeVars(aide: AideTree): TokenVar[] {
  const vars: TokenVar[] = [];
  const entities = aide.entities || {};

  for (const [id, entity] of Object.entries(entities)) {
    if (entity.props?.type === "token") {
      // For each prop except "type", generate a CSS variable
      for (const [key, value] of Object.entries(entity.props)) {
        // Skip the "type" prop itself and "text" which is typically a description
        if (key === "type") continue;

        const varName = `--${id.replace(/_/g, "-")}-${key.replace(/_/g, "-")}`;
        vars.push({
          name: varName,
          value: String(value),
        });
      }
    }
  }

  return vars;
}

/**
 * Extract dark mode CSS variables from entities with props.type === "token-dark".
 * The entity ID suffix "_dark" is stripped to get the variable namespace.
 * Pattern: ds_colors_dark prop text → --ds-colors-text (in dark block)
 */
function extractDarkModeTokenVars(aide: AideTree): TokenVar[] {
  const vars: TokenVar[] = [];
  const entities = aide.entities || {};

  for (const [id, entity] of Object.entries(entities)) {
    if (entity.props?.type === "token-dark") {
      // Strip _dark suffix from entity ID to get the namespace
      const namespace = id.replace(/_dark$/, "");

      // For each prop except "type", generate a CSS variable
      for (const [key, value] of Object.entries(entity.props)) {
        if (key === "type") continue;

        const varName = `--${namespace.replace(/_/g, "-")}-${key.replace(/_/g, "-")}`;
        vars.push({
          name: varName,
          value: String(value),
        });
      }
    }
  }

  return vars;
}

export interface VisualizeOptions {
  aide?: string;
  output?: string;
}

export interface VisualizeResult {
  outputPath: string;
  bytesWritten: number;
}

interface AideEntity {
  display?: string;
  parent?: string;
  props?: Record<string, unknown>;
}

interface AideRelationship {
  from: string;
  to: string;
  type: string;
  cardinality: string;
}

interface AideTree {
  entities: Record<string, AideEntity>;
  relationships: AideRelationship[];
}

interface CUJ {
  id: string;
  name: string;
  feature: string;
  area: string;
  scenarios: Scenario[];
}

interface Scenario {
  id: string;
  name: string;
  given: string;
  when: string;
  then: string;
  screen?: string;
  invariants: string[];
  componentStates: Record<string, string>; // comp_* props from scenario
}

interface Component {
  id: string;
  name: string;
  description?: string;
  wireframeHtml?: string;
}

interface Screen {
  id: string;
  name: string;
  description?: string;
  inferred: boolean;
  components?: Component[];
  nav?: string;
}

interface Transition {
  from: string;
  to: string;
  label: string;
  scenarioId: string;
}

export async function runVisualize(
  projectPath: string,
  options: VisualizeOptions = {}
): Promise<VisualizeResult> {
  // Find aide file
  const resolved = await resolveAidePath(projectPath, options.aide);
  const aidePath = resolved.path;

  // Parse aide file
  const aideContent = await readFile(aidePath, "utf-8");
  const aide = yaml.load(aideContent) as AideTree;

  // Extract design tokens (entities under design_system with value prop)
  const designTokens = extractDesignTokens(aide as any);

  // Extract tokens from type=token entities
  const tokenTypeVars = extractTokenTypeVars(aide);

  // Extract dark mode tokens from type=token-dark entities
  const darkModeTokenVars = extractDarkModeTokenVars(aide);

  // Load wireframe HTML files
  const wireframes = await loadWireframes(projectPath);

  // Extract data from aide
  const { cujs, screens, transitions, relationships } = extractVisualizerData(aide, wireframes);

  // Generate HTML
  const html = generateVisualizerHtml(cujs, screens, transitions, relationships, designTokens, wireframes, tokenTypeVars, darkModeTokenVars);

  // Write output
  const outputPath = options.output
    ? join(projectPath, options.output)
    : join(projectPath, "visualizer.html");

  await writeFile(outputPath, html);

  return {
    outputPath,
    bytesWritten: Buffer.byteLength(html, "utf-8"),
  };
}

/**
 * Load wireframe HTML files from wireframes/ directory
 */
async function loadWireframes(projectPath: string): Promise<WireframeMap> {
  const wireframes: WireframeMap = {};
  const wireframesDir = join(projectPath, "wireframes");

  try {
    const files = await Bun.file(wireframesDir).exists() ? [] : [];
    // Use readdir to list files
    const { readdir } = await import("fs/promises");
    const entries = await readdir(wireframesDir).catch(() => []);

    for (const entry of entries) {
      if (entry.endsWith(".html")) {
        const compId = entry.replace(".html", "");
        const content = await readFile(join(wireframesDir, entry), "utf-8");
        wireframes[compId] = content;
      }
    }
  } catch {
    // wireframes directory doesn't exist, return empty map
  }

  return wireframes;
}

function extractVisualizerData(aide: AideTree, wireframes: WireframeMap = {}): {
  cujs: CUJ[];
  screens: Screen[];
  transitions: Transition[];
  relationships: AideRelationship[];
} {
  const entities = aide.entities || {};
  const relationships = aide.relationships || [];

  // Build protected_by lookup
  const protectedBy = new Map<string, string[]>();
  for (const rel of relationships) {
    if (rel.type === "protected_by") {
      const existing = protectedBy.get(rel.from) || [];
      existing.push(rel.to);
      protectedBy.set(rel.from, existing);
    }
  }

  // Find CUJ container (entity with id 'cujs' or similar pattern)
  const cujContainer = Object.entries(entities).find(
    ([id, entity]) => id === "cujs" || entity.props?.title === "Critical User Journeys"
  );
  const cujContainerId = cujContainer?.[0];

  // Extract CUJs (entities that are children of CUJ container and start with cuj_)
  const cujs: CUJ[] = [];
  const cujMap = new Map<string, CUJ>();

  for (const [id, entity] of Object.entries(entities)) {
    if (id.startsWith("cuj_") && entity.parent === cujContainerId) {
      const cuj: CUJ = {
        id,
        name: String(entity.props?.feature || id),
        feature: String(entity.props?.feature || id),
        area: String(entity.props?.area || "default"),
        scenarios: [],
      };
      cujs.push(cuj);
      cujMap.set(id, cuj);
    }
  }

  // Extract scenarios (entities that start with sc_ and are children of CUJs)
  for (const [id, entity] of Object.entries(entities)) {
    if (id.startsWith("sc_") && entity.parent) {
      const parentCuj = cujMap.get(entity.parent);
      if (parentCuj) {
        // Collect component state overrides (props starting with comp_)
        const componentStates: Record<string, string> = {};
        if (entity.props) {
          for (const [key, value] of Object.entries(entity.props)) {
            if (key.startsWith("comp_")) {
              componentStates[key] = String(value);
            }
          }
        }

        const scenario: Scenario = {
          id,
          name: String(entity.props?.name || id),
          given: String(entity.props?.given || ""),
          when: String(entity.props?.when || ""),
          then: String(entity.props?.then || ""),
          screen: entity.props?.screen as string | undefined,
          invariants: protectedBy.get(id) || [],
          componentStates,
        };
        parentCuj.scenarios.push(scenario);
      }
    }
  }

  // Extract component entities (entities that start with comp_)
  const componentMap = new Map<string, Component>();
  for (const [id, entity] of Object.entries(entities)) {
    if (id.startsWith("comp_")) {
      componentMap.set(id, {
        id,
        name: String(entity.props?.name || id.replace("comp_", "")),
        description: entity.props?.description as string | undefined,
        wireframeHtml: wireframes[id],
      });
    }
  }

  // Extract explicit screens (entities that start with screen_)
  const explicitScreens: Screen[] = [];
  for (const [id, entity] of Object.entries(entities)) {
    if (id.startsWith("screen_")) {
      // Parse components prop (comma-separated string of component IDs)
      const componentsStr = entity.props?.components as string | undefined;
      const screenComponents: Component[] = [];
      if (componentsStr) {
        const compIds = componentsStr.split(",").map((s) => s.trim());
        for (const compId of compIds) {
          const comp = componentMap.get(compId);
          if (comp) {
            screenComponents.push(comp);
          }
        }
      }

      explicitScreens.push({
        id,
        name: String(entity.props?.name || id.replace("screen_", "")),
        description: entity.props?.description as string | undefined,
        inferred: false,
        components: screenComponents.length > 0 ? screenComponents : undefined,
        nav: entity.props?.nav as string | undefined,
      });
    }
  }

  // If no explicit screens, infer from scenarios
  let screens: Screen[];
  if (explicitScreens.length > 0) {
    screens = explicitScreens;
  } else {
    screens = inferScreensFromScenarios(cujs);
  }

  // Extract transitions from scenarios
  const transitions = extractTransitions(cujs, screens);

  return { cujs, screens, transitions, relationships };
}

function inferScreensFromScenarios(cujs: CUJ[]): Screen[] {
  const screenNames = new Set<string>();

  for (const cuj of cujs) {
    for (const scenario of cuj.scenarios) {
      // Extract screen-like terms from given/then
      const givenScreens = extractScreenTerms(scenario.given);
      const thenScreens = extractScreenTerms(scenario.then);

      for (const s of [...givenScreens, ...thenScreens]) {
        screenNames.add(s);
      }
    }
  }

  return Array.from(screenNames).map((name) => ({
    id: `screen_${name.toLowerCase().replace(/\s+/g, "_")}`,
    name,
    inferred: true,
  }));
}

function extractScreenTerms(text: string): string[] {
  const terms: string[] = [];

  // Look for common patterns like "on X page", "X displayed", "sees X"
  const patterns = [
    /(?:on|viewing|at)\s+(?:the\s+)?(\w+)/gi,
    /(\w+)\s+(?:displayed|shown|visible)/gi,
    /sees?\s+(?:the\s+)?(\w+)/gi,
    /(\w+)\s+(?:page|screen|form|view)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const term = match[1];
      // Filter out common non-screen words
      if (!["user", "the", "a", "an", "is", "are", "has", "have", "with"].includes(term.toLowerCase())) {
        terms.push(capitalize(term));
      }
    }
  }

  return terms;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function extractTransitions(cujs: CUJ[], screens: Screen[]): Transition[] {
  const transitions: Transition[] = [];
  const screenNameMap = new Map(screens.map((s) => [s.name.toLowerCase(), s.id]));

  for (const cuj of cujs) {
    for (let i = 0; i < cuj.scenarios.length; i++) {
      const scenario = cuj.scenarios[i];
      const nextScenario = cuj.scenarios[i + 1];

      if (nextScenario) {
        // Try to find screen transitions
        const fromScreen = findScreenForText(scenario.given, screenNameMap) ||
                          findScreenForText(scenario.then, screenNameMap);
        const toScreen = findScreenForText(nextScenario.given, screenNameMap) ||
                        findScreenForText(nextScenario.then, screenNameMap);

        if (fromScreen && toScreen && fromScreen !== toScreen) {
          transitions.push({
            from: fromScreen,
            to: toScreen,
            label: scenario.name,
            scenarioId: scenario.id,
          });
        }
      }
    }
  }

  return transitions;
}

function findScreenForText(text: string, screenMap: Map<string, string>): string | null {
  const lowerText = text.toLowerCase();
  for (const [name, id] of screenMap) {
    if (lowerText.includes(name)) {
      return id;
    }
  }
  return null;
}

function generateVisualizerHtml(
  cujs: CUJ[],
  screens: Screen[],
  transitions: Transition[],
  relationships: AideRelationship[],
  designTokens: DesignToken[] = [],
  wireframes: WireframeMap = {},
  tokenTypeVars: TokenVar[] = [],
  darkModeTokenVars: TokenVar[] = []
): string {
  // Generate data for embedding in HTML
  const cujsData = JSON.stringify(
    Object.fromEntries(
      cujs.map((cuj) => [
        cuj.id,
        {
          name: cuj.feature,
          area: cuj.area,
          scenarios: cuj.scenarios.map((s) => ({
            id: s.id,
            name: s.name,
            given: s.given,
            when: s.when,
            then: s.then,
            screen: s.screen || "default",
            invs: s.invariants,
            ...s.componentStates, // Include comp_* props directly on scenario
          })),
        },
      ])
    )
  );

  const screensData = JSON.stringify(screens);
  const transitionsData = JSON.stringify(transitions);

  // Build screenHtmlMap for walkthrough mode - pre-rendered HTML for each screen
  const screenHtmlMapObj: Record<string, string> = {};
  for (const screen of screens) {
    let bodyHtml: string;
    if (screen.components && screen.components.length > 0) {
      bodyHtml = screen.components
        .map((comp) => {
          const content = comp.wireframeHtml
            ? comp.wireframeHtml
            : `<div class="comp-desc">${comp.description || comp.name}</div>`;
          return `<div class="comp-box"><div class="comp-label">${comp.id}</div>${content}</div>`;
        })
        .join("");
    } else {
      bodyHtml = `<div style="padding:20px;text-align:center;color:var(--hint);">${screen.description || screen.name}</div>`;
    }

    let navHtml = "";
    if (screen.nav === "none") {
      navHtml = '<div class="nav-footer">no nav — immersive</div>';
    } else if (screen.nav && screen.nav !== "") {
      navHtml = '<div class="nav-bar"><span>Artifacts</span><span>Write</span><span>Settings</span></div>';
    }

    screenHtmlMapObj[screen.id] = bodyHtml + navHtml;
  }
  const screenHtmlMapData = JSON.stringify(screenHtmlMapObj);

  // Build variantHtmlMap - contains variant wireframes (e.g., comp_timer--idle)
  const variantHtmlMapObj: Record<string, string> = {};
  for (const [key, html] of Object.entries(wireframes)) {
    if (key.includes("--")) {
      // This is a variant wireframe
      variantHtmlMapObj[key] = html;
    }
  }
  const variantHtmlMapData = JSON.stringify(variantHtmlMapObj);

  // Generate screen HTML for map view - linear horizontal layout
  const screenHtml = screens
    .map((screen, i) => {
      // Linear layout: horizontal sequence with fixed spacing
      const x = 80 + i * 300;
      const y = 80;

      // Render component boxes if screen has components
      let bodyContent: string;
      if (screen.components && screen.components.length > 0) {
        bodyContent = screen.components
          .map(
            (comp) => {
              // Use wireframe HTML if available, otherwise fall back to description
              const content = comp.wireframeHtml
                ? comp.wireframeHtml
                : `<div class="comp-desc">${comp.description || comp.name}</div>`;
              return `
        <div class="comp-box">
          <div class="comp-label">${comp.id}</div>
          ${content}
        </div>`;
            }
          )
          .join("");
      } else {
        bodyContent = `
        <div style="text-align:center;padding:40px 0;color:var(--hint);font-size:12px;">
          ${screen.description || (screen.inferred ? "(Inferred from scenarios)" : "")}
        </div>`;
      }

      // Render nav bar
      let navContent = "";
      if (screen.nav === "none") {
        navContent = `<div class="nav-footer">no nav — immersive</div>`;
      } else if (screen.nav && screen.nav !== "") {
        navContent = `<div class="nav-bar"><span>Artifacts</span><span>Write</span><span>Settings</span></div>`;
      }

      return `
    <div class="screen" id="node-${screen.id}" style="left:${x}px;top:${y}px;">
      <div class="s-tag">${screen.id}</div>
      <div class="s-head"><span>${screen.name}</span></div>
      <div class="s-body">${bodyContent}</div>${navContent}
    </div>`;
    })
    .join("\n");

  // Generate CSS variables from design tokens (entities with value prop under design_system)
  const designTokenCssVars = designTokens
    .map((token) => `  ${tokenIdToCssVar(token.id)}: ${token.value};`)
    .join("\n");

  // Generate CSS variables from type=token entities
  const tokenTypeCssVars = tokenTypeVars
    .map((tv) => `  ${tv.name}: ${tv.value};`)
    .join("\n");

  // Combine both token sources
  const tokenCssVars = [designTokenCssVars, tokenTypeCssVars].filter(Boolean).join("\n");

  // Generate dark mode CSS variables from type=token-dark entities
  const darkModeCssVars = darkModeTokenVars
    .map((tv) => `  ${tv.name}: ${tv.value};`)
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Aide Visualizer</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
:root {
  --bg: #FAFAFA; --fg: #292929; --mt: #757575; --bd: rgba(0,0,0,0.08); --hint: #999;
  --accent: #1A8917; --blue: #2563eb; --green: #1A8917; --purple: #7c3aed; --amber: #f59e0b; --coral: #e8593c;
  --grid: 20px;
  --serif: Charter, Georgia, serif;
  --sans: -apple-system, BlinkMacSystemFont, sans-serif;
${tokenCssVars}
}
@media(prefers-color-scheme:dark){:root{
  --bg:#1a1a1a; --fg:#e8e6e1; --bd:rgba(255,255,255,0.08); --mt:#888; --hint:#666;
${darkModeCssVars}
}}

body { font-family: var(--sans); background: var(--bg); color: var(--fg); }

.mode-bar { display:flex; gap:2px; padding:8px 12px; background:var(--bg); border-bottom:1px solid var(--bd); font-family:monospace; font-size:11px; }
.mode-btn { padding:4px 14px; border:1px solid var(--bd); border-radius:6px; background:none; color:var(--mt); cursor:pointer; font-family:inherit; font-size:inherit; }
.mode-btn.active { background:var(--fg); color:var(--bg); border-color:var(--fg); }

/* MAP */
.viewport { width:100%; height:680px; position:relative; overflow:hidden; border:1px solid var(--bd); border-top:none; }
.pan-layer { position:absolute; width:4000px; height:3000px; transform-origin:0 0; background-image:radial-gradient(circle,var(--bd) 1px,transparent 1px); background-size:var(--grid) var(--grid); }
.screen { position:absolute; width:220px; min-height:476px; background:var(--bg); border:1px solid var(--bd); border-radius:10px; overflow:visible; font-family:var(--sans); font-size:11px; color:var(--fg); box-shadow:0 2px 10px rgba(0,0,0,0.08); cursor:grab; user-select:none; z-index:3; display:flex; flex-direction:column; transition:box-shadow 0.15s, opacity 0.2s; }
.screen.dimmed { opacity:0.2; }
@media(prefers-color-scheme:dark){ .screen { box-shadow:0 2px 12px rgba(0,0,0,0.5); } }
.screen.dragging { z-index:10; cursor:grabbing; box-shadow:0 6px 24px rgba(0,0,0,0.18); transition:none; }
.s-head { padding:5px 10px; border-bottom:1px solid var(--bd); display:flex; justify-content:space-between; font-size:10px; color:var(--mt); font-family:monospace; border-radius:10px 10px 0 0; }
.s-body { padding:8px 10px; flex:1; font-family:var(--serif); }
.s-tag { position:absolute; top:-20px; left:0; font-size:9px; font-family:monospace; color:var(--accent); white-space:nowrap; pointer-events:none; }

.comp-box { padding:4px 0; margin-bottom:2px; }
.comp-label { font-size:8px; font-family:monospace; color:var(--accent); opacity:0.5; margin-bottom:2px; }
.comp-desc { font-size:10px; color:var(--hint); }
.nav-bar { display:flex; justify-content:space-around; padding:8px; border-top:1px solid var(--bd); font-size:9px; color:var(--mt); }
.nav-footer { padding:6px 10px; border-top:1px solid var(--bd); font-size:9px; color:var(--hint); text-align:center; font-style:italic; }

.toolbar { position:absolute; top:12px; right:12px; z-index:30; display:flex; flex-direction:column; gap:2px; background:var(--bg); border:1px solid var(--bd); border-radius:8px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.08); }
.toolbar button { width:36px; height:36px; border:none; background:var(--bg); color:var(--fg); font-size:18px; cursor:pointer; display:flex; align-items:center; justify-content:center; border-bottom:1px solid var(--bd); font-family:monospace; }
.toolbar button:last-child { border-bottom:none; }
.toolbar button:hover { background:var(--bd); }
.zoom-label { position:absolute; top:12px; left:12px; z-index:20; font-size:10px; font-family:monospace; color:var(--hint); background:var(--bg); border:1px solid var(--bd); border-radius:4px; padding:2px 8px; }

/* WALKTHROUGH */
.walk-view { display:none; width:100%; border:1px solid var(--bd); border-top:none; }
.walk-view.active { display:flex; flex-direction:column; }
.walk-picker { padding:10px 16px; border-bottom:1px solid var(--bd); display:flex; gap:4px; flex-wrap:wrap; }
.walk-picker button { padding:4px 10px; border:1px solid var(--bd); border-radius:16px; background:none; color:var(--mt); cursor:pointer; font-family:var(--sans); font-size:10px; transition:all 0.15s; }
.walk-picker button.active { background:var(--accent); color:#fff; border-color:var(--accent); }
.walk-picker button:hover:not(.active) { border-color:var(--accent); color:var(--accent); }
.walk-main { display:flex; flex:1; min-height:480px; }
.walk-screen-wrap { flex:1; display:flex; align-items:center; justify-content:center; padding:24px; background:var(--bd); position:relative; }
.walk-screen { width:280px; min-height:300px; background:var(--bg); border:1px solid var(--bd); border-radius:16px; overflow:hidden; font-family:var(--sans); font-size:13px; color:var(--fg); box-shadow:0 4px 24px rgba(0,0,0,0.12); display:flex; flex-direction:column; transition:opacity 0.2s,transform 0.2s; }
.walk-screen.transitioning { opacity:0; transform:translateX(24px); }
.ws-head { padding:8px 14px; border-bottom:1px solid var(--bd); display:flex; justify-content:space-between; font-size:12px; color:var(--mt); font-family:monospace; }
.ws-body { padding:10px 14px; flex:1; }

.walk-panel { width:300px; border-left:1px solid var(--bd); padding:16px; display:flex; flex-direction:column; }
.walk-progress { display:flex; gap:3px; margin-bottom:12px; flex-wrap:wrap; }
.walk-dot { width:8px; height:8px; border-radius:4px; background:var(--bd); transition:background 0.2s; }
.walk-dot.done { background:var(--accent); }
.walk-dot.current { background:var(--blue); transform:scale(1.3); }
.walk-step-counter { font-size:10px; font-family:monospace; color:var(--hint); margin-bottom:6px; }
.walk-scenario-name { font-size:15px; font-weight:600; color:var(--fg); margin-bottom:4px; line-height:1.3; font-family:var(--serif); }
.walk-scenario-id { font-size:9px; font-family:monospace; color:var(--accent); margin-bottom:12px; }
.walk-gherkin { font-family:monospace; font-size:11px; line-height:1.8; margin-bottom:16px; }
.walk-gherkin .kw { color:var(--accent); font-weight:600; }
.walk-invariants { margin-bottom:16px; }
.walk-inv-title { font-size:9px; font-family:monospace; color:var(--hint); text-transform:uppercase; letter-spacing:1px; margin-bottom:4px; }
.walk-inv-item { font-size:9px; font-family:monospace; color:var(--coral); margin-bottom:2px; }
.walk-nav-btns { display:flex; gap:8px; margin-top:auto; }
.walk-nav-btns button { flex:1; padding:10px; border:1px solid var(--bd); border-radius:8px; background:none; color:var(--fg); cursor:pointer; font-family:var(--sans); font-size:12px; transition:all 0.15s; }
.walk-nav-btns button:hover { background:var(--bd); }
.walk-nav-btns button.primary { background:var(--accent); color:#fff; border-color:var(--accent); }
.walk-nav-btns button.primary:hover { opacity:0.9; }
.walk-nav-btns button:disabled { opacity:0.3; cursor:default; }

/* WALKTHROUGH SIDEBAR */
.walk-sidebar { width:220px; border-right:1px solid var(--bd); padding:12px; overflow-y:auto; max-height:480px; }
.area-label { font-size:9px; font-family:monospace; color:var(--hint); text-transform:uppercase; letter-spacing:1px; margin-top:12px; margin-bottom:4px; }
.area-label:first-child { margin-top:0; }
.cuj-group { margin-bottom:8px; }
.cuj-name { font-size:11px; font-weight:600; color:var(--fg); margin-bottom:4px; padding:4px 6px; border-radius:4px; cursor:default; }
.scenario-item { font-size:10px; color:var(--mt); padding:4px 6px 4px 16px; border-radius:4px; cursor:pointer; transition:all 0.15s; margin-bottom:2px; }
.scenario-item:hover { background:var(--bd); color:var(--fg); }
.scenario-item.current { background:var(--accent); color:#fff; }

/* MAP SIDEBAR */
.map-sidebar { width:220px; border-right:1px solid var(--bd); padding:12px; overflow-y:auto; max-height:680px; position:absolute; left:0; top:0; background:var(--bg); z-index:25; }
.map-sidebar .area-label { font-size:9px; font-family:monospace; color:var(--hint); text-transform:uppercase; letter-spacing:1px; margin-top:12px; margin-bottom:4px; }
.map-sidebar .area-label:first-child { margin-top:0; }
.map-sidebar .cuj-group { margin-bottom:8px; }
.map-sidebar .cuj-name { font-size:11px; font-weight:600; color:var(--fg); margin-bottom:4px; padding:4px 6px; border-radius:4px; }
.map-sidebar .scenario-item { font-size:10px; color:var(--mt); padding:4px 6px 4px 16px; border-radius:4px; cursor:pointer; transition:all 0.15s; margin-bottom:2px; }
.map-sidebar .scenario-item:hover { background:var(--bd); color:var(--fg); }
.map-sidebar .scenario-item.current { background:var(--accent); color:#fff; }
.map-sidebar .cuj-name.selected { background:var(--accent); color:#fff; }
.screen.highlighted { box-shadow:0 0 0 3px var(--accent), 0 6px 24px rgba(0,0,0,0.18); z-index:15; }
.arrow-highlighted { stroke-width:3 !important; }

/* STORYBOARD */
.storyboard-container { display:none; position:absolute; top:0; left:0; width:100%; height:100%; }
.storyboard-container.active { display:block; }
.default-screens { display:block; }
.default-screens.hidden { display:none; }
.storyboard-card { position:absolute; width:220px; min-height:476px; background:var(--bg); border:1px solid var(--bd); border-radius:10px; overflow:visible; font-family:var(--sans); font-size:11px; color:var(--fg); box-shadow:0 2px 10px rgba(0,0,0,0.08); z-index:3; display:flex; flex-direction:column; }
@media(prefers-color-scheme:dark){ .storyboard-card { box-shadow:0 2px 12px rgba(0,0,0,0.5); } }
.storyboard-label { position:absolute; bottom:-40px; left:0; width:100%; text-align:center; }
.storyboard-label .scenario-name { font-size:10px; font-family:monospace; color:var(--fg); display:block; }
.storyboard-label .screen-id { font-size:9px; font-family:monospace; color:var(--hint); display:block; }
</style>
</head>
<body>

<div class="mode-bar">
  <button class="mode-btn active" id="mode-map" onclick="setMode('map')">Map</button>
  <button class="mode-btn" id="mode-walk" onclick="setMode('walk')">Walkthrough</button>
</div>

<!-- MAP -->
<div class="viewport" id="viewport">
  <div class="map-sidebar" id="map-sidebar"></div>
  <div class="pan-layer" id="pan-layer">
    <svg id="arrows" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2;overflow:visible;"></svg>
    <div class="default-screens" id="default-screens">
      ${screenHtml}
    </div>
    <div class="storyboard-container" id="storyboard-container"></div>
  </div>

  <div class="toolbar">
    <button id="zoom-in">+</button>
    <button id="zoom-out">-</button>
    <button id="zoom-fit">◻</button>
    <button id="zoom-reset">1:1</button>
  </div>
  <div class="zoom-label" id="zoom-label">100%</div>
</div>

<!-- WALKTHROUGH -->
<div class="walk-view" id="walk-view">
  <div class="walk-main">
    <div class="walk-sidebar" id="walk-sidebar"></div>
    <div class="walk-screen-wrap"><div class="walk-screen" id="walk-screen"></div></div>
    <div class="walk-panel">
      <div class="walk-progress" id="walk-progress"></div>
      <div class="walk-step-counter" id="walk-step-counter"></div>
      <div class="walk-scenario-name" id="walk-scenario-name"></div>
      <div class="walk-scenario-id" id="walk-scenario-id"></div>
      <div class="walk-gherkin" id="walk-gherkin"></div>
      <div class="walk-invariants" id="walk-invariants"></div>
      <div class="walk-nav-btns">
        <button id="walk-prev" onclick="walkStep(-1)">← Back</button>
        <button id="walk-next" class="primary" onclick="walkStep(1)">Next →</button>
      </div>
    </div>
  </div>
</div>

<script>
const cujs = ${cujsData};
const screens = ${screensData};
const transitions = ${transitionsData};
const screenHtmlMap = ${screenHtmlMapData};
const variantHtmlMap = ${variantHtmlMapData};

/* MODE */
function setMode(m){
  document.getElementById('mode-map').classList.toggle('active',m==='map');
  document.getElementById('mode-walk').classList.toggle('active',m==='walk');
  document.getElementById('viewport').style.display=m==='map'?'block':'none';
  document.getElementById('walk-view').classList.toggle('active',m==='walk');
  if(m==='walk')initWalk();
  if(m==='map'){initMapSidebar();requestAnimationFrame(()=>requestAnimationFrame(drawArrows));}
}

/* MAP SIDEBAR */
let highlightedScenarioId=null;
let selectedMapCuj=null;
function initMapSidebar(){
  const sidebar=document.getElementById('map-sidebar');
  const areas={};
  Object.entries(cujs).forEach(([id,c])=>{
    const area=c.area||'default';
    if(!areas[area])areas[area]=[];
    areas[area].push({id,cuj:c});
  });
  let html='<div class="cuj-group"><div class="cuj-name" style="cursor:pointer;color:var(--accent);" onclick="showDefaultScreens()">All Screens</div></div>';
  Object.entries(areas).forEach(([area,cujList])=>{
    html+=\`<div class="area-label">\${area}</div>\`;
    cujList.forEach(({id,cuj})=>{
      html+=\`<div class="cuj-group" data-cuj="\${id}"><div class="cuj-name" style="cursor:pointer;" onclick="selectMapCuj('\${id}')">\${cuj.name}</div>\`;
      cuj.scenarios.forEach((sc,i)=>{
        html+=\`<div class="scenario-item" data-cuj="\${id}" data-step="\${i}" data-scenario="\${sc.id}" data-screen="\${sc.screen}" onclick="highlightScenario('\${sc.id}','\${sc.screen}')">\${sc.name}</div>\`;
      });
      html+=\`</div>\`;
    });
  });
  sidebar.innerHTML=html;
}
function showDefaultScreens(){
  selectedMapCuj=null;
  highlightedScenarioId=null;
  // Hide storyboard, show default screens
  document.getElementById('storyboard-container').classList.remove('active');
  document.getElementById('storyboard-container').innerHTML='';
  document.getElementById('default-screens').classList.remove('hidden');
  // Remove all highlighted states
  document.querySelectorAll('.screen.highlighted').forEach(el=>el.classList.remove('highlighted'));
  document.querySelectorAll('.map-sidebar .cuj-name.selected').forEach(el=>el.classList.remove('selected'));
  document.querySelectorAll('.map-sidebar .scenario-item.current').forEach(el=>el.classList.remove('current'));
  drawArrows();
}
function selectMapCuj(cujId){
  selectedMapCuj=cujId;
  highlightedScenarioId=null;
  // Update sidebar highlighting
  document.querySelectorAll('.map-sidebar .cuj-name.selected').forEach(el=>el.classList.remove('selected'));
  document.querySelectorAll('.map-sidebar .cuj-group[data-cuj="'+cujId+'"] .cuj-name').forEach(el=>el.classList.add('selected'));
  document.querySelectorAll('.map-sidebar .scenario-item.current').forEach(el=>el.classList.remove('current'));
  // Render storyboard for this CUJ
  renderStoryboard(cujId);
}
function renderStoryboard(cujId){
  const cuj=cujs[cujId];
  if(!cuj)return;
  // Hide default screens, show storyboard
  document.getElementById('default-screens').classList.add('hidden');
  const container=document.getElementById('storyboard-container');
  container.classList.add('active');
  // Generate one card per scenario
  let html='';
  let xPos=80;
  cuj.scenarios.forEach((sc,i)=>{
    const screenId=sc.screen;
    const bodyContent=renderScreenForStep(screenId,sc);
    html+=\`<div class="storyboard-card" id="storyboard-\${i}" style="left:\${xPos}px;top:80px;">
      <div class="s-head"><span>\${sc.screen||'default'}</span></div>
      <div class="s-body">\${bodyContent}</div>
      <div class="storyboard-label">
        <span class="scenario-name">\${sc.name}</span>
        <span class="screen-id">\${sc.screen||'default'}</span>
      </div>
    </div>\`;
    xPos+=300;
  });
  container.innerHTML=html;
  drawStoryboardArrows(cuj.scenarios);
}
function highlightScenario(scenarioId,screenId){
  // Clear previous highlight
  document.querySelectorAll('.screen.highlighted').forEach(el=>el.classList.remove('highlighted'));
  document.querySelectorAll('.map-sidebar .scenario-item.current').forEach(el=>el.classList.remove('current'));
  highlightedScenarioId=scenarioId;
  // Highlight screen
  const screenEl=document.getElementById('node-'+screenId);
  if(screenEl)screenEl.classList.add('highlighted');
  // Highlight scenario in sidebar
  document.querySelectorAll('.map-sidebar .scenario-item[data-scenario="'+scenarioId+'"]').forEach(el=>el.classList.add('current'));
  // Redraw arrows with highlight
  drawArrows();
}

/* WALKTHROUGH */
let curCuj=null,curStep=0;
function initWalk(){
  const sidebar=document.getElementById('walk-sidebar');
  // Group CUJs by area
  const areas={};
  Object.entries(cujs).forEach(([id,c])=>{
    const area=c.area||'default';
    if(!areas[area])areas[area]=[];
    areas[area].push({id,cuj:c});
  });
  // Build sidebar HTML
  let html='';
  Object.entries(areas).forEach(([area,cujList])=>{
    html+=\`<div class="area-label">\${area}</div>\`;
    cujList.forEach(({id,cuj})=>{
      html+=\`<div class="cuj-group" data-cuj="\${id}"><div class="cuj-name">\${cuj.name}</div>\`;
      cuj.scenarios.forEach((sc,i)=>{
        html+=\`<div class="scenario-item" data-cuj="\${id}" data-step="\${i}" onclick="jumpToScenario('\${id}',\${i})">\${sc.name}</div>\`;
      });
      html+=\`</div>\`;
    });
  });
  sidebar.innerHTML=html;
  selectCuj(curCuj||Object.keys(cujs)[0]);
}
function jumpToScenario(cujId,step){curCuj=cujId;curStep=step;renderStep();}
function selectCuj(id){curCuj=id;curStep=0;renderStep();}
function walkStep(d){const sc=cujs[curCuj].scenarios,n=curStep+d;if(n<0||n>=sc.length)return;curStep=n;renderStep();}
function renderScreenForStep(screenId,scenario){
  const screenData=screens.find(s=>s.id===screenId||s.name.toLowerCase()===scenario.screen);
  if(!screenData||!screenData.components||screenData.components.length===0){
    return \`<div style="padding:20px;text-align:center;color:var(--hint);">\${scenario.name}</div>\`;
  }
  let html='';
  for(const comp of screenData.components){
    const variant=scenario[comp.id];
    const variantKey=variant?comp.id+'--'+variant:null;
    const wireframe=(variantKey&&variantHtmlMap[variantKey])||comp.wireframeHtml||\`<div class="comp-desc">\${comp.description||comp.name}</div>\`;
    const label=variant?comp.id+' · '+variant:comp.id;
    html+=\`<div class="comp-box"><div class="comp-label">\${label}</div>\${wireframe}</div>\`;
  }
  if(screenData.nav==='none'){
    html+='<div class="nav-footer">no nav — immersive</div>';
  }else if(screenData.nav){
    html+='<div class="nav-bar"><span>Artifacts</span><span>Write</span><span>Settings</span></div>';
  }
  return html;
}
function renderStep(){
  const c=cujs[curCuj],sc=c.scenarios[curStep],tot=c.scenarios.length;
  const w=document.getElementById('walk-screen');
  // Find the screen entity for this scenario's screen prop
  const screenId=sc.screen;
  // Render screen with variant support
  const bodyContent=renderScreenForStep(screenId,sc);
  w.innerHTML=\`<div class="ws-head"><span>\${sc.screen||'default'}</span></div><div class="ws-body">\${bodyContent}</div>\`;
  document.getElementById('walk-progress').innerHTML=c.scenarios.map((_,i)=>\`<div class="walk-dot \${i<curStep?'done':''} \${i===curStep?'current':''}"></div>\`).join('');
  document.getElementById('walk-step-counter').textContent=\`Step \${curStep+1} of \${tot}\`;
  document.getElementById('walk-scenario-name').textContent=sc.name;
  document.getElementById('walk-scenario-id').textContent=sc.id;
  document.getElementById('walk-gherkin').innerHTML=\`<div><span class="kw">Given </span>\${sc.given}</div><div><span class="kw">When </span>\${sc.when}</div><div><span class="kw">Then </span>\${sc.then}</div>\`;
  const iv=document.getElementById('walk-invariants');iv.innerHTML=sc.invs.length?\`<div class="walk-inv-title">Protected by</div>\`+sc.invs.map(i=>\`<div class="walk-inv-item">\${i}</div>\`).join(''):'';
  document.getElementById('walk-prev').disabled=curStep===0;document.getElementById('walk-next').disabled=curStep===tot-1;
  // Highlight current scenario in sidebar
  document.querySelectorAll('.scenario-item').forEach(el=>{
    el.classList.toggle('current',el.dataset.cuj===curCuj&&parseInt(el.dataset.step)===curStep);
  });
}
document.addEventListener('keydown',e=>{if(!document.getElementById('walk-view').classList.contains('active'))return;if(e.key==='ArrowRight'||e.key===' '){e.preventDefault();walkStep(1);}if(e.key==='ArrowLeft'){e.preventDefault();walkStep(-1);}});

/* MAP: zoom/pan/drag */
const viewport=document.getElementById('viewport'),panLayer=document.getElementById('pan-layer'),svg=document.getElementById('arrows'),GRID=20;
let zoom=0.5,panX=0,panY=0,isPanning=false,panStart={x:0,y:0};
function applyTransform(){panLayer.style.transform=\`translate(\${panX}px,\${panY}px) scale(\${zoom})\`;document.getElementById('zoom-label').textContent=Math.round(zoom*100)+'%';}
document.getElementById('zoom-in').onclick=()=>{zoom=Math.min(2,zoom+0.1);applyTransform();drawArrows();};
document.getElementById('zoom-out').onclick=()=>{zoom=Math.max(0.15,zoom-0.1);applyTransform();drawArrows();};
document.getElementById('zoom-reset').onclick=()=>{zoom=1;panX=0;panY=0;applyTransform();drawArrows();};
document.getElementById('zoom-fit').onclick=()=>{const ns=document.querySelectorAll('#pan-layer .screen');let x1=Infinity,y1=Infinity,x2=0,y2=0;ns.forEach(n=>{const l=parseInt(n.style.left),t=parseInt(n.style.top);x1=Math.min(x1,l);y1=Math.min(y1,t);x2=Math.max(x2,l+220);y2=Math.max(y2,t+n.offsetHeight);});const w=x2-x1+160,h=y2-y1+160,vw=viewport.clientWidth,vh=viewport.clientHeight;zoom=Math.min(vw/w,vh/h,1);panX=(vw-w*zoom)/2-x1*zoom+60;panY=(vh-h*zoom)/2-y1*zoom+60;applyTransform();drawArrows();};
viewport.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(0.15,Math.min(2,zoom+(e.deltaY>0?-0.05:0.05)));applyTransform();drawArrows();},{passive:false});
viewport.addEventListener('mousedown',e=>{if(e.target.closest('.screen,.toolbar'))return;isPanning=true;panStart={x:e.clientX-panX,y:e.clientY-panY};viewport.style.cursor='grabbing';e.preventDefault();});
window.addEventListener('mousemove',e=>{if(isPanning){panX=e.clientX-panStart.x;panY=e.clientY-panStart.y;applyTransform();drawArrows();}});
window.addEventListener('mouseup',()=>{if(isPanning){isPanning=false;viewport.style.cursor='default';}});

function snap(v){return Math.round(v/GRID)*GRID;}
let dragNode=null,dragOff={x:0,y:0};
document.querySelectorAll('#pan-layer .screen').forEach(el=>{el.addEventListener('mousedown',e=>{dragNode=el;dragOff={x:e.clientX/zoom-(parseInt(el.style.left)||0),y:e.clientY/zoom-(parseInt(el.style.top)||0)};el.classList.add('dragging');e.preventDefault();e.stopPropagation();});});
window.addEventListener('mousemove',e=>{if(!dragNode)return;dragNode.style.left=snap(e.clientX/zoom-dragOff.x)+'px';dragNode.style.top=snap(e.clientY/zoom-dragOff.y)+'px';drawArrows();});
window.addEventListener('mouseup',()=>{if(dragNode){dragNode.classList.remove('dragging');dragNode=null;}});

function getAnchor(el,side){const lr=panLayer.getBoundingClientRect(),er=el.getBoundingClientRect();const cx=(er.left-lr.left)/zoom+er.width/(2*zoom),cy=(er.top-lr.top)/zoom+er.height/(2*zoom),w=er.width/zoom,h=er.height/zoom;switch(side){case'right':return{x:cx+w/2,y:cy};case'left':return{x:cx-w/2,y:cy};case'top':return{x:cx,y:cy-h/2};case'bottom':return{x:cx,y:cy+h/2};default:return{x:cx,y:cy};}}

function drawEdge(fEl,fS,tEl,tS,label,color,isHighlighted){
  const a=getAnchor(fEl,fS),b=getAnchor(tEl,tS),pull=70;
  let c1={...a},c2={...b};
  if(fS==='right')c1.x+=pull;else if(fS==='left')c1.x-=pull;else if(fS==='bottom')c1.y+=pull;else if(fS==='top')c1.y-=pull;
  if(tS==='right')c2.x+=pull;else if(tS==='left')c2.x-=pull;else if(tS==='bottom')c2.y+=pull;else if(tS==='top')c2.y-=pull;
  const path=\`M\${a.x},\${a.y} C\${c1.x},\${c1.y} \${c2.x},\${c2.y} \${b.x},\${b.y}\`;
  const mid='ah-'+Math.random().toString(36).slice(2,8);
  const strokeWidth=isHighlighted?3:1.5;
  const cssClass=isHighlighted?'class="arrow-highlighted"':'';
  let s=\`<defs><marker id="\${mid}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1L9 5L1 9" fill="none" stroke="\${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>\`;
  s+=\`<path \${cssClass} d="\${path}" fill="none" stroke="\${color}" stroke-width="\${strokeWidth}" marker-end="url(#\${mid})"/>\`;
  if(label){const t=0.5,mt=1-t;const lx=mt**3*a.x+3*mt**2*t*c1.x+3*mt*t**2*c2.x+t**3*b.x;const ly=mt**3*a.y+3*mt**2*t*c1.y+3*mt*t**2*c2.y+t**3*b.y-10;const tw=label.length*5.2+12;s+=\`<rect x="\${lx-tw/2}" y="\${ly-9}" width="\${tw}" height="16" rx="3" fill="var(--bg)" fill-opacity="0.92" stroke="var(--bd)" stroke-width="0.5"/>\`;s+=\`<text x="\${lx}" y="\${ly+2}" text-anchor="middle" font-size="8" font-family="monospace" fill="\${color}">\${label}</text>\`;}
  return s;
}

function drawArrows(){
  let s='';
  // If storyboard mode is active, don't draw default arrows
  if(selectedMapCuj){
    svg.innerHTML='';
    return;
  }
  transitions.forEach(t=>{
    const fromEl=document.getElementById('node-'+t.from);
    const toEl=document.getElementById('node-'+t.to);
    if(fromEl&&toEl){
      const isHighlighted=t.scenarioId===highlightedScenarioId;
      s+=drawEdge(fromEl,'right',toEl,'left',t.label,'var(--accent)',isHighlighted);
    }
  });
  svg.innerHTML=s;
}
function drawStoryboardArrows(scenarios){
  let s='';
  for(let i=0;i<scenarios.length-1;i++){
    const fromEl=document.getElementById('storyboard-'+i);
    const toEl=document.getElementById('storyboard-'+(i+1));
    if(fromEl&&toEl){
      s+=drawEdge(fromEl,'right',toEl,'left',null,'var(--accent)',false);
    }
  }
  svg.innerHTML=s;
}

applyTransform();
initMapSidebar();
requestAnimationFrame(()=>requestAnimationFrame(()=>document.getElementById('zoom-fit').click()));
window.addEventListener('resize',()=>document.getElementById('zoom-fit').click());
</script>
</body>
</html>`;
}
