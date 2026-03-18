import { readFile, writeFile } from "fs/promises";
import * as yaml from "js-yaml";
import {
  type AideTree,
  type Entity,
  type Relationship,
  type AddEntityOptions,
  type RemoveEntityOptions,
  type AddRelationshipOptions,
  type RelationshipType,
  VALID_RELATIONSHIP_TYPES,
  ID_PREFIX_CONVENTIONS,
  SCENARIO_PREFIX,
} from "./types";

// Re-export types
export type { AideTree, Entity, Relationship } from "./types";

/**
 * Read and parse a .aide YAML file
 */
export async function read(path: string): Promise<AideTree> {
  const content = await readFile(path, "utf-8");
  const parsed = yaml.load(content) as {
    entities?: Record<string, unknown>;
    relationships?: unknown[];
  };

  const entities: Record<string, Entity> = {};
  const relationships: Relationship[] = [];

  // Parse entities
  if (parsed.entities) {
    for (const [id, value] of Object.entries(parsed.entities)) {
      const entity = value as Record<string, unknown>;
      entities[id] = {
        display: entity.display as string | undefined,
        parent: entity.parent as string | undefined,
        props: entity.props as Record<string, unknown> | undefined,
      };
    }
  }

  // Parse relationships
  if (parsed.relationships && Array.isArray(parsed.relationships)) {
    for (const rel of parsed.relationships) {
      const r = rel as Record<string, unknown>;
      relationships.push({
        from: r.from as string,
        to: r.to as string,
        type: r.type as RelationshipType,
        cardinality: r.cardinality as string,
      } as Relationship);
    }
  }

  return { entities, relationships };
}

/**
 * Write an aide tree to a .aide YAML file
 */
export async function write(path: string, tree: AideTree): Promise<void> {
  const content = yaml.dump(
    {
      entities: tree.entities,
      relationships: tree.relationships,
    },
    {
      indent: 2,
      lineWidth: -1, // Don't wrap lines
      noRefs: true,
      sortKeys: false,
      quotingType: '"',
      forceQuotes: false,
    }
  );
  await writeFile(path, content, "utf-8");
}

/**
 * Add an entity to the tree
 */
export function addEntity(tree: AideTree, options: AddEntityOptions): AideTree {
  const { parent, display, props } = options;
  let { id } = options;

  // Validate parent exists if specified
  if (parent && !tree.entities[parent]) {
    throw new Error(`Parent entity "${parent}" not found`);
  }

  // Auto-generate ID if not provided
  if (!id) {
    id = generateEntityId(tree, parent);
  }

  // Check for duplicate ID
  if (tree.entities[id]) {
    throw new Error(`Entity "${id}" already exists`);
  }

  // Create new entity
  const entity: Entity = {};
  if (display) entity.display = display;
  if (parent) entity.parent = parent;
  if (props) entity.props = props;

  // Return new tree with entity added
  return {
    entities: {
      ...tree.entities,
      [id]: entity,
    },
    relationships: [...tree.relationships],
  };
}

/**
 * Remove an entity from the tree
 */
export function removeEntity(
  tree: AideTree,
  id: string,
  options: RemoveEntityOptions = {}
): AideTree {
  const { force = false } = options;

  // Check entity exists
  if (!tree.entities[id]) {
    throw new Error(`Entity "${id}" not found`);
  }

  // Find relationships involving this entity
  const involvedRelationships = tree.relationships.filter(
    (r) => r.from === id || r.to === id
  );

  if (involvedRelationships.length > 0 && !force) {
    throw new Error(
      `Cannot remove "${id}": relationships exist. Use force=true to remove anyway.`
    );
  }

  // Find all child entities (cascade)
  const idsToRemove = new Set<string>([id]);
  findChildEntities(tree, id, idsToRemove);

  // Remove entities
  const newEntities: Record<string, Entity> = {};
  for (const [entityId, entity] of Object.entries(tree.entities)) {
    if (!idsToRemove.has(entityId)) {
      newEntities[entityId] = entity;
    }
  }

  // Remove relationships involving removed entities
  const newRelationships = tree.relationships.filter(
    (r) => !idsToRemove.has(r.from) && !idsToRemove.has(r.to)
  );

  return {
    entities: newEntities,
    relationships: newRelationships,
  };
}

