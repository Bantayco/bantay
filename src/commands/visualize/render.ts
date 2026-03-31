/**
 * Rendering utilities for screen states and components
 */

import type {
  Screen,
  ScreenState,
  GraphTransition,
  WireframeMap,
  CUJ,
  CujGraphData,
  Component,
} from "./types";
import { computeDAGLayout } from "./layout";

// M3 component types that float (absolute positioned)
const FLOATING_TYPES = new Set(["fab", "fab-extended"]);

// M3 component types that render as navigation (bottom of screen)
const NAV_TYPES = new Set(["navigation-bar", "bottom-app-bar"]);

/**
 * Check if a component is a floating type (FAB, etc.)
 */
function isFloatingComponent(comp: Component): boolean {
  return comp.type ? FLOATING_TYPES.has(comp.type) : false;
}

/**
 * Check if a component is a navigation type
 */
function isNavComponent(comp: Component): boolean {
  return comp.type ? NAV_TYPES.has(comp.type) : false;
}

/**
 * Render a floating component (FAB, etc.)
 */
function renderFloatingComponent(comp: Component): string {
  // Use wireframe if available, otherwise render default FAB
  if (comp.wireframeHtml) {
    return `<div style="position:absolute; bottom:8px; right:4px;">${comp.wireframeHtml}</div>`;
  }
  // Default FAB rendering
  return `<div style="position:absolute; bottom:8px; right:4px; width:44px; height:44px; background:var(--accent); border-radius:50%; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 8px rgba(0,0,0,0.25);"><span style="color:#fff; font-size:22px; font-weight:300; line-height:1;">+</span></div>`;
}

/**
 * Render a navigation component
 */
function renderNavComponent(comp: Component): string {
  if (comp.wireframeHtml) {
    return comp.wireframeHtml;
  }
  // Default navigation bar rendering
  return '<div class="nav-bar"><span>Artifacts</span><span>Write</span><span>Settings</span></div>';
}

/**
 * Build HTML map for each screen (for walkthrough mode)
 */
export function buildScreenHtmlMap(
  screens: Screen[],
  wireframes: WireframeMap
): Record<string, string> {
  const screenHtmlMapObj: Record<string, string> = {};

  for (const screen of screens) {
    let bodyHtml: string;
    let floatingHtml = "";
    let navCompHtml = "";

    if (screen.components && screen.components.length > 0) {
      // Separate components by M3 type
      const regularComponents = screen.components.filter(c => !isFloatingComponent(c) && !isNavComponent(c));
      const floatingComponents = screen.components.filter(c => isFloatingComponent(c));
      const navComponents = screen.components.filter(c => isNavComponent(c));

      bodyHtml = regularComponents
        .map((comp) => {
          const content = comp.wireframeHtml
            ? comp.wireframeHtml
            : `<div class="comp-desc">${comp.description || comp.name}</div>`;
          return `<div class="comp-box"><div class="comp-label">${comp.id}</div>${content}</div>`;
        })
        .join("");

      // Render floating components (FABs)
      floatingHtml = floatingComponents.map(comp => renderFloatingComponent(comp)).join("");

      // Render navigation components
      navCompHtml = navComponents.map(comp => renderNavComponent(comp)).join("");
    } else {
      bodyHtml = `<div style="padding:20px;text-align:center;color:var(--hint);">${screen.description || screen.name}</div>`;
    }

    // Use screen.nav for legacy nav handling if no nav component found
    let navHtml = navCompHtml;
    if (!navHtml) {
      if (screen.nav === "none") {
        navHtml = '<div class="nav-footer">no nav — immersive</div>';
      } else if (screen.nav && screen.nav !== "") {
        navHtml = '<div class="nav-bar"><span>Artifacts</span><span>Write</span><span>Settings</span></div>';
      }
    }

    screenHtmlMapObj[screen.id] = bodyHtml + floatingHtml + navHtml;
  }

  return screenHtmlMapObj;
}

