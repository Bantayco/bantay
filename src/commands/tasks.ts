import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import * as yaml from "js-yaml";
import { resolveAidePath } from "../aide/discovery";

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

export async function runTasks(
  projectPath: string,
  options: TasksOptions = {}
): Promise<{ outputPath: string; cujs: CUJ[] }> {
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

  // Get CUJs to process
  let cujsToProcess: string[];

  if (options.all) {
    // All CUJs
    cujsToProcess = Object.keys(aideData.entities).filter((id) =>
      id.startsWith("cuj_")
    );
  } else {
    // Diff mode - only added/modified CUJs
    const lockPath = aidePath + ".lock";
    if (!existsSync(lockPath)) {
      throw new Error(
        "No lock file found. Run 'bantay aide lock' first, or use --all for full generation."
      );
    }

    const lockContent = await readFile(lockPath, "utf-8");
    const lockData = yaml.load(lockContent) as { entities: Record<string, string> };

    // Find CUJs that are new or modified
    cujsToProcess = Object.keys(aideData.entities).filter((id) => {
      if (!id.startsWith("cuj_")) return false;
      // CUJ is new if not in lock file
      if (!lockData.entities[id]) return true;
      // CUJ is modified if hash differs (we'd need to compute hash, but for now check existence)
      return false;
    });
  }

  // Build CUJ objects with scenarios and dependencies
  const cujs: CUJ[] = cujsToProcess.map((id) => {
    const entity = aideData.entities[id];
    const props = entity.props || {};

    // Find scenarios that are children of this CUJ
    const scenarios: Scenario[] = Object.entries(aideData.entities)
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
  const content = generateTasksMarkdown(phases);

  // Write to tasks.md
  const outputPath = join(projectPath, "tasks.md");
  await writeFile(outputPath, content, "utf-8");

  return { outputPath, cujs };
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

function generateTasksMarkdown(phases: CUJ[][]): string {
  const lines: string[] = ["# Tasks", ""];

  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    lines.push(`## Phase ${i + 1}`);
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
          lines.push(`- [ ] ${sc.name}`);
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

export function formatTasks(result: { outputPath: string; cujs: CUJ[] }): string {
  return `Generated ${result.outputPath} with ${result.cujs.length} tasks`;
}
