/**
 * diff.ts — bantay diff command
 *
 * Wraps bantay aide diff with entity type classification based on parent chain.
 * bantay aide diff stays unchanged (raw structural output).
 * bantay diff adds classification for human-readable output.
 *
 * @scenario sc_diff_classified
 */

import { existsSync } from "fs";
import { readFile, readdir } from "fs/promises";
import { read, type AideTree } from "../aide";

/**
 * Container parents that define entity types
 */
const PARENT_TYPE_MAP: Record<string, string> = {
  cujs: "scenario",
  invariants: "invariant",
  constraints: "constraint",
  foundations: "foundation",
  wisdom: "wisdom",
};

const CUJ_PREFIX = "cuj_";

/**
 * Classified change entry
 */
export interface ClassifiedChange {
  action: "ADDED" | "MODIFIED" | "REMOVED";
  type: string;
  entity_id: string;
  parent?: string;
  from?: string;
  to?: string;
  relationship_type?: string;
}

/**
 * Result from diff command
 */
export interface DiffResult {
  hasChanges: boolean;
  changes: ClassifiedChange[];
}

/**
 * Discover aide file in directory
 */
async function discoverAideFile(cwd: string): Promise<string | null> {
  try {
    const files = await readdir(cwd);
    const aideFiles = files.filter((f) => f.endsWith(".aide"));
    if (aideFiles.length === 1) {
      return `${cwd}/${aideFiles[0]}`;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get entity type by walking parent chain
 */
function getEntityTypeByParent(id: string, parent: string | undefined, tree: AideTree): string {
  if (!parent) {
    return "entity";
  }

  // Direct mapping
  if (parent in PARENT_TYPE_MAP) {
    return PARENT_TYPE_MAP[parent];
  }

  // If parent starts with cuj_, child is a scenario
  if (parent.startsWith(CUJ_PREFIX)) {
    return "scenario";
  }

  // Walk up the parent chain
  const parentEntity = tree.entities[parent];
  if (parentEntity && parentEntity.parent) {
    return getEntityTypeByParent(id, parentEntity.parent, tree);
  }

  return "entity";
}

/**
 * Get entity type from parent ID (for removed entities)
 */
function getEntityTypeFromParentId(parentId: string): string {
  if (parentId in PARENT_TYPE_MAP) {
    return PARENT_TYPE_MAP[parentId];
  }
  if (parentId.startsWith(CUJ_PREFIX)) {
    return "scenario";
  }
  return "entity";
}

/**
 * Fallback: get entity type from ID prefix
 */
function getEntityTypeByIdPrefix(id: string): string {
  const prefixes: Record<string, string> = {
    cuj_: "cuj",
    sc_: "scenario",
    inv_: "invariant",
    con_: "constraint",
    found_: "foundation",
    wis_: "wisdom",
  };
  for (const [prefix, type] of Object.entries(prefixes)) {
    if (id.startsWith(prefix)) {
      return type;
    }
  }
  return "entity";
}

/**
 * Lock file entity with parent info
 */
interface LockFileEntity {
  hash: string;
  parent?: string;
}

interface LockFile {
  entities: Record<string, LockFileEntity>;
  relationships: string[];
}

/**
 * Parse lock file content
 */
function parseLockFile(content: string): LockFile {
  const result: LockFile = {
    entities: {},
    relationships: [],
  };

  let section = "";
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("#") || trimmed === "") {
      continue;
    }

    if (trimmed === "entities:") {
      section = "entities";
      continue;
    }
    if (trimmed === "relationships:") {
      section = "relationships";
      continue;
    }

    if (section === "entities") {
      const matchWithParent = trimmed.match(/^(\w+):\s*(\w+)\s+parent:(\w+)$/);
      if (matchWithParent) {
        result.entities[matchWithParent[1]] = {
          hash: matchWithParent[2],
          parent: matchWithParent[3],
        };
      } else {
        const match = trimmed.match(/^(\w+):\s*(\w+)$/);
        if (match) {
          result.entities[match[1]] = {
            hash: match[2],
          };
        }
      }
    } else if (section === "relationships") {
      const match = trimmed.match(/^-\s*(\w+):(\w+):(\w+):\s*\w+$/);
      if (match) {
        result.relationships.push(`${match[1]}:${match[2]}:${match[3]}`);
      }
    }
  }

  return result;
}

/**
 * Compute entity hash (same as aide.ts)
 */
function computeEntityHash(
  id: string,
  entity: { display?: string; parent?: string; props?: Record<string, unknown> }
): string {
  const str = JSON.stringify({ id, ...entity });
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

/**
 * Run diff and classify changes
 */
export async function runDiff(projectPath: string): Promise<DiffResult> {
  const aidePath = await discoverAideFile(projectPath);

  if (!aidePath) {
    throw new Error("No .aide file found. Run 'bantay aide init' to create one.");
  }

  const lockPath = `${aidePath}.lock`;

  if (!existsSync(lockPath)) {
    throw new Error(`Lock file not found: ${lockPath}. Run 'bantay aide lock' first.`);
  }

  // Read current aide tree
  const tree = await read(aidePath);

  // Read and parse lock file
  const lockContent = await readFile(lockPath, "utf-8");
  const lock = parseLockFile(lockContent);

  // Compute current hashes
  const currentHashes: Record<string, string> = {};
  for (const [id, entity] of Object.entries(tree.entities)) {
    currentHashes[id] = computeEntityHash(id, entity);
  }

  // Compute current relationships
  const currentRelationships = new Set<string>();
  for (const rel of tree.relationships) {
    currentRelationships.add(`${rel.from}:${rel.to}:${rel.type}`);
  }

  const lockRelationships = new Set<string>(lock.relationships);

  // Build classified changes
  const changes: ClassifiedChange[] = [];

  // Added entities
  for (const id of Object.keys(currentHashes)) {
    if (!(id in lock.entities)) {
      const entity = tree.entities[id];
      const parent = entity.parent;
      const entityType = getEntityTypeByParent(id, parent, tree);
      changes.push({
        action: "ADDED",
        type: entityType,
        entity_id: id,
        parent,
      });
    } else if (lock.entities[id].hash !== currentHashes[id]) {
      const entity = tree.entities[id];
      const parent = entity.parent;
      const entityType = getEntityTypeByParent(id, parent, tree);
      changes.push({
        action: "MODIFIED",
        type: entityType,
        entity_id: id,
        parent,
      });
    }
  }

  // Removed entities
  for (const id of Object.keys(lock.entities)) {
    if (!(id in currentHashes)) {
      const lockEntity = lock.entities[id];
      let entityType: string;
      if (lockEntity.parent) {
        entityType = getEntityTypeFromParentId(lockEntity.parent);
      } else {
        entityType = getEntityTypeByIdPrefix(id);
      }
      changes.push({
        action: "REMOVED",
        type: entityType,
        entity_id: id,
        parent: lockEntity.parent,
      });
    }
  }

  // Added relationships
  for (const rel of currentRelationships) {
    if (!lockRelationships.has(rel)) {
      const [from, to, relType] = rel.split(":");
      changes.push({
        action: "ADDED",
        type: "relationship",
        entity_id: `${from}:${to}`,
        from,
        to,
        relationship_type: relType,
      });
    }
  }

  // Removed relationships
  for (const rel of lockRelationships) {
    if (!currentRelationships.has(rel)) {
      const [from, to, relType] = rel.split(":");
      changes.push({
        action: "REMOVED",
        type: "relationship",
        entity_id: `${from}:${to}`,
        from,
        to,
        relationship_type: relType,
      });
    }
  }

  return {
    hasChanges: changes.length > 0,
    changes,
  };
}

/**
 * Format diff result as human-readable output
 */
export function formatDiff(result: DiffResult): string {
  if (!result.hasChanges) {
    return "No changes since last lock.";
  }

  const lines: string[] = [];

  // Sort by action then by entity_id
  const sorted = [...result.changes].sort((a, b) => {
    const actionOrder = { ADDED: 0, MODIFIED: 1, REMOVED: 2 };
    const actionDiff = actionOrder[a.action] - actionOrder[b.action];
    if (actionDiff !== 0) return actionDiff;
    return a.entity_id.localeCompare(b.entity_id);
  });

  for (const change of sorted) {
    if (change.type === "relationship") {
      lines.push(`${change.action} relationship: ${change.from} → ${change.to}`);
    } else {
      const parentStr = change.parent ? ` (parent: ${change.parent})` : "";
      lines.push(`${change.action} ${change.type}: ${change.entity_id}${parentStr}`);
    }
  }

  return lines.join("\n");
}

/**
 * Format diff result as JSON
 */
export function formatDiffJson(result: DiffResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Handle bantay diff command
 */
export async function handleDiff(args: string[]): Promise<void> {
  const projectPath = process.cwd();
  const jsonOutput = args.includes("--json");

  try {
    const result = await runDiff(projectPath);

    if (jsonOutput) {
      console.log(formatDiffJson(result));
    } else {
      console.log(formatDiff(result));
    }

    process.exit(result.hasChanges ? 1 : 0);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
