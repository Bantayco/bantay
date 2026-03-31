/**
 * journeys command
 *
 * Clusters the state-transition graph and proposes CUJ boundaries.
 * Implements cuj_journeys scenarios.
 */

import { read, tryResolveAidePath } from "../aide";
import { deriveStates, deriveTransitions, type DerivedState, type DerivedTransition } from "./derive-graph";

export interface StateCluster {
  name: string;
  screen: string;
  states: string[];
}

export interface Handoff {
  transition: string;
  fromCluster: string;
  toCluster: string;
}

export interface JourneyScenario {
  id: string;
  path: string[];
  transitions: string[];
}

export interface Journey {
  name: string;
  path: string[];
  transitions: string[];
  goalState?: string;
  scenarios?: JourneyScenario[];
  optionalTransitions?: string[];
  requiredTransitions?: string[];
}

export interface MeceResult {
  isMece: boolean;
  uncoveredTransitions: string[];
  subsetJourneys: Array<{ subset: string; superset: string }>;
}

export interface GeneratedScenario {
  id: string;
  journey: string;
  given: string;
  path: string[];
}

export interface JourneysOptions {
  aide?: string;
  scenarios?: boolean;
  json?: boolean;
}

export interface JourneysResult {
  clusters: StateCluster[];
  handoffs: Handoff[];
  entryStates: string[];
  goalStates: string[];
  journeys: Journey[];
  meceResult: MeceResult;
  scenarios?: GeneratedScenario[];
}

/**
 * Cluster states by their screen prop.
 * States without a screen go into an "external" cluster.
 */
export function clusterStatesByScreen(states: DerivedState[]): StateCluster[] {
  const clusterMap = new Map<string, string[]>();

  for (const state of states) {
    const screen = state.screen || "";
    const clusterName = screen || "external";

    if (!clusterMap.has(clusterName)) {
      clusterMap.set(clusterName, []);
    }
    clusterMap.get(clusterName)!.push(state.id);
  }

  const clusters: StateCluster[] = [];
  for (const [name, stateIds] of clusterMap) {
    clusters.push({
      name,
      screen: name === "external" ? "" : name,
      states: stateIds,
    });
  }

  return clusters;
}

/**
 * Find which cluster a state belongs to.
 */
function findClusterForState(clusters: StateCluster[], stateId: string): string | undefined {
  for (const cluster of clusters) {
    if (cluster.states.includes(stateId)) {
      return cluster.name;
    }
  }
  return undefined;
}

/**
 * Identify handoff transitions between clusters.
 * A handoff is a transition where from and to states are in different clusters.
 */
export function findHandoffs(clusters: StateCluster[], transitions: DerivedTransition[]): Handoff[] {
  const handoffs: Handoff[] = [];

  for (const tr of transitions) {
    const fromCluster = findClusterForState(clusters, tr.from);
    const toCluster = findClusterForState(clusters, tr.to);

    if (fromCluster && toCluster && fromCluster !== toCluster) {
      handoffs.push({
        transition: tr.id,
        fromCluster,
        toCluster,
      });
    }
  }

  return handoffs;
}

/**
 * Find entry states (reachable from st_external) and goal states.
 *
 * Goal states are "at rest" states where users accomplish something:
 * - States that transition back to st_external
 * - Terminal states (no outgoing transitions)
 * - States where user is "viewing content" (has optional outgoing transitions but can stay)
 *   These are identified by having a suffix like _list, _detail, _readonly, etc.
 */
