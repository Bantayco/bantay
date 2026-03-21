import { readFile, readdir, access } from "fs/promises";
import { join, relative } from "path";
import * as yaml from "js-yaml";
import { tryResolveAidePath } from "../aide";

export interface StatusOptions {
  json?: boolean;
}

export interface ScenarioStatus {
  id: string;
  name: string;
  parentCuj: string;
  status: "implemented" | "missing";
  testFile?: string;
  line?: number;
}

export interface StatusSummary {
  total: number;
  implemented: number;
  missing: number;
}

export interface StatusResult {
  scenarios: ScenarioStatus[];
  summary: StatusSummary;
  cujs?: Record<string, string>;
  error?: string;
}

interface AideEntity {
  parent?: string;
  props?: {
    name?: string;
    feature?: string;
    [key: string]: unknown;
  };
}

interface AideFile {
  entities: Record<string, AideEntity>;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function findTestFiles(projectPath: string): Promise<string[]> {
  const files: string[] = [];

  // Test file extensions to look for
  const testExtensions = [".test.ts", ".test.tsx", ".test.js", ".test.jsx"];

  async function walk(dir: string): Promise<void> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          // Skip node_modules and hidden directories
          if (entry.name !== "node_modules" && !entry.name.startsWith(".")) {
            await walk(fullPath);
          }
        } else if (testExtensions.some(ext => entry.name.endsWith(ext))) {
          files.push(fullPath);
        }
      }
    } catch {
      // Directory doesn't exist or isn't readable
    }
  }

  // Search in common test locations
  const testDirs = [
    join(projectPath, "tests"),
    join(projectPath, "src", "__tests__"),
    join(projectPath, "__tests__"),
    join(projectPath, "test"),
    join(projectPath, "src"),  // For .test.tsx files alongside components
  ];

  for (const dir of testDirs) {
    await walk(dir);
  }

  return files;
}

async function searchTestFileForScenario(
  testFilePath: string,
  scenarioId: string
): Promise<{ found: boolean; line?: number }> {
  try {
    const content = await readFile(testFilePath, "utf-8");
    const lines = content.split("\n");

    // Priority 1: Look for explicit scenario marker (highest priority)
    // Formats: @scenario sc_xxx, // sc_xxx:, // sc_xxx, * @scenario sc_xxx
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (
        line.includes(`@scenario ${scenarioId}`) ||
        line.includes(`@scenario: ${scenarioId}`) ||
        line.includes(`// ${scenarioId}:`) ||
        line.includes(`// ${scenarioId} `) ||
        line.match(new RegExp(`\\*\\s*@scenario\\s+${scenarioId}\\b`))
      ) {
        return { found: true, line: i + 1 };
      }
    }

    // Priority 2: Look for describe/test block containing exact scenario ID
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Match scenario ID in describe block or test name
      const isDescribeOrTest = /^\s*(describe|test|it)\s*\(/.test(line);
      if (isDescribeOrTest && (line.includes(`"${scenarioId}"`) || line.includes(`'${scenarioId}'`))) {
        return { found: true, line: i + 1 };
      }
    }

    return { found: false };
  } catch {
    return { found: false };
  }
}

function scenarioIdToTestFileName(scenarioId: string): string[] {
  // Convert sc_init_prerequisites to possible test file names
  // sc_init_prerequisites -> [prerequisites, init-prerequisites, init]
  const withoutPrefix = scenarioId.replace(/^sc_/, "");
  const parts = withoutPrefix.split("_");

  const candidates: string[] = [];

  // Full name with dashes: init-prerequisites
  candidates.push(parts.join("-"));

  // Last part only: prerequisites
  if (parts.length > 1) {
    candidates.push(parts[parts.length - 1]);
    candidates.push(parts.slice(1).join("-"));
  }

  // First part only: init
  candidates.push(parts[0]);

  return candidates;
}

function testFileMatchesScenario(testFileName: string, scenarioId: string): boolean {
  const baseName = testFileName.replace(/\.test\.(ts|js)$/, "");
  const candidates = scenarioIdToTestFileName(scenarioId);

  return candidates.some(candidate => baseName === candidate);
}

