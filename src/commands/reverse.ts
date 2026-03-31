/**
 * bantay reverse --prompt
 *
 * Scans a project directory and generates a structured prompt for an LLM
 * to propose a complete aide (or reconcile against an existing aide).
 */

import { readdir, stat, readFile } from "fs/promises";
import { join, relative, basename, extname, dirname } from "path";
import { Glob } from "bun";

export interface ReverseOptions {
  prompt?: boolean;
  focus?: "frontend" | "backend" | "auth";
}

export interface ReverseResult {
  prompt: string;
  tokenEstimate: number;
  warnings: string[];
}

interface ProjectInfo {
  name: string;
  description?: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

interface RouteInfo {
  method?: string;
  path: string;
  file: string;
}

interface ComponentInfo {
  name: string;
  file: string;
  props?: string[];
}

interface StateMachineInfo {
  name: string;
  states: string[];
  actions: string[];
  file: string;
}

interface EventHandlerInfo {
  name: string;
  file: string;
}

interface ExportedFunctionInfo {
  name: string;
  file: string;
}

interface CodebaseSummary {
  project?: ProjectInfo;
  readme?: string;
  claudeMd?: string;
  routes: RouteInfo[];
  components: ComponentInfo[];
  stateMachines: StateMachineInfo[];
  eventHandlers: EventHandlerInfo[];
  exportedFunctions: ExportedFunctionInfo[];
  existingAide?: string;
}

// Token estimation: ~4 chars per token for English text
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Truncate content to fit within token budget
function truncateContent(content: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars) + "\n\n... (truncated for token limit)";
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readFileSafe(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

async function globFiles(pattern: string, cwd: string): Promise<string[]> {
  const glob = new Glob(pattern);
  const files: string[] = [];
  for await (const file of glob.scan({ cwd, onlyFiles: true })) {
    files.push(file);
  }
  return files;
}

async function scanPackageJson(projectPath: string): Promise<ProjectInfo | undefined> {
  const content = await readFileSafe(join(projectPath, "package.json"));
  if (!content) {
    // Try pyproject.toml for Python projects
    const pyproject = await readFileSafe(join(projectPath, "pyproject.toml"));
    if (pyproject) {
      const nameMatch = pyproject.match(/name\s*=\s*"([^"]+)"/);
      const deps: Record<string, string> = {};
      const depsMatch = pyproject.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
      if (depsMatch) {
        const depList = depsMatch[1].match(/"([^"]+)"/g);
        if (depList) {
          for (const dep of depList) {
            const clean = dep.replace(/"/g, "").split(/[<>=]/)[0];
            deps[clean] = "*";
          }
        }
      }
      return {
        name: nameMatch?.[1] || "python-project",
        dependencies: deps,
        devDependencies: {},
      };
    }
    return undefined;
  }

  try {
    const pkg = JSON.parse(content);
    return {
      name: pkg.name || "unknown",
      description: pkg.description,
      dependencies: pkg.dependencies || {},
      devDependencies: pkg.devDependencies || {},
    };
  } catch {
    return undefined;
  }
}

function detectFramework(project: ProjectInfo): string | null {
  const allDeps = { ...project.dependencies, ...project.devDependencies };

  if (allDeps["next"]) return "nextjs";
  if (allDeps["@sveltejs/kit"]) return "sveltekit";
  if (allDeps["nuxt"]) return "nuxt";
  if (allDeps["express"]) return "express";
  if (allDeps["fastify"]) return "fastify";
  if (allDeps["koa"]) return "koa";
  if (allDeps["hono"]) return "hono";
  if (allDeps["react"]) return "react";
  if (allDeps["vue"]) return "vue";
  if (allDeps["svelte"]) return "svelte";
  if (allDeps["fastapi"]) return "fastapi";
  if (allDeps["django"]) return "django";
  if (allDeps["flask"]) return "flask";

  return null;
}

async function scanNextJsRoutes(projectPath: string): Promise<RouteInfo[]> {
  const routes: RouteInfo[] = [];

  // App router (app directory)
  const appFiles = await globFiles("app/**/page.{tsx,jsx,ts,js}", projectPath);
  for (const file of appFiles) {
    const dir = dirname(file);
    let routePath = "/" + dir.replace(/^app\/?/, "").replace(/page\.(tsx|jsx|ts|js)$/, "");
    routePath = routePath.replace(/\/+$/, "") || "/";
    routes.push({ path: routePath, file });
  }

  // Pages router (pages directory)
  const pagesFiles = await globFiles("pages/**/*.{tsx,jsx,ts,js}", projectPath);
  for (const file of pagesFiles) {
    if (file.includes("_app") || file.includes("_document") || file.includes("api/")) continue;
    let routePath = "/" + file.replace(/^pages\/?/, "").replace(/\.(tsx|jsx|ts|js)$/, "");
    routePath = routePath.replace(/\/index$/, "") || "/";
    routes.push({ path: routePath, file });
  }

  return routes;
}

async function scanSvelteKitRoutes(projectPath: string): Promise<RouteInfo[]> {
  const routes: RouteInfo[] = [];

  const routeFiles = await globFiles("src/routes/**/+page.svelte", projectPath);
  for (const file of routeFiles) {
    const dir = dirname(file);
    let routePath = "/" + dir.replace(/^src\/routes\/?/, "").replace(/\+page\.svelte$/, "");
    routePath = routePath.replace(/\/+$/, "") || "/";
    routes.push({ path: routePath, file });
  }

  return routes;
}

async function scanExpressRoutes(projectPath: string): Promise<RouteInfo[]> {
  const routes: RouteInfo[] = [];

  // Scan all JS/TS files for Express route patterns
  const files = await globFiles("**/*.{js,ts}", projectPath);
  const routePattern = /app\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi;

  for (const file of files) {
    if (file.includes("node_modules")) continue;
    const content = await readFileSafe(join(projectPath, file));
    if (!content) continue;

    let match;
    while ((match = routePattern.exec(content)) !== null) {
      routes.push({
        method: match[1].toUpperCase(),
        path: match[2],
        file,
      });
    }
  }

  return routes;
}

async function scanFastAPIRoutes(projectPath: string): Promise<RouteInfo[]> {
  const routes: RouteInfo[] = [];

  const files = await globFiles("**/*.py", projectPath);
  const routePattern = /@app\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/gi;

  for (const file of files) {
    if (file.includes("venv") || file.includes(".venv") || file.includes("__pycache__")) continue;
    const content = await readFileSafe(join(projectPath, file));
    if (!content) continue;

    let match;
    while ((match = routePattern.exec(content)) !== null) {
      routes.push({
        method: match[1].toUpperCase(),
        path: match[2],
        file,
      });
    }
  }

  return routes;
}

async function scanRoutes(projectPath: string, framework: string | null): Promise<RouteInfo[]> {
  switch (framework) {
    case "nextjs":
      return scanNextJsRoutes(projectPath);
    case "sveltekit":
      return scanSvelteKitRoutes(projectPath);
    case "express":
    case "fastify":
    case "koa":
    case "hono":
      return scanExpressRoutes(projectPath);
    case "fastapi":
    case "flask":
      return scanFastAPIRoutes(projectPath);
    default:
      // Try all route scanners
      const routes: RouteInfo[] = [];
      routes.push(...await scanNextJsRoutes(projectPath));
      routes.push(...await scanSvelteKitRoutes(projectPath));
      routes.push(...await scanExpressRoutes(projectPath));
      routes.push(...await scanFastAPIRoutes(projectPath));
      return routes;
  }
}

async function scanReactComponents(projectPath: string): Promise<ComponentInfo[]> {
  const components: ComponentInfo[] = [];

  const files = await globFiles("**/*.{tsx,jsx}", projectPath);
  const componentPattern = /export\s+(?:default\s+)?function\s+([A-Z][a-zA-Z0-9]*)\s*\(/g;

  for (const file of files) {
    if (file.includes("node_modules")) continue;
    const content = await readFileSafe(join(projectPath, file));
    if (!content) continue;

    let match;
    while ((match = componentPattern.exec(content)) !== null) {
      components.push({
        name: match[1],
        file,
      });
    }
  }

  return components;
}

async function scanStateMachines(projectPath: string): Promise<StateMachineInfo[]> {
  const machines: StateMachineInfo[] = [];

  const files = await globFiles("**/*.{ts,tsx,js,jsx}", projectPath);

  for (const file of files) {
    if (file.includes("node_modules")) continue;
    const content = await readFileSafe(join(projectPath, file));
    if (!content) continue;

    // Look for reducer patterns with type unions
    const stateTypeMatch = content.match(/type\s+\w*[Ss]tate\s*=\s*['"]([^'"]+)['"](?:\s*\|\s*['"]([^'"]+)['"])*/g);
    const actionTypeMatch = content.match(/type\s+\w*[Aa]ction\s*=\s*\{[^}]*type:\s*['"](\w+)['"][^}]*\}(?:\s*\|\s*\{[^}]*type:\s*['"](\w+)['"][^}]*\})*/g);

    if (stateTypeMatch || actionTypeMatch) {
      const states: string[] = [];
      const actions: string[] = [];

      if (stateTypeMatch) {
        for (const match of stateTypeMatch) {
          const stateMatches = match.match(/['"]([^'"]+)['"]/g);
          if (stateMatches) {
            states.push(...stateMatches.map(s => s.replace(/['"]/g, "")));
          }
        }
      }

      if (actionTypeMatch) {
        for (const match of actionTypeMatch) {
          const actionMatches = match.match(/type:\s*['"](\w+)['"]/g);
          if (actionMatches) {
            actions.push(...actionMatches.map(a => a.replace(/type:\s*['"]|['"]/g, "")));
          }
        }
      }

      // Also scan for switch case patterns
      const switchCases = content.match(/case\s+['"]([A-Z_]+)['"]\s*:/g);
      if (switchCases) {
        actions.push(...switchCases.map(c => c.replace(/case\s+['"]|['"]\s*:/g, "")));
      }

      if (states.length > 0 || actions.length > 0) {
        machines.push({
          name: basename(file, extname(file)),
          states: [...new Set(states)],
          actions: [...new Set(actions)],
          file,
        });
      }
    }
  }

  return machines;
}

async function scanEventHandlers(projectPath: string): Promise<EventHandlerInfo[]> {
  const handlers: EventHandlerInfo[] = [];

  const files = await globFiles("**/*.{ts,tsx,js,jsx}", projectPath);
  const handlerPattern = /(?:const|let|var|function)\s+(handle[A-Z][a-zA-Z0-9]*)\s*(?:=|[({])/g;

  for (const file of files) {
    if (file.includes("node_modules")) continue;
    const content = await readFileSafe(join(projectPath, file));
    if (!content) continue;

    let match;
    while ((match = handlerPattern.exec(content)) !== null) {
      handlers.push({
        name: match[1],
        file,
      });
    }
  }

  return handlers;
}

async function scanExportedFunctions(projectPath: string): Promise<ExportedFunctionInfo[]> {
  const functions: ExportedFunctionInfo[] = [];

  const files = await globFiles("**/*.{ts,tsx,js,jsx}", projectPath);
  // Match: export async function name, export function name, export const name = async
  const exportPattern = /export\s+(?:async\s+)?(?:function|const)\s+([a-zA-Z][a-zA-Z0-9]*)/g;

  for (const file of files) {
    if (file.includes("node_modules")) continue;
    const content = await readFileSafe(join(projectPath, file));
    if (!content) continue;

    let match;
    while ((match = exportPattern.exec(content)) !== null) {
      functions.push({
        name: match[1],
        file,
      });
    }
  }

  return functions;
}

async function scanExistingAide(projectPath: string): Promise<string | null> {
  const aideFiles = await globFiles("*.aide", projectPath);
  if (aideFiles.length === 0) return null;

  return readFileSafe(join(projectPath, aideFiles[0]));
}

function shouldIncludeForFocus(
  file: string,
  type: "route" | "component" | "handler" | "machine",
  focus?: "frontend" | "backend" | "auth"
): boolean {
  if (!focus) return true;

  const fileLower = file.toLowerCase();

  const isBackendFile =
    fileLower.includes("/api/") ||
    fileLower.includes("api/") ||
    fileLower.includes("server/") ||
    fileLower.includes("backend/") ||
    file.endsWith(".py");

  const isFrontendFile =
    fileLower.includes("components/") ||
    (fileLower.includes("src/") && !isBackendFile) ||
    (fileLower.includes("app/") && fileLower.includes("page")) ||
    (fileLower.includes("pages/") && !fileLower.includes("/api/"));

  const isAuthFile =
    fileLower.includes("/auth/") ||
    fileLower.includes("auth/") ||
    fileLower.includes("login") ||
    fileLower.includes("session") ||
    fileLower.includes("/user");

  switch (focus) {
    case "frontend":
      return isFrontendFile && !isBackendFile;
    case "backend":
      return isBackendFile;
    case "auth":
      return isAuthFile;
    default:
      return true;
  }
}

async function scanCodebase(projectPath: string, focus?: "frontend" | "backend" | "auth"): Promise<CodebaseSummary> {
  const summary: CodebaseSummary = {
    routes: [],
    components: [],
    stateMachines: [],
    eventHandlers: [],
    exportedFunctions: [],
  };

  // Scan project info
  summary.project = await scanPackageJson(projectPath);

  // Read documentation
  summary.readme = await readFileSafe(join(projectPath, "README.md")) ?? undefined;
  summary.claudeMd = await readFileSafe(join(projectPath, "CLAUDE.md")) ?? undefined;

  // Detect framework
  const framework = summary.project ? detectFramework(summary.project) : null;

  // Scan routes
  const allRoutes = await scanRoutes(projectPath, framework);
  summary.routes = allRoutes.filter(r => shouldIncludeForFocus(r.file, "route", focus));

  // Scan components
  const allComponents = await scanReactComponents(projectPath);
  summary.components = allComponents.filter(c => shouldIncludeForFocus(c.file, "component", focus));

  // Scan state machines
  const allMachines = await scanStateMachines(projectPath);
  summary.stateMachines = allMachines.filter(m => shouldIncludeForFocus(m.file, "machine", focus));

  // Scan event handlers
  const allHandlers = await scanEventHandlers(projectPath);
  summary.eventHandlers = allHandlers.filter(h => shouldIncludeForFocus(h.file, "handler", focus));

  // Scan exported functions (for backend APIs)
  const allFunctions = await scanExportedFunctions(projectPath);
  summary.exportedFunctions = allFunctions.filter(f => shouldIncludeForFocus(f.file, "handler", focus));

  // Check for existing aide
  summary.existingAide = await scanExistingAide(projectPath) ?? undefined;

  return summary;
}

function formatPrompt(summary: CodebaseSummary): string {
  const sections: string[] = [];

  // Context about Bantay
  sections.push("# Bantay Aide Generation\n");
  sections.push("## What is Bantay?\n");
  sections.push("Bantay is a CLI tool that enforces project invariants. An **aide** is a YAML file that models your app's structure:");
  sections.push("- **Screens**: Pages/routes users navigate between");
  sections.push("- **Components**: Reusable UI elements");
  sections.push("- **CUJs (Critical User Journeys)**: End-to-end user flows with scenarios");
  sections.push("- **Transitions**: Navigation between screens\n");
  sections.push("Your task: Analyze the codebase below and generate `bantay aide add` commands to create entities for the **main user-facing screens and flows**. Focus on what users see and do, not internal utilities.\n");
  sections.push("---\n");

  // Header
  sections.push("# Codebase Analysis\n");

  // Project info
  if (summary.project) {
    sections.push("## Project Information\n");
    sections.push(`**Name:** ${summary.project.name}`);
    if (summary.project.description) {
      sections.push(`**Description:** ${summary.project.description}`);
    }

    const deps = Object.keys(summary.project.dependencies).join(", ");
    const devDeps = Object.keys(summary.project.devDependencies).join(", ");
    if (deps) sections.push(`**Dependencies:** ${deps}`);
    if (devDeps) sections.push(`**Dev Dependencies:** ${devDeps}`);
    sections.push("");
  }

  // Documentation
  if (summary.readme) {
    sections.push("## README Content\n");
    sections.push(truncateContent(summary.readme, 2000));
    sections.push("");
  }

  if (summary.claudeMd) {
    sections.push("## CLAUDE.md Content\n");
    sections.push(truncateContent(summary.claudeMd, 2000));
    sections.push("");
  }

  // Routes/Screens
  if (summary.routes.length > 0) {
    sections.push("## Detected Routes/Screens\n");
    for (const route of summary.routes) {
      if (route.method) {
        sections.push(`- ${route.method} ${route.path} (${route.file})`);
      } else {
        sections.push(`- ${route.path} (${route.file})`);
      }
    }
    sections.push("");
  }

  // Components
  if (summary.components.length > 0) {
    sections.push("## Detected Components\n");
    for (const comp of summary.components) {
      sections.push(`- ${comp.name} (${comp.file})`);
    }
    sections.push("");
  }

  // State machines
  if (summary.stateMachines.length > 0) {
    sections.push("## Detected State Machines\n");
    for (const machine of summary.stateMachines) {
      sections.push(`- **${machine.name}** (${machine.file})`);
      if (machine.states.length > 0) {
        sections.push(`  States: ${machine.states.join(", ")}`);
      }
      if (machine.actions.length > 0) {
        sections.push(`  Actions: ${machine.actions.join(", ")}`);
      }
    }
    sections.push("");
  }

  // Event handlers
  if (summary.eventHandlers.length > 0) {
    sections.push("## Detected Event Handlers\n");
    for (const handler of summary.eventHandlers) {
      sections.push(`- ${handler.name} (${handler.file})`);
    }
    sections.push("");
  }

  // Exported functions (API handlers, utilities)
  if (summary.exportedFunctions.length > 0) {
    sections.push("## Detected Exported Functions\n");
    for (const fn of summary.exportedFunctions) {
      sections.push(`- ${fn.name} (${fn.file})`);
    }
    sections.push("");
  }

  // Existing aide
  if (summary.existingAide) {
    sections.push("## Existing Aide\n");
    sections.push("The project already has an aide file. Compare code against the aide and identify:\n");
    sections.push("- **NEW**: Entities in code but not in aide");
    sections.push("- **CHANGED**: Entities that have drifted from aide");
    sections.push("- **MISSING**: Entities in aide but not found in code\n");
    sections.push("```yaml");
    sections.push(truncateContent(summary.existingAide, 4000));
    sections.push("```\n");
  }

  // Instructions for LLM
  sections.push("---\n");
  sections.push("## Your Task\n");
  sections.push("Generate `bantay aide add` commands for:\n");
  sections.push("1. **Screens** (prefix: `screen_`) — One per user-facing route/page");
  sections.push("2. **Key Components** (prefix: `comp_`) — Major UI elements users interact with");
  sections.push("3. **CUJs** (prefix: `cuj_`) — 3-5 critical user journeys (login, main task, etc.)\n");
  sections.push("**Do NOT include:**");
  sections.push("- Internal utilities, helpers, or infrastructure code");
  sections.push("- Every single component — only the important ones");
  sections.push("- Duplicate entities\n");

  if (summary.existingAide) {
    sections.push("**Reconciliation mode:** An existing aide was found. Identify:");
    sections.push("- **NEW**: Entities in code but missing from aide → generate `bantay aide add`");
    sections.push("- **CHANGED**: Entities that drifted → note the difference");
    sections.push("- **MISSING**: Entities in aide but not in code → note for removal\n");
  }

  sections.push("## Output Format\n");
  sections.push("```bash");
  sections.push("# Screens");
  sections.push('bantay aide add screen_home --parent screens --prop "name=Home" --prop "route=/"');
  sections.push('bantay aide add screen_dashboard --parent screens --prop "name=Dashboard" --prop "route=/dashboard"');
  sections.push("");
  sections.push("# Components");
  sections.push('bantay aide add comp_navbar --parent components --prop "name=Navigation Bar"');
  sections.push("");
  sections.push("# CUJs");
  sections.push('bantay aide add cuj_login --parent cujs --prop "feature=User logs in to access dashboard"');
  sections.push('bantay aide add sc_login_success --parent cuj_login --prop "name=Successful login" --prop "given=User has valid credentials" --prop "path=screen_login, screen_dashboard"');
  sections.push("");
  sections.push("# Relationships");
  sections.push("bantay aide link screen_home comp_navbar --type uses");
  sections.push("```\n");
  sections.push("Now analyze the codebase and generate the commands:");

  return sections.join("\n");
}

export async function runReverse(projectPath: string, options: ReverseOptions = {}): Promise<ReverseResult> {
  const warnings: string[] = [];

  // Scan the codebase
  const summary = await scanCodebase(projectPath, options.focus);

  // Generate the prompt
  const prompt = formatPrompt(summary);

  // Estimate tokens
  const tokenEstimate = estimateTokens(prompt);

  // Calculate entity counts
  const totalEntities =
    summary.routes.length +
    summary.components.length +
    summary.stateMachines.length +
    summary.eventHandlers.length +
    summary.exportedFunctions.length;

  // Warn if too large (either token count or entity count)
  if (tokenEstimate > 30000) {
    warnings.push(`Prompt is ~${tokenEstimate} tokens. Consider using --focus to narrow scope.`);
  } else if (totalEntities > 50) {
    warnings.push(`Large codebase detected (${totalEntities} entities). Consider using --focus to narrow scope.`);
  }

  return {
    prompt,
    tokenEstimate,
    warnings,
  };
}

export function formatReverseResult(result: ReverseResult): string {
  let output = result.prompt;

  if (result.warnings.length > 0) {
    output += "\n---\n";
    output += "Warnings:\n";
    for (const warning of result.warnings) {
      output += `  - ${warning}\n`;
    }
  }

  return output;
}
