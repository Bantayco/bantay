/**
 * derive-graph command
 *
 * Derives screen states and transitions from plain-English actions in the aide.
 * Implements cuj_derive_graph scenarios.
 */

import { read, tryResolveAidePath, type AideTree } from "../aide";

export interface DeriveGraphOptions {
  aide?: string;
  json?: boolean;
}

export interface DeriveGraphResult {
  states: DerivedState[];
  transitions: DerivedTransition[];
  diff: GraphDiff;
}

export interface DerivedState {
  id: string;
  screen: string;
  componentVariants: Record<string, string>;
}

export interface DerivedTransition {
  id: string;
  from: string;
  to: string;
  action: string;
  trigger?: string;
}

export interface GraphDiff {
  newStates: DerivedState[];
  orphanedStates: string[];
  newTransitions: DerivedTransition[];
  orphanedTransitions: string[];
  matchingStates: string[];
  matchingTransitions: string[];
  hasChanges: boolean;
}

interface AideEntity {
  props?: Record<string, unknown>;
}

/**
 * Derives unique screen states from aide entities.
 *
 * States can come from two sources:
 * 1. tr_* transition entities - extracts from/to state references
 * 2. st_* state entities - extracts full state definition with screen + variants
 */
export function deriveStates(
  entities: Record<string, AideEntity>
): DerivedState[] {
  const stateMap = new Map<string, DerivedState>();

  for (const [id, entity] of Object.entries(entities)) {
    // Handle st_* state entities directly
    if (id.startsWith("st_")) {
      const props = entity.props || {};
      const screen = props.screen as string | undefined;
      const componentVariants: Record<string, string> = {};

      // Extract component variants (comp_* props)
      for (const [key, value] of Object.entries(props)) {
        if (key.startsWith("comp_") && typeof value === "string") {
          componentVariants[key] = value;
        }
      }

      stateMap.set(id, {
        id,
        screen: screen || "",
        componentVariants,
      });
    }

    // Handle tr_* transition entities - extract from/to state references
    if (id.startsWith("tr_")) {
      const props = entity.props || {};
      const from = props.from as string | undefined;
      const to = props.to as string | undefined;

      if (from && !stateMap.has(from)) {
        stateMap.set(from, {
          id: from,
          screen: "",
          componentVariants: {},
        });
      }

      if (to && !stateMap.has(to)) {
        stateMap.set(to, {
          id: to,
          screen: "",
          componentVariants: {},
        });
      }
    }
  }

  return Array.from(stateMap.values());
}

/**
 * Derives transitions from tr_* entities in the aide.
 */
export function deriveTransitions(
  entities: Record<string, AideEntity>
): DerivedTransition[] {
  const transitions: DerivedTransition[] = [];

  for (const [id, entity] of Object.entries(entities)) {
    if (!id.startsWith("tr_")) {
      continue;
    }

    const props = entity.props || {};
    const from = props.from as string | undefined;
    const to = props.to as string | undefined;
    const action = props.action as string | undefined;
    const trigger = props.trigger as string | undefined;

    if (from && to) {
      const transition: DerivedTransition = {
        id,
        from,
        to,
        action: action || "",
      };

      if (trigger) {
        transition.trigger = trigger;
      }

      transitions.push(transition);
    }
  }

  return transitions;
}

/**
 * Compares derived graph against existing aide entities.
 * Returns diff showing new, orphaned, and matching items.
 */
