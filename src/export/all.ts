/**
 * Export all targets at once
 */

import { exportInvariants } from "./invariants";
import { exportClaude } from "./claude";
import { exportCursor } from "./cursor";
import type { ExportOptions, ExportResult } from "./types";

/**
 * Export all targets: invariants.md, CLAUDE.md, .cursorrules
 */
export async function exportAll(
  projectPath: string,
  options: ExportOptions = {}
): Promise<ExportResult[]> {
  const results: ExportResult[] = [];

  // Export invariants.md
  results.push(await exportInvariants(projectPath, options));

  // Export CLAUDE.md
  results.push(await exportClaude(projectPath, options));

  // Export .cursorrules
  results.push(await exportCursor(projectPath, options));

  return results;
}
