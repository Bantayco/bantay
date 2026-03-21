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

interface DesignTokenTask {
  id: string;
  action: string;
  corrective_action: string;
  props?: Record<string, string>;
}

export async function runTasks(
  projectPath: string,
  options: TasksOptions = {}
): Promise<{ outputPath: string; cujs: CUJ[]; designTokens: DesignTokenTask[] }> {
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

  // Get CUJs and scenarios to process
  let cujsToProcess: string[];
  let changedScenarios: Map<string, string[]> = new Map(); // Map parent CUJ -> scenario IDs
  let designTokens: DesignTokenTask[] = [];

  if (options.all) {
    // All CUJs
    cujsToProcess = Object.keys(aideData.entities).filter((id) =>
      id.startsWith("cuj_")
    );
    // All design tokens
    designTokens = Object.entries(aideData.entities)
      .filter(([, entity]) => entity.parent === "design_system")
      .map(([id, entity]) => ({
        id,
        action: "EXISTING",
        corrective_action: "screenshot diff + human review",
        props: entity.props,
      }));
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

    // Find design_token changes
    for (const change of diffResult.changes) {
      if (change.type === "design_token" && (change.action === "ADDED" || change.action === "MODIFIED")) {
        const entity = aideData.entities[change.entity_id];
        designTokens.push({
          id: change.entity_id,
          action: change.action,
          corrective_action: change.corrective_action || "screenshot diff + human review",
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
  const content = generateTasksMarkdown(phases, designTokens);

  // Write to tasks.md
  const outputPath = join(projectPath, "tasks.md");
  await writeFile(outputPath, content, "utf-8");

  return { outputPath, cujs, designTokens };
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

function generateTasksMarkdown(phases: CUJ[][], designTokens: DesignTokenTask[] = []): string {
  const lines: string[] = ["# Tasks", ""];

  // Generate design token tasks first (they need visual review)
  if (designTokens.length > 0) {
    lines.push("## Design Token Changes");
    lines.push("");
    lines.push("*These changes require visual review before deployment.*");
    lines.push("");

    for (const token of designTokens) {
      lines.push(`### ${token.id}`);
      lines.push("");
      lines.push(`- [ ] Apply ${token.id} token change to components`);
      lines.push(`- [ ] Run screenshot diff against baselines`);
      lines.push(`- [ ] Flag for human review`);
      lines.push("");
    }
  }

  // Generate CUJ phases
  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    const phaseNum = designTokens.length > 0 ? i + 2 : i + 1;
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

export function formatTasks(result: { outputPath: string; cujs: CUJ[]; designTokens: DesignTokenTask[] }): string {
  const total = result.cujs.length + result.designTokens.length;
  return `Generated ${result.outputPath} with ${total} tasks`;
}
