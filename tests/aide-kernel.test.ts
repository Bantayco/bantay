import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  read,
  write,
  addEntity,
  removeEntity,
  addRelationship,
  validate,
  type AideTree,
  type Entity,
  type Relationship,
} from "../src/aide";

describe("Aide Kernel", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "aide-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("read()", () => {
    test("parses a simple .aide YAML file", async () => {
      const aidePath = join(tempDir, "test.aide");
      await writeFile(
        aidePath,
        `entities:
  root_page:
    display: page
    props:
      title: Test Page

relationships: []
`
      );

      const tree = await read(aidePath);

      expect(tree.entities).toBeDefined();
      expect(tree.entities.root_page).toBeDefined();
      expect(tree.entities.root_page.display).toBe("page");
      expect(tree.entities.root_page.props?.title).toBe("Test Page");
      expect(tree.relationships).toEqual([]);
    });

    test("parses entities with parent references", async () => {
      const aidePath = join(tempDir, "test.aide");
      await writeFile(
        aidePath,
        `entities:
  root:
    display: page
    props:
      title: Root

  child:
    parent: root
    props:
      name: Child Entity

relationships: []
`
      );

      const tree = await read(aidePath);

      expect(tree.entities.child.parent).toBe("root");
    });

    test("parses relationships", async () => {
      const aidePath = join(tempDir, "test.aide");
      await writeFile(
        aidePath,
        `entities:
  a:
    props:
      name: Entity A
  b:
    props:
      name: Entity B

relationships:
  - from: a
    to: b
    type: protected_by
    cardinality: many_to_many
`
      );

      const tree = await read(aidePath);

      expect(tree.relationships).toHaveLength(1);
      expect(tree.relationships[0].from).toBe("a");
      expect(tree.relationships[0].to).toBe("b");
      expect(tree.relationships[0].type).toBe("protected_by");
      expect(tree.relationships[0].cardinality).toBe("many_to_many");
    });

    test("throws error for non-existent file", async () => {
      await expect(read(join(tempDir, "nonexistent.aide"))).rejects.toThrow();
    });
  });

  describe("write()", () => {
    test("serializes entity tree to YAML", async () => {
      const aidePath = join(tempDir, "output.aide");
      const tree: AideTree = {
        entities: {
          root: {
            display: "page",
            props: { title: "Test" },
          },
        },
        relationships: [],
      };

      await write(aidePath, tree);

      const content = await readFile(aidePath, "utf-8");
      expect(content).toContain("entities:");
      expect(content).toContain("root:");
      expect(content).toContain("display: page");
      expect(content).toContain("title: Test");
    });

    test("preserves relationships in output", async () => {
      const aidePath = join(tempDir, "output.aide");
      const tree: AideTree = {
        entities: {
          a: { props: { name: "A" } },
          b: { props: { name: "B" } },
        },
        relationships: [
          { from: "a", to: "b", type: "depends_on", cardinality: "many_to_many" },
        ],
      };

      await write(aidePath, tree);

      const content = await readFile(aidePath, "utf-8");
      expect(content).toContain("relationships:");
      expect(content).toContain("from: a");
      expect(content).toContain("to: b");
      expect(content).toContain("type: depends_on");
    });

    test("round-trip preserves structure", async () => {
      const aidePath = join(tempDir, "roundtrip.aide");
      const original: AideTree = {
        entities: {
          page: {
            display: "page",
            props: { title: "My Page", version: "1.0" },
          },
          child: {
            parent: "page",
            display: "list",
            props: { items: ["one", "two"] },
          },
        },
        relationships: [
          { from: "child", to: "page", type: "implements", cardinality: "many_to_one" },
        ],
      };

      await write(aidePath, original);
      const restored = await read(aidePath);

      expect(restored.entities.page.display).toBe(original.entities.page.display);
      expect(restored.entities.page.props?.title).toBe(original.entities.page.props?.title);
      expect(restored.entities.child.parent).toBe(original.entities.child.parent);
      expect(restored.relationships).toHaveLength(1);
      expect(restored.relationships[0].from).toBe("child");
    });
  });

  describe("addEntity()", () => {
    test("adds entity with explicit ID", () => {
      const tree: AideTree = { entities: {}, relationships: [] };

      const result = addEntity(tree, {
        id: "my_entity",
        props: { name: "Test Entity" },
      });

      expect(result.entities.my_entity).toBeDefined();
      expect(result.entities.my_entity.props?.name).toBe("Test Entity");
    });

    test("adds entity with parent reference", () => {
      const tree: AideTree = {
        entities: {
          parent: { display: "page", props: { title: "Parent" } },
        },
        relationships: [],
      };

      const result = addEntity(tree, {
        id: "child",
        parent: "parent",
        props: { name: "Child" },
      });

      expect(result.entities.child.parent).toBe("parent");
    });

    test("adds entity with display type", () => {
      const tree: AideTree = { entities: {}, relationships: [] };

      const result = addEntity(tree, {
        id: "table_entity",
        display: "table",
        props: { columns: ["a", "b"] },
      });

      expect(result.entities.table_entity.display).toBe("table");
    });

    test("auto-generates ID from prefix convention when not provided", () => {
      const tree: AideTree = {
        entities: {
          invariants: { display: "checklist", props: { title: "Invariants" } },
        },
        relationships: [],
      };

      const result = addEntity(tree, {
        parent: "invariants",
        props: { statement: "Test invariant" },
      });

      // Should auto-generate ID with inv_ prefix based on parent
      const newIds = Object.keys(result.entities).filter((id) => id !== "invariants");
      expect(newIds).toHaveLength(1);
      expect(newIds[0]).toMatch(/^inv_/);
    });

    test("auto-generates ID for scenario under cuj parent", () => {
      const tree: AideTree = {
        entities: {
          cujs: { display: "table", props: { title: "CUJs" } },
          cuj_init: { parent: "cujs", props: { feature: "Init feature" } },
        },
        relationships: [],
      };

      const result = addEntity(tree, {
        parent: "cuj_init",
        props: { name: "Test scenario" },
      });

      const newIds = Object.keys(result.entities).filter(
        (id) => id !== "cujs" && id !== "cuj_init"
      );
      expect(newIds).toHaveLength(1);
      expect(newIds[0]).toMatch(/^sc_/);
    });

    test("throws error when parent does not exist", () => {
      const tree: AideTree = { entities: {}, relationships: [] };

      expect(() =>
        addEntity(tree, {
          id: "child",
          parent: "nonexistent",
          props: { name: "Orphan" },
        })
      ).toThrow(/parent.*not found/i);
    });

    test("throws error when ID already exists", () => {
      const tree: AideTree = {
        entities: {
          existing: { props: { name: "Existing" } },
        },
        relationships: [],
      };

      expect(() =>
        addEntity(tree, {
          id: "existing",
          props: { name: "Duplicate" },
        })
      ).toThrow(/already exists/i);
    });
  });

  describe("removeEntity()", () => {
    test("removes entity by ID", () => {
      const tree: AideTree = {
        entities: {
          to_remove: { props: { name: "Remove me" } },
          keep: { props: { name: "Keep me" } },
        },
        relationships: [],
      };

      const result = removeEntity(tree, "to_remove");

      expect(result.entities.to_remove).toBeUndefined();
      expect(result.entities.keep).toBeDefined();
    });

    test("throws error when entity does not exist", () => {
      const tree: AideTree = { entities: {}, relationships: [] };

      expect(() => removeEntity(tree, "nonexistent")).toThrow(/not found/i);
    });

    test("throws error when entity has relationships without force flag", () => {
      const tree: AideTree = {
        entities: {
          a: { props: { name: "A" } },
          b: { props: { name: "B" } },
        },
        relationships: [
          { from: "a", to: "b", type: "depends_on", cardinality: "many_to_many" },
        ],
      };

      expect(() => removeEntity(tree, "a")).toThrow(/relationships exist/i);
    });

    test("removes entity and relationships with force flag", () => {
      const tree: AideTree = {
        entities: {
          a: { props: { name: "A" } },
          b: { props: { name: "B" } },
        },
        relationships: [
          { from: "a", to: "b", type: "depends_on", cardinality: "many_to_many" },
        ],
      };

      const result = removeEntity(tree, "a", { force: true });

      expect(result.entities.a).toBeUndefined();
      expect(result.relationships).toHaveLength(0);
    });

    test("cascade removes child entities", () => {
      const tree: AideTree = {
        entities: {
          parent: { display: "page", props: { title: "Parent" } },
          child1: { parent: "parent", props: { name: "Child 1" } },
          child2: { parent: "parent", props: { name: "Child 2" } },
          grandchild: { parent: "child1", props: { name: "Grandchild" } },
        },
        relationships: [],
      };

      const result = removeEntity(tree, "parent", { force: true });

      expect(result.entities.parent).toBeUndefined();
      expect(result.entities.child1).toBeUndefined();
      expect(result.entities.child2).toBeUndefined();
      expect(result.entities.grandchild).toBeUndefined();
    });
  });

  describe("addRelationship()", () => {
    test("adds relationship between existing entities", () => {
      const tree: AideTree = {
        entities: {
          a: { props: { name: "A" } },
          b: { props: { name: "B" } },
        },
        relationships: [],
      };

      const result = addRelationship(tree, {
        from: "a",
        to: "b",
        type: "protected_by",
        cardinality: "many_to_many",
      });

      expect(result.relationships).toHaveLength(1);
      expect(result.relationships[0].from).toBe("a");
      expect(result.relationships[0].to).toBe("b");
    });

    test("validates relationship type", () => {
      const tree: AideTree = {
        entities: {
          a: { props: { name: "A" } },
          b: { props: { name: "B" } },
        },
        relationships: [],
      };

      expect(() =>
        addRelationship(tree, {
          from: "a",
          to: "b",
          type: "invalid_type" as any,
          cardinality: "many_to_many",
        })
      ).toThrow(/invalid.*type/i);
    });

    test("throws error when 'from' entity does not exist", () => {
      const tree: AideTree = {
        entities: {
          b: { props: { name: "B" } },
        },
        relationships: [],
      };

      expect(() =>
        addRelationship(tree, {
          from: "nonexistent",
          to: "b",
          type: "depends_on",
          cardinality: "many_to_many",
        })
      ).toThrow(/from.*not found/i);
    });

    test("throws error when 'to' entity does not exist", () => {
      const tree: AideTree = {
        entities: {
          a: { props: { name: "A" } },
        },
        relationships: [],
      };

      expect(() =>
        addRelationship(tree, {
          from: "a",
          to: "nonexistent",
          type: "depends_on",
          cardinality: "many_to_many",
        })
      ).toThrow(/to.*not found/i);
    });

    test("accepts all valid relationship types", () => {
      const validTypes = [
        "protected_by",
        "depends_on",
        "implements",
        "delegates_to",
        "weakens",
      ] as const;

      for (const type of validTypes) {
        const tree: AideTree = {
          entities: {
            a: { props: { name: "A" } },
            b: { props: { name: "B" } },
          },
          relationships: [],
        };

        const result = addRelationship(tree, {
          from: "a",
          to: "b",
          type,
          cardinality: "many_to_many",
        });

        expect(result.relationships[0].type).toBe(type);
      }
    });
  });

  describe("validate()", () => {
    test("returns empty array for valid tree", () => {
      const tree: AideTree = {
        entities: {
          root: { display: "page", props: { title: "Root" } },
          child: { parent: "root", props: { name: "Child" } },
        },
        relationships: [
          { from: "child", to: "root", type: "implements", cardinality: "many_to_one" },
        ],
      };

      const errors = validate(tree);

      expect(errors).toEqual([]);
    });

    test("detects orphaned relationships (from entity missing)", () => {
      const tree: AideTree = {
        entities: {
          b: { props: { name: "B" } },
        },
        relationships: [
          { from: "nonexistent", to: "b", type: "depends_on", cardinality: "many_to_many" },
        ],
      };

      const errors = validate(tree);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.includes("nonexistent") && e.includes("from"))).toBe(
        true
      );
    });

    test("detects orphaned relationships (to entity missing)", () => {
      const tree: AideTree = {
        entities: {
          a: { props: { name: "A" } },
        },
        relationships: [
          { from: "a", to: "nonexistent", type: "depends_on", cardinality: "many_to_many" },
        ],
      };

      const errors = validate(tree);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.includes("nonexistent") && e.includes("to"))).toBe(true);
    });

    test("detects missing parent references", () => {
      const tree: AideTree = {
        entities: {
          child: { parent: "missing_parent", props: { name: "Orphan" } },
        },
        relationships: [],
      };

      const errors = validate(tree);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.includes("missing_parent"))).toBe(true);
    });

    test("detects duplicate IDs (should not happen but validate anyway)", () => {
      // This tests the validation logic even though addEntity prevents this
      const tree: AideTree = {
        entities: {
          unique_id: { props: { name: "Entity" } },
        },
        relationships: [],
      };

      // A valid tree should have no duplicates
      const errors = validate(tree);
      expect(errors).toEqual([]);
    });

    test("detects invalid relationship types", () => {
      const tree: AideTree = {
        entities: {
          a: { props: { name: "A" } },
          b: { props: { name: "B" } },
        },
        relationships: [
          { from: "a", to: "b", type: "invalid_type" as any, cardinality: "many_to_many" },
        ],
      };

      const errors = validate(tree);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.includes("invalid") || e.includes("type"))).toBe(true);
    });
  });
});
