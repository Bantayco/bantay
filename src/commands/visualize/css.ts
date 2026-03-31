/**
 * CSS generation for the visualizer
 */

import type { DesignToken, TokenVar } from "./types";
import { tokenIdToCssVar } from "../../export/css";

/**
 * Generate CSS variables from design tokens
 */
export function generateTokenCssVars(
  designTokens: DesignToken[],
  tokenTypeVars: TokenVar[]
): string {
  const designTokenCssVars = designTokens
    .map((token) => `  ${tokenIdToCssVar(token.id)}: ${token.value};`)
    .join("\n");

  const tokenTypeCssVars = tokenTypeVars
    .map((tv) => `  ${tv.name}: ${tv.value};`)
    .join("\n");

  return [designTokenCssVars, tokenTypeCssVars].filter(Boolean).join("\n");
}

/**
 * Generate dark mode CSS variables
 */
export function generateDarkModeCssVars(darkModeTokenVars: TokenVar[]): string {
  return darkModeTokenVars
    .map((tv) => `  ${tv.name}: ${tv.value};`)
    .join("\n");
}

/**
 * Generate the complete CSS stylesheet
 */
export function generateCss(tokenCssVars: string, darkModeCssVars: string): string {
  return `* { margin:0; padding:0; box-sizing:border-box; }
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
.s-body { padding:8px 10px; flex:1; font-family:var(--serif); position:relative; border-radius:10px 10px 0 0; }
.s-tag { position:absolute; top:-18px; left:0; font-size:10px; font-family:monospace; color:var(--mt); white-space:nowrap; pointer-events:none; }
.s-tag-id { font-size:8px; color:var(--hint); margin-left:6px; display:none; }

.comp-box { padding:4px 0; margin-bottom:2px; position:relative; }
.comp-label { font-size:8px; font-family:monospace; color:var(--accent); opacity:0.5; margin-bottom:2px; display:none; }

/* DEBUG MODE */
.app.debug-mode .s-tag-id { display:inline; }
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
.walk-screen { width:220px; min-height:476px; background:var(--bg); border:1px solid var(--bd); border-radius:10px; overflow:visible; font-family:var(--sans); font-size:11px; color:var(--fg); box-shadow:0 2px 10px rgba(0,0,0,0.08); display:flex; flex-direction:column; transition:opacity 0.2s,transform 0.2s; position:relative; }
.walk-screen.transitioning { opacity:0; transform:translateX(24px); }
.ws-tag { position:absolute; top:-18px; left:0; font-size:10px; font-family:monospace; color:var(--mt); white-space:nowrap; pointer-events:none; }
.ws-body { padding:8px 10px; flex:1; font-family:var(--serif); position:relative; border-radius:10px 10px 0 0; }

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
.cuj-map { position:absolute; top:0; left:0; width:100%; height:100%; }`;
}
