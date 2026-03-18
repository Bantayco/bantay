/**
 * Export invariants.md from the aide tree
 */

import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { read as readAide } from "../aide";
import { extractInvariants, groupBy } from "./aide-reader";
import type { ExportOptions, ExportResult, ExtractedInvariant } from "./types";

/**
 * Generate invariants.md content from the aide tree
 */
export function generateInvariantsMd(invariants: ExtractedInvariant[]): string {
  const lines: string[] = [];

  lines.push("# Invariants");
  lines.push("");
  lines.push("Rules this project must never break. Generated from bantay.aide.");
  lines.push("");

  // Group by category
  const byCategory = groupBy(invariants, (inv) => inv.category);

  // Sort categories for consistent output
  const sortedCategories = Array.from(byCategory.keys()).sort();

  for (const category of sortedCategories) {
    const categoryInvariants = byCategory.get(category) || [];

    lines.push(`## ${formatCategoryTitle(category)}`);
    lines.push("");

    for (const inv of categoryInvariants) {
      // Format: - [ ] ID: statement
      const checkbox = inv.done ? "[x]" : "[ ]";
      lines.push(`- ${checkbox} **${inv.id}**: ${inv.statement}`);

      // Add threat signal as sub-item if present
      if (inv.threatSignal) {
        lines.push(`  - Threat: ${inv.threatSignal}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format a category ID into a readable title
 * e.g., "correctness" -> "Correctness"
 */
function formatCategoryTitle(category: string): string {
  return category
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Export invariants.md from the aide file
 */
export async function exportInvariants(
  projectPath: string,
  options: ExportOptions = {}
): Promise<ExportResult> {
  const aidePath = options.aidePath || join(projectPath, "bantay.aide");
  const outputPath = options.outputPath || join(projectPath, "invariants.md");

  // Read the aide tree
  const tree = await readAide(aidePath);

  // Extract invariants
  const invariants = extractInvariants(tree);

  // Generate content
  const content = generateInvariantsMd(invariants);

  // Write unless dry run
  if (!options.dryRun) {
    await writeFile(outputPath, content, "utf-8");
  }

  return {
    target: "invariants",
    outputPath,
    content,
    bytesWritten: Buffer.byteLength(content, "utf-8"),
  };
}
