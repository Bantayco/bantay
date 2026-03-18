/**
 * Helpers to extract entities from the aide tree for export
 */

import type { AideTree, Entity } from "../aide";
import type {
  ExtractedInvariant,
  ExtractedConstraint,
  ExtractedFoundation,
  ExtractedWisdom,
} from "./types";

/**
 * Extract all invariants from the aide tree
 * Invariants are entities with parent "invariants"
 */
export function extractInvariants(tree: AideTree): ExtractedInvariant[] {
  const invariants: ExtractedInvariant[] = [];

  for (const [id, entity] of Object.entries(tree.entities)) {
    if (entity.parent === "invariants" && entity.props) {
      const props = entity.props;
      invariants.push({
        id,
        statement: String(props.statement || ""),
        category: String(props.category || "uncategorized"),
        threatSignal: props.threat_signal ? String(props.threat_signal) : undefined,
        done: props.done === true,
      });
    }
  }

  return invariants;
}

/**
 * Extract all constraints from the aide tree
 * Constraints are entities with parent "constraints"
 */
export function extractConstraints(tree: AideTree): ExtractedConstraint[] {
  const constraints: ExtractedConstraint[] = [];

  for (const [id, entity] of Object.entries(tree.entities)) {
    if (entity.parent === "constraints" && entity.props) {
      const props = entity.props;
      constraints.push({
        id,
        text: String(props.text || ""),
        domain: String(props.domain || "general"),
        rationale: props.rationale ? String(props.rationale) : undefined,
      });
    }
  }

  return constraints;
}

/**
 * Extract all foundations from the aide tree
 * Foundations are entities with parent "foundations"
 */
export function extractFoundations(tree: AideTree): ExtractedFoundation[] {
  const foundations: ExtractedFoundation[] = [];

  for (const [id, entity] of Object.entries(tree.entities)) {
    if (entity.parent === "foundations" && entity.props) {
      const props = entity.props;
      foundations.push({
        id,
        text: String(props.text || ""),
      });
    }
  }

  return foundations;
}

/**
 * Extract all wisdom entries from the aide tree
 * Wisdom entries are entities with parent "wisdom"
 */
export function extractWisdom(tree: AideTree): ExtractedWisdom[] {
  const wisdom: ExtractedWisdom[] = [];

  for (const [id, entity] of Object.entries(tree.entities)) {
    if (entity.parent === "wisdom" && entity.props) {
      const props = entity.props;
      wisdom.push({
        id,
        text: String(props.text || ""),
      });
    }
  }

  return wisdom;
}

/**
 * Group items by a key
 */
export function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const key = keyFn(item);
    const existing = groups.get(key) || [];
    existing.push(item);
    groups.set(key, existing);
  }

  return groups;
}
