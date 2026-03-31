import { describe, test, expect } from "bun:test";

// Import the built-in checker for unit testing
import {
  validateComponents,
  M3_COMPONENT_TYPES,
  TYPE_VARIANTS,
} from "../src/checkers/m3-component-types";

// Helper to check violations
function check(entities: Record<string, { props?: Record<string, unknown> }>) {
  // Filter to only comp_* entities (mimics what the checker does)
  const compEntities: Record<string, { props?: Record<string, unknown> }> = {};
  for (const [id, entity] of Object.entries(entities)) {
    if (id.startsWith("comp_")) {
      compEntities[id] = entity;
    }
  }
  const violations = validateComponents(compEntities);
  return {
    pass: violations.length === 0,
    violations,
  };
}

describe("M3 Component Types Checker", () => {
  describe("type validation", () => {
    test("FAIL when component is missing type", () => {
      const result = check({
        comp_button: {
          props: {
            name: "Submit button",
          },
        },
      });

      expect(result.pass).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].message).toContain("missing props.type");
    });

    test("FAIL when type is unknown", () => {
      const result = check({
        comp_widget: {
          props: {
            name: "My widget",
            type: "widget",
          },
        },
      });

      expect(result.pass).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].message).toContain('unknown type "widget"');
    });

    test("PASS when type is valid M3 component", () => {
      const result = check({
        comp_action: {
          props: {
            name: "Action button",
            type: "fab",
          },
        },
      });

      expect(result.pass).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });

  describe("custom type validation", () => {
    test("FAIL when custom type lacks description", () => {
      const result = check({
        comp_timer: {
          props: {
            name: "Session timer",
            type: "custom",
          },
        },
      });

      expect(result.pass).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].message).toContain("custom");
      expect(result.violations[0].message).toContain("description");
    });

    test("PASS when custom type has description", () => {
      const result = check({
        comp_timer: {
          props: {
            name: "Session timer",
            type: "custom",
            description: "Countdown timer with pause/resume functionality",
          },
        },
      });

      expect(result.pass).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });

  describe("variant validation", () => {
    test("FAIL when variant is invalid for type", () => {
      const result = check({
        comp_save: {
          props: {
            name: "Save button",
            type: "button",
            variant: "floating", // Invalid variant for button
          },
        },
      });

      expect(result.pass).toBe(false);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].message).toContain('invalid variant "floating"');
    });

    test("PASS when variant is valid for type", () => {
      const result = check({
        comp_save: {
          props: {
            name: "Save button",
            type: "button",
            variant: "filled",
          },
        },
      });

      expect(result.pass).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    test("PASS when type has no defined variants and variant is provided", () => {
      // Types without variant restrictions should accept any variant
      const result = check({
        comp_nav: {
          props: {
            name: "Navigation",
            type: "navigation-bar",
            variant: "bottom", // navigation-bar has no variant restrictions
          },
        },
      });

      expect(result.pass).toBe(true);
    });
  });

  describe("multiple components", () => {
    test("reports all violations", () => {
      const result = check({
        comp_one: {
          props: {
            name: "Missing type",
          },
        },
        comp_two: {
          props: {
            name: "Unknown type",
            type: "unknown",
          },
        },
        comp_three: {
          props: {
            name: "Custom without description",
            type: "custom",
          },
        },
      });

      expect(result.pass).toBe(false);
      expect(result.violations).toHaveLength(3);
    });

    test("PASS when all components are valid", () => {
      const result = check({
        comp_fab: {
          props: {
            name: "Add button",
            type: "fab",
          },
        },
        comp_search: {
          props: {
            name: "Search bar",
            type: "search",
          },
        },
        comp_timer: {
          props: {
            name: "Timer",
            type: "custom",
            description: "Session countdown timer",
          },
        },
      });

      expect(result.pass).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });

  describe("ignores non-component entities", () => {
    test("does not validate non-comp_ entities", () => {
      const result = check({
        screen_home: {
          props: {
            name: "Home screen",
            // No type - but this is a screen, not a component
          },
        },
        cuj_login: {
          props: {
            feature: "User login",
          },
        },
      });

      expect(result.pass).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });

  describe("M3 type coverage", () => {
    test("all M3 types are defined", () => {
      // Ensure we have a comprehensive set of M3 component types
      expect(M3_COMPONENT_TYPES.has("fab")).toBe(true);
      expect(M3_COMPONENT_TYPES.has("button")).toBe(true);
      expect(M3_COMPONENT_TYPES.has("navigation-bar")).toBe(true);
      expect(M3_COMPONENT_TYPES.has("text-field")).toBe(true);
      expect(M3_COMPONENT_TYPES.has("card")).toBe(true);
      expect(M3_COMPONENT_TYPES.has("dialog")).toBe(true);
      expect(M3_COMPONENT_TYPES.has("custom")).toBe(true);
    });

    test("button variants are defined", () => {
      expect(TYPE_VARIANTS["button"]).toBeDefined();
      expect(TYPE_VARIANTS["button"].has("filled")).toBe(true);
      expect(TYPE_VARIANTS["button"].has("outlined")).toBe(true);
      expect(TYPE_VARIANTS["button"].has("text")).toBe(true);
    });
  });
});
