import { existsSync } from "fs";
import { readFile, writeFile, readdir } from "fs/promises";
import { basename } from "path";
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

/**
 * Entity type classification based on ID prefix
 */
const ENTITY_TYPE_PREFIXES: Record<string, string> = {
  "cuj_": "cuj",
  "sc_": "scenario",
  "inv_": "invariant",
  "con_": "constraint",
  "found_": "foundation",
  "wis_": "wisdom",
};

/**
 * Get entity type from ID prefix
 */
function getEntityType(id: string): string {
  for (const [prefix, type] of Object.entries(ENTITY_TYPE_PREFIXES)) {
    if (id.startsWith(prefix)) {
      return type;
    }
  }
  return "entity";
}

/**
 * Parsed lock file structure
 */
interface LockFile {
  entities: Record<string, string>;
  relationships: string[];
}

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
 * Discover .aide files in the current directory
 * Returns: { found: string[], error?: string }
 */
async function discoverAideFiles(cwd: string): Promise<{ found: string[]; error?: string }> {
  try {
    const files = await readdir(cwd);
    const aideFiles = files.filter((f) => f.endsWith(".aide"));
    return { found: aideFiles };
  } catch (error) {
    return { found: [], error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Get the aide file path with auto-discovery
 * - If --aide flag is provided, use that
 * - Otherwise, glob for *.aide in cwd
 * - If exactly one found, use it
 * - If multiple found, error
 * - If none found, error
 */
async function getAidePath(options: AideCommandOptions): Promise<string> {
  const cwd = process.cwd();

  // If explicit path provided, use it (resolve relative to cwd)
  if (options.aidePath) {
    if (options.aidePath.startsWith("/")) {
      return options.aidePath;
    }
    return `${cwd}/${options.aidePath}`;
  }

  // Auto-discover
  const { found, error } = await discoverAideFiles(cwd);

  if (error) {
    console.error(`Error discovering aide files: ${error}`);
    process.exit(1);
  }

  if (found.length === 0) {
    console.error("No .aide file found. Run 'bantay aide init' to create one.");
    process.exit(1);
  }

  if (found.length > 1) {
    console.error("Multiple .aide files found. Specify one with --aide <path>");
    console.error("Found:");
    for (const f of found) {
      console.error(`  - ${f}`);
    }
    process.exit(1);
  }

  return `${cwd}/${found[0]}`;
}

/**
 * Generate skeleton aide file content
 */
function generateAideSkeleton(projectName: string): string {
  return `entities:
  ${projectName}:
    display: page
    props:
      title: ${projectName}
      description: Project description
      version: "0.1"
  cujs:
    display: table
    parent: ${projectName}
    props:
      title: Critical User Journeys
      _pattern: roster
      _group_by: area
      _sort_by: tier
      _sort_order: asc
  invariants:
    display: checklist
    parent: ${projectName}
    props:
      title: Invariants
      _pattern: roster
      _group_by: category
  constraints:
    display: list
    parent: ${projectName}
    props:
      title: Architectural Constraints
      _pattern: flat_list
      _group_by: domain
  foundations:
    display: list
    parent: ${projectName}
    props:
      title: Design Foundations
      _pattern: flat_list
  wisdom:
    display: list
    parent: ${projectName}
    props:
      title: Project Wisdom
      _pattern: flat_list
relationships: []
`;
}

/**
 * Handle bantay aide init
 * Usage: bantay aide init [--name <name>]
 * Creates a new .aide file with skeleton structure
 */
export async function handleAideInit(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const dirName = basename(cwd);

  // Parse --name option
  let name: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--name" || args[i] === "-n") {
      name = args[++i];
    }
  }

  // Determine the aide filename
  const aideName = name || dirName;
  const aideFilename = `${aideName}.aide`;
  const aidePath = `${cwd}/${aideFilename}`;

  // Check if any .aide file already exists
  const { found } = await discoverAideFiles(cwd);

  if (found.length > 0) {
    // Check if the specific file we want to create exists
    if (found.includes(aideFilename)) {
      console.error(`Error: ${aideFilename} already exists.`);
      console.error("Use a different name with --name <name> or delete the existing file.");
      process.exit(1);
    }

    // If we're trying to create a new aide file but others exist, warn
    console.error(`Error: .aide file already exists: ${found[0]}`);
    console.error("Use --name <name> to create a differently named file, or use the existing one.");
    process.exit(1);
  }

  // Generate and write the skeleton
  const content = generateAideSkeleton(aideName);
  await writeFile(aidePath, content, "utf-8");

  console.log(`Created ${aideFilename}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Edit ${aideFilename} to add your project's CUJs, invariants, and constraints`);
  console.log(`  2. Run 'bantay aide validate' to check the file`);
  console.log(`  3. Run 'bantay export all' to generate invariants.md and agent context files`);
}

/**
 * Handle bantay aide add
 * Usage: bantay aide add <id> [--parent <parent>] [--display <display>] [--prop key=value...]
 */
export async function handleAideAdd(args: string[]): Promise<void> {
  const { options, rest } = parseOptions(args);
  const aidePath = await getAidePath(options);

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
  const aidePath = await getAidePath(options);

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
  const aidePath = await getAidePath(options);

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
  const aidePath = await getAidePath(options);

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
  const aidePath = await getAidePath(options);

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
  const aidePath = await getAidePath(options);
  const lockPath = `${aidePath}.lock`;

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
  const aidePath = await getAidePath(options);

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
    // Include parent and behavioral hash for scenarios
    const parts = [`${id}: ${hash}`];
    if (entity.parent) {
      parts.push(`parent:${entity.parent}`);
    }
    // For scenarios (sc_*), include behavioral hash
    if (id.startsWith("sc_")) {
      const bhash = computeBehavioralHash(entity.props || {});
      parts.push(`bh:${bhash}`);
    }
    lines.push(`  ${parts.join(" ")}`);
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

/**
 * Compute hash of behavioral props only (given, when, then, name).
 * Used to distinguish behavioral changes from metadata-only changes in scenarios.
 */
function computeBehavioralHash(props: Record<string, unknown>): string {
  const BEHAVIORAL_PROPS = ["given", "when", "then", "name"];
  const behavioralData: Record<string, unknown> = {};
  for (const key of BEHAVIORAL_PROPS) {
    if (key in props) {
      behavioralData[key] = props[key];
    }
  }
  const str = JSON.stringify(behavioralData);
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
 * Handle bantay aide diff
 * Usage: bantay aide diff [--json]
 * Compare bantay.aide against bantay.aide.lock and show changes
 */
export async function handleAideDiff(args: string[]): Promise<void> {
  const { options } = parseOptions(args);
  const aidePath = await getAidePath(options);
  const lockPath = `${aidePath}.lock`;
  const jsonOutput = args.includes("--json");

  // Check that lock file exists
  if (!existsSync(lockPath)) {
    console.error(`Error: Lock file not found: ${lockPath}`);
    console.error("Run 'bantay aide lock' to create a lock file first.");
    process.exit(1);
  }

  try {
    // Read and parse current aide file
    const tree = await read(aidePath);

    // Read and parse lock file
    const lockContent = await readFile(lockPath, "utf-8");
    const lock = parseLockFile(lockContent);

    // Compute current hashes
    const currentHashes: Record<string, string> = {};
    for (const [id, entity] of Object.entries(tree.entities)) {
      currentHashes[id] = computeEntityHash(id, entity);
    }

    // Compute current relationship keys
    const currentRelationships = new Set<string>();
    for (const rel of tree.relationships) {
      currentRelationships.add(`${rel.from}:${rel.to}:${rel.type}`);
    }

    // Parse lock relationships into set
    const lockRelationships = new Set<string>(lock.relationships);

    // Find differences
    const added: string[] = [];
    const removed: string[] = [];
    const modified: string[] = [];

    // Find added and modified entities
    for (const id of Object.keys(currentHashes)) {
      if (!(id in lock.entities)) {
        added.push(id);
      } else if (lock.entities[id] !== currentHashes[id]) {
        modified.push(id);
      }
    }

    // Find removed entities
    for (const id of Object.keys(lock.entities)) {
      if (!(id in currentHashes)) {
        removed.push(id);
      }
    }

    // Find relationship changes
    const addedRelationships: string[] = [];
    const removedRelationships: string[] = [];

    for (const rel of currentRelationships) {
      if (!lockRelationships.has(rel)) {
        addedRelationships.push(rel);
      }
    }

    for (const rel of lockRelationships) {
      if (!currentRelationships.has(rel)) {
        removedRelationships.push(rel);
      }
    }

    // Check if there are any changes
    const hasChanges =
      added.length > 0 ||
      removed.length > 0 ||
      modified.length > 0 ||
      addedRelationships.length > 0 ||
      removedRelationships.length > 0;

    if (jsonOutput) {
      // JSON output
      const result = {
        hasChanges,
        added: added.map((id) => ({ id, type: getEntityType(id) })),
        removed: removed.map((id) => ({ id, type: getEntityType(id) })),
        modified: modified.map((id) => ({ id, type: getEntityType(id) })),
        relationships: {
          added: addedRelationships.map((r) => {
            const [from, to, type] = r.split(":");
            return { from, to, type };
          }),
          removed: removedRelationships.map((r) => {
            const [from, to, type] = r.split(":");
            return { from, to, type };
          }),
        },
        summary: {
          entitiesAdded: added.length,
          entitiesRemoved: removed.length,
          entitiesModified: modified.length,
          relationshipsAdded: addedRelationships.length,
          relationshipsRemoved: removedRelationships.length,
        },
      };
      console.log(JSON.stringify(result, null, 2));
    } else {
      // Human-readable output
      if (!hasChanges) {
        console.log("No changes since last lock.");
        process.exit(0);
      }

      console.log("Changes since last lock:\n");

      if (added.length > 0) {
        console.log("ADDED");
        for (const id of added.sort()) {
          console.log(`  + ${id} (${getEntityType(id)})`);
        }
        console.log("");
      }

      if (modified.length > 0) {
        console.log("MODIFIED");
        for (const id of modified.sort()) {
          console.log(`  ~ ${id} (${getEntityType(id)})`);
        }
        console.log("");
      }

      if (removed.length > 0) {
        console.log("REMOVED");
        for (const id of removed.sort()) {
          console.log(`  - ${id} (${getEntityType(id)})`);
        }
        console.log("");
      }

      if (addedRelationships.length > 0 || removedRelationships.length > 0) {
        console.log("RELATIONSHIPS");
        for (const rel of addedRelationships) {
          const [from, to, type] = rel.split(":");
          console.log(`  + ${from} --[${type}]--> ${to}`);
        }
        for (const rel of removedRelationships) {
          const [from, to, type] = rel.split(":");
          console.log(`  - ${from} --[${type}]--> ${to}`);
        }
        console.log("");
      }

      // Summary
      console.log("Summary:");
      const parts: string[] = [];
      if (added.length > 0) parts.push(`${added.length} added`);
      if (modified.length > 0) parts.push(`${modified.length} modified`);
      if (removed.length > 0) parts.push(`${removed.length} removed`);
      if (addedRelationships.length > 0)
        parts.push(`${addedRelationships.length} relationship(s) added`);
      if (removedRelationships.length > 0)
        parts.push(`${removedRelationships.length} relationship(s) removed`);
      console.log(`  ${parts.join(", ")}`);
    }

    // Exit with code 1 if changes exist
    process.exit(hasChanges ? 1 : 0);
  } catch (error) {
    console.error(`Error comparing aide files: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

/**
 * Parse lock file content into structured format
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

    // Skip comments and empty lines
    if (trimmed.startsWith("#") || trimmed === "") {
      continue;
    }

    // Section headers
    if (trimmed === "entities:") {
      section = "entities";
      continue;
    }
    if (trimmed === "relationships:") {
      section = "relationships";
      continue;
    }

    // Parse content based on section
    if (section === "entities") {
      // Format: "entity_id: hash [parent:parent_id] [bh:behavioral_hash]"
      // We only need the entity ID and hash for aide diff
      const match = trimmed.match(/^(\w+):\s*(\w+)/);
      if (match) {
        result.entities[match[1]] = match[2];
      }
    } else if (section === "relationships") {
      // Format: "  - from:to:type: hash"
      const match = trimmed.match(/^-\s*(\w+):(\w+):(\w+):\s*\w+$/);
      if (match) {
        result.relationships.push(`${match[1]}:${match[2]}:${match[3]}`);
      }
    }
  }

  return result;
}

/**
 * Print help for aide subcommands
 */
export function printAideHelp(): void {
  console.log(`
bantay aide - Manage the aide entity tree

Usage: bantay aide <subcommand> [options]

Subcommands:
  init      Create a new .aide file with skeleton structure
  add       Add an entity to the tree
  update    Update an entity's properties
  remove    Remove an entity from the tree
  link      Add a relationship between entities
  show      Display the entity tree or a specific entity
  validate  Validate the aide file
  lock      Generate a lock file
  diff      Compare aide against lock file

Init Options:
  --name, -n    Name for the aide file (default: current directory name)

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

Diff Options:
  --json            Output as JSON

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
  bantay aide diff
  bantay aide diff --json
`);
}