export function findEntryAndGoalStates(transitions: DerivedTransition[]): {
  entryStates: string[];
  goalStates: string[];
} {
  const entryStates: string[] = [];
  const goalStates: string[] = [];

  // Build a map of outgoing transitions per state
  const outgoing = new Map<string, DerivedTransition[]>();
  const incoming = new Map<string, DerivedTransition[]>();
  const allStates = new Set<string>();

  for (const tr of transitions) {
    allStates.add(tr.from);
    allStates.add(tr.to);

    if (!outgoing.has(tr.from)) {
      outgoing.set(tr.from, []);
    }
    outgoing.get(tr.from)!.push(tr);

    if (!incoming.has(tr.to)) {
      incoming.set(tr.to, []);
    }
    incoming.get(tr.to)!.push(tr);

    // Entry states: destinations of transitions from st_external
    if (tr.from === "st_external") {
      entryStates.push(tr.to);
    }

    // Goal states: sources of transitions to st_external
    if (tr.to === "st_external") {
      goalStates.push(tr.from);
    }
  }

  // Terminal states (no outgoing transitions) are goal states
  for (const state of allStates) {
    if (state !== "st_external" && !outgoing.has(state)) {
      goalStates.push(state);
    }
  }

  // "At rest" states - states where user can stay and view content
  // These have outgoing transitions but are natural stopping points
  const atRestSuffixes = ["_list", "_detail", "_readonly", "_view", "_home", "_dashboard"];
  for (const state of allStates) {
    if (state === "st_external") continue;
    if (goalStates.includes(state)) continue;

    // Check if state name indicates an "at rest" state
    const isAtRest = atRestSuffixes.some(suffix => state.endsWith(suffix));
    if (isAtRest) {
      goalStates.push(state);
    }
  }

  return {
    entryStates: [...new Set(entryStates)],
    goalStates: [...new Set(goalStates)],
  };
}

/**
 * Propose journeys as paths through the full graph from entry to goal.
 * Groups paths by goal state to create meaningful journeys with scenarios.
 */