/**
 * Build variant HTML map from wireframes (for component variants)
 */
export function buildVariantHtmlMap(wireframes: WireframeMap): Record<string, string> {
  const variantHtmlMapObj: Record<string, string> = {};
  for (const [key, html] of Object.entries(wireframes)) {
    if (key.includes("--")) {
      variantHtmlMapObj[key] = html;
    }
  }
  return variantHtmlMapObj;
}

/**
 * Build state HTML map - pre-renders body content for each screen state
 */
export function buildStateHtmlMap(
  screenStates: ScreenState[],
  screens: Screen[],
  variantHtmlMap: Record<string, string>
): { stateHtml: Record<string, string>; stateNav: Record<string, string> } {
  const stateHtmlMapObj: Record<string, string> = {};
  const stateNavMapObj: Record<string, string> = {};

  for (const state of screenStates) {
    const screen = screens.find(s => s.id === state.screen);
    let bodyContent = "";
    let floatingHtml = "";

    if (screen?.components && screen.components.length > 0) {
      // Separate components by M3 type
      const regularComponents = screen.components.filter(c => !isFloatingComponent(c) && !isNavComponent(c));
      const floatingComponents = screen.components.filter(c => isFloatingComponent(c));

      bodyContent = regularComponents
        .map((comp) => {
          const variant = state.componentStates[comp.id];
          let content: string;
          if (variant) {
            const variantKey = `${comp.id}--${variant}`;
            content = variantHtmlMap[variantKey] || comp.wireframeHtml || `<div class="comp-desc">${comp.description || comp.name}</div>`;
          } else {
            content = comp.wireframeHtml || `<div class="comp-desc">${comp.description || comp.name}</div>`;
          }
          return `<div class="comp-box"><div class="comp-label">${comp.id}</div>${content}</div>`;
        })
        .join("");

      // Render floating components (FABs)
      floatingHtml = floatingComponents.map(comp => renderFloatingComponent(comp)).join("");
    } else {
      bodyContent = `<div style="text-align:center;padding:40px 0;color:var(--hint);font-size:12px;">${state.id}</div>`;
    }

    stateHtmlMapObj[state.id] = bodyContent + floatingHtml;

    // Check for nav components first, then fall back to screen.nav
    const navComponents = screen?.components?.filter(c => isNavComponent(c)) || [];
    if (navComponents.length > 0) {
      stateNavMapObj[state.id] = navComponents.map(comp => renderNavComponent(comp)).join("");
    } else if (screen?.nav === "none") {
      stateNavMapObj[state.id] = `<div class="nav-footer">no nav — immersive</div>`;
    } else if (screen?.nav && screen.nav !== "") {
      stateNavMapObj[state.id] = `<div class="nav-bar"><span>Artifacts</span><span>Write</span><span>Settings</span></div>`;
    } else {
      stateNavMapObj[state.id] = "";
    }
  }

  return { stateHtml: stateHtmlMapObj, stateNav: stateNavMapObj };
}

/**
 * Compute CUJ graph data (states and transitions per CUJ)
 */
export function computeCujGraphs(
  cujs: CUJ[],
  transitions: GraphTransition[]
): CujGraphData[] {
  const cujGraphs: CujGraphData[] = [];

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

  return cujGraphs;
}

/**
 * Render a state node for the graph view
 */
export function renderStateNode(
  state: ScreenState,
  x: number,
  y: number,
  screens: Screen[],
  stateHtmlMap: Record<string, string>,
  stateNavMap: Record<string, string>
): string {
  const screen = screens.find(s => s.id === state.screen);
  const screenName = screen?.name || state.screen;
  const bodyContent = stateHtmlMap[state.id] || `<div style="text-align:center;padding:40px 0;color:var(--hint);font-size:12px;">${state.id}</div>`;
  const navContent = stateNavMap[state.id] || "";

  return `
    <div class="graph-node" id="graph-node-${state.id}" style="left:${x}px;top:${y}px;">
      <div class="s-tag">${screenName}<span class="s-tag-id">${state.id}</span></div>
      <div class="s-body">${bodyContent}</div>
      ${navContent}
    </div>`;
}

