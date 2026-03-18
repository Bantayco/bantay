/**
 * Export module - generates output files from bantay.aide
 */

export { exportInvariants, generateInvariantsMd } from "./invariants";
export { exportClaude, generateClaudeSection, insertSection } from "./claude";
export { exportCursor } from "./cursor";
export { exportAll } from "./all";

export type {
  ExportOptions,
  ExportResult,
  ExportTarget,
  ExtractedInvariant,
  ExtractedConstraint,
  ExtractedFoundation,
  ExtractedWisdom,
} from "./types";

export { SECTION_START, SECTION_END } from "./types";

export {
  extractInvariants,
  extractConstraints,
  extractFoundations,
  extractWisdom,
  groupBy,
} from "./aide-reader";
