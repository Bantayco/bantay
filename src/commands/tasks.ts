import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import * as yaml from "js-yaml";
import { resolveAidePath } from "../aide/discovery";
import { runDiff, type ClassifiedChange } from "./diff";

interface Entity {
  id: string;
  parent?: string;
  display?: string;
  props?: Record<string, string>;
}

interface Relationship {
  from: string;
  to: string;
  type: string;
  cardinality?: string;
}

interface AideData {
  entities: Record<string, Entity>;
  relationships: Relationship[];
}

interface CUJ {
  id: string;
  feature: string;
  tier?: string;
  area?: string;
  scenarios: Scenario[];
  dependsOn: string[];
}

interface Scenario {
  id: string;
  name: string;
  given?: string;
  when?: string;
  then?: string;
}

interface TasksOptions {
  all?: boolean;
  aide?: string;
}

interface EntityTask {
  id: string;
  type: string;
  action: string;
  corrective_action: string;
  props?: Record<string, string>;
}

export async function runTasks(
  projectPath: string,
  options: TasksOptions = {}
): Promise<{ outputPath: string; cujs: CUJ[]; entityTasks: EntityTask[] }> {
  // Resolve aide file path
  const { path: aidePath, filename } = await resolveAidePath(
    projectPath,
    options.aide
  );

  if (!existsSync(aidePath)) {
    throw new Error("No .aide file found. Run 'bantay aide init' to create one.");
  }

  // Parse the aide file
  const aideContent = await readFile(aidePath, "utf-8");
  const aideData = yaml.load(aideContent) as AideData;

  // Entity types that generate tasks with corrective actions
  const ENTITY_TYPES_WITH_TASKS = ["design_token", "constraint", "foundation", "invariant", "wisdom", "relationship"];

  // Get CUJs and scenarios to process
  let cujsToProcess: string[];
  let changedScenarios: Map<string, string[]> = new Map(); // Map parent CUJ -> scenario IDs
  let entityTasks: EntityTask[] = [];

  if (options.all) {
    // All CUJs
    cujsToProcess = Object.keys(aideData.entities).filter((id) =>
      id.startsWith("cuj_")
    );
    // All entities with corrective actions
    const parentToType: Record<string, string> = {
      design_system: "design_token",
      constraints: "constraint",
      foundations: "foundation",
      invariants: "invariant",
      wisdom: "wisdom",
    };
    const typeToAction: Record<string, string> = {
      design_token: "apply tokens to code",
      constraint: "enforce in codebase",
      foundation: "apply to project",
      invariant: "write checker",
      wisdom: "update exports",
    };
    for (const [id, entity] of Object.entries(aideData.entities)) {
      const parent = entity.parent;
      if (parent && parentToType[parent]) {
        const type = parentToType[parent];
        entityTasks.push({
          id,
          type,
          action: "EXISTING",
          corrective_action: typeToAction[type],
          props: entity.props,
        });
      }
    }
  } else {
    // Diff mode - use bantay diff to find changes
    const lockPath = aidePath + ".lock";
    if (!existsSync(lockPath)) {
      throw new Error(
        "No lock file found. Run 'bantay aide lock' first, or use --all for full generation."
      );
    }

    // Get diff results
    const diffResult = await runDiff(projectPath);

    // Find new CUJs only (not modified - matches original behavior)
    cujsToProcess = diffResult.changes
      .filter((c) => c.type === "cuj" && c.action === "ADDED")
      .map((c) => c.entity_id);

    // Find new/modified scenarios and group by parent CUJ
    for (const change of diffResult.changes) {
      if (change.type === "scenario" && (change.action === "ADDED" || change.action === "MODIFIED")) {
        const parentCuj = change.parent;
        if (parentCuj && parentCuj.startsWith("cuj_")) {
          if (!changedScenarios.has(parentCuj)) {
            changedScenarios.set(parentCuj, []);
          }
          changedScenarios.get(parentCuj)!.push(change.entity_id);
        }
      }
    }

    // Find all entity types with corrective actions
    for (const change of diffResult.changes) {
      if (ENTITY_TYPES_WITH_TASKS.includes(change.type) && (change.action === "ADDED" || change.action === "MODIFIED")) {
        const entity = aideData.entities[change.entity_id];
        entityTasks.push({
          id: change.entity_id,
          type: change.type,
          action: change.action,
          corrective_action: change.corrective_action || "",
          props: entity?.props,
        });
      }
    }
  }

  // Add CUJs that have changed scenarios (even if the CUJ itself didn't change)
  for (const parentCuj of changedScenarios.keys()) {
    if (!cujsToProcess.includes(parentCuj)) {
      cujsToProcess.push(parentCuj);
    }
  }

  // Build CUJ objects with scenarios and dependencies
  const cujs: CUJ[] = cujsToProcess.map((id) => {
    const entity = aideData.entities[id];
    const props = entity.props || {};

    // Determine which scenarios to include
    const changedScenariosForCuj = changedScenarios.get(id);
    let scenarios: Scenario[];

    if (changedScenariosForCuj && changedScenariosForCuj.length > 0) {
      // Only include the changed scenarios for this CUJ
      scenarios = changedScenariosForCuj
        .map((scId) => {
          const scEntity = aideData.entities[scId];
          if (!scEntity) return null;
          return {
            id: scId,
            name: scEntity.props?.name || scId,
            given: scEntity.props?.given,
            when: scEntity.props?.when,
            then: scEntity.props?.then,
          };
        })
        .filter((s): s is Scenario => s !== null);
    } else {
      // New or modified CUJ: include all scenarios
      scenarios = Object.entries(aideData.entities)
        .filter(([scId, scEntity]) =>
          scId.startsWith("sc_") && scEntity.parent === id
        )
        .map(([scId, scEntity]) => ({
          id: scId,
          name: scEntity.props?.name || scId,
          given: scEntity.props?.given,
          when: scEntity.props?.when,
          then: scEntity.props?.then,
        }));
    }

    // Find dependencies (depends_on relationships where this CUJ is the 'from')
    const dependsOn: string[] = aideData.relationships
      .filter((rel) => rel.from === id && rel.type === "depends_on")
      .map((rel) => rel.to);

    return {
      id,
      feature: props.feature || id,
      tier: props.tier,
      area: props.area,
      scenarios,
      dependsOn,
    };
  });

  // Order CUJs into phases using topological sort
  const phases = topologicalSort(cujs);

  // Generate tasks.md content
  const content = generateTasksMarkdown(phases, entityTasks);

  // Write to tasks.md
  const outputPath = join(projectPath, "tasks.md");
  await writeFile(outputPath, content, "utf-8");

  return { outputPath, cujs, entityTasks };
}

