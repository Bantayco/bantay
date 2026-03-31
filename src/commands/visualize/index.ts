/**
 * Visualizer command - generates interactive HTML visualization of aide files
 */

import { join } from "path";
import { readFile, writeFile } from "fs/promises";
import * as yaml from "js-yaml";
import { resolveAidePath } from "../../aide/discovery";
import { extractDesignTokens } from "../../export/css";

// Re-export types
export type {
  VisualizeOptions,
  VisualizeResult,
  AideTree,
  CUJ,
  Scenario,
  Screen,
  ScreenState,
  GraphTransition,
  Component,
  DesignToken,
  TokenVar,
  WireframeMap,
  CujGraphData,
  VisualizerData,
} from "./types";

// Import modular components
import type { AideTree, DesignToken, TokenVar, VisualizeOptions, VisualizeResult } from "./types";
import { extractTokenTypeVars, extractDarkModeTokenVars } from "./tokens";
import { loadWireframes } from "./wireframes";
import { extractVisualizerData } from "./extract";
import {
  buildScreenHtmlMap,
  buildVariantHtmlMap,
  buildStateHtmlMap,
  computeCujGraphs,
  generateMapScreenHtml,
} from "./render";
import { generateCss, generateTokenCssVars, generateDarkModeCssVars } from "./css";
import { generateScripts } from "./scripts";

/**
 * Run the visualize command
 */
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
  const html = generateVisualizerHtml(
    cujs,
    screens,
    transitions,
    relationships,
    designTokens,
    wireframes,
    tokenTypeVars,
    darkModeTokenVars,
    screenStates
  );

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
 * Generate the complete visualizer HTML document
 */
function generateVisualizerHtml(
  cujs: ReturnType<typeof extractVisualizerData>["cujs"],
  screens: ReturnType<typeof extractVisualizerData>["screens"],
  transitions: ReturnType<typeof extractVisualizerData>["transitions"],
  relationships: ReturnType<typeof extractVisualizerData>["relationships"],
  designTokens: DesignToken[] = [],
  wireframes: Record<string, string> = {},
  tokenTypeVars: TokenVar[] = [],
  darkModeTokenVars: TokenVar[] = [],
  screenStates: ReturnType<typeof extractVisualizerData>["screenStates"] = []
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
            path: s.path,
            invs: s.invariants,
            ...s.componentStates,
          })),
        },
      ])
    )
  );

  // Determine if graph mode is enabled
  const hasGraphEntities = screenStates.length > 0 || transitions.length > 0;

  // Compute CUJ graphs
  const cujGraphs = hasGraphEntities ? computeCujGraphs(cujs, transitions) : [];

  // Generate serialized data
  const screenStatesData = JSON.stringify(screenStates);
  const transitionsData = JSON.stringify(transitions);
  const cujGraphsData = JSON.stringify(cujGraphs.map(g => ({
    cujId: g.cujId,
    stateIds: Array.from(g.stateIds),
    transitionIds: Array.from(g.transitionIds),
  })));
  const screensData = JSON.stringify(screens);

  // Build HTML maps
  const screenHtmlMapObj = buildScreenHtmlMap(screens, wireframes);
  const variantHtmlMapObj = buildVariantHtmlMap(wireframes);
  const { stateHtml: stateHtmlMapObj, stateNav: stateNavMapObj } = buildStateHtmlMap(
    screenStates,
    screens,
    variantHtmlMapObj
  );

  const screenHtmlMapData = JSON.stringify(screenHtmlMapObj);
  const variantHtmlMapData = JSON.stringify(variantHtmlMapObj);
  const stateHtmlMapData = JSON.stringify(stateHtmlMapObj);
  const stateNavMapData = JSON.stringify(stateNavMapObj);

  // Generate screen HTML for map view
  const screenHtml = generateMapScreenHtml(
    hasGraphEntities,
    cujGraphs,
    screenStates,
    transitions,
    screens,
    stateHtmlMapObj,
    stateNavMapObj
  );

  // Generate CSS
  const tokenCssVars = generateTokenCssVars(designTokens, tokenTypeVars);
  const darkModeCssVars = generateDarkModeCssVars(darkModeTokenVars);
  const css = generateCss(tokenCssVars, darkModeCssVars);

  // Generate scripts
  const scripts = generateScripts({
    cujsData,
    screensData,
    transitionsData,
    screenHtmlMapData,
    variantHtmlMapData,
    screenStatesData,
    stateHtmlMapData,
    stateNavMapData,
    hasGraphEntities,
    cujGraphsData,
  });

  // Assemble HTML document
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Aide Visualizer</title>
<style>
${css}
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
${scripts}
</script>
</body>
</html>`;
}
