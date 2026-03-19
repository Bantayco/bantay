/**
 * Export to .cursorrules with section markers
 */

import { readFile, writeFile, access } from "fs/promises";
import { join } from "path";
import { read as readAide, resolveAidePath } from "../aide";
import {
  extractConstraints,
  extractFoundations,
  extractInvariants,
} from "./aide-reader";
import { generateClaudeSection, insertSection } from "./claude";
import type { ExportOptions, ExportResult } from "./types";

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
 * Export to .cursorrules
 */
export async function exportCursor(
  projectPath: string,
  options: ExportOptions = {}
): Promise<ExportResult> {
  // Discover aide file if not explicitly provided
  const resolved = await resolveAidePath(projectPath, options.aidePath);
  const aidePath = resolved.path;
  const outputPath = options.outputPath || join(projectPath, ".cursorrules");

  // Read the aide tree
  const tree = await readAide(aidePath);

  // Extract entities
  const constraints = extractConstraints(tree);
  const foundations = extractFoundations(tree);
  const invariants = extractInvariants(tree);

  // Generate section content (same format as claude)
  const section = generateClaudeSection(constraints, foundations, invariants, resolved.filename);

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
    target: "cursor",
    outputPath,
    content,
    bytesWritten: Buffer.byteLength(content, "utf-8"),
  };
}
