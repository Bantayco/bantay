/**
 * Export to CLAUDE.md with section markers
 */

import { readFile, writeFile, access } from "fs/promises";
import { join } from "path";
import { read as readAide } from "../aide";
import {
  extractConstraints,
  extractFoundations,
  extractInvariants,
  groupBy,
} from "./aide-reader";
import {
  type ExportOptions,
  type ExportResult,
  type ExtractedConstraint,
  type ExtractedFoundation,
  type ExtractedInvariant,
  SECTION_START,
  SECTION_END,
} from "./types";

/**
 * Generate the Bantay section content for CLAUDE.md
 */
export function generateClaudeSection(
  constraints: ExtractedConstraint[],
  foundations: ExtractedFoundation[],
  invariants: ExtractedInvariant[]
): string {
  const lines: string[] = [];

  lines.push(SECTION_START);
  lines.push("");
  lines.push("## Bantay Project Rules");
  lines.push("");
  lines.push("*Auto-generated from bantay.aide. Do not edit manually.*");
  lines.push("");

  // Foundations as principles
  if (foundations.length > 0) {
    lines.push("### Design Principles");
    lines.push("");
    for (const f of foundations) {
      lines.push(`- ${f.text}`);
    }
    lines.push("");
  }

  // Constraints grouped by domain
  if (constraints.length > 0) {
    lines.push("### Architectural Constraints");
    lines.push("");

    const byDomain = groupBy(constraints, (c) => c.domain);
    const sortedDomains = Array.from(byDomain.keys()).sort();

    for (const domain of sortedDomains) {
      const domainConstraints = byDomain.get(domain) || [];

      lines.push(`#### ${formatDomainTitle(domain)}`);
      lines.push("");

      for (const c of domainConstraints) {
        lines.push(`- **${c.id}**: ${c.text}`);
        if (c.rationale) {
          lines.push(`  - *Rationale*: ${c.rationale}`);
        }
      }
      lines.push("");
    }
  }

  // Invariants as rules
  if (invariants.length > 0) {
    lines.push("### Invariants (Rules You Must Follow)");
    lines.push("");

    const byCategory = groupBy(invariants, (inv) => inv.category);
    const sortedCategories = Array.from(byCategory.keys()).sort();

    for (const category of sortedCategories) {
      const categoryInvariants = byCategory.get(category) || [];

      lines.push(`#### ${formatCategoryTitle(category)}`);
      lines.push("");

      for (const inv of categoryInvariants) {
        lines.push(`- **${inv.id}**: ${inv.statement}`);
      }
      lines.push("");
    }
  }

  lines.push(SECTION_END);

  return lines.join("\n");
}

/**
 * Format a domain ID into a readable title
 */
function formatDomainTitle(domain: string): string {
  return domain
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Format a category ID into a readable title
 */
function formatCategoryTitle(category: string): string {
  return category
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Find the position of a marker at the start of a line (not inline)
 * Returns -1 if not found
 */
function findMarkerPosition(content: string, marker: string): number {
  // Match marker at start of line (with optional leading whitespace)
  const regex = new RegExp(`^[ \\t]*${escapeRegex(marker)}`, "m");
  const match = content.match(regex);
  if (match && match.index !== undefined) {
    // Return the position of the marker itself, not the leading whitespace
    return content.indexOf(marker, match.index);
  }
  return -1;
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Insert or replace the Bantay section in a file
 * Only matches markers at the start of a line, not inline markers
 */
export function insertSection(existingContent: string, newSection: string): string {
  const startIdx = findMarkerPosition(existingContent, SECTION_START);
  const endIdx = findMarkerPosition(existingContent, SECTION_END);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    // Replace existing section
    const before = existingContent.slice(0, startIdx);
    const after = existingContent.slice(endIdx + SECTION_END.length);
    return before + newSection + after;
  }

  // Append section at end
  if (existingContent.length > 0 && !existingContent.endsWith("\n")) {
    return existingContent + "\n\n" + newSection + "\n";
  }
  if (existingContent.length > 0) {
    return existingContent + "\n" + newSection + "\n";
  }
  return newSection + "\n";
}

/**
 * Check if a file exists
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Export to CLAUDE.md
 */
export async function exportClaude(
  projectPath: string,
  options: ExportOptions = {}
): Promise<ExportResult> {
  const aidePath = options.aidePath || join(projectPath, "bantay.aide");
  const outputPath = options.outputPath || join(projectPath, "CLAUDE.md");

  // Read the aide tree
  const tree = await readAide(aidePath);

  // Extract entities
  const constraints = extractConstraints(tree);
  const foundations = extractFoundations(tree);
  const invariants = extractInvariants(tree);

  // Generate section content
  const section = generateClaudeSection(constraints, foundations, invariants);

  // Read existing file if it exists
  let existingContent = "";
  if (await fileExists(outputPath)) {
    existingContent = await readFile(outputPath, "utf-8");
  }

  // Insert or replace section
  const content = insertSection(existingContent, section);

  // Write unless dry run
  if (!options.dryRun) {
    await writeFile(outputPath, content, "utf-8");
  }

  return {
    target: "claude",
    outputPath,
    content,
    bytesWritten: Buffer.byteLength(content, "utf-8"),
  };
}
