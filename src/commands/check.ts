import { readFile, access } from "fs/promises";
import { spawn } from "bun";
import { join } from "path";
import { parseInvariants, type Invariant } from "../generators/invariants";
import { runChecker, hasChecker } from "../checkers/registry";
import { loadConfig } from "../config";
import { getGitDiff, shouldCheckInvariant } from "../diff";
import type { CheckResult, CheckerContext } from "../checkers/types";
import { read as readAide, tryResolveAidePath } from "../aide";

export interface CheckOptions {
  id?: string;
  diff?: string;
}

export interface CheckSummary {
  passed: number;
  failed: number;
  skipped: number;
  tested: number;
  enforced: number;
  total: number;
  results: CheckResult[];
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

interface ProjectCheckerResult {
  pass: boolean;
  violations: Array<{ file: string; line: number; message: string }>;
}

interface InvariantEnforcementInfo {
  checker?: string;
  test?: string;
  enforced?: string;
}

/**
 * Load checker and test paths from .aide file for each invariant
 */
async function getEnforcementInfo(
  projectPath: string
): Promise<Map<string, InvariantEnforcementInfo>> {
  const info = new Map<string, InvariantEnforcementInfo>();

  // Try to discover the aide file
  const resolved = await tryResolveAidePath(projectPath);
  if (!resolved) {
    return info; // No aide file found, return empty map
  }

  try {
    const tree = await readAide(resolved.path);
    for (const [id, entity] of Object.entries(tree.entities)) {
      if (id.startsWith("inv_")) {
        const enforcement: InvariantEnforcementInfo = {};
        if (entity.props?.checker) {
          enforcement.checker = entity.props.checker as string;
        }
        if (entity.props?.test) {
          enforcement.test = entity.props.test as string;
        }
        if (entity.props?.enforced) {
          enforcement.enforced = entity.props.enforced as string;
        }
        if (enforcement.checker || enforcement.test || enforcement.enforced) {
          info.set(id, enforcement);
        }
      }
    }
  } catch {
    // No aide file or can't read it
  }

  return info;
}

/**
 * Run a project checker from .bantay/checkers/
 */
async function runProjectChecker(
  checkerPath: string,
  projectPath: string
): Promise<ProjectCheckerResult> {
  // checkerPath is like "./no-eval" or "./bin-field"
  const checkerFile = checkerPath.startsWith("./")
    ? checkerPath.slice(2) + ".ts"
    : checkerPath + ".ts";
  const fullPath = join(projectPath, ".bantay", "checkers", checkerFile);

  try {
    // Import and run the checker
    const checker = await import(fullPath);

    if (typeof checker.check !== "function") {
      return {
        pass: false,
        violations: [
          {
            file: checkerFile,
            line: 0,
            message: "Checker does not export a check() function",
          },
        ],
      };
    }

    const result = await checker.check({ projectPath });

    return {
      pass: result.pass === true,
      violations: Array.isArray(result.violations) ? result.violations : [],
    };
  } catch (err) {
    return {
      pass: false,
      violations: [
        {
          file: checkerFile,
          line: 0,
          message: `Failed to run checker: ${err instanceof Error ? err.message : err}`,
        },
      ],
    };
  }
}

export async function runCheck(
  projectPath: string,
  options: CheckOptions = {}
): Promise<CheckSummary> {
  const invariantsPath = join(projectPath, "invariants.md");

  // Check if invariants.md exists
  if (!(await fileExists(invariantsPath))) {
    throw new Error(
      'No invariants.md found. Run "bantay init" to create one.'
    );
  }

  // Load invariants
  const content = await readFile(invariantsPath, "utf-8");
  let invariants = parseInvariants(content);

  // Filter by ID if specified
  if (options.id) {
    invariants = invariants.filter((inv) => inv.id === options.id);
    if (invariants.length === 0) {
      throw new Error(`Invariant with ID "${options.id}" not found.`);
    }
  }

  // Load config
  const config = await loadConfig(projectPath);

  const context: CheckerContext = {
    projectPath,
    config,
  };

  // Get diff info if in diff mode
  let affectedCategories: Set<string> | null = null;
  if (options.diff) {
    const diffResult = await getGitDiff(projectPath, options.diff);
    affectedCategories = diffResult.categories;
  }

  // Get enforcement info (checker and test paths) from bantay.aide
  const enforcementInfo = await getEnforcementInfo(projectPath);

  // Run checkers for each invariant
  const results: CheckResult[] = [];

  for (const invariant of invariants) {
    // In diff mode, skip invariants for unaffected categories
    if (affectedCategories && !shouldCheckInvariant(invariant.category, affectedCategories)) {
      // Skip this invariant entirely - don't even report it
      continue;
    }

    // Get enforcement info for this invariant
    const enforcement = enforcementInfo.get(invariant.id);

    if (enforcement?.checker) {
      // Run project checker
      const projectResult = await runProjectChecker(enforcement.checker, projectPath);
      results.push({
        invariant,
        status: projectResult.pass ? "pass" : "fail",
        violations: projectResult.violations.map(v => ({
          filePath: v.file,
          line: v.line,
          message: v.message,
        })),
        message: projectResult.pass ? undefined : `Project checker: ${enforcement.checker}`,
      });
    } else if (enforcement?.test) {
      // Invariant is enforced by a test, not a checker
      results.push({
        invariant,
        status: "tested",
        violations: [],
        message: `Enforced by test: ${enforcement.test}`,
      });
    } else if (enforcement?.enforced) {
      // Invariant is enforced by implementation code directly
      results.push({
        invariant,
        status: "enforced",
        violations: [],
        message: `Enforced by: ${enforcement.enforced}`,
      });
    } else {
      // Try built-in checker
      const result = await runChecker(invariant, context);
      results.push(result);
    }
  }

  // Calculate summary
  const summary: CheckSummary = {
    passed: results.filter((r) => r.status === "pass").length,
    failed: results.filter((r) => r.status === "fail").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    tested: results.filter((r) => r.status === "tested").length,
    enforced: results.filter((r) => r.status === "enforced").length,
    total: results.length,
    results,
  };

  return summary;
}

export interface JsonCheckOutput {
  timestamp: string;
  commit: string | null;
  results: Array<{
    id: string;
    status: "pass" | "fail" | "skipped" | "tested" | "enforced";
    message?: string;
    violations?: Array<{
      file: string;
      line?: number;
      message: string;
    }>;
  }>;
  summary: {
    passed: number;
    failed: number;
    skipped: number;
    tested: number;
    enforced: number;
    total: number;
  };
}

async function getGitCommit(projectPath: string): Promise<string | null> {
  try {
    const proc = spawn({
      cmd: ["git", "rev-parse", "HEAD"],
      cwd: projectPath,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [exitCode, stdout] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
    ]);

    if (exitCode === 0) {
      return stdout.trim();
    }
    return null;
  } catch {
    return null;
  }
}

export async function formatCheckResultsJson(
  summary: CheckSummary,
  projectPath: string
): Promise<JsonCheckOutput> {
  const commit = await getGitCommit(projectPath);

  return {
    timestamp: new Date().toISOString(),
    commit,
    results: summary.results.map((result) => ({
      id: result.invariant.id,
      status: result.status,
      message: result.message,
      violations:
        result.violations.length > 0
          ? result.violations.map((v) => ({
              file: v.filePath,
              line: v.line,
              message: v.message,
            }))
          : undefined,
    })),
    summary: {
      passed: summary.passed,
      failed: summary.failed,
      skipped: summary.skipped,
      tested: summary.tested,
      enforced: summary.enforced,
      total: summary.total,
    },
  };
}

export function formatCheckResults(summary: CheckSummary): string {
  const lines: string[] = [];

  lines.push("Invariant Check Results");
  lines.push("=======================");
  lines.push("");

  for (const result of summary.results) {
    const statusIcon = result.status === "pass" ? "✓"
      : result.status === "fail" ? "✗"
      : result.status === "tested" ? "~"
      : result.status === "enforced" ? "◆"
      : "○";
    const statusText = result.status.toUpperCase();

    lines.push(`${statusIcon} [${result.invariant.id}] ${statusText}`);
    lines.push(`  ${result.invariant.statement}`);

    if (result.message) {
      lines.push(`  Note: ${result.message}`);
    }

    for (const violation of result.violations) {
      const location = violation.line
        ? `${violation.filePath}:${violation.line}`
        : violation.filePath;
      lines.push(`  - ${location}: ${violation.message}`);
    }

    lines.push("");
  }

  lines.push("Summary");
  lines.push("-------");
  const parts = [`${summary.passed} passed`, `${summary.failed} failed`];
  if (summary.tested > 0) {
    parts.push(`${summary.tested} tested`);
  }
  if (summary.enforced > 0) {
    parts.push(`${summary.enforced} enforced`);
  }
  if (summary.skipped > 0) {
    parts.push(`${summary.skipped} skipped`);
  }
  lines.push(parts.join(", "));

  return lines.join("\n");
}