/**
 * Add a relationship to the tree
 */
export function addRelationship(
  tree: AideTree,
  options: AddRelationshipOptions
): AideTree {
  const { from, to, type, cardinality } = options;

  // Validate 'from' entity exists
  if (!tree.entities[from]) {
    throw new Error(`"from" entity "${from}" not found`);
  }

  // Validate 'to' entity exists
  if (!tree.entities[to]) {
    throw new Error(`"to" entity "${to}" not found`);
  }

  // Validate relationship type
  if (!VALID_RELATIONSHIP_TYPES.includes(type)) {
    throw new Error(
      `Invalid relationship type "${type}". Valid types: ${VALID_RELATIONSHIP_TYPES.join(", ")}`
    );
  }

  const relationship: Relationship = { from, to, type, cardinality };

  return {
    entities: { ...tree.entities },
    relationships: [...tree.relationships, relationship],
  };
}

/**
 * Validate the aide tree and return an array of error messages
 */
export function validate(tree: AideTree): string[] {
  const errors: string[] = [];

  // Check for orphaned relationships (from entity missing)
  for (const rel of tree.relationships) {
    if (!tree.entities[rel.from]) {
      errors.push(
        `Orphaned relationship: "from" entity "${rel.from}" not found`
      );
    }
    if (!tree.entities[rel.to]) {
      errors.push(`Orphaned relationship: "to" entity "${rel.to}" not found`);
    }

    // Validate relationship type
    if (!VALID_RELATIONSHIP_TYPES.includes(rel.type)) {
      errors.push(
        `Invalid relationship type "${rel.type}" in relationship from "${rel.from}" to "${rel.to}"`
      );
    }
  }

  // Check for missing parent references
  for (const [id, entity] of Object.entries(tree.entities)) {
    if (entity.parent && !tree.entities[entity.parent]) {
      errors.push(`Entity "${id}" has missing parent "${entity.parent}"`);
    }
  }

  return errors;
}

// --- Helper Functions ---

/**
 * Find all child entities recursively
 */
function findChildEntities(
  tree: AideTree,
  parentId: string,
  collected: Set<string>
): void {
  for (const [id, entity] of Object.entries(tree.entities)) {
    if (entity.parent === parentId && !collected.has(id)) {
      collected.add(id);
      findChildEntities(tree, id, collected);
    }
  }
}

/**
 * Generate an entity ID based on parent conventions
 */
function generateEntityId(tree: AideTree, parent?: string): string {
  if (!parent) {
    // Generate a generic ID
    let counter = 1;
    while (tree.entities[`entity_${counter}`]) {
      counter++;
    }
    return `entity_${counter}`;
  }

  // Check if parent has a known prefix convention
  let prefix = ID_PREFIX_CONVENTIONS[parent];

  // If parent is a CUJ (starts with cuj_), generate scenario prefix
  if (!prefix && parent.startsWith("cuj_")) {
    prefix = SCENARIO_PREFIX;
  }

  // If parent itself has a prefix, use the same prefix
  if (!prefix) {
    for (const [container, containerPrefix] of Object.entries(
      ID_PREFIX_CONVENTIONS
    )) {
      if (tree.entities[parent]?.parent === container) {
        prefix = containerPrefix;
        break;
      }
    }
  }

  // Default to a generic prefix based on parent
  if (!prefix) {
    prefix = `${parent}_`;
  }

  // Find next available number for this prefix
  let counter = 1;
  while (tree.entities[`${prefix}${counter}`]) {
    counter++;
  }

  return `${prefix}${counter}`;
}