export function proposeJourneys(
  clusters: StateCluster[],
  handoffs: Handoff[],
  entryStates: string[],
  goalStates: string[],
  transitions?: DerivedTransition[]
): Journey[] {
  const MAX_DEPTH = 10;

  // If no transitions provided, fall back to handoff-only behavior
  if (!transitions || transitions.length === 0) {
    return proposeJourneysFromHandoffs(clusters, handoffs, entryStates, goalStates);
  }

  // Build adjacency list for full state graph
  const stateGraph = new Map<string, DerivedTransition[]>();
  const selfLoops = new Set<string>(); // Track self-loop transitions

  for (const tr of transitions) {
    if (!stateGraph.has(tr.from)) {
      stateGraph.set(tr.from, []);
    }
    stateGraph.get(tr.from)!.push(tr);

    // Identify self-loops
    if (tr.from === tr.to) {
      selfLoops.add(tr.id);
    }
  }

  const goalStateSet = new Set(goalStates);

  // DFS to find all paths from entry states to goal states
  function findPaths(
    current: string,
    collectedTransitions: string[],
    statePath: string[],
    visitedStates: Set<string>,
    depth: number
  ): Array<{ goalState: string; transitions: string[]; statePath: string[] }> {
    // Check if we reached a goal
    if (goalStateSet.has(current) && collectedTransitions.length > 0) {
      return [{ goalState: current, transitions: [...collectedTransitions], statePath: [...statePath] }];
    }

    // Max depth check to prevent infinite loops
    if (depth >= MAX_DEPTH) {
      return [];
    }

    const outgoing = stateGraph.get(current) || [];
    const results: Array<{ goalState: string; transitions: string[]; statePath: string[] }> = [];

    for (const tr of outgoing) {
      // Skip self-loops for path finding (they'll be included as optional)
      if (tr.to === current) {
        continue;
      }

      // Skip already visited states to avoid cycles
      if (visitedStates.has(tr.to)) {
        continue;
      }

      visitedStates.add(tr.to);
      const newTransitions = [...collectedTransitions, tr.id];
      const newStatePath = [...statePath, tr.to];
      const subPaths = findPaths(tr.to, newTransitions, newStatePath, visitedStates, depth + 1);
      results.push(...subPaths);
      visitedStates.delete(tr.to);
    }

    return results;
  }

  // Collect all paths from all entry states
  const allPaths: Array<{ goalState: string; transitions: string[]; statePath: string[]; entryState: string }> = [];

  for (const entryState of entryStates) {
    const paths = findPaths(entryState, [], [entryState], new Set([entryState]), 0);
    for (const path of paths) {
      allPaths.push({ ...path, entryState });
    }
  }

  // Group paths by goal state
  const pathsByGoal = new Map<string, typeof allPaths>();
  for (const path of allPaths) {
    if (!pathsByGoal.has(path.goalState)) {
      pathsByGoal.set(path.goalState, []);
    }
    pathsByGoal.get(path.goalState)!.push(path);
  }

  // Create one journey per goal
  const journeys: Journey[] = [];
  const usedNames = new Set<string>();

  for (const [goalState, paths] of pathsByGoal) {
    // Generate goal-based name
    const baseName = generateJourneyName(goalState, paths[0].transitions, transitions);
    let name = baseName;

    // Ensure unique names (without numeric suffixes)
    if (usedNames.has(name)) {
      // Add context from the goal state if name collision
      const goalSuffix = goalState.replace(/^st_/, "").replace(/_/g, "_");
      name = `${baseName}_${goalSuffix}`;
    }
    usedNames.add(name);

    // Build cluster path from the first (canonical) path
    const canonicalPath = paths[0];
    const clusterPath: string[] = [];
    let lastCluster: string | undefined;

    for (const trId of canonicalPath.transitions) {
      const tr = transitions.find(t => t.id === trId);
      if (tr) {
        const fromCluster = findClusterForState(clusters, tr.from);
        const toCluster = findClusterForState(clusters, tr.to);

        if (fromCluster && fromCluster !== lastCluster && fromCluster !== "external") {
          clusterPath.push(fromCluster);
          lastCluster = fromCluster;
        }
        if (toCluster && toCluster !== lastCluster && toCluster !== "external") {
          clusterPath.push(toCluster);
          lastCluster = toCluster;
        }
      }
    }

    // Collect all transitions across all paths to this goal
    const allTransitionsSet = new Set<string>();
    for (const p of paths) {
      for (const trId of p.transitions) {
        allTransitionsSet.add(trId);
      }
    }

    // Find self-loops that touch any state in any path to this goal
    const touchedStates = new Set<string>();
    for (const p of paths) {
      for (const state of p.statePath) {
        touchedStates.add(state);
      }
    }

    for (const trId of selfLoops) {
      const tr = transitions.find(t => t.id === trId);
      if (tr && touchedStates.has(tr.from)) {
        allTransitionsSet.add(trId);
      }
    }

    // Classify transitions as required vs optional
    // Required: transitions that appear in ALL paths to this goal
    // Optional: self-loops and transitions that only appear in some paths
    const requiredTransitions: string[] = [];
    const optionalTransitions: string[] = [];

    for (const trId of allTransitionsSet) {
      if (selfLoops.has(trId)) {
        optionalTransitions.push(trId);
      } else {
        // Check if this transition appears in all paths
        const appearsInAll = paths.every(p => p.transitions.includes(trId));
        if (appearsInAll) {
          requiredTransitions.push(trId);
        } else {
          optionalTransitions.push(trId);
        }
      }
    }

    // Create scenarios from path variations
    const scenarios: JourneyScenario[] = paths.map((p, idx) => ({
      id: `sc_${name}_${idx + 1}`,
      path: p.statePath,
      transitions: p.transitions,
    }));

    journeys.push({
      name,
      goalState,
      path: clusterPath,
      transitions: Array.from(allTransitionsSet),
      scenarios: scenarios.length > 1 ? scenarios : undefined,
      requiredTransitions: requiredTransitions.length > 0 ? requiredTransitions : undefined,
      optionalTransitions: optionalTransitions.length > 0 ? optionalTransitions : undefined,
    });
  }

  // If no journeys found, fall back to handoff-based journeys
  if (journeys.length === 0) {
    return proposeJourneysFromHandoffs(clusters, handoffs, entryStates, goalStates);
  }

  return journeys;
}