export function diffGraph(
  derivedStates: DerivedState[],
  derivedTransitions: DerivedTransition[],
  existingStates: Record<string, AideEntity>,
  existingTransitions: Record<string, AideEntity>
): GraphDiff {
  const derivedStateIds = new Set(derivedStates.map((s) => s.id));
  const existingStateIds = new Set(Object.keys(existingStates));

  const derivedTransitionIds = new Set(derivedTransitions.map((t) => t.id));
  const existingTransitionIds = new Set(Object.keys(existingTransitions));

  // New states: in derived but not in existing
  const newStates = derivedStates.filter((s) => !existingStateIds.has(s.id));

  // Orphaned states: in existing but not in derived
  const orphanedStates = Array.from(existingStateIds).filter(
    (id) => !derivedStateIds.has(id)
  );

  // New transitions: in derived but not in existing
  const newTransitions = derivedTransitions.filter(
    (t) => !existingTransitionIds.has(t.id)
  );

  // Orphaned transitions: in existing but not in derived
  const orphanedTransitions = Array.from(existingTransitionIds).filter(
    (id) => !derivedTransitionIds.has(id)
  );

  // Matching states: in both derived and existing
  const matchingStates = Array.from(derivedStateIds).filter((id) =>
    existingStateIds.has(id)
  );

  // Matching transitions: in both derived and existing
  const matchingTransitions = Array.from(derivedTransitionIds).filter((id) =>
    existingTransitionIds.has(id)
  );

  const hasChanges =
    newStates.length > 0 ||
    orphanedStates.length > 0 ||
    newTransitions.length > 0 ||
    orphanedTransitions.length > 0;

  return {
    newStates,
    orphanedStates,
    newTransitions,
    orphanedTransitions,
    matchingStates,
    matchingTransitions,
    hasChanges,
  };
}

/**
 * Run the derive-graph command.
 * Derives states and transitions from aide, compares against existing graph entities.
 */
export async function runDeriveGraph(
  projectPath: string,
  options: DeriveGraphOptions = {}
): Promise<DeriveGraphResult> {
  // Resolve aide path
  const resolved = await tryResolveAidePath(projectPath, options.aide);
  if (!resolved) {
    throw new Error("Could not find aide file");
  }

  // Read aide
  const aide = await read(resolved.path);

  // Convert AideTree entities to the format expected by deriveStates/deriveTransitions
  const entities: Record<string, AideEntity> = {};
  for (const [id, entity] of Object.entries(aide.entities)) {
    entities[id] = { props: entity.props as Record<string, unknown> };
  }

  // Derive states and transitions
  const states = deriveStates(entities);
  const transitions = deriveTransitions(entities);

  // Separate existing st_* and tr_* entities for diff comparison
  const existingStates: Record<string, AideEntity> = {};
  const existingTransitions: Record<string, AideEntity> = {};

  for (const [id, entity] of Object.entries(entities)) {
    if (id.startsWith("st_")) {
      existingStates[id] = entity;
    } else if (id.startsWith("tr_")) {
      existingTransitions[id] = entity;
    }
  }

  // Compute diff against existing entities
  const diff = diffGraph(states, transitions, existingStates, existingTransitions);

  return { states, transitions, diff };
}

/**
 * Format derive-graph results for human-readable output.
 */
export function formatDeriveGraphResult(result: DeriveGraphResult): string {
  const lines: string[] = [];

  lines.push(`Derived Graph Summary:`);
  lines.push(`  ${result.states.length} states, ${result.transitions.length} transitions`);
  lines.push("");

  if (!result.diff.hasChanges) {
    lines.push("✓ Graph is up to date. No changes needed.");
    return lines.join("\n");
  }

  if (result.diff.newStates.length > 0) {
    lines.push(`New States (${result.diff.newStates.length}):`);
    for (const state of result.diff.newStates) {
      lines.push(`  + ${state.id}${state.screen ? ` (screen: ${state.screen})` : ""}`);
    }
    lines.push("");
  }

  if (result.diff.newTransitions.length > 0) {
    lines.push(`New Transitions (${result.diff.newTransitions.length}):`);
    for (const tr of result.diff.newTransitions) {
      lines.push(`  + ${tr.id}: ${tr.from} → ${tr.to}`);
      if (tr.action) {
        lines.push(`      action: "${tr.action}"`);
      }
    }
    lines.push("");
  }

  if (result.diff.orphanedStates.length > 0) {
    lines.push(`Orphaned States (${result.diff.orphanedStates.length}):`);
    for (const id of result.diff.orphanedStates) {
      lines.push(`  - ${id}`);
    }
    lines.push("");
  }

  if (result.diff.orphanedTransitions.length > 0) {
    lines.push(`Orphaned Transitions (${result.diff.orphanedTransitions.length}):`);
    for (const id of result.diff.orphanedTransitions) {
      lines.push(`  - ${id}`);
    }
    lines.push("");
  }

  if (result.diff.matchingStates.length > 0 || result.diff.matchingTransitions.length > 0) {
    lines.push(`Matching: ${result.diff.matchingStates.length} states, ${result.diff.matchingTransitions.length} transitions`);
  }

  return lines.join("\n");
}
