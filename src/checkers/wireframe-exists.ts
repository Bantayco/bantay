/**
 * Wireframe Exists Checker
 *
 * Verifies that every component entity (comp_*) in the aide
 * has a corresponding wireframe file at wireframes/<comp_id>.html
 *
 * This is a STRUCTURAL checker - it runs automatically whenever
 * the aide has comp_* entities, regardless of invariants.md.
 */

import type {
  Checker,
  CheckResult,
  CheckerContext,
  CheckViolation,
  StructuralChecker,
  StructuralCheckResult,
} from "./types";
import type { Invariant } from "../generators/invariants";
import { readFile } from "fs/promises";
import { join } from "path";
import * as yaml from "js-yaml";
import { resolveAidePath } from "../aide/discovery";

interface AideEntity {
  display?: string;
  parent?: string;
  props?: Record<string, unknown>;
}

interface AideTree {
  entities: Record<string, AideEntity>;
  relationships: unknown[];
}

/**
 * Find all component entity IDs in the aide tree.
 * Components are entities whose ID starts with "comp_".
 */
function findComponentIds(aide: AideTree): string[] {
  const entities = aide.entities || {};
  return Object.keys(entities).filter((id) => id.startsWith("comp_"));
}

/**
 * Check if a wireframe file exists for a component.
 */
async function wireframeExists(projectPath: string, compId: string): Promise<boolean> {
  const wireframePath = join(projectPath, "wireframes", `${compId}.html`);
  try {
    const file = Bun.file(wireframePath);
    return await file.exists();
  } catch {
    return false;
  }
}

/**
 * Load and parse the aide file, returning component IDs if found.
 */
async function loadComponentIds(projectPath: string): Promise<string[]> {
  try {
    const resolved = await resolveAidePath(projectPath);
    const aideContent = await readFile(resolved.path, "utf-8");
    const aide = yaml.load(aideContent) as AideTree;
    return findComponentIds(aide);
  } catch {
    return [];
  }
}

/**
 * Core check logic shared by both checker types.
 */
async function checkWireframes(
  projectPath: string
): Promise<{ violations: CheckViolation[]; componentIds: string[] }> {
  const componentIds = await loadComponentIds(projectPath);
  const violations: CheckViolation[] = [];

  for (const compId of componentIds) {
    const exists = await wireframeExists(projectPath, compId);
    if (!exists) {
      violations.push({
        filePath: `wireframes/${compId}.html`,
        message: `Missing wireframe: wireframes/${compId}.html`,
      });
    }
  }

  return { violations, componentIds };
}

/**
 * Structural checker - runs automatically when aide has comp_* entities.
 */
export const wireframeStructuralChecker: StructuralChecker = {
  name: "Wireframe Files",
  description: "Every component entity must have a wireframe file at wireframes/<comp_id>.html",

  async shouldRun(context: CheckerContext): Promise<boolean> {
    const componentIds = await loadComponentIds(context.projectPath);
    return componentIds.length > 0;
  },

  async check(context: CheckerContext): Promise<StructuralCheckResult> {
    const { violations } = await checkWireframes(context.projectPath);

    return {
      name: "Wireframe Files",
      status: violations.length > 0 ? "fail" : "pass",
      violations,
    };
  },
};

/**
 * Category-based checker - runs when matched to a design_integrity invariant.
 * This is kept for backward compatibility but the structural checker is preferred.
 */
export const wireframeExistsChecker: Checker = {
  category: "design_integrity",

  async check(invariant: Invariant, context: CheckerContext): Promise<CheckResult> {
    const { violations, componentIds } = await checkWireframes(context.projectPath);

    if (componentIds.length === 0) {
      return {
        invariant,
        status: "pass",
        violations: [],
        message: "No component entities found in aide",
      };
    }

    return {
      invariant,
      status: violations.length > 0 ? "fail" : "pass",
      violations,
    };
  },
};