export async function runStatus(
  projectPath: string,
  options?: StatusOptions
): Promise<StatusResult> {
  // Discover aide file
  const resolved = await tryResolveAidePath(projectPath);
  if (!resolved) {
    return {
      scenarios: [],
      summary: { total: 0, implemented: 0, missing: 0 },
      error: "No .aide file found. Run 'bantay aide init' to create one.",
    };
  }

  const aidePath = resolved.path;

  // Parse aide file
  let aideContent: AideFile;
  try {
    const rawContent = await readFile(aidePath, "utf-8");
    aideContent = yaml.load(rawContent) as AideFile;
  } catch (e) {
    return {
      scenarios: [],
      summary: { total: 0, implemented: 0, missing: 0 },
      error: `Failed to parse ${resolved.filename}: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (!aideContent?.entities) {
    return {
      scenarios: [],
      summary: { total: 0, implemented: 0, missing: 0 },
      error: `${resolved.filename} has no entities`,
    };
  }

  // Extract CUJ information
  const cujs: Record<string, string> = {};
  for (const [id, entity] of Object.entries(aideContent.entities)) {
    if (id.startsWith("cuj_") && entity.props?.feature) {
      cujs[id] = entity.props.feature;
    }
  }

  // Extract all sc_* entities
  const scenarios: ScenarioStatus[] = [];
  for (const [id, entity] of Object.entries(aideContent.entities)) {
    if (id.startsWith("sc_")) {
      scenarios.push({
        id,
        name: entity.props?.name || id,
        parentCuj: entity.parent || "unknown",
        status: "missing",
      });
    }
  }

  // Find test files
  const testFiles = await findTestFiles(projectPath);

  // Match scenarios to test files
  for (const scenario of scenarios) {
    // Priority 1: Explicit scenario ID in test file
    for (const testFile of testFiles) {
      // Skip status-command.test.ts as it's a meta test that contains scenario IDs as test data
      if (testFile.includes("status-command.test.ts")) {
        continue;
      }

      const result = await searchTestFileForScenario(testFile, scenario.id);
      if (result.found) {
        scenario.status = "implemented";
        scenario.testFile = relative(projectPath, testFile);
        scenario.line = result.line;
        break;
      }
    }

    // Priority 2: Test file name matches scenario (if not already matched)
    if (scenario.status === "missing") {
      for (const testFile of testFiles) {
        if (testFile.includes("status-command.test.ts")) {
          continue;
        }

        const fileName = testFile.split("/").pop() || "";
        if (testFileMatchesScenario(fileName, scenario.id)) {
          // Found a file that matches by name, but verify it has relevant tests
          try {
            const content = await readFile(testFile, "utf-8");
            // Ensure it's not an empty or stub test file
            if (content.includes("describe(") || content.includes("test(")) {
              scenario.status = "implemented";
              scenario.testFile = relative(projectPath, testFile);
              scenario.line = 1; // Start of file when matched by name
              break;
            }
          } catch {
            // Skip if can't read file
          }
        }
      }
    }
  }

  // Calculate summary
  const implemented = scenarios.filter((s) => s.status === "implemented").length;
  const missing = scenarios.filter((s) => s.status === "missing").length;

  return {
    scenarios,
    summary: {
      total: scenarios.length,
      implemented,
      missing,
    },
    cujs,
  };
}

export function formatStatus(result: StatusResult): string {
  if (result.error) {
    return `Error: ${result.error}\n`;
  }

  const lines: string[] = [];
  lines.push("# Scenario Implementation Status\n");

  // Group scenarios by CUJ
  const byParent: Record<string, ScenarioStatus[]> = {};
  for (const scenario of result.scenarios) {
    if (!byParent[scenario.parentCuj]) {
      byParent[scenario.parentCuj] = [];
    }
    byParent[scenario.parentCuj].push(scenario);
  }

  // Output by CUJ
  for (const [cuj, scenarios] of Object.entries(byParent)) {
    const cujName = result.cujs?.[cuj] || cuj;
    lines.push(`\n## ${cujName}\n`);

    for (const scenario of scenarios) {
      const icon = scenario.status === "implemented" ? "✓" : "○";
      const location = scenario.testFile
        ? `${scenario.testFile}${scenario.line ? `:${scenario.line}` : ""}`
        : "";

      lines.push(`${icon} ${scenario.id}: ${scenario.name}`);
      if (location) {
        lines.push(`  → ${location}`);
      }
    }
  }

  // Summary
  lines.push(`\n---`);
  lines.push(
    `Implemented: ${result.summary.implemented}/${result.summary.total} (${Math.round((result.summary.implemented / result.summary.total) * 100)}%)`
  );
  lines.push(`Missing: ${result.summary.missing}`);

  return lines.join("\n");
}
