/**
 * M3 Component Types Checker
 *
 * Validates that all visual components (comp_*) declare a type from the
 * Material Design 3 component vocabulary.
 *
 * Reference: https://m3.material.io/components
 */

import type {
  Checker,
  CheckResult,
  CheckerContext,
  CheckViolation,
} from "./types";
import type { Invariant } from "../generators/invariants";
import { readFile } from "fs/promises";
import * as yaml from "js-yaml";
import { resolveAidePath } from "../aide/discovery";

interface AideEntity {
  props?: Record<string, unknown>;
}

interface AideTree {
  entities: Record<string, AideEntity>;
}

// M3 Component Types
// Source: https://m3.material.io/components
export const M3_COMPONENT_TYPES = new Set([
  // Actions
  "fab",
  "fab-extended",
  "icon-button",
  "button",
  "segmented-button",
  // Communication
  "badge",
  "progress",
  "snackbar",
  "tooltip",
  // Containment
  "bottom-sheet",
  "card",
  "carousel",
  "dialog",
  "divider",
  "list",
  "list-item",
  "side-sheet",
  // Navigation
  "bottom-app-bar",
  "navigation-bar",
  "navigation-drawer",
  "navigation-rail",
  "search",
  "tabs",
  "top-app-bar",
  // Selection
  "checkbox",
  "chip",
  "date-picker",
  "time-picker",
  "menu",
  "radio",
  "slider",
  "switch",
  // Text inputs
  "text-field",
  // Escape hatch
  "custom",
]);

// Valid variants per type
export const TYPE_VARIANTS: Record<string, Set<string>> = {
  button: new Set(["filled", "outlined", "text", "elevated", "tonal"]),
  fab: new Set(["standard", "small", "large"]),
  "fab-extended": new Set(["standard", "small", "large"]),
  progress: new Set(["circular", "linear"]),
  "text-field": new Set(["filled", "outlined"]),
  chip: new Set(["assist", "filter", "input", "suggestion"]),
  card: new Set(["elevated", "filled", "outlined"]),
  "top-app-bar": new Set(["center-aligned", "small", "medium", "large"]),
};

/**
 * Load component entities from the aide file.
 */
async function loadComponentEntities(
  projectPath: string
): Promise<Record<string, AideEntity>> {
  try {
    const resolved = await resolveAidePath(projectPath);
    const aideContent = await readFile(resolved.path, "utf-8");
    const aide = yaml.load(aideContent) as AideTree;
    const entities = aide.entities || {};

    // Filter to only comp_* entities
    const components: Record<string, AideEntity> = {};
    for (const [id, entity] of Object.entries(entities)) {
      if (id.startsWith("comp_")) {
        components[id] = entity;
      }
    }
    return components;
  } catch {
    return {};
  }
}

/**
 * Validate component entities against M3 vocabulary.
 * Exported for testing.
 */
export function validateComponents(
  entities: Record<string, AideEntity>
): CheckViolation[] {
  const violations: CheckViolation[] = [];

  for (const [id, entity] of Object.entries(entities)) {
    const props = entity.props || {};
    const componentType = props.type as string | undefined;
    const variant = props.variant as string | undefined;
    const description = props.description as string | undefined;

    // Must have type
    if (!componentType) {
      violations.push({
        filePath: "aide",
        line: 0,
        message: `${id} is missing props.type. Add type: <m3-type> (e.g., type: fab, type: text-field)`,
      });
      continue;
    }

    // Type must be known
    if (!M3_COMPONENT_TYPES.has(componentType)) {
      violations.push({
        filePath: "aide",
        line: 0,
        message: `${id} has unknown type "${componentType}". See https://m3.material.io/components`,
      });
      continue;
    }

    // Custom requires description
    if (componentType === "custom" && !description) {
      violations.push({
        filePath: "aide",
        line: 0,
        message: `${id} has type "custom" but missing props.description`,
      });
    }

    // Validate variant if provided and type has defined variants
    if (variant && TYPE_VARIANTS[componentType]) {
      if (!TYPE_VARIANTS[componentType].has(variant)) {
        const allowed = [...TYPE_VARIANTS[componentType]].join(", ");
        violations.push({
          filePath: "aide",
          line: 0,
          message: `${id} has invalid variant "${variant}" for type "${componentType}". Allowed: ${allowed}`,
        });
      }
    }
  }

  return violations;
}

/**
 * Built-in checker for M3 component types.
 * Category: visualize
 */
export const m3ComponentTypesChecker: Checker = {
  category: "visualize",

  async check(
    invariant: Invariant,
    context: CheckerContext
  ): Promise<CheckResult> {
    const components = await loadComponentEntities(context.projectPath);

    if (Object.keys(components).length === 0) {
      return {
        invariant,
        status: "pass",
        violations: [],
        message: "No component entities found in aide",
      };
    }

    const violations = validateComponents(components);

    return {
      invariant,
      status: violations.length > 0 ? "fail" : "pass",
      violations,
    };
  },
};
