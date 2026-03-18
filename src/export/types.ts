/**
 * Export types for bantay export command
 */

/**
 * An invariant extracted from the aide tree
 */
export interface ExtractedInvariant {
  id: string;
  statement: string;
  category: string;
  threatSignal?: string;
  done?: boolean;
}

/**
 * A constraint extracted from the aide tree
 */
export interface ExtractedConstraint {
  id: string;
  text: string;
  domain: string;
  rationale?: string;
}

/**
 * A foundation extracted from the aide tree
 */
export interface ExtractedFoundation {
  id: string;
  text: string;
}

/**
 * A wisdom entry extracted from the aide tree
 */
export interface ExtractedWisdom {
  id: string;
  text: string;
}

/**
 * Export target types
 */
export type ExportTarget = "invariants" | "claude" | "cursor" | "codex";

/**
 * Options for export commands
 */
export interface ExportOptions {
  aidePath?: string;
  outputPath?: string;
  dryRun?: boolean;
}

/**
 * Result of an export operation
 */
export interface ExportResult {
  target: ExportTarget;
  outputPath: string;
  content: string;
  bytesWritten: number;
}

/**
 * Section markers for agent context files
 */
export const SECTION_START = "<!-- bantay:start -->";
export const SECTION_END = "<!-- bantay:end -->";