/**
 * Generate a goal-based journey name from the goal state and transitions.
 */
function generateJourneyName(
  goalState: string,
  pathTransitions: string[],
  transitions: DerivedTransition[]
): string {
  // Try to extract a meaningful name from the goal state
  const goalName = goalState
    .replace(/^st_/, "")
    .replace(/_/g, " ");

  // Get the last action for context
  const lastTrId = pathTransitions[pathTransitions.length - 1];
  const lastTr = transitions.find(t => t.id === lastTrId);
  const lastAction = lastTr?.action || "";

  // Generate name based on goal
  if (goalState.includes("readonly") || goalState.includes("edit")) {
    return "journey_write_draft";
  }
  if (goalState.includes("list") || goalState.includes("artifacts")) {
    return "journey_view_collection";
  }
  if (goalState.includes("detail")) {
    return "journey_view_detail";
  }
  if (goalState.includes("home") || goalState.includes("dashboard")) {
    return "journey_home";
  }

  // Fallback: use goal state name
  return `journey_${goalName.replace(/\s+/g, "_")}`;
}

/**
 * Fallback: propose journeys using only handoffs (cluster-level paths).
 */
function proposeJourneysFromHandoffs(
  clusters: StateCluster[],
  handoffs: Handoff[],
  entryStates: string[],
  goalStates: string[]
): Journey[] {
  const journeys: Journey[] = [];

  // Build adjacency list for clusters based on handoffs
  const clusterGraph = new Map<string, Array<{ to: string; transition: string }>>();
  for (const handoff of handoffs) {
    if (!clusterGraph.has(handoff.fromCluster)) {
      clusterGraph.set(handoff.fromCluster, []);
    }
    clusterGraph.get(handoff.fromCluster)!.push({
      to: handoff.toCluster,
      transition: handoff.transition,
    });
  }

  // Find clusters containing entry states
  const entryClusters = new Set<string>();
  for (const entryState of entryStates) {
    const cluster = findClusterForState(clusters, entryState);
    if (cluster && cluster !== "external") {
      entryClusters.add(cluster);
    }
  }

  // Find clusters containing goal states
  const goalClusters = new Set<string>();
  for (const goalState of goalStates) {
    const cluster = findClusterForState(clusters, goalState);
    if (cluster && cluster !== "external") {
      goalClusters.add(cluster);
    }
  }

  // DFS to find paths from entry clusters to goal clusters
  function findClusterPaths(
    current: string,
    target: Set<string>,
    path: string[],
    transitions: string[],
    visited: Set<string>
  ): Array<{ path: string[]; transitions: string[] }> {
    if (target.has(current)) {
      return [{ path: [...path], transitions: [...transitions] }];
    }

    const neighbors = clusterGraph.get(current) || [];
    const results: Array<{ path: string[]; transitions: string[] }> = [];

    for (const { to, transition } of neighbors) {
      if (!visited.has(to)) {
        visited.add(to);
        const subPaths = findClusterPaths(to, target, [...path, to], [...transitions, transition], visited);
        results.push(...subPaths);
        visited.delete(to);
      }
    }

    return results;
  }

  // Generate journeys from each entry cluster to goal clusters
  for (const entryCluster of entryClusters) {
    const paths = findClusterPaths(entryCluster, goalClusters, [entryCluster], [], new Set([entryCluster]));

    for (const { path, transitions } of paths) {
      const journeyName = `journey_${path.map((p) => p.replace("screen_", "")).join("_to_")}`;
      journeys.push({
        name: journeyName,
        path,
        transitions,
      });
    }
  }

  // If no journeys found but we have handoffs, create a default journey
  if (journeys.length === 0 && handoffs.length > 0) {
    const orderedClusters: string[] = [];
    const transitionIds: string[] = [];

    for (const handoff of handoffs) {
      if (!orderedClusters.includes(handoff.fromCluster)) {
        orderedClusters.push(handoff.fromCluster);
      }
      if (!orderedClusters.includes(handoff.toCluster)) {
        orderedClusters.push(handoff.toCluster);
      }
      transitionIds.push(handoff.transition);
    }

    journeys.push({
      name: "journey_main",
      path: orderedClusters.filter((c) => c !== "external"),
      transitions: transitionIds,
    });
  }

  return journeys;
}

