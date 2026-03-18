import { existsSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import {
  read,
  write,
  addEntity,
  removeEntity,
  addRelationship,
  validate,
  type AideTree,
} from "../aide";
import type { RelationshipType, Cardinality } from "../aide/types";

const DEFAULT_AIDE_PATH = "bantay.aide";

/**
 * Parse command-line arguments for the aide commands
 */
interface AideCommandOptions {
  aidePath?: string;
}

function parseOptions(args: string[]): { options: AideCommandOptions; rest: string[] } {
  const options: AideCommandOptions = {};
  const rest: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--aide" || args[i] === "-a") {
      options.aidePath = args[++i];
    } else {
      rest.push(args[i]);
    }
  }

  return { options, rest };
}

/**
 * Get the aide file path, defaulting to bantay.aide in cwd
 */
function getAidePath(options: AideCommandOptions): string {
  return options.aidePath || `${process.cwd()}/${DEFAULT_AIDE_PATH}`;
}

/**
 * Handle bantay aide add
 * Usage: bantay aide add <id> [--parent <parent>] [--display <display>] [--prop key=value...]
 */
export async function handleAideAdd(args: string[]): Promise<void> {
  const { options, rest } = parseOptions(args);
  const aidePath = getAidePath(options);

  if (!existsSync(aidePath)) {
    console.error(`Error: Aide file not found: ${aidePath}`);
    console.error("Run 'bantay init' to create a project first.");
    process.exit(1);
  }

  // Parse add-specific options
  let id: string | undefined;
  let parent: string | undefined;
  let display: string | undefined;
  const props: Record<string, unknown> = {};

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--parent" || arg === "-p") {
      parent = rest[++i];
    } else if (arg === "--display" || arg === "-d") {
      display = rest[++i];
    } else if (arg === "--prop") {
      const propStr = rest[++i];
      const eqIdx = propStr.indexOf("=");
      if (eqIdx > 0) {
        const key = propStr.slice(0, eqIdx);
        const value = propStr.slice(eqIdx + 1);
        props[key] = parsePropertyValue(value);
      }
    } else if (!arg.startsWith("-") && !id) {
      id = arg;
    }
  }

  try {
    const tree = await read(aidePath);
    const newTree = addEntity(tree, { id, parent, display, props });
    await write(aidePath, newTree);

    // Find the new ID (might be auto-generated)
    const newId = id || findNewId(tree, newTree);
    console.log(`Added entity: ${newId}`);
  } catch (error) {
    console.error(`Error adding entity: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

/**
 * Handle bantay aide remove
 * Usage: bantay aide remove <id> [--force]
 */
export async function handleAideRemove(args: string[]): Promise<void> {
  const { options, rest } = parseOptions(args);
  const aidePath = getAidePath(options);

  if (!existsSync(aidePath)) {
    console.error(`Error: Aide file not found: ${aidePath}`);
    process.exit(1);
  }

  const id = rest.find((arg) => !arg.startsWith("-"));
  const force = rest.includes("--force") || rest.includes("-f");

  if (!id) {
    console.error("Error: Entity ID required");
    console.error("Usage: bantay aide remove <id> [--force]");
    process.exit(1);
  }

  try {
    const tree = await read(aidePath);
    const newTree = removeEntity(tree, id, { force });
    await write(aidePath, newTree);

    console.log(`Removed entity: ${id}`);
  } catch (error) {
    console.error(`Error removing entity: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

/**
 * Handle bantay aide link
 * Usage: bantay aide link <from> <to> --type <type> [--cardinality <cardinality>]
 */
export async function handleAideLink(args: string[]): Promise<void> {
  const { options, rest } = parseOptions(args);
  const aidePath = getAidePath(options);

  if (!existsSync(aidePath)) {
    console.error(`Error: Aide file not found: ${aidePath}`);
    process.exit(1);
  }

  let from: string | undefined;
  let to: string | undefined;
  let type: RelationshipType | undefined;
  let cardinality: Cardinality = "many_to_many";

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--type" || arg === "-t") {
      type = rest[++i] as RelationshipType;
    } else if (arg === "--cardinality" || arg === "-c") {
      cardinality = rest[++i] as Cardinality;
    } else if (!arg.startsWith("-")) {
      if (!from) {
        from = arg;
      } else if (!to) {
        to = arg;
      }
    }
  }

  if (!from || !to) {
    console.error("Error: Both 'from' and 'to' entity IDs required");
    console.error("Usage: bantay aide link <from> <to> --type <type>");
    process.exit(1);
  }

  if (!type) {
    console.error("Error: Relationship type required (--type)");
    console.error("Valid types: protected_by, depends_on, implements, delegates_to, weakens");
    process.exit(1);
  }

  try {
    const tree = await read(aidePath);
    const newTree = addRelationship(tree, { from, to, type, cardinality });
    await write(aidePath, newTree);

    console.log(`Added relationship: ${from} --[${type}]--> ${to}`);
  } catch (error) {
    console.error(`Error adding relationship: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

/**
 * Handle bantay aide show
 * Usage: bantay aide show [id] [--format json|tree]
 */
export async function handleAideShow(args: string[]): Promise<void> {
  const { options, rest } = parseOptions(args);
  const aidePath = getAidePath(options);

  if (!existsSync(aidePath)) {
    console.error(`Error: Aide file not found: ${aidePath}`);
    process.exit(1);
  }

  let entityId: string | undefined;
  let format = "tree";

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--format" || arg === "-f") {
      format = rest[++i];
    } else if (!arg.startsWith("-")) {
      entityId = arg;
    }
  }

  try {
    const tree = await read(aidePath);

    if (format === "json") {
      if (entityId) {
        const entity = tree.entities[entityId];
        if (!entity) {
          console.error(`Entity not found: ${entityId}`);
          process.exit(1);
        }
        console.log(JSON.stringify({ id: entityId, ...entity }, null, 2));
      } else {
        console.log(JSON.stringify(tree, null, 2));
      }
    } else {
      // Tree format
      if (entityId) {
        showEntity(tree, entityId, 0);
      } else {
        showTree(tree);
      }
    }
  } catch (error) {
    console.error(`Error reading aide file: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

/**
 * Handle bantay aide validate
 * Usage: bantay aide validate
 */
export async function handleAideValidate(args: string[]): Promise<void> {
  const { options } = parseOptions(args);
  const aidePath = getAidePath(options);

  if (!existsSync(aidePath)) {
    console.error(`Error: Aide file not found: ${aidePath}`);
    process.exit(1);
  }

  try {
    const tree = await read(aidePath);
    const errors = validate(tree);

    if (errors.length === 0) {
      console.log("Aide file is valid.");
      const entityCount = Object.keys(tree.entities).length;
      const relCount = tree.relationships.length;
      console.log(`  Entities: ${entityCount}`);
      console.log(`  Relationships: ${relCount}`);
    } else {
      console.error("Validation errors:");
      for (const error of errors) {
        console.error(`  - ${error}`);
      }
      process.exit(1);
    }
  } catch (error) {
    console.error(`Error validating aide file: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

/**
 * Handle bantay aide lock
 * Usage: bantay aide lock
 * Generates bantay.aide.lock with a hash of the current state
 */
export async function handleAideLock(args: string[]): Promise<void> {
  const { options } = parseOptions(args);
  const aidePath = getAidePath(options);
  const lockPath = `${aidePath}.lock`;

  if (!existsSync(aidePath)) {
    console.error(`Error: Aide file not found: ${aidePath}`);
    process.exit(1);
  }

  try {
    const tree = await read(aidePath);
    const errors = validate(tree);

    if (errors.length > 0) {
      console.error("Cannot lock: aide file has validation errors");
      for (const error of errors) {
        console.error(`  - ${error}`);
      }
      process.exit(1);
    }

    // Generate lock file content
    const lockContent = generateLockFile(tree);
    await writeFile(lockPath, lockContent, "utf-8");

    console.log(`Lock file generated: ${lockPath}`);
    console.log(`  Entities: ${Object.keys(tree.entities).length}`);
    console.log(`  Relationships: ${tree.relationships.length}`);
  } catch (error) {
    console.error(`Error generating lock file: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

/**
 * Handle bantay aide update
 * Usage: bantay aide update <id> [--prop key=value...]
 */
export async function handleAideUpdate(args: string[]): Promise<void> {
  const { options, rest } = parseOptions(args);
  const aidePath = getAidePath(options);

  if (!existsSync(aidePath)) {
    console.error(`Error: Aide file not found: ${aidePath}`);
    process.exit(1);
  }

  let id: string | undefined;
  const propsToSet: Record<string, unknown> = {};

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--prop") {
      const propStr = rest[++i];
      const eqIdx = propStr.indexOf("=");
      if (eqIdx > 0) {
        const key = propStr.slice(0, eqIdx);
        const value = propStr.slice(eqIdx + 1);
        propsToSet[key] = parsePropertyValue(value);
      }
    } else if (arg.startsWith("--")) {
      // Handle --checker, --statement, etc. as shorthand for --prop
      const key = arg.slice(2);
      const value = rest[++i];
      if (value) {
        propsToSet[key] = parsePropertyValue(value);
      }
    } else if (!arg.startsWith("-") && !id) {
      id = arg;
    }
  }

  if (!id) {
    console.error("Error: Entity ID required");
    console.error("Usage: bantay aide update <id> --prop key=value");
    process.exit(1);
  }

  if (Object.keys(propsToSet).length === 0) {
    console.error("Error: No properties to update");
    console.error("Usage: bantay aide update <id> --prop key=value");
    process.exit(1);
  }

  try {
    const tree = await read(aidePath);

    if (!tree.entities[id]) {
      console.error(`Error: Entity not found: ${id}`);
      process.exit(1);
    }

    // Update the entity's props
    const entity = tree.entities[id];
    entity.props = entity.props || {};
    for (const [key, value] of Object.entries(propsToSet)) {
      entity.props[key] = value;
    }

    await write(aidePath, tree);

    const updatedKeys = Object.keys(propsToSet).join(", ");
    console.log(`Updated entity ${id}: ${updatedKeys}`);
  } catch (error) {
    console.error(`Error updating entity: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

// --- Helper Functions ---

function parsePropertyValue(value: string): unknown {
  // Try to parse as JSON
  try {
    return JSON.parse(value);
  } catch {
    // Return as string
    return value;
  }
}

function findNewId(oldTree: AideTree, newTree: AideTree): string {
  const oldIds = new Set(Object.keys(oldTree.entities));
  for (const id of Object.keys(newTree.entities)) {
    if (!oldIds.has(id)) {
      return id;
    }
  }
  return "unknown";
}

function showTree(tree: AideTree): void {
  console.log("Entities:");

  // Find root entities (no parent)
  const roots = Object.entries(tree.entities)
    .filter(([_, entity]) => !entity.parent)
    .map(([id]) => id);

  for (const rootId of roots) {
    showEntity(tree, rootId, 1);
  }

  if (tree.relationships.length > 0) {
    console.log("\nRelationships:");
    for (const rel of tree.relationships) {
      console.log(`  ${rel.from} --[${rel.type}]--> ${rel.to}`);
    }
  }
}

function showEntity(tree: AideTree, id: string, indent: number): void {
  const entity = tree.entities[id];
  if (!entity) {
    console.log(`${" ".repeat(indent * 2)}${id} (not found)`);
    return;
  }

  const prefix = " ".repeat(indent * 2);
  const displayStr = entity.display ? ` [${entity.display}]` : "";
  console.log(`${prefix}${id}${displayStr}`);

  // Show props summary
  if (entity.props) {
    const propsKeys = Object.keys(entity.props);
    if (propsKeys.length > 0) {
      const summary = propsKeys.slice(0, 3).join(", ");
      const more = propsKeys.length > 3 ? `, +${propsKeys.length - 3} more` : "";
      console.log(`${prefix}  props: {${summary}${more}}`);
    }
  }

  // Find and show children
  const children = Object.entries(tree.entities)
    .filter(([_, e]) => e.parent === id)
    .map(([childId]) => childId);

  for (const childId of children) {
    showEntity(tree, childId, indent + 1);
  }
}

function generateLockFile(tree: AideTree): string {
  const lines: string[] = [];
  lines.push("# bantay.aide.lock");
  lines.push("# Auto-generated. Do not edit manually.");
  lines.push(`# Generated: ${new Date().toISOString()}`);
  lines.push("");

  // Hash computation placeholder - for now just list entities
  lines.push("entities:");
  const sortedIds = Object.keys(tree.entities).sort();
  for (const id of sortedIds) {
    const entity = tree.entities[id];
    const hash = computeEntityHash(id, entity);
    lines.push(`  ${id}: ${hash}`);
  }

  lines.push("");
  lines.push("relationships:");
  for (const rel of tree.relationships) {
    const hash = computeRelationshipHash(rel);
    lines.push(`  - ${rel.from}:${rel.to}:${rel.type}: ${hash}`);
  }

  return lines.join("\n") + "\n";
}

function computeEntityHash(id: string, entity: { display?: string; parent?: string; props?: Record<string, unknown> }): string {
  // Simple hash for now - could use crypto.subtle for real hash
  const str = JSON.stringify({ id, ...entity });
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

function computeRelationshipHash(rel: { from: string; to: string; type: string; cardinality: string }): string {
  const str = JSON.stringify(rel);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

/**
 * Print help for aide subcommands
 */
export function printAideHelp(): void {
  console.log(`
bantay aide - Manage the aide entity tree

Usage: bantay aide <subcommand> [options]

Subcommands:
  add       Add an entity to the tree
  update    Update an entity's properties
  remove    Remove an entity from the tree
  link      Add a relationship between entities
  show      Display the entity tree or a specific entity
  validate  Validate the aide file
  lock      Generate a lock file

Add Options:
  <id>              Entity ID (optional, auto-generated if parent provided)
  --parent, -p      Parent entity ID
  --display, -d     Display type (page, table, list, checklist)
  --prop key=value  Set a property (can be used multiple times)

Update Options:
  <id>              Entity ID (required)
  --prop key=value  Set a property (can be used multiple times)
  --<key> <value>   Shorthand for --prop key=value (e.g., --checker ./no-eval)

Remove Options:
  <id>              Entity ID (required)
  --force, -f       Force removal even if relationships exist

Link Options:
  <from> <to>       Source and target entity IDs
  --type, -t        Relationship type (required)
                    Valid: protected_by, depends_on, implements, delegates_to, weakens
  --cardinality, -c Cardinality (default: many_to_many)
                    Valid: one_to_one, one_to_many, many_to_one, many_to_many

Show Options:
  [id]              Specific entity to show (optional)
  --format, -f      Output format: tree (default) or json

Global Options:
  --aide, -a        Path to aide file (default: bantay.aide)

Examples:
  bantay aide add inv_new_check --parent invariants --prop "statement=My new check"
  bantay aide update inv_no_network --checker ./no-network
  bantay aide remove inv_old_check --force
  bantay aide link sc_init_new inv_new_check --type protected_by
  bantay aide show invariants
  bantay aide validate
  bantay aide lock
`);
}
