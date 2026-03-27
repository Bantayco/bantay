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
  path?: string; // comma-separated list of tr_* IDs
  invariants: string[];
  componentStates: Record<string, string>; // comp_* props from scenario
}

// Screen state entity (st_*) - represents a specific state of a screen
interface ScreenState {
  id: string;
  screen: string;
  componentStates: Record<string, string>; // comp_* props
}

// Graph transition entity (tr_*) - represents a transition between screen states
interface GraphTransition {
  id: string;
  from: string; // st_* entity ID
  to: string; // st_* entity ID
  action: string;
  trigger?: string;
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
  const { cujs, screens, transitions, relationships, screenStates } = extractVisualizerData(aide, wireframes);

  // Generate HTML
  const html = generateVisualizerHtml(cujs, screens, transitions, relationships, designTokens, wireframes, tokenTypeVars, darkModeTokenVars, screenStates);

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
  transitions: GraphTransition[];
  relationships: AideRelationship[];
  screenStates: ScreenState[];
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
          path: entity.props?.path as string | undefined,
          invariants: protectedBy.get(id) || [],
          componentStates,
        };
        parentCuj.scenarios.push(scenario);
      }
    }
  }

  // Extract screen state entities (st_*)
  const screenStates: ScreenState[] = [];
  for (const [id, entity] of Object.entries(entities)) {
    if (id.startsWith("st_")) {
      const componentStates: Record<string, string> = {};
      if (entity.props) {
        for (const [key, value] of Object.entries(entity.props)) {
          if (key.startsWith("comp_")) {
            componentStates[key] = String(value);
          }
        }
      }
      screenStates.push({
        id,
        screen: String(entity.props?.screen || ""),
        componentStates,
      });
    }
  }

  // Extract transition entities (tr_*) - unified transitions array
  const transitions: GraphTransition[] = [];
  for (const [id, entity] of Object.entries(entities)) {
    if (id.startsWith("tr_")) {
      transitions.push({
        id,
        from: String(entity.props?.from || ""),
        to: String(entity.props?.to || ""),
        action: String(entity.props?.action || ""),
        trigger: entity.props?.trigger as string | undefined,
      });
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

  return { cujs, screens, transitions, relationships, screenStates };
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

function generateVisualizerHtml(
  cujs: CUJ[],
  screens: Screen[],
  transitions: GraphTransition[],
  relationships: AideRelationship[],
  designTokens: DesignToken[] = [],
  wireframes: WireframeMap = {},
  tokenTypeVars: TokenVar[] = [],
  darkModeTokenVars: TokenVar[] = [],
  screenStates: ScreenState[] = []
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
            path: s.path, // path prop for graph mode
            invs: s.invariants,
            ...s.componentStates, // Include comp_* props directly on scenario
          })),
        },
      ])
    )
  );

  // Determine if graph mode is enabled (has st_* or tr_* entities)
  const hasGraphEntities = screenStates.length > 0 || transitions.length > 0;

  // Compute states and transitions per CUJ (for separate map canvases)
  interface CujGraphData {
    cujId: string;
    stateIds: Set<string>;
    transitionIds: Set<string>;
  }
  const cujGraphs: CujGraphData[] = [];

  if (hasGraphEntities) {
    for (const cuj of cujs) {
      const stateIds = new Set<string>();
      const transitionIds = new Set<string>();

      for (const scenario of cuj.scenarios) {
        if (scenario.path) {
          const pathIds = scenario.path.split(',').map((s: string) => s.trim());
          for (const trId of pathIds) {
            transitionIds.add(trId);
            const tr = transitions.find(t => t.id === trId);
            if (tr) {
              stateIds.add(tr.from);
              stateIds.add(tr.to);
            }
          }
        }
      }

      if (stateIds.size > 0) {
        cujGraphs.push({ cujId: cuj.id, stateIds, transitionIds });
      }
    }
  }

  // Generate screen states and transitions data
  const screenStatesData = JSON.stringify(screenStates);
  const transitionsData = JSON.stringify(transitions);
  const cujGraphsData = JSON.stringify(cujGraphs.map(g => ({
    cujId: g.cujId,
    stateIds: Array.from(g.stateIds),
    transitionIds: Array.from(g.transitionIds),
  })));

  const screensData = JSON.stringify(screens);

  // Build screenHtmlMap for walkthrough mode - pre-rendered HTML for each screen
  const screenHtmlMapObj: Record<string, string> = {};
  for (const screen of screens) {
    let bodyHtml: string;
    let fabHtml = "";
    if (screen.components && screen.components.length > 0) {
      // Separate FAB from other components
      const regularComponents = screen.components.filter(c => c.id !== "comp_fab");
      const fabComponent = screen.components.find(c => c.id === "comp_fab");

      bodyHtml = regularComponents
        .map((comp) => {
          const content = comp.wireframeHtml
            ? comp.wireframeHtml
            : `<div class="comp-desc">${comp.description || comp.name}</div>`;
          return `<div class="comp-box"><div class="comp-label">${comp.id}</div>${content}</div>`;
        })
        .join("");

      // Render FAB with absolute positioning
      if (fabComponent) {
        fabHtml = `<div style="position:absolute; bottom:52px; right:12px; width:44px; height:44px; background:var(--accent); border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 8px rgba(0,0,0,0.25);"><span style="color:#fff; font-size:22px; font-weight:300; line-height:1;">+</span></div>`;
      }
    } else {
      bodyHtml = `<div style="padding:20px;text-align:center;color:var(--hint);">${screen.description || screen.name}</div>`;
    }

    let navHtml = "";
    if (screen.nav === "none") {
      navHtml = '<div class="nav-footer">no nav — immersive</div>';
    } else if (screen.nav && screen.nav !== "") {
      navHtml = '<div class="nav-bar"><span>Artifacts</span><span>Write</span><span>Settings</span></div>';
    }

    screenHtmlMapObj[screen.id] = bodyHtml + fabHtml + navHtml;
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

  // Build stateHtmlMap - pre-renders body content for each screen state (WITHOUT nav)
  // This ensures map and walkthrough use identical HTML
  const stateHtmlMapObj: Record<string, string> = {};
  const stateNavMapObj: Record<string, string> = {};
  for (const state of screenStates) {
    const screen = screens.find(s => s.id === state.screen);
    let bodyContent = "";
    let fabHtml = "";
    if (screen?.components && screen.components.length > 0) {
      // Separate FAB from other components
      const regularComponents = screen.components.filter(c => c.id !== "comp_fab");
      const fabComponent = screen.components.find(c => c.id === "comp_fab");

      bodyContent = regularComponents
        .map((comp) => {
          const variant = state.componentStates[comp.id];
          let content: string;
          if (variant) {
            const variantKey = `${comp.id}--${variant}`;
            content = variantHtmlMapObj[variantKey] || comp.wireframeHtml || `<div class="comp-desc">${comp.description || comp.name}</div>`;
          } else {
            content = comp.wireframeHtml || `<div class="comp-desc">${comp.description || comp.name}</div>`;
          }
          return `<div class="comp-box"><div class="comp-label">${comp.id}</div>${content}</div>`;
        })
        .join("");

      // Render FAB with absolute positioning
      if (fabComponent) {
        fabHtml = `<div style="position:absolute; bottom:52px; right:12px; width:44px; height:44px; background:var(--accent); border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 8px rgba(0,0,0,0.25);"><span style="color:#fff; font-size:22px; font-weight:300; line-height:1;">+</span></div>`;
      }
    } else {
      bodyContent = `<div style="text-align:center;padding:40px 0;color:var(--hint);font-size:12px;">${state.id}</div>`;
    }
    stateHtmlMapObj[state.id] = bodyContent + fabHtml;
    // Store nav separately
    if (screen?.nav === "none") {
      stateNavMapObj[state.id] = `<div class="nav-footer">no nav — immersive</div>`;
    } else if (screen?.nav && screen.nav !== "") {
      stateNavMapObj[state.id] = `<div class="nav-bar"><span>Artifacts</span><span>Write</span><span>Settings</span></div>`;
    } else {
      stateNavMapObj[state.id] = "";
    }
  }
  const stateHtmlMapData = JSON.stringify(stateHtmlMapObj);
  const stateNavMapData = JSON.stringify(stateNavMapObj);

  // Known container entity IDs that should not be rendered as screen cards
  const containerEntityIds = new Set(["screens", "states", "transitions", "components", "cujs", "invariants", "constraints", "foundations", "wisdom"]);

  // Filter screens to exclude container entities
  // Also exclude screen_* entities that match container names (e.g., screen_states)
  const filteredScreens = screens.filter(screen => {
    if (containerEntityIds.has(screen.id)) return false;
    // Check if screen.id is screen_<container_name>
    if (screen.id.startsWith("screen_")) {
      const suffix = screen.id.slice(7); // Remove "screen_" prefix
      if (containerEntityIds.has(suffix)) return false;
    }
    return true;
  });

  // Helper function to compute DAG layout for a subset of states
  function computeDAGLayout(
    stateSubset: ScreenState[],
    transitionSubset: GraphTransition[]
  ): Map<string, {x: number, y: number}> {
    const outEdges = new Map<string, string[]>();
    const inDegree = new Map<string, number>();
    const stateIdSet = new Set(stateSubset.map(s => s.id));

    for (const state of stateSubset) {
      outEdges.set(state.id, []);
      inDegree.set(state.id, 0);
    }

    for (const t of transitionSubset) {
      if (stateIdSet.has(t.from) && stateIdSet.has(t.to) && t.from !== t.to) {
        outEdges.get(t.from)!.push(t.to);
        inDegree.set(t.to, (inDegree.get(t.to) || 0) + 1);
      }
    }

    const layer = new Map<string, number>();
    const roots = stateSubset.filter(s => (inDegree.get(s.id) || 0) === 0).map(s => s.id);
    const externalState = stateSubset.find(s => s.id === 'st_external');
    if (externalState && !roots.includes(externalState.id)) {
      roots.unshift(externalState.id);
    }
    if (roots.length === 0 && stateSubset.length > 0) {
      roots.push(stateSubset[0].id);
    }

    const queue: string[] = [];
    for (const root of roots) {
      layer.set(root, 0);
      queue.push(root);
    }

    while (queue.length > 0) {
      const id = queue.shift()!;
      const depth = layer.get(id) || 0;
      for (const next of (outEdges.get(id) || [])) {
        if (!layer.has(next)) {
          layer.set(next, depth + 1);
          queue.push(next);
        }
      }
    }

    for (const state of stateSubset) {
      if (!layer.has(state.id)) {
        layer.set(state.id, 0);
      }
    }

    const layerGroups = new Map<number, string[]>();
    for (const state of stateSubset) {
      const l = layer.get(state.id) || 0;
      if (!layerGroups.has(l)) layerGroups.set(l, []);
      layerGroups.get(l)!.push(state.id);
    }

    const nodePositions = new Map<string, {x: number, y: number}>();
    const layerSpacing = 320;
    const nodeSpacing = 560;

    // Separate nodes into rows based on patterns
    // Row 0 (top): main states
    // Row 1 (bottom): editing/focused/invalid/updated states (transient states)
    const isTransientState = (id: string) => {
      return id.includes('_focused') ||
             id.includes('_editing') ||
             id.includes('_invalid') ||
             id.includes('_updated') ||
             id.includes('_typing');
    };

    // Group by layer, then by row within layer
    for (const [l, nodes] of layerGroups) {
      const x = 80 + l * layerSpacing;
      const mainNodes = nodes.filter(id => !isTransientState(id));
      const transientNodes = nodes.filter(id => isTransientState(id));

      // Position main nodes first (top row)
      mainNodes.forEach((nodeId, idx) => {
        nodePositions.set(nodeId, { x, y: 80 + idx * nodeSpacing });
      });

      // Position transient nodes on second row
      const row2Y = 80 + nodeSpacing; // Second row baseline
      transientNodes.forEach((nodeId, idx) => {
        nodePositions.set(nodeId, { x, y: row2Y + idx * nodeSpacing });
      });
    }

    return nodePositions;
  }

  // Helper function to render a state node
  function renderStateNode(state: ScreenState, x: number, y: number): string {
    const screen = filteredScreens.find(s => s.id === state.screen);
    const screenName = screen?.name || state.screen;
    // Use pre-rendered body content from stateHtmlMapObj
    const bodyContent = stateHtmlMapObj[state.id] || `<div style="text-align:center;padding:40px 0;color:var(--hint);font-size:12px;">${state.id}</div>`;
    const navContent = stateNavMapObj[state.id] || "";

    return `
    <div class="graph-node" id="graph-node-${state.id}" style="left:${x}px;top:${y}px;">
      <div class="s-tag">${state.id}</div>
      <div class="s-head"><span>${screenName}</span></div>
      <div class="s-body">${bodyContent}</div>
      ${navContent}
    </div>`;
  }

  // Generate screen HTML for map view - depends on whether we have graph entities
  let screenHtml: string;

  if (hasGraphEntities && cujGraphs.length > 0) {
    // Graph mode: generate separate canvas for each CUJ
    const cujMapsHtml: string[] = [];

    for (const cujGraph of cujGraphs) {
      const cujStates = screenStates.filter(s => cujGraph.stateIds.has(s.id));
      const cujTransitions = transitions.filter(t => cujGraph.transitionIds.has(t.id));
      const positions = computeDAGLayout(cujStates, cujTransitions);

      const nodesHtml = cujStates.map(state => {
        const pos = positions.get(state.id) || { x: 80, y: 80 };
        return renderStateNode(state, pos.x, pos.y);
      }).join("\n");

      cujMapsHtml.push(`
        <div class="cuj-map" id="cuj-map-${cujGraph.cujId}" style="display:none;">
          <svg class="cuj-map-arrows" id="arrows-${cujGraph.cujId}" style="position:absolute;inset:0;width:100%;height:100%;z-index:10;overflow:visible;pointer-events:none;"></svg>
          ${nodesHtml}
        </div>`);
    }

    screenHtml = cujMapsHtml.join("\n");
  } else if (screenStates.length > 0) {
    // Fallback: single map with all states (legacy behavior)
    const positions = computeDAGLayout(screenStates, transitions);
    screenHtml = screenStates
      .map((state) => {
        const pos = positions.get(state.id) || { x: 80, y: 80 };
        return renderStateNode(state, pos.x, pos.y);
      })
      .join("\n");
  } else {
    // Legacy mode: render screen_* entities as cards
    screenHtml = filteredScreens
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
  }

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

html, body { height: 100%; margin: 0; }
body { font-family: var(--sans); background: var(--bg); color: var(--fg); }

/* APP LAYOUT */
.app { display:flex; height:100vh; }

/* SHARED SIDEBAR */
.sidebar { width:220px; border-right:1px solid var(--bd); padding:12px; overflow-y:auto; height:100%; background:var(--bg); z-index:25; flex-shrink:0; }
.area-label { font-size:9px; font-family:monospace; color:var(--hint); text-transform:uppercase; letter-spacing:1px; margin-top:12px; margin-bottom:4px; }
.area-label:first-child { margin-top:0; }
.cuj-group { margin-bottom:8px; }
.cuj-name { font-size:11px; font-weight:600; color:var(--fg); margin-bottom:4px; padding:4px 6px; border-radius:4px; cursor:pointer; }
.cuj-name:hover { background:var(--bd); }
.cuj-name.selected { background:var(--accent); color:#fff; }
.scenario-item { font-size:10px; color:var(--mt); padding:4px 6px 4px 16px; border-radius:4px; cursor:pointer; transition:all 0.15s; margin-bottom:2px; }
.scenario-item:hover { background:var(--bd); color:var(--fg); }
.scenario-item.current { background:var(--accent); color:#fff; }

/* RESIZE HANDLE */
.resize-handle { width:4px; background:var(--bd); cursor:col-resize; flex-shrink:0; transition:background 0.15s; }
.resize-handle:hover { background:var(--accent); }

/* CANVAS PANEL */
.canvas-panel { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.canvas-toolbar { height:40px; display:flex; align-items:center; gap:8px; padding:0 12px; border-bottom:1px solid var(--bd); background:var(--bg); }
.canvas-toolbar .mode-btns { display:flex; gap:2px; }
.mode-btn { padding:4px 14px; border:1px solid var(--bd); border-radius:6px; background:none; color:var(--mt); cursor:pointer; font-family:monospace; font-size:11px; }
.mode-btn.active { background:var(--fg); color:var(--bg); border-color:var(--fg); }
.canvas-toolbar .spacer { flex:1; }
.canvas-toolbar .zoom-btns { display:flex; gap:2px; }
.canvas-toolbar .zoom-btns button { width:28px; height:28px; border:1px solid var(--bd); border-radius:4px; background:var(--bg); color:var(--fg); font-size:14px; cursor:pointer; display:flex; align-items:center; justify-content:center; font-family:monospace; }
.canvas-toolbar .zoom-btns button:hover { background:var(--bd); }
.canvas-toolbar .zoom-label { font-size:10px; font-family:monospace; color:var(--hint); padding:0 8px; }
.debug-toggle { width:28px; height:28px; border:1px solid var(--bd); border-radius:4px; background:var(--bg); color:var(--hint); font-size:14px; cursor:pointer; display:flex; align-items:center; justify-content:center; margin-left:8px; }
.debug-toggle:hover { background:var(--bd); }
.debug-toggle.active { background:var(--accent); color:#fff; border-color:var(--accent); }

/* MAP CANVAS */
#map-canvas { flex:1; position:relative; overflow:hidden; display:flex; }
#map-canvas.hidden { display:none; }
.pan-layer { position:absolute; width:4000px; height:3000px; transform-origin:0 0; background-image:radial-gradient(circle,var(--bd) 1px,transparent 1px); background-size:var(--grid) var(--grid); }
.screen { position:absolute; width:220px; min-height:476px; background:var(--bg); border:1px solid var(--bd); border-radius:10px; overflow:visible; font-family:var(--sans); font-size:11px; color:var(--fg); box-shadow:0 2px 10px rgba(0,0,0,0.08); cursor:grab; user-select:none; z-index:3; display:flex; flex-direction:column; transition:box-shadow 0.15s, opacity 0.2s; }
.screen.dimmed { opacity:0.2; }
@media(prefers-color-scheme:dark){ .screen { box-shadow:0 2px 12px rgba(0,0,0,0.5); } }
.screen.dragging { z-index:10; cursor:grabbing; box-shadow:0 6px 24px rgba(0,0,0,0.18); transition:none; }
.screen.highlighted { box-shadow:0 0 0 3px var(--accent), 0 6px 24px rgba(0,0,0,0.18); z-index:15; }
.s-head { padding:5px 10px; border-bottom:1px solid var(--bd); display:flex; justify-content:space-between; font-size:10px; color:var(--mt); font-family:monospace; border-radius:10px 10px 0 0; }
.s-body { padding:8px 10px; flex:1; font-family:var(--serif); }
.s-tag { position:absolute; top:-20px; left:0; font-size:9px; font-family:monospace; color:var(--accent); white-space:nowrap; pointer-events:none; display:none; }

.comp-box { padding:4px 0; margin-bottom:2px; position:relative; }
.comp-label { font-size:8px; font-family:monospace; color:var(--accent); opacity:0.5; margin-bottom:2px; display:none; }

/* DEBUG MODE */
.app.debug-mode .s-tag { display:block; }
.app.debug-mode .comp-label { display:block; }
.app.debug-mode .comp-box { border:1px dashed var(--accent); border-radius:4px; padding:4px; opacity:0.85; }
.app.debug-mode .screen::after,
.app.debug-mode .storyboard-card::after,
.app.debug-mode .walk-screen::after { content:''; position:absolute; inset:0; background:rgba(0,0,0,0.12); border-radius:inherit; pointer-events:none; }
@media(prefers-color-scheme:dark){ .app.debug-mode .screen::after, .app.debug-mode .storyboard-card::after, .app.debug-mode .walk-screen::after { background:rgba(255,255,255,0.08); } }
.comp-desc { font-size:10px; color:var(--hint); }
.nav-bar { display:flex; justify-content:space-around; padding:8px; border-top:1px solid var(--bd); font-size:9px; color:var(--mt); }
.nav-footer { padding:6px 10px; border-top:1px solid var(--bd); font-size:9px; color:var(--hint); text-align:center; font-style:italic; }

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
.storyboard-card.highlighted { box-shadow:0 0 0 3px var(--accent), 0 6px 24px rgba(0,0,0,0.18); z-index:15; }

/* WALK CANVAS */
#walk-canvas { flex:1; display:none; }
#walk-canvas.active { display:flex; }
.walk-content { display:flex; flex:1; }
.walk-resize-handle { width:4px; background:var(--bd); cursor:col-resize; flex-shrink:0; transition:background 0.15s; }
.walk-resize-handle:hover { background:var(--accent); }
.walk-screen-wrap { flex:1; display:flex; align-items:center; justify-content:center; padding:24px; background:var(--bd); position:relative; }
.walk-screen { width:220px; min-height:476px; background:var(--bg); border:1px solid var(--bd); border-radius:10px; overflow:visible; font-family:var(--sans); font-size:11px; color:var(--fg); box-shadow:0 2px 10px rgba(0,0,0,0.08); display:flex; flex-direction:column; transition:opacity 0.2s,transform 0.2s; }
.walk-screen.transitioning { opacity:0; transform:translateX(24px); }
.ws-head { padding:5px 10px; border-bottom:1px solid var(--bd); display:flex; justify-content:space-between; font-size:10px; color:var(--mt); font-family:monospace; border-radius:10px 10px 0 0; }
.ws-body { padding:8px 10px; flex:1; font-family:var(--serif); }

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

/* GRAPH VIEW */
.graph-node { position:absolute; width:220px; min-height:476px; background:var(--bg); border:1px solid var(--bd); border-radius:10px; overflow:visible; font-family:var(--sans); font-size:11px; color:var(--fg); box-shadow:0 2px 10px rgba(0,0,0,0.08); z-index:3; display:flex; flex-direction:column; transition:box-shadow 0.15s, opacity 0.2s; cursor:grab; user-select:none; }
.graph-node.dimmed { opacity:0.2; }
.graph-node.highlighted { box-shadow:0 0 0 3px var(--accent), 0 6px 24px rgba(0,0,0,0.18); z-index:15; opacity:1; }
.graph-node.edge-hover { box-shadow:0 0 0 3px #fff, 0 6px 24px rgba(0,0,0,0.25); z-index:16; }
.edge-line.edge-hover, .edge-line.arrow-highlighted.edge-hover { stroke:#fff !important; stroke-width:3.5 !important; filter:drop-shadow(0 0 4px rgba(255,255,255,0.5)); }
.graph-node.dragging { z-index:20; cursor:grabbing; box-shadow:0 6px 24px rgba(0,0,0,0.18); transition:none; }
@media(prefers-color-scheme:dark){ .graph-node { box-shadow:0 2px 12px rgba(0,0,0,0.5); } }

/* CUJ MAPS */
.cuj-map { position:absolute; top:0; left:0; width:100%; height:100%; }
</style>
</head>
<body>

<div class="app">
  <!-- SHARED SIDEBAR -->
  <div class="sidebar" id="sidebar"></div>
  <div class="resize-handle" id="resize-handle"></div>

  <!-- CANVAS PANEL -->
  <div class="canvas-panel">
    <div class="canvas-toolbar">
      <div class="mode-btns">
        <button class="mode-btn active" id="mode-map" onclick="setMode('map')">Map</button>
        <button class="mode-btn" id="mode-walk" onclick="setMode('walk')">Walkthrough</button>
      </div>
      <span class="spacer"></span>
      <div class="zoom-btns" id="zoom-btns">
        <button id="zoom-out">-</button>
        <button id="zoom-in">+</button>
        <button id="zoom-fit">◻</button>
        <button id="zoom-reset">1:1</button>
      </div>
      <span class="zoom-label" id="zoom-label">100%</span>
      <button class="debug-toggle" id="debug-toggle" onclick="toggleDebug()" title="Toggle IDs">◉</button>
    </div>

    <!-- MAP CANVAS -->
    <div id="map-canvas">
      <div class="pan-layer" id="pan-layer">
        <svg id="arrows" style="position:absolute;inset:0;width:100%;height:100%;z-index:10;overflow:visible;pointer-events:none;"></svg>
        ${hasGraphEntities && cujGraphs.length > 0 ? screenHtml : `<div class="default-screens" id="default-screens">${screenHtml}</div>`}
        <div class="storyboard-container" id="storyboard-container"></div>
      </div>
    </div>

    <!-- WALK CANVAS -->
    <div id="walk-canvas">
      <div class="walk-content">
        <div class="walk-resize-handle" id="walk-resize-left"></div>
        <div class="walk-screen-wrap"><div class="walk-screen" id="walk-screen"></div></div>
        <div class="walk-resize-handle" id="walk-resize-right"></div>
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
  </div>
</div>

<script>
const cujs = ${cujsData};
const screens = ${screensData};
const transitions = ${transitionsData};
const screenHtmlMap = ${screenHtmlMapData};
const variantHtmlMap = ${variantHtmlMapData};
const screenStates = ${screenStatesData};
const stateHtmlMap = ${stateHtmlMapData};
const stateNavMap = ${stateNavMapData};
const hasGraphEntities = ${hasGraphEntities};
const cujGraphs = ${cujGraphsData};
const hasSeparateCujMaps = hasGraphEntities && cujGraphs.length > 0;

let currentMode='map';
let highlightedScenarioId=null;
let selectedMapCuj=null;
let activeCujSvg=null;
let highlightedStoryboardIdx=null;
let curCuj=null,curStep=0;
let walkSteps=[];  // For graph mode: stores steps with state, fromState, transition info
let currentScenarioIdx=0;  // Track which scenario is selected in walkthrough

/* SCREEN NAME HELPER - looks up screen name from ID */
function getScreenName(screenId){
  const screen=screens.find(s=>s.id===screenId||s.id==='screen_'+screenId);
  return screen?screen.name:(screenId||'default');
}

/* SCREEN HTML CACHE - caches rendered HTML strings */
const screenHtmlCache={};
function getScreenKey(screenId,scenario){
  // Build key from screen + component variants
  const variants=Object.keys(scenario).filter(k=>k.startsWith('comp_')).sort().map(k=>k+'='+scenario[k]).join('|');
  return screenId+'::'+variants;
}
function getScreenHtml(screenId,scenario){
  const key=getScreenKey(screenId,scenario);
  if(!screenHtmlCache[key]){
    screenHtmlCache[key]=renderScreenForStep(screenId,scenario);
  }
  return screenHtmlCache[key];
}

/* MODE */
function setMode(m){
  currentMode=m;
  document.getElementById('mode-map').classList.toggle('active',m==='map');
  document.getElementById('mode-walk').classList.toggle('active',m==='walk');
  document.getElementById('map-canvas').classList.toggle('hidden',m!=='map');
  document.getElementById('map-canvas').style.display=m==='map'?'flex':'none';
  document.getElementById('walk-canvas').classList.toggle('active',m==='walk');
  document.getElementById('zoom-btns').style.display=m==='map'?'flex':'none';
  document.getElementById('zoom-label').style.display=m==='map'?'inline':'none';
  if(m==='walk'){
    // Sync currentScenarioIdx with curStep (scenario index from map mode)
    currentScenarioIdx=curStep;
    // Compute walkSteps for graph mode with paths
    if(curCuj&&hasGraphEntities){
      const c=cujs[curCuj];
      const sc=c&&c.scenarios&&c.scenarios[currentScenarioIdx];
      if(sc&&sc.path){
        walkSteps=computeWalkSteps(sc.path);
        curStep=0; // Reset walk step position within this scenario
      }
    }
    renderStep();
  }
  if(m==='map'){
    // Sync curStep with currentScenarioIdx (scenario index from walk mode)
    curStep=currentScenarioIdx;
    if(hasSeparateCujMaps&&selectedMapCuj){
      // Show the previously selected CUJ's map and highlight the current scenario
      showCujMap(selectedMapCuj);
      const cuj=cujs[selectedMapCuj];
      const scenario=cuj&&cuj.scenarios&&cuj.scenarios[curStep];
      if(scenario&&scenario.path){
        highlightGraphPathInCuj(selectedMapCuj,scenario);
        const pathIds=scenario.path.split(',').map(s=>s.trim());
        drawCujArrows(selectedMapCuj,pathIds);
      }else{
        requestAnimationFrame(()=>redrawArrows());
      }
    }else if(hasSeparateCujMaps){
      // No CUJ selected, show first CUJ by default
      const firstCujId=Object.keys(cujs)[0];
      if(firstCujId)selectCuj(firstCujId);
    }else{
      requestAnimationFrame(()=>requestAnimationFrame(drawArrows));
    }
  }
  // Update sidebar highlight based on current selection
  updateSidebarHighlight();
}

/* Compute walk steps from path - each step has state, fromState, transition info */
function computeWalkSteps(path){
  const pathIds=path.split(',').map(s=>s.trim());
  const steps=[];
  for(const trId of pathIds){
    const tr=transitions.find(t=>t.id===trId);
    if(tr){
      // Add starting state if this is the first transition
      if(steps.length===0){
        steps.push({state:tr.from,fromState:null,transition:null,transitionAction:null});
      }
      // Add the destination state with transition info
      steps.push({state:tr.to,fromState:tr.from,transition:trId,transitionAction:tr.action});
    }
  }
  return steps;
}

/* Legacy: compute unique states from path (for backwards compat) */
function computeWalkStates(path){
  return computeWalkSteps(path).map(s=>s.state);
}

/* DEBUG MODE */
function toggleDebug(){
  const app=document.querySelector('.app');
  const btn=document.getElementById('debug-toggle');
  app.classList.toggle('debug-mode');
  btn.classList.toggle('active');
}

/* SHARED SIDEBAR */
function initSidebar(){
  const sidebar=document.getElementById('sidebar');
  const areas={};
  Object.entries(cujs).forEach(([id,c])=>{
    const area=c.area||'default';
    if(!areas[area])areas[area]=[];
    areas[area].push({id,cuj:c});
  });
  let html=hasSeparateCujMaps?'':'<div class="cuj-group"><div class="cuj-name" style="color:var(--accent);" onclick="showDefaultScreens()">All Screens</div></div>';
  Object.entries(areas).forEach(([area,cujList])=>{
    html+=\`<div class="area-label">\${area}</div>\`;
    cujList.forEach(({id,cuj})=>{
      html+=\`<div class="cuj-group" data-cuj="\${id}"><div class="cuj-name" onclick="selectCuj('\${id}')">\${cuj.name}</div>\`;
      cuj.scenarios.forEach((sc,i)=>{
        html+=\`<div class="scenario-item" data-cuj="\${id}" data-step="\${i}" data-scenario="\${sc.id}" data-screen="\${sc.screen}" onclick="selectScenario('\${id}',\${i},'\${sc.id}','\${sc.screen}')">\${sc.name}</div>\`;
      });
      html+=\`</div>\`;
    });
  });
  sidebar.innerHTML=html;
}

/* CUJ MAP SWITCHING */
function showCujMap(cujId){
  if(!hasSeparateCujMaps)return;
  // Hide all CUJ maps
  document.querySelectorAll('.cuj-map').forEach(el=>{el.style.display='none';});
  // Show the selected CUJ map
  const mapEl=document.getElementById('cuj-map-'+cujId);
  if(mapEl){
    mapEl.style.display='block';
    activeCujSvg=document.getElementById('arrows-'+cujId);
    // Make nodes draggable within this map
    initCujMapDrag(cujId);
  }
}

function hideCujMaps(){
  if(!hasSeparateCujMaps)return;
  document.querySelectorAll('.cuj-map').forEach(el=>{el.style.display='none';});
  activeCujSvg=null;
}

function initCujMapDrag(cujId){
  const mapEl=document.getElementById('cuj-map-'+cujId);
  if(!mapEl)return;
  mapEl.querySelectorAll('.graph-node').forEach(el=>{
    // Remove any existing handlers
    el.onmousedown=null;
    el.addEventListener('mousedown',e=>{
      dragNode=el;
      dragOff={x:e.clientX/zoom-(parseInt(el.style.left)||0),y:e.clientY/zoom-(parseInt(el.style.top)||0)};
      el.classList.add('dragging');
      e.preventDefault();
      e.stopPropagation();
    });
  });
}

function drawCujArrows(cujId,pathIds){
  if(!hasSeparateCujMaps)return;
  const svgEl=document.getElementById('arrows-'+cujId);
  if(!svgEl)return;
  const mapEl=document.getElementById('cuj-map-'+cujId);
  if(!mapEl)return;
  const cujGraph=cujGraphs.find(g=>g.cujId===cujId);
  if(!cujGraph)return;
  const cujTransitions=transitions.filter(t=>cujGraph.transitionIds.includes(t.id));

  // Collect all node positions as obstacles
  const obstacles=[];
  mapEl.querySelectorAll('.graph-node').forEach(el=>{
    obstacles.push({el,x:parseInt(el.style.left)||0,y:parseInt(el.style.top)||0});
  });

  // Assign ports to edges - track outgoing/incoming edge counts per node
  const outPorts=new Map(); // node -> next outgoing port index
  const inPorts=new Map();  // node -> next incoming port index

  let s='';
  const pathSet=pathIds?new Set(pathIds):null;
  for(const t of cujTransitions){
    const fromEl=mapEl.querySelector('#graph-node-'+t.from);
    const toEl=mapEl.querySelector('#graph-node-'+t.to);
    if(fromEl&&toEl){
      const isInPath=pathSet?pathSet.has(t.id):true;
      const color=isInPath?'var(--accent)':'var(--hint)';
      const opacity=isInPath?1:0.15;

      // Get port indices for this edge
      const outPort=outPorts.get(t.from)||0;
      const inPort=inPorts.get(t.to)||0;
      outPorts.set(t.from,(outPort+1));
      inPorts.set(t.to,(inPort+1));

      s+=drawEdgeWithPorts(fromEl,toEl,outPort,inPort,isInPath?t.action:null,color,isInPath,opacity,obstacles);
    }
  }
  svgEl.innerHTML=s;
}

function selectScenario(cujId,stepIdx,scenarioId,screenId){
  curCuj=cujId;
  curStep=stepIdx;
  currentScenarioIdx=stepIdx; // Keep both in sync
  highlightedScenarioId=scenarioId;

  if(currentMode==='map'){
    // Map mode: highlight screen or storyboard card
    document.querySelectorAll('.screen.highlighted').forEach(el=>el.classList.remove('highlighted'));
    document.querySelectorAll('.storyboard-card.highlighted').forEach(el=>el.classList.remove('highlighted'));
    document.querySelectorAll('.graph-node.highlighted').forEach(el=>el.classList.remove('highlighted'));
    document.querySelectorAll('.graph-node.dimmed').forEach(el=>el.classList.remove('dimmed'));

    const cuj=cujs[cujId];
    const scenario=cuj&&cuj.scenarios[stepIdx];

    // Separate CUJ maps mode: show this CUJ's map, highlight path
    if(hasSeparateCujMaps&&scenario&&scenario.path){
      selectedMapCuj=cujId;
      showCujMap(cujId);
      document.getElementById('storyboard-container').classList.remove('active');
      // Highlight path nodes within this CUJ's map
      highlightGraphPathInCuj(cujId,scenario);
      // Draw arrows for this CUJ with path highlighting
      const pathIds=scenario.path.split(',').map(s=>s.trim());
      drawCujArrows(cujId,pathIds);
      // Center the map
      requestAnimationFrame(()=>document.getElementById('zoom-fit').click());
    }else if(hasGraphEntities&&scenario&&scenario.path){
      // Single map mode (legacy fallback)
      selectedMapCuj=cujId;
      document.getElementById('default-screens').classList.remove('hidden');
      document.getElementById('storyboard-container').classList.remove('active');
      highlightGraphPath(scenario);
      drawArrowsWithPath(scenario);
    }else{
      // Legacy mode: render storyboard
      if(selectedMapCuj&&selectedMapCuj===cujId){
        highlightStoryboardCard(stepIdx);
      }else{
        selectedMapCuj=cujId;
        renderStoryboard(cujId);
        highlightStoryboardCard(stepIdx);
      }
    }
  }else{
    // Walkthrough mode: update walkthrough view
    currentScenarioIdx=stepIdx;
    // Compute walkSteps for graph mode with paths
    if(hasGraphEntities){
      const cuj=cujs[cujId];
      const scenario=cuj&&cuj.scenarios[stepIdx];
      if(scenario&&scenario.path){
        walkSteps=computeWalkSteps(scenario.path);
        curStep=0;  // Reset to first step in path
      }
    }
    renderStep();
  }
  updateSidebarHighlight();
}

function selectCuj(cujId){
  curCuj=cujId;
  curStep=0;

  if(currentMode==='map'){
    selectedMapCuj=cujId;
    highlightedScenarioId=null;
    const cuj=cujs[cujId];
    const scenario=cuj&&cuj.scenarios[0];

    // Separate CUJ maps mode: show this CUJ's map
    if(hasSeparateCujMaps){
      showCujMap(cujId);
      document.getElementById('storyboard-container').classList.remove('active');
      // Show all nodes (no dimming), draw all arrows
      clearGraphHighlightsInCuj(cujId);
      drawCujArrows(cujId,null);
      // Center the map
      requestAnimationFrame(()=>document.getElementById('zoom-fit').click());
    }else if(hasGraphEntities&&scenario&&scenario.path){
      // Single map mode (legacy fallback)
      document.getElementById('default-screens').classList.remove('hidden');
      document.getElementById('storyboard-container').classList.remove('active');
      highlightGraphPath(scenario);
      drawArrowsWithPath(scenario);
    }else{
      // Legacy mode: render storyboard
      renderStoryboard(cujId);
    }
  }else{
    // Walkthrough mode: delegate to first scenario
    const cuj=cujs[cujId];
    if(cuj&&cuj.scenarios.length>0){
      const firstSc=cuj.scenarios[0];
      selectScenario(cujId,0,firstSc.id,firstSc.screen);
      return;
    }
  }
  updateSidebarHighlight();
}

function updateSidebarHighlight(){
  // Clear all highlights
  document.querySelectorAll('.sidebar .cuj-name.selected').forEach(el=>el.classList.remove('selected'));
  document.querySelectorAll('.sidebar .scenario-item.current').forEach(el=>el.classList.remove('current'));

  // Highlight current CUJ if in storyboard mode
  if(currentMode==='map'&&selectedMapCuj){
    document.querySelectorAll('.sidebar .cuj-group[data-cuj="'+selectedMapCuj+'"] .cuj-name').forEach(el=>el.classList.add('selected'));
  }

  // Highlight current scenario
  // In walkthrough mode with graph entities, use currentScenarioIdx (scenario index)
  // Otherwise use curStep (which is the scenario index in legacy mode)
  const scenarioIdx=(currentMode==='walk'&&hasGraphEntities)?currentScenarioIdx:curStep;
  if(curCuj&&scenarioIdx!==null){
    document.querySelectorAll('.sidebar .scenario-item[data-cuj="'+curCuj+'"][data-step="'+scenarioIdx+'"]').forEach(el=>el.classList.add('current'));
  }
}

function showDefaultScreens(){
  selectedMapCuj=null;
  highlightedScenarioId=null;
  curCuj=null;
  curStep=0;
  // Hide storyboard, show default screens
  document.getElementById('storyboard-container').classList.remove('active');
  document.getElementById('storyboard-container').innerHTML='';

  if(hasSeparateCujMaps){
    // Hide all CUJ maps - user needs to select a CUJ
    hideCujMaps();
  }else{
    document.getElementById('default-screens').classList.remove('hidden');
  }

  // Remove all highlighted states
  document.querySelectorAll('.screen.highlighted').forEach(el=>el.classList.remove('highlighted'));
  clearGraphHighlights();
  updateSidebarHighlight();
  if(!hasSeparateCujMaps)drawArrows();
}

/* STATE KEY - builds unique key from screen + component variants */
function getStateKey(scenario){
  const variants=Object.keys(scenario).filter(k=>k.startsWith('comp_')).sort().map(k=>k+'='+scenario[k]).join('|');
  return scenario.screen+'::'+variants;
}

let stateCards=[];  // Array of {stateKey, screenId, scenario, scenarios, cardIdx}
let scenarioToCard={};  // Map scenario index to card index

function renderStoryboard(cujId){
  const cuj=cujs[cujId];
  if(!cuj)return;

  // If graph mode and first scenario has path, delegate to path-based rendering
  if(hasGraphEntities&&cuj.scenarios[0]&&cuj.scenarios[0].path){
    renderPathStoryboard(cujId,0);
    return;
  }

  // Hide default screens, show storyboard
  document.getElementById('default-screens').classList.add('hidden');
  const container=document.getElementById('storyboard-container');
  container.classList.add('active');
  container.innerHTML='';

  // Group scenarios by state key (deduplicate)
  stateCards=[];
  scenarioToCard={};
  const seenKeys={};
  cuj.scenarios.forEach((sc,i)=>{
    const key=getStateKey(sc);
    if(!seenKeys[key]){
      seenKeys[key]={stateKey:key,screenId:sc.screen,scenario:sc,scenarios:[sc],cardIdx:stateCards.length};
      stateCards.push(seenKeys[key]);
    }else{
      seenKeys[key].scenarios.push(sc);
    }
    scenarioToCard[i]=seenKeys[key].cardIdx;
  });

  // Generate one card per unique state
  let xPos=80;
  stateCards.forEach((card,cardIdx)=>{
    const screenId=card.screenId;
    const el=document.createElement('div');
    el.className='storyboard-card';
    el.id='storyboard-'+cardIdx;
    el.style.left=xPos+'px';
    el.style.top='80px';
    // Show all scenario names that map to this card
    const names=card.scenarios.map(s=>s.name).join('<br>');
    const navHtml=getNavHtml(screenId);
    el.innerHTML=\`<div class="s-head"><span>\${getScreenName(screenId)}</span></div><div class="s-body"></div>\${navHtml}<div class="storyboard-label"><span class="scenario-name">\${names}</span><span class="screen-id">\${card.screenId||'default'}</span></div>\`;
    el.querySelector('.s-body').innerHTML=getScreenHtml(screenId,card.scenario);
    container.appendChild(el);
    xPos+=300;
  });
  highlightedStoryboardIdx=null;
  drawStoryboardArrows(stateCards,highlightedStoryboardIdx);
}

function highlightStoryboardCard(scenarioIdx){
  // Map scenario index to card index
  const cardIdx=scenarioToCard[scenarioIdx];
  highlightedStoryboardIdx=cardIdx;
  // Clear previous storyboard highlights
  document.querySelectorAll('.storyboard-card.highlighted').forEach(el=>el.classList.remove('highlighted'));
  // Highlight the card at this card index
  const cardEl=document.getElementById('storyboard-'+cardIdx);
  if(cardEl){
    cardEl.classList.add('highlighted');
    panToCard(cardEl);
  }
  // Redraw arrows with highlight
  drawStoryboardArrows(stateCards,highlightedStoryboardIdx);
}

function panToCard(el){
  const mapCanvas=document.getElementById('map-canvas');
  const vw=mapCanvas.clientWidth;
  const vh=mapCanvas.clientHeight;
  const cardX=parseInt(el.style.left)||0;
  const cardY=parseInt(el.style.top)||0;
  const cardW=220;
  const cardH=el.offsetHeight||476;
  // Center the card in the viewport
  panX=(vw/2)-(cardX+cardW/2)*zoom;
  panY=(vh/2)-(cardY+cardH/2)*zoom;
  applyTransform();
}

/* WALKTHROUGH */
function walkStep(d){
  const c=cujs[curCuj];
  const scenario=c.scenarios[currentScenarioIdx];
  // In graph mode with path, step through walkSteps
  const total=hasGraphEntities&&scenario&&scenario.path?walkSteps.length:c.scenarios.length;
  const n=curStep+d;
  if(n<0||n>=total)return;
  curStep=n;
  renderStep();
  updateSidebarHighlight();
}
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
  return html;
}
function getNavHtml(screenId){
  const screenData=screens.find(s=>s.id===screenId);
  if(!screenData)return '';
  if(screenData.nav==='none'){
    return '<div class="nav-footer">no nav — immersive</div>';
  }else if(screenData.nav){
    return '<div class="nav-bar"><span>Artifacts</span><span>Write</span><span>Settings</span></div>';
  }
  return '';
}
function renderStep(){
  const c=cujs[curCuj],sc=c.scenarios[currentScenarioIdx];
  const w=document.getElementById('walk-screen');

  // Graph mode with path: step through states
  if(hasGraphEntities&&sc&&sc.path){
    const tot=walkSteps.length;
    const step=walkSteps[curStep];
    if(!step)return;
    const st=screenStates.find(s=>s.id===step.state);
    if(st){
      // Use pre-rendered HTML from stateHtmlMap for consistency with map view
      const bodyHtml=stateHtmlMap[step.state]||'<div style="padding:20px;text-align:center;color:var(--hint);">'+step.state+'</div>';
      const navHtml=stateNavMap[step.state]||'';
      w.innerHTML=\`<div class="ws-head"><span>\${getScreenName(st.screen)}</span></div><div class="ws-body">\${bodyHtml}</div>\${navHtml}\`;
    }else{
      w.innerHTML=\`<div class="ws-head"><span>\${step.state}</span></div><div class="ws-body"><div style="padding:20px;text-align:center;color:var(--hint);">\${step.state}</div></div>\`;
    }
    document.getElementById('walk-progress').innerHTML=walkSteps.map((_,i)=>\`<div class="walk-dot \${i<curStep?'done':''} \${i===curStep?'current':''}"></div>\`).join('');
    document.getElementById('walk-step-counter').textContent=\`Step \${curStep+1} of \${tot}\`;
    document.getElementById('walk-scenario-name').textContent=sc.name;
    document.getElementById('walk-scenario-id').textContent=sc.id;
    // Show transition info: from_state → action → to_state
    let transitionHtml='';
    if(step.transition){
      transitionHtml=\`<div style="margin-bottom:12px;padding:8px;background:var(--bd);border-radius:6px;font-family:monospace;font-size:10px;">
        <div style="color:var(--hint);margin-bottom:4px;">\${step.fromState}</div>
        <div style="color:var(--accent);margin-bottom:4px;">↓ \${step.transitionAction}</div>
        <div style="color:var(--fg);font-weight:600;">\${step.state}</div>
      </div>\`;
    }else{
      transitionHtml=\`<div style="margin-bottom:12px;padding:8px;background:var(--bd);border-radius:6px;font-family:monospace;font-size:10px;">
        <div style="color:var(--fg);font-weight:600;">\${step.state}</div>
        <div style="color:var(--hint);font-size:9px;margin-top:4px;">Starting state</div>
      </div>\`;
    }
    document.getElementById('walk-gherkin').innerHTML=transitionHtml;
    const iv=document.getElementById('walk-invariants');iv.innerHTML=sc.invs&&sc.invs.length?\`<div class="walk-inv-title">Protected by</div>\`+sc.invs.map(i=>\`<div class="walk-inv-item">\${i}</div>\`).join(''):'';
    document.getElementById('walk-prev').disabled=curStep===0;document.getElementById('walk-next').disabled=curStep===tot-1;
    return;
  }

  // Non-graph mode: step through scenarios
  const legacySc=c.scenarios[curStep],tot=c.scenarios.length;
  const screenId=legacySc.screen;
  w.innerHTML=\`<div class="ws-head"><span>\${getScreenName(screenId)}</span></div><div class="ws-body"></div>\`;
  w.querySelector('.ws-body').innerHTML=getScreenHtml(screenId,legacySc);
  document.getElementById('walk-progress').innerHTML=c.scenarios.map((_,i)=>\`<div class="walk-dot \${i<curStep?'done':''} \${i===curStep?'current':''}"></div>\`).join('');
  document.getElementById('walk-step-counter').textContent=\`Step \${curStep+1} of \${tot}\`;
  document.getElementById('walk-scenario-name').textContent=legacySc.name;
  document.getElementById('walk-scenario-id').textContent=legacySc.id;
  document.getElementById('walk-gherkin').innerHTML=\`<div><span class="kw">Given </span>\${legacySc.given}</div><div><span class="kw">When </span>\${legacySc.when}</div><div><span class="kw">Then </span>\${legacySc.then}</div>\`;
  const iv=document.getElementById('walk-invariants');iv.innerHTML=legacySc.invs&&legacySc.invs.length?\`<div class="walk-inv-title">Protected by</div>\`+legacySc.invs.map(i=>\`<div class="walk-inv-item">\${i}</div>\`).join(''):'';
  document.getElementById('walk-prev').disabled=curStep===0;document.getElementById('walk-next').disabled=curStep===tot-1;
  // Highlight current scenario in sidebar
  document.querySelectorAll('.scenario-item').forEach(el=>{
    el.classList.toggle('current',el.dataset.cuj===curCuj&&parseInt(el.dataset.step)===curStep);
  });
}
document.addEventListener('keydown',e=>{
  // Walkthrough mode keyboard nav
  if(document.getElementById('walk-canvas').classList.contains('active')){
    if(e.key==='ArrowRight'||e.key===' '){e.preventDefault();walkStep(1);}
    if(e.key==='ArrowLeft'){e.preventDefault();walkStep(-1);}
    return;
  }
  // Map mode storyboard keyboard nav (navigates between unique state cards)
  if(currentMode==='map'&&selectedMapCuj&&stateCards.length>0){
    const len=stateCards.length;
    if(e.key==='ArrowRight'){
      e.preventDefault();
      // If no card highlighted yet, highlight first card
      if(highlightedStoryboardIdx===null){
        highlightedStoryboardIdx=0;
        curStep=0;  // First scenario of first card
        highlightStoryboardCard(0);
        updateSidebarHighlight();
      }else if(highlightedStoryboardIdx<len-1){
        // Move to next card
        const nextCardIdx=highlightedStoryboardIdx+1;
        // Find first scenario that maps to this card
        const firstScenarioIdx=Object.keys(scenarioToCard).find(k=>scenarioToCard[k]===nextCardIdx);
        curStep=parseInt(firstScenarioIdx)||0;
        highlightStoryboardCard(curStep);
        updateSidebarHighlight();
      }
    }
    if(e.key==='ArrowLeft'){
      e.preventDefault();
      if(highlightedStoryboardIdx!==null&&highlightedStoryboardIdx>0){
        // Move to previous card
        const prevCardIdx=highlightedStoryboardIdx-1;
        // Find first scenario that maps to this card
        const firstScenarioIdx=Object.keys(scenarioToCard).find(k=>scenarioToCard[k]===prevCardIdx);
        curStep=parseInt(firstScenarioIdx)||0;
        highlightStoryboardCard(curStep);
        updateSidebarHighlight();
      }
    }
  }
});

/* MAP: zoom/pan/drag */
const mapCanvas=document.getElementById('map-canvas'),panLayer=document.getElementById('pan-layer'),svg=document.getElementById('arrows'),GRID=20;
let zoom=0.5,panX=0,panY=0,isPanning=false,panStart={x:0,y:0};
function applyTransform(){panLayer.style.transform=\`translate(\${panX}px,\${panY}px) scale(\${zoom})\`;document.getElementById('zoom-label').textContent=Math.round(zoom*100)+'%';}
document.getElementById('zoom-in').onclick=()=>{zoom=Math.min(2,zoom+0.1);applyTransform();redrawArrows();};
document.getElementById('zoom-out').onclick=()=>{zoom=Math.max(0.15,zoom-0.1);applyTransform();redrawArrows();};
document.getElementById('zoom-reset').onclick=()=>{zoom=1;panX=0;panY=0;applyTransform();redrawArrows();};
document.getElementById('zoom-fit').onclick=()=>{
  // Find visible nodes (in active CUJ map or default screens)
  let ns;
  if(hasSeparateCujMaps&&selectedMapCuj){
    ns=document.querySelectorAll('#cuj-map-'+selectedMapCuj+' .graph-node');
  }else{
    ns=document.querySelectorAll('#pan-layer .screen,#pan-layer .graph-node');
  }
  if(ns.length===0)return;
  let x1=Infinity,y1=Infinity,x2=0,y2=0;
  ns.forEach(n=>{const l=parseInt(n.style.left),t=parseInt(n.style.top);x1=Math.min(x1,l);y1=Math.min(y1,t);x2=Math.max(x2,l+220);y2=Math.max(y2,t+n.offsetHeight);});
  const w=x2-x1+160,h=y2-y1+160,vw=mapCanvas.clientWidth,vh=mapCanvas.clientHeight;
  zoom=Math.min(vw/w,vh/h,1);panX=(vw-w*zoom)/2-x1*zoom+60;panY=(vh-h*zoom)/2-y1*zoom+60;
  applyTransform();redrawArrows();
};
mapCanvas.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(0.15,Math.min(2,zoom+(e.deltaY>0?-0.05:0.05)));applyTransform();redrawArrows();},{passive:false});
mapCanvas.addEventListener('mousedown',e=>{if(e.target.closest('.screen,.graph-node,.toolbar'))return;isPanning=true;panStart={x:e.clientX-panX,y:e.clientY-panY};mapCanvas.style.cursor='grabbing';e.preventDefault();});
window.addEventListener('mousemove',e=>{if(isPanning){panX=e.clientX-panStart.x;panY=e.clientY-panStart.y;applyTransform();redrawArrows();}});
window.addEventListener('mouseup',()=>{if(isPanning){isPanning=false;mapCanvas.style.cursor='default';}});

function snap(v){return Math.round(v/GRID)*GRID;}
let dragNode=null,dragOff={x:0,y:0};
document.querySelectorAll('#pan-layer .screen,#pan-layer .graph-node').forEach(el=>{el.addEventListener('mousedown',e=>{dragNode=el;dragOff={x:e.clientX/zoom-(parseInt(el.style.left)||0),y:e.clientY/zoom-(parseInt(el.style.top)||0)};el.classList.add('dragging');e.preventDefault();e.stopPropagation();});});
window.addEventListener('mousemove',e=>{if(!dragNode)return;dragNode.style.left=snap(e.clientX/zoom-dragOff.x)+'px';dragNode.style.top=snap(e.clientY/zoom-dragOff.y)+'px';redrawArrows();});
window.addEventListener('mouseup',()=>{if(dragNode){dragNode.classList.remove('dragging');dragNode=null;}});

// Edge hover handlers - highlight connected nodes and edge
document.addEventListener('mouseover',e=>{
  const target=e.target.closest('.edge-hover-target');
  if(target){
    const fromId=target.dataset.from;
    const toId=target.dataset.to;
    // Find the parent CUJ map to scope the node search (avoids finding nodes in hidden CUJs)
    const parentMap=target.closest('.cuj-map')||document;
    const fromEl=parentMap.querySelector('[id="graph-node-'+fromId+'"]');
    const toEl=parentMap.querySelector('[id="graph-node-'+toId+'"]');
    if(fromEl)fromEl.classList.add('edge-hover');
    if(toEl)toEl.classList.add('edge-hover');
    // Highlight the edge line (next sibling)
    const edgeLine=target.nextElementSibling;
    if(edgeLine&&edgeLine.classList.contains('edge-line')){
      edgeLine.classList.add('edge-hover');
    }
  }
});
document.addEventListener('mouseout',e=>{
  const target=e.target.closest('.edge-hover-target');
  if(target){
    document.querySelectorAll('.graph-node.edge-hover').forEach(el=>el.classList.remove('edge-hover'));
    document.querySelectorAll('.edge-line.edge-hover').forEach(el=>el.classList.remove('edge-hover'));
  }
});

function getAnchor(el,side){const lr=panLayer.getBoundingClientRect(),er=el.getBoundingClientRect();const cx=(er.left-lr.left)/zoom+er.width/(2*zoom),cy=(er.top-lr.top)/zoom+er.height/(2*zoom),w=er.width/zoom,h=er.height/zoom;switch(side){case'right':return{x:cx+w/2,y:cy};case'left':return{x:cx-w/2,y:cy};case'top':return{x:cx,y:cy-h/2};case'bottom':return{x:cx,y:cy+h/2};default:return{x:cx,y:cy};}}

function drawEdge(fEl,fS,tEl,tS,label,color,isHighlighted,opacity=1,obstacles=[],edgeOffset=0){
  const a=getAnchor(fEl,fS),b=getAnchor(tEl,tS);
  const mid='ah-'+Math.random().toString(36).slice(2,8);
  const strokeWidth=isHighlighted?3:1.5;
  const cssClass=isHighlighted?'class="arrow-highlighted"':'';
  const opacityAttr=opacity<1?\` opacity="\${opacity}"\`:'';

  // Orthogonal routing that avoids obstacles
  const path=computeOrthogonalPath(a,b,fS,tS,fEl,tEl,obstacles,edgeOffset);

  let s=\`<defs><marker id="\${mid}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1L9 5L1 9" fill="none" stroke="\${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>\`;
  s+=\`<path \${cssClass} d="\${path}" fill="none" stroke="\${color}" stroke-width="\${strokeWidth}"\${opacityAttr} marker-end="url(#\${mid})"/>\`;

  // Label at midpoint of longest horizontal segment
  if(label){
    const points=pathToPoints(path);
    // Find the longest horizontal segment for label placement
    let bestSeg={x1:a.x,x2:b.x,y:a.y,len:0};
    for(let i=0;i<points.length-1;i++){
      const p1=points[i],p2=points[i+1];
      if(Math.abs(p1.y-p2.y)<1){// Horizontal segment
        const len=Math.abs(p2.x-p1.x);
        if(len>bestSeg.len){
          bestSeg={x1:Math.min(p1.x,p2.x),x2:Math.max(p1.x,p2.x),y:p1.y,len};
        }
      }
    }
    const lx=(bestSeg.x1+bestSeg.x2)/2;
    const ly=bestSeg.y-10;
    const tw=label.length*5.2+12;
    s+=\`<rect x="\${lx-tw/2}" y="\${ly-9}" width="\${tw}" height="16" rx="3" fill="var(--bg)" fill-opacity="0.92" stroke="var(--bd)" stroke-width="0.5"\${opacityAttr}/>\`;
    s+=\`<text x="\${lx}" y="\${ly+2}" text-anchor="middle" font-size="8" font-family="monospace" fill="\${color}"\${opacityAttr}>\${label}</text>\`;
  }
  return s;
}

function pathToPoints(pathD){
  const points=[];
  const cmds=pathD.match(/[ML]\\s*[\\d.,-]+/g)||[];
  for(const cmd of cmds){
    const nums=cmd.match(/[\\d.]+/g);
    if(nums&&nums.length>=2)points.push({x:parseFloat(nums[0]),y:parseFloat(nums[1])});
  }
  return points;
}

function drawEdgeWithPorts(fEl,tEl,outPort,inPort,label,color,isHighlighted,opacity,obstacles){
  const nodeW=220,nodeH=476,portSpacing=40;
  const fRect={x:parseInt(fEl.style.left)||0,y:parseInt(fEl.style.top)||0};
  const tRect={x:parseInt(tEl.style.left)||0,y:parseInt(tEl.style.top)||0};
  const fromId=fEl.id.replace('graph-node-','');
  const toId=tEl.id.replace('graph-node-','');

  // Calculate port positions along the right edge (for outgoing) and left edge (for incoming)
  const baseY=120;
  const outY=fRect.y+baseY+outPort*portSpacing;
  const inY=tRect.y+baseY+inPort*portSpacing;

  const a={x:fRect.x+nodeW,y:outY};
  const b={x:tRect.x,y:inY};

  const mid='ah-'+Math.random().toString(36).slice(2,8);
  const strokeWidth=isHighlighted?2.5:1.5;
  const edgeClasses=isHighlighted?'edge-line arrow-highlighted':'edge-line';
  const opacityAttr=opacity<1?\` opacity="\${opacity}"\`:'';

  // Compute path
  const path=computePortPath(a,b,fRect,tRect,nodeW,nodeH,obstacles);

  let s=\`<defs><marker id="\${mid}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M1 1L9 5L1 9" fill="none" stroke="\${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>\`;
  // Invisible wider path for easier hover detection
  s+=\`<path class="edge-hover-target" d="\${path}" fill="none" stroke="transparent" stroke-width="12" data-from="\${fromId}" data-to="\${toId}" style="cursor:pointer;pointer-events:auto;"/>\`;
  s+=\`<path class="\${edgeClasses}" d="\${path}" fill="none" stroke="\${color}" stroke-width="\${strokeWidth}"\${opacityAttr} marker-end="url(#\${mid})" style="pointer-events:none;"/>\`;

  // Label on longest horizontal segment
  if(label){
    const points=pathToPoints(path);
    let bestSeg={x1:a.x,x2:b.x,y:a.y,len:0};
    for(let i=0;i<points.length-1;i++){
      const p1=points[i],p2=points[i+1];
      if(Math.abs(p1.y-p2.y)<1){
        const len=Math.abs(p2.x-p1.x);
        if(len>bestSeg.len)bestSeg={x1:Math.min(p1.x,p2.x),x2:Math.max(p1.x,p2.x),y:p1.y,len};
      }
    }
    const lx=(bestSeg.x1+bestSeg.x2)/2;
    const ly=bestSeg.y-10;
    const tw=label.length*5.2+12;
    s+=\`<rect x="\${lx-tw/2}" y="\${ly-9}" width="\${tw}" height="16" rx="3" fill="var(--bg)" fill-opacity="0.92" stroke="var(--bd)" stroke-width="0.5"\${opacityAttr}/>\`;
    s+=\`<text x="\${lx}" y="\${ly+2}" text-anchor="middle" font-size="8" font-family="monospace" fill="\${color}"\${opacityAttr}>\${label}</text>\`;
  }
  return s;
}

function computePortPath(a,b,fRect,tRect,nodeW,nodeH,obstacles){
  const margin=20;
  const dx=tRect.x-fRect.x;

  // Self-loop
  if(fRect.x===tRect.x&&fRect.y===tRect.y){
    const loopH=50;
    return \`M\${a.x},\${a.y} L\${a.x+margin},\${a.y} L\${a.x+margin},\${fRect.y-loopH} L\${fRect.x-margin},\${fRect.y-loopH} L\${fRect.x-margin},\${b.y} L\${b.x},\${b.y}\`;
  }

  // Backward edge
  if(dx<=0){
    // Route above both nodes
    const routeY=Math.min(fRect.y,tRect.y)-40;
    return \`M\${a.x},\${a.y} L\${a.x+margin},\${a.y} L\${a.x+margin},\${routeY} L\${b.x-margin},\${routeY} L\${b.x-margin},\${b.y} L\${b.x},\${b.y}\`;
  }

  // Forward edge - simple horizontal with vertical adjustment
  const midX=a.x+(b.x-a.x)/2;
  if(Math.abs(a.y-b.y)<10){
    // Nearly horizontal
    return \`M\${a.x},\${a.y} L\${b.x},\${b.y}\`;
  }
  // L-shape through midpoint
  return \`M\${a.x},\${a.y} L\${midX},\${a.y} L\${midX},\${b.y} L\${b.x},\${b.y}\`;
}

function computeOrthogonalPath(a,b,fS,tS,fEl,tEl,obstacles,edgeOffset=0){
  const nodeW=220,nodeH=476,margin=25,gap=40;

  // Get source and target node bounds
  const fRect={x:parseInt(fEl.style.left)||0,y:parseInt(fEl.style.top)||0,w:nodeW,h:nodeH};
  const tRect={x:parseInt(tEl.style.left)||0,y:parseInt(tEl.style.top)||0,w:nodeW,h:nodeH};

  const dx=tRect.x-fRect.x;
  const dy=b.y-a.y;

  // Self-loop: route above the node
  if(fEl===tEl){
    const loopH=gap+edgeOffset*20;
    return \`M\${a.x},\${a.y} L\${a.x+margin},\${a.y} L\${a.x+margin},\${fRect.y-loopH} L\${fRect.x-margin},\${fRect.y-loopH} L\${fRect.x-margin},\${b.y} L\${b.x},\${b.y}\`;
  }

  // Mermaid-style: route through the gap between rows
  // Find the gap Y position (between top row bottom and bottom row top)
  let row1Bottom=0, row2Top=Infinity;
  for(const o of obstacles){
    const oBottom=o.y+nodeH;
    const oTop=o.y;
    // Classify nodes into rows based on Y position
    if(o.y<400){
      row1Bottom=Math.max(row1Bottom,oBottom);
    }else{
      row2Top=Math.min(row2Top,oTop);
    }
  }
  const gapY=row1Bottom+(row2Top-row1Bottom)/2;

  // Backward edge: target is to the left of source
  if(dx<=0){
    // Route through the gap between rows, offset for multiple back edges
    const routeY=gapY+edgeOffset*20;
    const exitX=fRect.x+nodeW+margin;
    const entryX=tRect.x-margin;
    return \`M\${a.x},\${a.y} L\${exitX},\${a.y} L\${exitX},\${routeY} L\${entryX},\${routeY} L\${entryX},\${b.y} L\${b.x},\${b.y}\`;
  }

  // Forward edge: simple routing
  const midX=a.x+(b.x-a.x)/2;

  // Same row: direct or L-shape
  if(Math.abs(dy)<100){
    if(Math.abs(dy)<10){
      return \`M\${a.x},\${a.y} L\${b.x},\${b.y}\`;
    }else{
      return \`M\${a.x},\${a.y} L\${midX},\${a.y} L\${midX},\${b.y} L\${b.x},\${b.y}\`;
    }
  }

  // Different rows: route through the gap
  const exitX=a.x+margin;
  const entryX=b.x-margin;
  return \`M\${a.x},\${a.y} L\${exitX},\${a.y} L\${exitX},\${gapY} L\${entryX},\${gapY} L\${entryX},\${b.y} L\${b.x},\${b.y}\`;
}

function drawArrows(){
  let s='';
  if(selectedMapCuj&&!hasGraphEntities){
    svg.innerHTML='';
    return;
  }
  const obstacles=[];
  const prefix=hasGraphEntities?'graph-node-':'node-';
  document.querySelectorAll('#pan-layer .graph-node, #pan-layer .screen').forEach(el=>{
    obstacles.push({el,x:parseInt(el.style.left)||0,y:parseInt(el.style.top)||0});
  });

  const outPorts=new Map();
  const inPorts=new Map();

  transitions.forEach(t=>{
    const fromEl=document.getElementById(prefix+t.from);
    const toEl=document.getElementById(prefix+t.to);
    if(fromEl&&toEl){
      const isHighlighted=t.scenarioId===highlightedScenarioId;
      const outPort=outPorts.get(t.from)||0;
      const inPort=inPorts.get(t.to)||0;
      outPorts.set(t.from,outPort+1);
      inPorts.set(t.to,inPort+1);
      s+=drawEdgeWithPorts(fromEl,toEl,outPort,inPort,t.action,'var(--accent)',isHighlighted,1,obstacles);
    }
  });
  svg.innerHTML=s;
}

function drawArrowsWithPath(scenario){
  if(!scenario||!scenario.path){drawArrows();return;}
  const pathIds=new Set(scenario.path.split(',').map(s=>s.trim()));
  const obstacles=[];
  const prefix=hasGraphEntities?'graph-node-':'node-';
  document.querySelectorAll('#pan-layer .graph-node, #pan-layer .screen').forEach(el=>{
    obstacles.push({el,x:parseInt(el.style.left)||0,y:parseInt(el.style.top)||0});
  });

  const outPorts=new Map();
  const inPorts=new Map();

  let s='';
  transitions.forEach(t=>{
    const fromEl=document.getElementById(prefix+t.from);
    const toEl=document.getElementById(prefix+t.to);
    if(fromEl&&toEl){
      const isInPath=pathIds.has(t.id);
      const color=isInPath?'var(--accent)':'var(--hint)';
      const opacity=isInPath?1:0.15;
      const outPort=outPorts.get(t.from)||0;
      const inPort=inPorts.get(t.to)||0;
      outPorts.set(t.from,outPort+1);
      inPorts.set(t.to,inPort+1);
      s+=drawEdgeWithPorts(fromEl,toEl,outPort,inPort,isInPath?t.action:null,color,isInPath,opacity,obstacles);
    }
  });
  svg.innerHTML=s;
}

function redrawArrows(){
  // Check if using separate CUJ maps
  if(hasSeparateCujMaps&&selectedMapCuj){
    // Redraw the arrows for the active CUJ
    const cuj=cujs[selectedMapCuj];
    const scenario=highlightedScenarioId?cuj.scenarios.find(s=>s.id===highlightedScenarioId):null;
    const pathIds=scenario&&scenario.path?scenario.path.split(',').map(s=>s.trim()):null;
    drawCujArrows(selectedMapCuj,pathIds);
    return;
  }
  // Legacy mode
  if(hasGraphEntities&&selectedMapCuj){
    const cuj=cujs[selectedMapCuj];
    const scenario=cuj&&cuj.scenarios[0];
    if(scenario&&scenario.path){
      drawArrowsWithPath(scenario);
      return;
    }
  }
  drawArrows();
}
function drawStoryboardArrows(scenarios,highlightedStoryboardIdx){
  let s='';
  for(let i=0;i<scenarios.length-1;i++){
    const fromEl=document.getElementById('storyboard-'+i);
    const toEl=document.getElementById('storyboard-'+(i+1));
    if(fromEl&&toEl){
      // Highlight arrow if it points to the highlighted card (i+1===highlightedStoryboardIdx)
      const isHighlighted=i+1===highlightedStoryboardIdx;
      s+=drawEdge(fromEl,'right',toEl,'left',null,'var(--accent)',isHighlighted);
    }
  }
  svg.innerHTML=s;
}

/* RESIZE HANDLERS */
let sidebarWidth=220;
function initResize(){
  const handle=document.getElementById('resize-handle');
  const sidebar=document.getElementById('sidebar');
  let isResizing=false;
  handle.addEventListener('mousedown',e=>{isResizing=true;e.preventDefault();});
  window.addEventListener('mousemove',e=>{
    if(!isResizing)return;
    const newWidth=Math.max(150,Math.min(400,e.clientX));
    sidebar.style.width=newWidth+'px';
    sidebarWidth=newWidth;
  });
  window.addEventListener('mouseup',()=>{isResizing=false;});
}

let walkPanelWidth=300;
function initWalkResize(){
  const leftHandle=document.getElementById('walk-resize-left');
  const rightHandle=document.getElementById('walk-resize-right');
  const panel=document.querySelector('.walk-panel');
  let resizingLeft=false,resizingRight=false;
  if(leftHandle)leftHandle.addEventListener('mousedown',e=>{resizingLeft=true;e.preventDefault();});
  if(rightHandle)rightHandle.addEventListener('mousedown',e=>{resizingRight=true;e.preventDefault();});
  window.addEventListener('mousemove',e=>{
    if(resizingRight){
      const viewWidth=window.innerWidth;
      const newWidth=Math.max(200,Math.min(450,viewWidth-e.clientX));
      panel.style.width=newWidth+'px';
      walkPanelWidth=newWidth;
    }
  });
  window.addEventListener('mouseup',()=>{resizingLeft=false;resizingRight=false;});
}

/* SIDEBAR SCROLL PREVENTION */
document.getElementById('sidebar').addEventListener('wheel',e=>{e.stopPropagation();},{passive:true});

/* GRAPH MODE - path-based storyboard rendering */
function renderPathStoryboard(cujId,scenarioIdx){
  const cuj=cujs[cujId];
  if(!cuj)return;
  const scenario=cuj.scenarios[scenarioIdx];
  if(!scenario||!scenario.path)return;

  // Hide default screens, show storyboard
  document.getElementById('default-screens').classList.add('hidden');
  const container=document.getElementById('storyboard-container');
  container.classList.add('active');
  container.innerHTML='';

  // Parse path (comma-separated tr_* IDs)
  const pathIds=scenario.path.split(',').map(s=>s.trim());

  // Collect ordered screen states from path
  const visitedStates=[];
  for(const trId of pathIds){
    const tr=transitions.find(t=>t.id===trId);
    if(tr){
      // Add from state (if not already last in list)
      if(visitedStates.length===0||visitedStates[visitedStates.length-1]!==tr.from){
        visitedStates.push(tr.from);
      }
      // Add to state
      visitedStates.push(tr.to);
    }
  }

  // Deduplicate consecutive identical states
  const uniqueStates=[];
  for(const stId of visitedStates){
    if(uniqueStates.length===0||uniqueStates[uniqueStates.length-1]!==stId){
      uniqueStates.push(stId);
    }
  }

  // Generate cards for each state in path
  let xPos=80;
  stateCards=[];
  scenarioToCard={};
  uniqueStates.forEach((stId,cardIdx)=>{
    const st=screenStates.find(s=>s.id===stId);
    if(!st)return;

    const el=document.createElement('div');
    el.className='storyboard-card';
    el.id='storyboard-'+cardIdx;
    el.style.left=xPos+'px';
    el.style.top='80px';

    // Build scenario-like object with comp_* from screen state
    const stScenario={name:stId,screen:st.screen,...st.componentStates};
    const navHtml=getNavHtml(st.screen);
    el.innerHTML=\`<div class="s-head"><span>\${getScreenName(st.screen)}</span></div><div class="s-body"></div>\${navHtml}<div class="storyboard-label"><span class="scenario-name">\${stId}</span><span class="screen-id">\${st.screen}</span></div>\`;
    el.querySelector('.s-body').innerHTML=getScreenHtml(st.screen,stScenario);
    container.appendChild(el);
    stateCards.push({stateKey:stId,screenId:st.screen,scenario:stScenario,scenarios:[stScenario],cardIdx});
    xPos+=300;
  });

  scenarioToCard[scenarioIdx]=0;
  highlightedStoryboardIdx=null;
  drawStoryboardArrows(stateCards,highlightedStoryboardIdx);
}

/* GRAPH MODE - highlight path nodes, dim others */
function highlightGraphPath(scenario){
  if(!hasGraphEntities||!scenario||!scenario.path)return;

  const pathIds=scenario.path.split(',').map(s=>s.trim());
  const pathStates=new Set();
  for(const trId of pathIds){
    const tr=transitions.find(t=>t.id===trId);
    if(tr){
      pathStates.add(tr.from);
      pathStates.add(tr.to);
    }
  }

  // Dim all graph nodes that are NOT in the path
  document.querySelectorAll('.graph-node').forEach(el=>{
    const nodeId=el.id.replace('graph-node-','');
    if(pathStates.has(nodeId)){
      el.classList.remove('dimmed');
      el.classList.add('highlighted');
    }else{
      el.classList.add('dimmed');
      el.classList.remove('highlighted');
    }
  });
}

function clearGraphHighlights(){
  document.querySelectorAll('.graph-node').forEach(el=>{
    el.classList.remove('dimmed');
    el.classList.remove('highlighted');
  });
}

/* CUJ-SPECIFIC HIGHLIGHTING */
function highlightGraphPathInCuj(cujId,scenario){
  if(!hasSeparateCujMaps||!scenario||!scenario.path)return;
  const mapEl=document.getElementById('cuj-map-'+cujId);
  if(!mapEl)return;

  const pathIds=scenario.path.split(',').map(s=>s.trim());
  const pathStates=new Set();
  for(const trId of pathIds){
    const tr=transitions.find(t=>t.id===trId);
    if(tr){
      pathStates.add(tr.from);
      pathStates.add(tr.to);
    }
  }

  // Dim nodes NOT in the path, highlight nodes IN the path
  mapEl.querySelectorAll('.graph-node').forEach(el=>{
    const nodeId=el.id.replace('graph-node-','');
    if(pathStates.has(nodeId)){
      el.classList.remove('dimmed');
      el.classList.add('highlighted');
    }else{
      el.classList.add('dimmed');
      el.classList.remove('highlighted');
    }
  });
}

function clearGraphHighlightsInCuj(cujId){
  const mapEl=document.getElementById('cuj-map-'+cujId);
  if(!mapEl)return;
  mapEl.querySelectorAll('.graph-node').forEach(el=>{
    el.classList.remove('dimmed');
    el.classList.remove('highlighted');
  });
}

applyTransform();
initSidebar();
initResize();
initWalkResize();

// Initialize: show first CUJ map if using separate maps
if(hasSeparateCujMaps){
  const firstCujId=Object.keys(cujs)[0];
  if(firstCujId){
    selectCuj(firstCujId);
  }
}else{
  requestAnimationFrame(()=>requestAnimationFrame(()=>document.getElementById('zoom-fit').click()));
}
window.addEventListener('resize',()=>document.getElementById('zoom-fit').click());
</script>
</body>
</html>`;
}