function topologicalSort(cujs: CUJ[]): CUJ[][] {
  const cujMap = new Map(cujs.map((c) => [c.id, c]));
  const phases: CUJ[][] = [];
  const processed = new Set<string>();

  // Keep going until all CUJs are processed
  while (processed.size < cujs.length) {
    const phase: CUJ[] = [];

    for (const cuj of cujs) {
      if (processed.has(cuj.id)) continue;

      // Check if all dependencies are already processed
      const allDepsProcessed = cuj.dependsOn.every(
        (dep) => !cujMap.has(dep) || processed.has(dep)
      );

      if (allDepsProcessed) {
        phase.push(cuj);
      }
    }

    if (phase.length === 0 && processed.size < cujs.length) {
      // Circular dependency - just add remaining
      for (const cuj of cujs) {
        if (!processed.has(cuj.id)) {
          phase.push(cuj);
        }
      }
    }

    for (const cuj of phase) {
      processed.add(cuj.id);
    }

    if (phase.length > 0) {
      phases.push(phase);
    }
  }

  return phases;
}

function generateTasksMarkdown(phases: CUJ[][], entityTasks: EntityTask[] = []): string {
  const lines: string[] = ["# Tasks", ""];

  // Group entity tasks by type
  const tasksByType = new Map<string, EntityTask[]>();
  for (const task of entityTasks) {
    if (!tasksByType.has(task.type)) {
      tasksByType.set(task.type, []);
    }
    tasksByType.get(task.type)!.push(task);
  }

  // Section titles for each entity type
  const sectionTitles: Record<string, string> = {
    design_token: "Design Token Changes",
    constraint: "Constraint Changes",
    foundation: "Foundation Changes",
    invariant: "Invariant Changes",
    wisdom: "Wisdom Changes",
    relationship: "Relationship Changes",
  };

  // Generate entity task sections
  for (const [type, tasks] of tasksByType) {
    const title = sectionTitles[type] || `${type} Changes`;
    lines.push(`## ${title}`);
    lines.push("");

    for (const task of tasks) {
      lines.push(`### ${task.id}`);
      lines.push("");
      lines.push(`- [ ] ${task.corrective_action}`);
      lines.push("");
    }
  }

  // Generate CUJ phases
  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    const phaseNum = entityTasks.length > 0 ? i + tasksByType.size + 1 : i + 1;
    lines.push(`## Phase ${phaseNum}`);
    lines.push("");

    for (const cuj of phase) {
      lines.push(`### ${cuj.id}: ${cuj.feature}`);
      lines.push("");
      lines.push(`- [ ] Implement ${cuj.feature}`);
      lines.push("");

      if (cuj.scenarios.length > 0) {
        lines.push("**Acceptance Criteria:**");
        lines.push("");
        for (const sc of cuj.scenarios) {
          lines.push(`- [ ] ${sc.id}: ${sc.name}`);
          if (sc.given || sc.when || sc.then) {
            if (sc.given) lines.push(`  - Given: ${sc.given}`);
            if (sc.when) lines.push(`  - When: ${sc.when}`);
            if (sc.then) lines.push(`  - Then: ${sc.then}`);
          }
        }
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}

export function formatTasks(result: { outputPath: string; cujs: CUJ[]; entityTasks: EntityTask[] }): string {
  const total = result.cujs.length + result.entityTasks.length;
  return `Generated ${result.outputPath} with ${total} tasks`;
}