/**
 * Check if journeys are MECE (Mutually Exclusive, Collectively Exhaustive).
 */
export function checkMece(journeys: Journey[], transitions: DerivedTransition[]): MeceResult {
  // Find transitions not covered by any journey
  const coveredTransitions = new Set<string>();
  for (const journey of journeys) {
    for (const tr of journey.transitions) {
      coveredTransitions.add(tr);
    }
  }

  const uncoveredTransitions = transitions
    .filter((tr) => !coveredTransitions.has(tr.id))
    .map((tr) => tr.id);

  // Find journeys that are subsets of other journeys
  const subsetJourneys: Array<{ subset: string; superset: string }> = [];

  for (const j1 of journeys) {
    for (const j2 of journeys) {
      if (j1.name === j2.name) continue;

      // Check if j1's transitions are a subset of j2's
      const j1Set = new Set(j1.transitions);
      const j2Set = new Set(j2.transitions);

      if (j1Set.size < j2Set.size) {
        const isSubset = [...j1Set].every((t) => j2Set.has(t));
        if (isSubset) {
          subsetJourneys.push({ subset: j1.name, superset: j2.name });
        }
      }
    }
  }

  return {
    isMece: uncoveredTransitions.length === 0 && subsetJourneys.length === 0,
    uncoveredTransitions,
    subsetJourneys,
  };
}

/**
 * Generate scenarios as path permutations through a journey.
 */
export function generateScenarios(journey: Journey, transitions: DerivedTransition[]): GeneratedScenario[] {
  const scenarios: GeneratedScenario[] = [];

  // Get the transitions that belong to this journey
  const journeyTransitions = transitions.filter((tr) => journey.transitions.includes(tr.id));

  if (journeyTransitions.length === 0) {
    return scenarios;
  }

  // Find entry points (states that are 'from' but never 'to' within the journey)
  const fromStates = new Set(journeyTransitions.map((tr) => tr.from));
  const toStates = new Set(journeyTransitions.map((tr) => tr.to));

  const entryPoints = [...fromStates].filter((s) => !toStates.has(s) || s === "st_external");

  // For simple case, generate one scenario per entry point
  for (const entry of entryPoints) {
    if (entry === "st_external") continue;

    const path: string[] = [];
    const visited = new Set<string>();
    let current = entry;

    // Follow the transition path
    while (current && !visited.has(current)) {
      path.push(current);
      visited.add(current);

      const nextTr = journeyTransitions.find((tr) => tr.from === current);
      if (nextTr) {
        current = nextTr.to;
      } else {
        break;
      }
    }

    // Add final state if not already in path
    if (current && !visited.has(current)) {
      path.push(current);
    }

    scenarios.push({
      id: `sc_${journey.name}_${entry.replace("st_", "")}`,
      journey: journey.name,
      given: `User is at ${entry}`,
      path,
    });
  }

  // If no scenarios generated, create a default one
  if (scenarios.length === 0 && journeyTransitions.length > 0) {
    const firstTr = journeyTransitions[0];
    scenarios.push({
      id: `sc_${journey.name}_default`,
      journey: journey.name,
      given: `User is at ${firstTr.from}`,
      path: [firstTr.from, firstTr.to],
    });
  }

  return scenarios;
}

/**
 * Run the journeys command.
 */
