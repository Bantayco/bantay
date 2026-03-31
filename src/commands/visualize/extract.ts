/**
 * Data extraction functions for the visualizer
 */

import type {
  AideTree,
  WireframeMap,
  CUJ,
  Scenario,
  Screen,
  ScreenState,
  GraphTransition,
  Component,
  VisualizerData,
} from "./types";

/**
 * Extract all visualizer data from an aide tree
 */
export function extractVisualizerData(
  aide: AideTree,
  wireframes: WireframeMap = {}
): VisualizerData {
  const entities = aide.entities || {};
  const relationships = aide.relationships || [];

  // Build protected_by lookup
  const protectedBy = new Map<string, string[]>();
  for (const rel of relationships) {
    if (rel.type === "protected_by") {
      const existing = protectedBy.get(rel.from) || [];
      existing.push(rel.to);
      protectedBy.set(rel.from, existing);
    }
  }

  // Find CUJ container
  const cujContainer = Object.entries(entities).find(
    ([id, entity]) => id === "cujs" || entity.props?.title === "Critical User Journeys"
  );
  const cujContainerId = cujContainer?.[0];

  // Extract CUJs
  const cujs: CUJ[] = [];
  const cujMap = new Map<string, CUJ>();

  for (const [id, entity] of Object.entries(entities)) {
    if (id.startsWith("cuj_") && entity.parent === cujContainerId) {
      const cuj: CUJ = {
        id,
        name: String(entity.props?.feature || id),
        feature: String(entity.props?.feature || id),
        area: String(entity.props?.area || "default"),
        scenarios: [],
      };
      cujs.push(cuj);
      cujMap.set(id, cuj);
    }
  }

  // Extract scenarios
  for (const [id, entity] of Object.entries(entities)) {
    if (id.startsWith("sc_") && entity.parent) {
      const parentCuj = cujMap.get(entity.parent);
      if (parentCuj) {
        const componentStates: Record<string, string> = {};
        if (entity.props) {
          for (const [key, value] of Object.entries(entity.props)) {
            if (key.startsWith("comp_")) {
              componentStates[key] = String(value);
            }
          }
        }

        const scenario: Scenario = {
          id,
          name: String(entity.props?.name || id),
          given: String(entity.props?.given || ""),
          when: String(entity.props?.when || ""),
          then: String(entity.props?.then || ""),
          screen: entity.props?.screen as string | undefined,
          path: entity.props?.path as string | undefined,
          invariants: protectedBy.get(id) || [],
          componentStates,
        };
        parentCuj.scenarios.push(scenario);
      }
    }
  }

  // Extract screen states (st_*)
  const screenStates: ScreenState[] = [];
  for (const [id, entity] of Object.entries(entities)) {
    if (id.startsWith("st_")) {
      const componentStates: Record<string, string> = {};
      if (entity.props) {
        for (const [key, value] of Object.entries(entity.props)) {
          if (key.startsWith("comp_")) {
            componentStates[key] = String(value);
          }
        }
      }
      screenStates.push({
        id,
        screen: String(entity.props?.screen || ""),
        componentStates,
      });
    }
  }

  // Extract transitions (tr_*)
  const transitions: GraphTransition[] = [];
  for (const [id, entity] of Object.entries(entities)) {
    if (id.startsWith("tr_")) {
      transitions.push({
        id,
        from: String(entity.props?.from || ""),
        to: String(entity.props?.to || ""),
        action: String(entity.props?.action || ""),
        trigger: entity.props?.trigger as string | undefined,
      });
    }
  }

  // Extract components (comp_*)
  const componentMap = new Map<string, Component>();
  for (const [id, entity] of Object.entries(entities)) {
    if (id.startsWith("comp_")) {
      componentMap.set(id, {
        id,
        name: String(entity.props?.name || id.replace("comp_", "")),
        type: entity.props?.type as string | undefined,
        variant: entity.props?.variant as string | undefined,
        description: entity.props?.description as string | undefined,
        wireframeHtml: wireframes[id],
      });
    }
  }

  // Extract explicit screens (screen_*)
  const explicitScreens: Screen[] = [];
  for (const [id, entity] of Object.entries(entities)) {
    if (id.startsWith("screen_")) {
      const componentsStr = entity.props?.components as string | undefined;
      const screenComponents: Component[] = [];
      if (componentsStr) {
        const compIds = componentsStr.split(",").map((s) => s.trim());
        for (const compId of compIds) {
          const comp = componentMap.get(compId);
          if (comp) {
            screenComponents.push(comp);
          }
        }
      }

      explicitScreens.push({
        id,
        name: String(entity.props?.name || id.replace("screen_", "")),
        description: entity.props?.description as string | undefined,
        inferred: false,
        components: screenComponents.length > 0 ? screenComponents : undefined,
        nav: entity.props?.nav as string | undefined,
      });
    }
  }

  // Use explicit screens or infer from scenarios
  const screens = explicitScreens.length > 0
    ? explicitScreens
    : inferScreensFromScenarios(cujs);

  return { cujs, screens, transitions, relationships, screenStates };
}

/**
 * Infer screens from scenario text when no explicit screens are defined
 */
function inferScreensFromScenarios(cujs: CUJ[]): Screen[] {
  const screenNames = new Set<string>();

  for (const cuj of cujs) {
    for (const scenario of cuj.scenarios) {
      const givenScreens = extractScreenTerms(scenario.given);
      const thenScreens = extractScreenTerms(scenario.then);

      for (const s of [...givenScreens, ...thenScreens]) {
        screenNames.add(s);
      }
    }
  }

  return Array.from(screenNames).map((name) => ({
    id: `screen_${name.toLowerCase().replace(/\s+/g, "_")}`,
    name,
    inferred: true,
  }));
}

/**
 * Extract screen-like terms from text
 */
function extractScreenTerms(text: string): string[] {
  const terms: string[] = [];
  const patterns = [
    /(?:on|viewing|at)\s+(?:the\s+)?(\w+)/gi,
    /(\w+)\s+(?:displayed|shown|visible)/gi,
    /sees?\s+(?:the\s+)?(\w+)/gi,
    /(\w+)\s+(?:page|screen|form|view)/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const term = match[1];
      if (!["user", "the", "a", "an", "is", "are", "has", "have", "with"].includes(term.toLowerCase())) {
        terms.push(capitalize(term));
      }
    }
  }

  return terms;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
