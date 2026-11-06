import { readFile, access } from "fs/promises";
import { spawn } from "bun";
import { join } from "path";
import { parseInvariants, type Invariant } from "../generators/invariants";
import { runChecker, hasChecker, runStructuralCheckers } from "../checkers/registry";
import { createDecisionModel, DecisionError, type DecisionModel, type NoulQuestion } from "../decision";
import { loadConfig } from "../config";
import { getGitDiff, getGitDiffText, shouldCheckInvariant } from "../diff";
import type { CheckResult, CheckerContext, StructuralCheckResult } from "../checkers/types";
import { read as readAide, tryResolveAidePath } from "@bantay/aide/node";

export interface CheckOptions {
  /** Inject a decision model (tests). Overrides config. */
  decisionModel?: DecisionModel;
  /** Disable the decision oracle even if configured. */
  noOracle?: boolean;
  id?: string;
  diff?: string;
}

export interface CheckSummary {
  review: number;
  passed: number;
  failed: number;
  skipped: number;
  tested: number;
  enforced: number;
  total: number;
  results: CheckResult[];
  structuralResults: StructuralCheckResult[];
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
  let diffText = "";
  if (options.diff) {
    const diffResult = await getGitDiff(projectPath, options.diff);
    affectedCategories = diffResult.categories;
    diffText = await getGitDiffText(projectPath, options.diff);
  }

  // Resolve the decision oracle (Jev or a swappable stand-in)
  let oracle: DecisionModel | null = null;
  let threshold = 0.8;
  if (!options.noOracle) {
    if (options.decisionModel) {
      oracle = options.decisionModel;
      threshold = config.decision?.threshold ?? threshold;
    } else {
      const resolved = createDecisionModel(config.decision);
      oracle = resolved.model;
      threshold = resolved.threshold;
    }
  }
  /** Invariants with no static enforcement, queued for the oracle. */
  const oracleQueue: Invariant[] = [];

  // Get enforcement info (checker and test paths) from bantay.aide
  const enforcementInfo = await getEnforcementInfo(projectPath);

  // Run checkers for each invariant
  const results: CheckResult[] = [];

  for (const invariant of invariants) {
    // In diff mode, invariants for unaffected categories have no static
    // checker to run — but the oracle can still judge them against the diff.
    if (affectedCategories && !shouldCheckInvariant(invariant.category, affectedCategories)) {
      if (oracle && diffText) oracleQueue.push(invariant);
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
    } else if (hasChecker(invariant.category)) {
      // Built-in checker
      const result = await runChecker(invariant, context);
      results.push(result);
    } else if (oracle && diffText) {
      oracleQueue.push(invariant);
    } else {
      results.push(await runChecker(invariant, context)); // yields "skipped"
    }
  }

  // One batched oracle call: every unenforced invariant as a noul question
  // against the diff. Jev evaluates the questions in parallel.
  if (oracle && oracleQueue.length > 0) {
    results.push(...(await runOracle(oracle, threshold, diffText, oracleQueue)));
  }

  // Run structural checkers (independent of invariants)
  const structuralResults = await runStructuralCheckers(context);

  // Calculate summary - include structural results in pass/fail counts
  const structuralPassed = structuralResults.filter((r) => r.status === "pass").length;
  const structuralFailed = structuralResults.filter((r) => r.status === "fail").length;

  const summary: CheckSummary = {
    review: results.filter((r) => r.status === "review").length,
    passed: results.filter((r) => r.status === "pass").length + structuralPassed,
    failed: results.filter((r) => r.status === "fail").length + structuralFailed,
    skipped: results.filter((r) => r.status === "skipped").length,
    tested: results.filter((r) => r.status === "tested").length,
    enforced: results.filter((r) => r.status === "enforced").length,
    total: results.length + structuralResults.length,
    results,
    structuralResults,
  };

  return summary;
}

export interface JsonCheckOutput {
  timestamp: string;
  commit: string | null;
  results: Array<{
    id: string;
    status: "pass" | "fail" | "skipped" | "tested" | "enforced" | "review";
    message?: string;
    oracle?: { provider: string; model: string; violationProbability: number; threshold: number };
    violations?: Array<{
      file: string;
      line?: number;
      message: string;
    }>;
  }>;
  structuralResults: Array<{
    name: string;
    status: "pass" | "fail";
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
    review: number;
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
      oracle: result.oracle,
      violations:
        result.violations.length > 0
          ? result.violations.map((v) => ({
              file: v.filePath,
              line: v.line,
              message: v.message,
            }))
          : undefined,
    })),
    structuralResults: (summary.structuralResults || []).map((result) => ({
      name: result.name,
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
      review: summary.review,
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
      : result.status === "review" ? "?"
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

  // Display structural check results
  if (summary.structuralResults && summary.structuralResults.length > 0) {
    lines.push("Structural Checks");
    lines.push("-----------------");
    lines.push("");

    for (const result of summary.structuralResults) {
      const statusIcon = result.status === "pass" ? "✓" : "✗";
      const statusText = result.status.toUpperCase();

      lines.push(`${statusIcon} [${result.name}] ${statusText}`);

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


/**
 * Ask the decision oracle whether the diff violates each invariant.
 * One request, N noul questions. Verdict per invariant:
 *   P(violated) >= threshold       → fail
 *   P(violated) <= 1 - threshold   → pass
 *   otherwise                      → review (escalate to a human)
 */
export async function runOracle(
  oracle: DecisionModel,
  threshold: number,
  diffText: string,
  invariants: Invariant[]
): Promise<CheckResult[]> {
  const questions: Record<string, NoulQuestion> = {};
  for (const inv of invariants) {
    questions[inv.id] = {
      type: "noul",
      instructions: `Does the code change in \`diff\` violate this invariant? Invariant (${inv.category}): ${inv.statement}`,
      criteria: {
        true: "The change introduces or leaves code that breaks the invariant.",
        false: "The change does not touch the invariant, or preserves it.",
      },
    };
  }

  let response;
  try {
    response = await oracle.decide({ state: { diff: diffText }, questions });
  } catch (err) {
    const msg = err instanceof DecisionError ? err.message : String(err);
    return invariants.map((invariant) => ({
      invariant,
      status: "skipped" as const,
      violations: [],
      message: `Decision oracle unavailable: ${msg}`,
    }));
  }

  return invariants.map((invariant) => {
    const a = response.answers[invariant.id];
    if (!a || a.type !== "noul") {
      return {
        invariant,
        status: "skipped" as const,
        violations: [],
        message: "Decision oracle returned no answer",
      };
    }
    const p = a.probability;
    const oracleInfo = {
      provider: oracle.name,
      model: response.model,
      violationProbability: p,
      threshold,
    };
    if (p >= threshold) {
      return {
        invariant,
        status: "fail" as const,
        violations: [{ filePath: "(diff)", message: `Oracle: P(violated)=${p.toFixed(2)}` }],
        message: `Decision oracle (${oracle.name}) judged the diff violates this invariant`,
        oracle: oracleInfo,
      };
    }
    if (p <= 1 - threshold) {
      return {
        invariant,
        status: "pass" as const,
        violations: [],
        message: `Decision oracle (${oracle.name}): P(violated)=${p.toFixed(2)}`,
        oracle: oracleInfo,
      };
    }
    return {
      invariant,
      status: "review" as const,
      violations: [],
      message: `Decision oracle (${oracle.name}) not confident: P(violated)=${p.toFixed(2)} — needs human review`,
      oracle: oracleInfo,
    };
  });
}
