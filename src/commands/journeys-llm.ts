/**
 * journeys-llm command
 *
 * Uses an LLM to propose user journeys based on the aide's state-transition graph.
 * The LLM provides product thinking (user intent), the algorithm provides validation.
 */

import { type DerivedTransition } from "./derive-graph";

// ----- Types -----

export interface JourneyContext {
  appName: string;
  appDescription: string;
  states: StateContext[];
  transitions: TransitionContext[];
  existingCujs: CujContext[];
  screens: ScreenContext[];
}

export interface StateContext {
  id: string;
  screen?: string;
  description?: string;
  componentVariants?: Record<string, string>;
}

export interface TransitionContext {
  id: string;
  from: string;
  to: string;
  action: string;
  trigger?: string;
}

export interface CujContext {
  id: string;
  feature: string;
  scenarios: { id: string; name: string }[];
}

export interface ScreenContext {
  id: string;
  name?: string;
  description?: string;
}

export interface JourneyScenarioProposal {
  name: string;
  given: string;
  path: string[]; // Ordered transition IDs
}

export interface JourneyProposal {
  name: string;
  description: string;
  core_transitions: string[];
  optional_transitions: string[];
  entry_states: string[];
  goal_description: string;
  scenarios: JourneyScenarioProposal[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface MeceResult {
  isMece: boolean;
  uncoveredTransitions: string[];
  subsetJourneys: Array<{ subset: string; superset: string }>;
}

export interface ProposalValidationResult {
  journeys: Array<JourneyProposal & { validation: ValidationResult }>;
  meceResult: MeceResult;
  warnings: string[];
  allValid: boolean;
}

// ----- Context Collection -----

/**
 * Collect context from the aide for LLM journey proposal.
 */
export function collectJourneyContext(aide: { entities: Record<string, any> }): JourneyContext {
  const entities = aide.entities;

  // Find app description (root page entity)
  let appName = "";
  let appDescription = "";

  for (const [id, entity] of Object.entries(entities)) {
    if (entity.display === "page" && entity.props) {
      appName = entity.props.title || id;
      appDescription = entity.props.description || "";
      break;
    }
  }

  // Collect st_* entities
  const states: StateContext[] = [];
  for (const [id, entity] of Object.entries(entities)) {
    if (id.startsWith("st_") && entity.props) {
      const props = entity.props as Record<string, unknown>;
      const componentVariants: Record<string, string> = {};

      for (const [key, value] of Object.entries(props)) {
        if (key.startsWith("comp_") && typeof value === "string") {
          componentVariants[key] = value;
        }
      }

      states.push({
        id,
        screen: props.screen as string | undefined,
        description: props.description as string | undefined,
        componentVariants: Object.keys(componentVariants).length > 0 ? componentVariants : undefined,
      });
    }
  }

  // Collect tr_* entities
  const transitions: TransitionContext[] = [];
  for (const [id, entity] of Object.entries(entities)) {
    if (id.startsWith("tr_") && entity.props) {
      const props = entity.props as Record<string, unknown>;
      if (props.from && props.to) {
        transitions.push({
          id,
          from: props.from as string,
          to: props.to as string,
          action: (props.action as string) || "",
          trigger: props.trigger as string | undefined,
        });
      }
    }
  }

  // Collect existing CUJs
  const existingCujs: CujContext[] = [];
  const cujScenarios = new Map<string, { id: string; name: string }[]>();

  // First pass: find scenarios and their parents
  for (const [id, entity] of Object.entries(entities)) {
    if (id.startsWith("sc_") && entity.parent && entity.props) {
      const parentId = entity.parent as string;
      if (!cujScenarios.has(parentId)) {
        cujScenarios.set(parentId, []);
      }
      cujScenarios.get(parentId)!.push({
        id,
        name: (entity.props.name as string) || id,
      });
    }
  }

  // Second pass: collect CUJs
  for (const [id, entity] of Object.entries(entities)) {
    if (id.startsWith("cuj_") && entity.props) {
      existingCujs.push({
        id,
        feature: (entity.props.feature as string) || "",
        scenarios: cujScenarios.get(id) || [],
      });
    }
  }

  // Collect screen_* entities
  const screens: ScreenContext[] = [];
  for (const [id, entity] of Object.entries(entities)) {
    if (id.startsWith("screen_") && entity.props) {
      const props = entity.props as Record<string, unknown>;
      screens.push({
        id,
        name: props.name as string | undefined,
        description: props.description as string | undefined,
      });
    }
  }

  return {
    appName,
    appDescription,
    states,
    transitions,
    existingCujs,
    screens,
  };
}

// ----- Validation -----

/**
 * Build a map of transitions for quick lookup.
 */
function buildTransitionMap(transitions: DerivedTransition[]): Map<string, DerivedTransition> {
  const map = new Map<string, DerivedTransition>();
  for (const tr of transitions) {
    map.set(tr.id, tr);
  }
  return map;
}

/**
 * Validate that a path is a valid walk through the graph.
 * Each transition's "to" must match the next transition's "from".
 */
function validatePath(
  path: string[],
  transitionMap: Map<string, DerivedTransition>
): { valid: boolean; error?: string } {
  if (path.length === 0) {
    return { valid: true };
  }

  for (let i = 0; i < path.length - 1; i++) {
    const current = transitionMap.get(path[i]);
    const next = transitionMap.get(path[i + 1]);

    if (!current) {
      return { valid: false, error: `Transition ${path[i]} does not exist in graph` };
    }
    if (!next) {
      return { valid: false, error: `Transition ${path[i + 1]} does not exist in graph` };
    }

    if (current.to !== next.from) {
      return {
        valid: false,
        error: `Invalid path: ${path[i]} ends at ${current.to}, but ${path[i + 1]} starts from ${next.from}`,
      };
    }
  }

  // Check that all transitions exist
  for (const trId of path) {
    if (!transitionMap.has(trId)) {
      return { valid: false, error: `Transition ${trId} does not exist in graph` };
    }
  }

  return { valid: true };
}

/**
 * Validate a single journey proposal against the transition graph.
 */
export function validateJourneyProposal(
  proposal: JourneyProposal,
  transitions: DerivedTransition[]
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const transitionMap = buildTransitionMap(transitions);

  // Validate core transitions exist
  for (const trId of proposal.core_transitions) {
    if (!transitionMap.has(trId)) {
      errors.push(`Transition ${trId} does not exist in graph`);
    }
  }

  // Validate optional transitions exist
  for (const trId of proposal.optional_transitions) {
    if (!transitionMap.has(trId)) {
      errors.push(`Optional transition ${trId} does not exist in graph`);
    }
  }

  // Validate core path is a valid walk
  const corePathResult = validatePath(proposal.core_transitions, transitionMap);
  if (!corePathResult.valid && corePathResult.error) {
    errors.push(corePathResult.error);
  }

  // Validate scenario paths
  for (const scenario of proposal.scenarios) {
    const scenarioResult = validatePath(scenario.path, transitionMap);
    if (!scenarioResult.valid && scenarioResult.error) {
      errors.push(`In scenario '${scenario.name}': ${scenarioResult.error}`);
    }
  }

  // Warn about scenarios count
  if (proposal.scenarios.length < 2) {
    warnings.push(`Journey '${proposal.name}' has fewer than 2 scenarios`);
  }
  if (proposal.scenarios.length > 4) {
    warnings.push(`Journey '${proposal.name}' has more than 4 scenarios`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate all journey proposals together (MECE check, subset check).
 */
export function validateJourneyProposals(
  proposals: JourneyProposal[],
  transitions: DerivedTransition[]
): ProposalValidationResult {
  const warnings: string[] = [];
  const transitionMap = buildTransitionMap(transitions);

  // Validate individual journeys
  const validatedJourneys = proposals.map((proposal) => ({
    ...proposal,
    validation: validateJourneyProposal(proposal, transitions),
  }));

  // Check journey count
  if (proposals.length < 4) {
    warnings.push(`Expected 4-8 journeys, got ${proposals.length}`);
  } else if (proposals.length > 8) {
    warnings.push(`Expected 4-8 journeys, got ${proposals.length}`);
  }

  // MECE check: every transition should be covered
  const coveredTransitions = new Set<string>();
  for (const proposal of proposals) {
    for (const trId of proposal.core_transitions) {
      coveredTransitions.add(trId);
    }
    for (const trId of proposal.optional_transitions) {
      coveredTransitions.add(trId);
    }
  }

  const uncoveredTransitions = transitions
    .filter((tr) => !coveredTransitions.has(tr.id))
    .map((tr) => tr.id);

  // Check for subset journeys
  const subsetJourneys: Array<{ subset: string; superset: string }> = [];

  for (const j1 of proposals) {
    for (const j2 of proposals) {
      if (j1.name === j2.name) continue;

      const j1Transitions = new Set([...j1.core_transitions, ...j1.optional_transitions]);
      const j2Transitions = new Set([...j2.core_transitions, ...j2.optional_transitions]);

      // Check if j1 is a strict subset of j2
      if (j1Transitions.size < j2Transitions.size) {
        const isSubset = [...j1Transitions].every((t) => j2Transitions.has(t));
        if (isSubset) {
          subsetJourneys.push({ subset: j1.name, superset: j2.name });
        }
      }
    }
  }

  const meceResult: MeceResult = {
    isMece: uncoveredTransitions.length === 0 && subsetJourneys.length === 0,
    uncoveredTransitions,
    subsetJourneys,
  };

  const allValid = validatedJourneys.every((j) => j.validation.valid);

  return {
    journeys: validatedJourneys,
    meceResult,
    warnings,
    allValid,
  };
}

// ----- Prompt Generation for --prompt flag -----

interface TransitionCategory {
  entry: TransitionContext[];
  navigation: TransitionContext[];
  perScreen: Map<string, TransitionContext[]>;
}

/**
 * Categorize transitions into entry, navigation, and per-screen actions.
 */
function categorizeTransitions(
  context: JourneyContext
): TransitionCategory {
  const entry: TransitionContext[] = [];
  const navigation: TransitionContext[] = [];
  const perScreen = new Map<string, TransitionContext[]>();

  // Build state-to-screen map
  const stateToScreen = new Map<string, string>();
  for (const state of context.states) {
    if (state.screen) {
      stateToScreen.set(state.id, state.screen);
    }
  }

  for (const tr of context.transitions) {
    const fromScreen = stateToScreen.get(tr.from);
    const toScreen = stateToScreen.get(tr.to);

    // Entry transitions: from st_external or no screen
    if (tr.from === "st_external" || !fromScreen) {
      entry.push(tr);
    }
    // Navigation: cross-screen transitions
    else if (fromScreen !== toScreen && toScreen) {
      navigation.push(tr);
    }
    // Per-screen: same screen transitions
    else if (fromScreen === toScreen) {
      if (!perScreen.has(fromScreen)) {
        perScreen.set(fromScreen, []);
      }
      perScreen.get(fromScreen)!.push(tr);
    }
    // Default to navigation if unclear
    else {
      navigation.push(tr);
    }
  }

  return { entry, navigation, perScreen };
}

/**
 * Generate a prompt for the user to paste into Claude.
 * This is the --prompt flag output.
 */
export function generateJourneyPrompt(context: JourneyContext): string {
  const lines: string[] = [];

  // System prompt section
  lines.push("You are a product analyst. Given an app description and its complete state-transition graph, identify the 4-8 core user journeys.");
  lines.push("");
  lines.push("A journey is defined by user INTENT — what the user is trying to accomplish. Group transitions by intent, not by graph structure.");
  lines.push("");
  lines.push("---");
  lines.push("");

  // App info
  lines.push(`## App: ${context.appName}`);
  if (context.appDescription) {
    lines.push("");
    lines.push(context.appDescription);
  }
  lines.push("");

  // Screens
  if (context.screens.length > 0) {
    lines.push("## Screens");
    lines.push("");
    for (const screen of context.screens) {
      let line = `- **${screen.id}**`;
      if (screen.name) {
        line += `: ${screen.name}`;
      }
      if (screen.description) {
        line += ` — ${screen.description}`;
      }
      lines.push(line);
    }
    lines.push("");
  }

  // Categorize transitions
  const categories = categorizeTransitions(context);

  // Entry transitions
  if (categories.entry.length > 0) {
    lines.push("## Entry Transitions");
    lines.push("_How users enter the app_");
    lines.push("");
    for (const tr of categories.entry) {
      lines.push(`- \`${tr.id}\`: ${tr.from} → ${tr.to} | "${tr.action}"`);
    }
    lines.push("");
  }

  // Navigation transitions
  if (categories.navigation.length > 0) {
    lines.push("## Navigation Transitions");
    lines.push("_How users move between screens_");
    lines.push("");
    for (const tr of categories.navigation) {
      lines.push(`- \`${tr.id}\`: ${tr.from} → ${tr.to} | "${tr.action}"`);
    }
    lines.push("");
  }

  // Per-screen actions
  if (categories.perScreen.size > 0) {
    lines.push("## Per-Screen Actions");
    lines.push("");

    for (const [screen, transitions] of categories.perScreen) {
      const screenInfo = context.screens.find((s) => s.id === screen);
      const screenName = screenInfo?.name || screen;
      lines.push(`### ${screenName} (${screen})`);
      lines.push("");
      for (const tr of transitions) {
        lines.push(`- \`${tr.id}\`: ${tr.from} → ${tr.to} | "${tr.action}"`);
      }
      lines.push("");
    }
  }

  // Existing CUJs for reference
  if (context.existingCujs.length > 0) {
    lines.push("## Existing CUJs (for reference)");
    lines.push("");
    for (const cuj of context.existingCujs) {
      lines.push(`- **${cuj.id}**: ${cuj.feature}`);
    }
    lines.push("");
  }

  // Instructions
  lines.push("---");
  lines.push("");
  lines.push("## Instructions");
  lines.push("");
  lines.push("Identify 4-8 core user journeys. For each journey, provide:");
  lines.push("");
  lines.push("1. **name**: Verb phrase describing what the user is trying to do");
  lines.push("2. **description**: One sentence summary");
  lines.push("3. **core_transitions**: The transitions that define this journey (ordered)");
  lines.push("4. **optional_transitions**: Transitions that can happen during this journey but aren't required");
  lines.push("5. **entry_states**: Where the user starts");
  lines.push("6. **goal_description**: What \"done\" looks like");
  lines.push("7. **scenarios**: 2-4 variations with different entry points or branches");
  lines.push("");
  lines.push("Rules:");
  lines.push("- Each journey represents a distinct user goal");
  lines.push("- Journeys should NOT overlap significantly");
  lines.push("- Every transition should appear in at least one journey (core or optional)");
  lines.push("");
  lines.push("Respond in JSON format:");
  lines.push("");
  lines.push("```json");
  lines.push(`{
  "journeys": [
    {
      "name": "string",
      "description": "string",
      "core_transitions": ["tr_id1", "tr_id2"],
      "optional_transitions": ["tr_id3"],
      "entry_states": ["st_id1"],
      "goal_description": "string",
      "scenarios": [
        {
          "name": "string",
          "given": "string",
          "path": ["tr_id1", "tr_id2"]
        }
      ]
    }
  ]
}`);
  lines.push("```");

  return lines.join("\n");
}

// ----- Apply Functionality (--apply flag) -----

export interface ExistingCUJ {
  id: string;
  feature: string;
  scenarios: Array<{
    id: string;
    name: string;
    path?: string[];
  }>;
}

export interface JourneyMatch {
  proposedJourney: JourneyProposal;
  matchedCUJ?: ExistingCUJ;
  overlapPercentage: number;
  additionalMatches?: ExistingCUJ[];
}

export interface MergeCandidate {
  proposedJourney: JourneyProposal;
  absorbedCUJs: string[];
}

export interface JourneyClassification {
  matched: JourneyMatch[];
  new: JourneyProposal[];
  merged: MergeCandidate[];
  orphaned: ExistingCUJ[];
}

/**
 * Collect all transition IDs from a journey proposal.
 */
function collectProposalTransitions(proposal: JourneyProposal): Set<string> {
  const transitions = new Set<string>();

  for (const trId of proposal.core_transitions) {
    transitions.add(trId);
  }
  for (const trId of proposal.optional_transitions) {
    transitions.add(trId);
  }
  for (const scenario of proposal.scenarios) {
    for (const trId of scenario.path) {
      transitions.add(trId);
    }
  }

  return transitions;
}

/**
 * Collect all transition IDs from an existing CUJ.
 */
function collectCUJTransitions(cuj: ExistingCUJ): Set<string> {
  const transitions = new Set<string>();

  for (const scenario of cuj.scenarios) {
    if (scenario.path) {
      for (const trId of scenario.path) {
        transitions.add(trId);
      }
    }
  }

  return transitions;
}

/**
 * Calculate overlap percentage between two sets.
 */
function calculateOverlap(set1: Set<string>, set2: Set<string>): number {
  if (set1.size === 0 || set2.size === 0) {
    return 0;
  }

  const intersection = [...set1].filter(item => set2.has(item)).length;
  const union = new Set([...set1, ...set2]).size;

  return intersection / union;
}

/**
 * Match proposed journeys to existing CUJs by transition overlap.
 * 80%+ overlap = match.
 */
export function matchJourneysToExistingCUJs(
  proposals: JourneyProposal[],
  existingCUJs: ExistingCUJ[]
): JourneyMatch[] {
  const matches: JourneyMatch[] = [];

  for (const proposal of proposals) {
    const proposalTransitions = collectProposalTransitions(proposal);

    let bestMatch: ExistingCUJ | undefined;
    let bestOverlap = 0;
    let highestOverlap = 0; // Track highest overlap even if < 0.8
    const additionalMatches: ExistingCUJ[] = [];

    for (const cuj of existingCUJs) {
      const cujTransitions = collectCUJTransitions(cuj);
      const overlap = calculateOverlap(proposalTransitions, cujTransitions);

      // Track highest overlap for reporting
      if (overlap > highestOverlap) {
        highestOverlap = overlap;
      }

      if (overlap >= 0.8) {
        if (overlap > bestOverlap) {
          if (bestMatch) {
            additionalMatches.push(bestMatch);
          }
          bestMatch = cuj;
          bestOverlap = overlap;
        } else {
          additionalMatches.push(cuj);
        }
      }
    }

    matches.push({
      proposedJourney: proposal,
      matchedCUJ: bestMatch,
      overlapPercentage: bestMatch ? bestOverlap : highestOverlap,
      additionalMatches: additionalMatches.length > 0 ? additionalMatches : undefined,
    });
  }

  return matches;
}

/**
 * Classify journeys into matched, new, merged, and orphaned.
 */
export function classifyJourneys(
  matches: JourneyMatch[],
  existingCUJs: ExistingCUJ[]
): JourneyClassification {
  const matched: JourneyMatch[] = [];
  const newJourneys: JourneyProposal[] = [];
  const merged: MergeCandidate[] = [];

  // Track which CUJs are covered
  const coveredCUJIds = new Set<string>();

  for (const match of matches) {
    if (match.matchedCUJ) {
      coveredCUJIds.add(match.matchedCUJ.id);

      // Check for merge candidates (matches multiple CUJs)
      if (match.additionalMatches && match.additionalMatches.length > 0) {
        const absorbedCUJs = [match.matchedCUJ.id];
        for (const additional of match.additionalMatches) {
          absorbedCUJs.push(additional.id);
          coveredCUJIds.add(additional.id);
        }
        merged.push({
          proposedJourney: match.proposedJourney,
          absorbedCUJs,
        });
      } else {
        matched.push(match);
      }
    } else {
      newJourneys.push(match.proposedJourney);
    }
  }

  // Find orphaned CUJs (not covered by any proposal)
  const orphaned = existingCUJs.filter(cuj => !coveredCUJIds.has(cuj.id));

  return {
    matched,
    new: newJourneys,
    merged,
    orphaned,
  };
}

/**
 * Generate a CUJ ID from a journey name.
 * "Write in Flow" → "cuj_write_in_flow"
 */
export function generateCujId(name: string): string {
  return "cuj_" + name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * Format the apply diff for display.
 */
export function formatApplyDiff(classification: JourneyClassification): string {
  const lines: string[] = [];

  lines.push("Journey Apply Diff");
  lines.push("==================");
  lines.push("");

  if (classification.matched.length > 0) {
    lines.push(`## Matched (${classification.matched.length})`);
    lines.push("_These proposals match existing CUJs_");
    lines.push("");
    for (const match of classification.matched) {
      lines.push(`- **${match.proposedJourney.name}** → updates **${match.matchedCUJ!.id}**`);
      lines.push(`  Current: ${match.matchedCUJ!.feature}`);
      lines.push(`  New: ${match.proposedJourney.description}`);
      lines.push(`  Overlap: ${Math.round(match.overlapPercentage * 100)}%`);
    }
    lines.push("");
  }

  if (classification.new.length > 0) {
    lines.push(`## New (${classification.new.length})`);
    lines.push("_These will create new CUJs_");
    lines.push("");
    for (const journey of classification.new) {
      const id = generateCujId(journey.name);
      lines.push(`- **${journey.name}** → creates **${id}**`);
      lines.push(`  ${journey.description}`);
      lines.push(`  Scenarios: ${journey.scenarios.length}`);
    }
    lines.push("");
  }

  if (classification.merged.length > 0) {
    lines.push(`## Merged (${classification.merged.length})`);
    lines.push("_These will combine multiple existing CUJs_");
    lines.push("");
    for (const merge of classification.merged) {
      lines.push(`- **${merge.proposedJourney.name}** absorbs: ${merge.absorbedCUJs.join(", ")}`);
    }
    lines.push("");
  }

  if (classification.orphaned.length > 0) {
    lines.push(`## Orphaned (${classification.orphaned.length})`);
    lines.push("_These existing CUJs have no matching proposals_");
    lines.push("");
    for (const cuj of classification.orphaned) {
      lines.push(`- **${cuj.id}**: ${cuj.feature}`);
    }
    lines.push("");
  }

  const total = classification.matched.length +
                classification.new.length +
                classification.merged.length;
  lines.push("---");
  lines.push(`Total: ${total} proposals, ${classification.orphaned.length} orphaned`);

  return lines.join("\n");
}