export async function runJourneys(
  projectPath: string,
  options: JourneysOptions = {}
): Promise<JourneysResult> {
  // Resolve aide path
  const resolved = await tryResolveAidePath(projectPath, options.aide);
  if (!resolved) {
    throw new Error("Could not find aide file");
  }

  // Read aide
  const aide = await read(resolved.path);

  // Convert to entity format for derive functions
  const entities: Record<string, { props?: Record<string, unknown> }> = {};
  for (const [id, entity] of Object.entries(aide.entities)) {
    entities[id] = { props: entity.props as Record<string, unknown> };
  }

  // Derive states and transitions
  const states = deriveStates(entities);
  const transitions = deriveTransitions(entities);

  // Cluster states by screen
  const clusters = clusterStatesByScreen(states);

  // Find handoffs between clusters
  const handoffs = findHandoffs(clusters, transitions);

  // Find entry and goal states
  const { entryStates, goalStates } = findEntryAndGoalStates(transitions);

  // Propose journeys (pass transitions for full path walking)
  const journeys = proposeJourneys(clusters, handoffs, entryStates, goalStates, transitions);

  // Check MECE
  const meceResult = checkMece(journeys, transitions);

  // Generate scenarios if requested
  let scenarios: GeneratedScenario[] | undefined;
  if (options.scenarios) {
    scenarios = [];
    for (const journey of journeys) {
      scenarios.push(...generateScenarios(journey, transitions));
    }
  }

  return {
    clusters,
    handoffs,
    entryStates,
    goalStates,
    journeys,
    meceResult,
    scenarios,
  };
}

/**
 * Format journeys results for human-readable output.
 */
export function formatJourneysResult(result: JourneysResult): string {
  const lines: string[] = [];

  lines.push("Journeys Analysis");
  lines.push("=================");
  lines.push("");

  // Clusters
  lines.push(`Clusters (${result.clusters.length}):`);
  for (const cluster of result.clusters) {
    lines.push(`  ${cluster.name}: ${cluster.states.length} states`);
    for (const state of cluster.states) {
      lines.push(`    - ${state}`);
    }
  }
  lines.push("");

  // Handoffs
  lines.push(`Handoffs (${result.handoffs.length}):`);
  for (const handoff of result.handoffs) {
    lines.push(`  ${handoff.transition}: ${handoff.fromCluster} → ${handoff.toCluster}`);
  }
  lines.push("");

  // Entry and Goal States
  lines.push(`Entry States: ${result.entryStates.join(", ") || "(none)"}`);
  lines.push(`Goal States: ${result.goalStates.join(", ") || "(none)"}`);
  lines.push("");

  // Journeys
  lines.push(`Proposed Journeys (${result.journeys.length}):`);
  for (const journey of result.journeys) {
    lines.push(`  ${journey.name}:`);
    lines.push(`    Path: ${journey.path.join(" → ")}`);
    lines.push(`    Transitions: ${journey.transitions.join(", ")}`);
  }
  lines.push("");

  // MECE Check
  if (result.meceResult.isMece) {
    lines.push("✓ MECE Check: PASS");
  } else {
    lines.push("✗ MECE Check: FAIL");
    if (result.meceResult.uncoveredTransitions.length > 0) {
      lines.push(`  Uncovered transitions: ${result.meceResult.uncoveredTransitions.join(", ")}`);
    }
    if (result.meceResult.subsetJourneys.length > 0) {
      for (const { subset, superset } of result.meceResult.subsetJourneys) {
        lines.push(`  ${subset} is a subset of ${superset}`);
      }
    }
  }

  // Scenarios
  if (result.scenarios) {
    lines.push("");
    lines.push(`Generated Scenarios (${result.scenarios.length}):`);
    for (const scenario of result.scenarios) {
      lines.push(`  ${scenario.id}:`);
      lines.push(`    Journey: ${scenario.journey}`);
      lines.push(`    Given: ${scenario.given}`);
      lines.push(`    Path: ${scenario.path.join(" → ")}`);
    }
  }

  return lines.join("\n");
}