/**
 * Generate screen HTML for map view based on graph mode
 */
export function generateMapScreenHtml(
  hasGraphEntities: boolean,
  cujGraphs: CujGraphData[],
  screenStates: ScreenState[],
  transitions: GraphTransition[],
  screens: Screen[],
  stateHtmlMap: Record<string, string>,
  stateNavMap: Record<string, string>
): string {
  // Known container entity IDs that should not be rendered as screen cards
  const containerEntityIds = new Set([
    "screens", "states", "transitions", "components",
    "cujs", "invariants", "constraints", "foundations", "wisdom"
  ]);

  const filteredScreens = screens.filter(screen => {
    if (containerEntityIds.has(screen.id)) return false;
    if (screen.id.startsWith("screen_")) {
      const suffix = screen.id.slice(7);
      if (containerEntityIds.has(suffix)) return false;
    }
    return true;
  });

  if (hasGraphEntities && cujGraphs.length > 0) {
    const cujMapsHtml: string[] = [];

    for (const cujGraph of cujGraphs) {
      const cujStates = screenStates.filter(s => cujGraph.stateIds.has(s.id));
      const cujTransitions = transitions.filter(t => cujGraph.transitionIds.has(t.id));
      const positions = computeDAGLayout(cujStates, cujTransitions);

      const nodesHtml = cujStates.map(state => {
        const pos = positions.get(state.id) || { x: 80, y: 80 };
        return renderStateNode(state, pos.x, pos.y, filteredScreens, stateHtmlMap, stateNavMap);
      }).join("\n");

      cujMapsHtml.push(`
        <div class="cuj-map" id="cuj-map-${cujGraph.cujId}" style="display:none;">
          <svg class="cuj-map-arrows" id="arrows-${cujGraph.cujId}" style="position:absolute;inset:0;width:100%;height:100%;z-index:10;overflow:visible;pointer-events:none;"></svg>
          ${nodesHtml}
        </div>`);
    }

    return cujMapsHtml.join("\n");
  } else if (screenStates.length > 0) {
    const positions = computeDAGLayout(screenStates, transitions);
    return screenStates
      .map((state) => {
        const pos = positions.get(state.id) || { x: 80, y: 80 };
        return renderStateNode(state, pos.x, pos.y, filteredScreens, stateHtmlMap, stateNavMap);
      })
      .join("\n");
  } else {
    return filteredScreens
      .map((screen, i) => {
        const x = 80 + i * 300;
        const y = 80;

        let bodyContent: string;
        if (screen.components && screen.components.length > 0) {
          bodyContent = screen.components
            .map((comp) => {
              const content = comp.wireframeHtml
                ? comp.wireframeHtml
                : `<div class="comp-desc">${comp.description || comp.name}</div>`;
              return `
        <div class="comp-box">
          <div class="comp-label">${comp.id}</div>
          ${content}
        </div>`;
            })
            .join("");
        } else {
          bodyContent = `
        <div style="text-align:center;padding:40px 0;color:var(--hint);font-size:12px;">
          ${screen.description || (screen.inferred ? "(Inferred from scenarios)" : "")}
        </div>`;
        }

        let navContent = "";
        if (screen.nav === "none") {
          navContent = `<div class="nav-footer">no nav — immersive</div>`;
        } else if (screen.nav && screen.nav !== "") {
          navContent = `<div class="nav-bar"><span>Artifacts</span><span>Write</span><span>Settings</span></div>`;
        }

        return `
    <div class="screen" id="node-${screen.id}" style="left:${x}px;top:${y}px;">
      <div class="s-tag">${screen.name}<span class="s-tag-id">${screen.id}</span></div>
      <div class="s-body">${bodyContent}</div>${navContent}
    </div>`;
      })
      .join("\n");
  }
}
