/**
 * Valid relationship types in an aide file
 */
export const VALID_RELATIONSHIP_TYPES = [
  "protected_by",
  "depends_on",
  "implements",
  "delegates_to",
  "weakens",
] as const;

export type RelationshipType = (typeof VALID_RELATIONSHIP_TYPES)[number];

/**
 * Valid cardinality values
 */
export const VALID_CARDINALITIES = [
  "one_to_one",
  "one_to_many",
  "many_to_one",
  "many_to_many",
] as const;

export type Cardinality = (typeof VALID_CARDINALITIES)[number];

/**
 * A relationship between two entities in the aide tree
 */
export interface Relationship {
  from: string;
  to: string;
  type: RelationshipType;
  cardinality: Cardinality;
}

/**
 * An entity in the aide tree
 */
export interface Entity {
  display?: string;
  parent?: string;
  props?: Record<string, unknown>;
}

/**
 * The complete aide tree structure
 */
export interface AideTree {
  entities: Record<string, Entity>;
  relationships: Relationship[];
}

/**
 * Options for adding an entity
 */
export interface AddEntityOptions {
  id?: string;
  parent?: string;
  display?: string;
  props?: Record<string, unknown>;
}

/**
 * Options for removing an entity
 */
export interface RemoveEntityOptions {
  force?: boolean;
}

/**
 * Options for adding a relationship
 */
export interface AddRelationshipOptions {
  from: string;
  to: string;
  type: RelationshipType;
  cardinality: Cardinality;
}

/**
 * Prefix conventions for auto-generating entity IDs based on parent
 */
export const ID_PREFIX_CONVENTIONS: Record<string, string> = {
  cujs: "cuj_",
  invariants: "inv_",
  constraints: "con_",
  foundations: "found_",
  wisdom: "wis_",
};

/**
 * Prefix for entities under a CUJ (scenarios)
 */
export const SCENARIO_PREFIX = "sc_";
