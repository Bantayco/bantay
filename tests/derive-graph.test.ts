/**
 * @scenario sc_derive_states
 * @scenario sc_derive_transitions
 * @scenario sc_derive_preview
 * @scenario sc_derive_diff
 * @scenario sc_derive_idempotent
 */
import { describe, test, expect, beforeEach } from "bun:test";
import {
  deriveStates,
  deriveTransitions,
  diffGraph,
  formatDeriveGraphResult,
  type DerivedState,
  type DerivedTransition,
  type GraphDiff,
  type DeriveGraphResult,
} from "../src/commands/derive-graph";

describe("derive-graph", () => {
  // @scenario sc_derive_states
  describe("sc_derive_states: Derive screen states from actions", () => {
    test("extracts unique states from tr_* entities", () => {
      const entities = {
        tr_tap_write: {
          props: {
            from: "st_artifact_list",
            to: "st_flow_idle",
            action: "Tap Write nav",
            trigger: "comp_nav_bar",
          },
        },
        tr_first_keystroke: {
          props: {
            from: "st_flow_idle",
            to: "st_flow_running",
            action: "First keystroke",
            trigger: "comp_editor",
          },
        },
      };

      const states = deriveStates(entities);

      expect(states).toHaveLength(3);
      expect(states.map((s) => s.id).sort()).toEqual([
        "st_artifact_list",
        "st_flow_idle",
        "st_flow_running",
      ]);
    });

    test("extracts states with component variants", () => {
      const entities = {
        st_flow_idle: {
          props: {
            screen: "screen_flow_mode",
            comp_timer: "idle",
            comp_editor: "empty",
          },
        },
        st_flow_running: {
          props: {
            screen: "screen_flow_mode",
            comp_timer: "running",
            comp_editor: "writing",
          },
        },
      };

      const states = deriveStates(entities);

      expect(states).toHaveLength(2);
      expect(states[0].screen).toBe("screen_flow_mode");
      expect(states[0].componentVariants).toEqual({
        comp_timer: "idle",
        comp_editor: "empty",
      });
    });

    test("deduplicates states by screen + variant combo", () => {
      const entities = {
        tr_a: {
          props: { from: "st_flow_idle", to: "st_flow_running" },
        },
        tr_b: {
          props: { from: "st_flow_idle", to: "st_flow_paused" },
        },
        tr_c: {
          props: { from: "st_flow_running", to: "st_flow_idle" },
        },
      };

      const states = deriveStates(entities);

      // st_flow_idle appears twice but should only be counted once
      const idleCount = states.filter((s) => s.id === "st_flow_idle").length;
      expect(idleCount).toBe(1);
    });
  });

  // @scenario sc_derive_transitions
  describe("sc_derive_transitions: Derive transitions from actions", () => {
    test("extracts transitions from tr_* entities", () => {
      const entities = {
        tr_tap_write: {
          props: {
            from: "st_artifact_list",
            to: "st_flow_idle",
            action: "Tap Write nav",
            trigger: "comp_nav_bar",
          },
        },
      };

      const transitions = deriveTransitions(entities);

      expect(transitions).toHaveLength(1);
      expect(transitions[0]).toEqual({
        id: "tr_tap_write",
        from: "st_artifact_list",
        to: "st_flow_idle",
        action: "Tap Write nav",
        trigger: "comp_nav_bar",
      });
    });

    test("handles transitions without trigger", () => {
      const entities = {
        tr_timer_expires: {
          props: {
            from: "st_flow_running",
            to: "st_flow_expired",
            action: "Timer reaches zero",
          },
        },
      };

      const transitions = deriveTransitions(entities);

      expect(transitions).toHaveLength(1);
      expect(transitions[0].trigger).toBeUndefined();
    });

    test("ignores non-transition entities", () => {
      const entities = {
        tr_tap_write: {
          props: { from: "st_a", to: "st_b", action: "Tap" },
        },
        st_flow_idle: {
          props: { screen: "screen_flow" },
        },
        comp_timer: {
          props: { name: "Timer" },
        },
      };

      const transitions = deriveTransitions(entities);

      expect(transitions).toHaveLength(1);
      expect(transitions[0].id).toBe("tr_tap_write");
    });
  });

  // @scenario sc_derive_preview
  describe("sc_derive_preview: Preview derived graph before writing", () => {
    test("shows summary with state and transition counts", () => {
      const result: DeriveGraphResult = {
        states: [
          { id: "st_a", screen: "screen_a", componentVariants: {} },
          { id: "st_b", screen: "screen_b", componentVariants: {} },
        ],
        transitions: [
          { id: "tr_x", from: "st_a", to: "st_b", action: "Go" },
        ],
        diff: {
          newStates: [],
          orphanedStates: [],
          newTransitions: [],
          orphanedTransitions: [],
          matchingStates: ["st_a", "st_b"],
          matchingTransitions: ["tr_x"],
          hasChanges: false,
        },
      };

      const output = formatDeriveGraphResult(result);

      expect(output).toContain("2 states");
      expect(output).toContain("1 transitions");
    });

    test("shows full list of new states and transitions", () => {
      const result: DeriveGraphResult = {
        states: [
          { id: "st_new", screen: "screen_new", componentVariants: {} },
        ],
        transitions: [
          { id: "tr_new", from: "st_a", to: "st_new", action: "Navigate" },
        ],
        diff: {
          newStates: [{ id: "st_new", screen: "screen_new", componentVariants: {} }],
          orphanedStates: [],
          newTransitions: [{ id: "tr_new", from: "st_a", to: "st_new", action: "Navigate" }],
          orphanedTransitions: [],
          matchingStates: [],
          matchingTransitions: [],
          hasChanges: true,
        },
      };

      const output = formatDeriveGraphResult(result);

      expect(output).toContain("st_new");
      expect(output).toContain("tr_new");
      expect(output).toContain("New States");
      expect(output).toContain("New Transitions");
    });

    test("indicates when graph is up to date", () => {
      const result: DeriveGraphResult = {
        states: [],
        transitions: [],
        diff: {
          newStates: [],
          orphanedStates: [],
          newTransitions: [],
          orphanedTransitions: [],
          matchingStates: [],
          matchingTransitions: [],
          hasChanges: false,
        },
      };

      const output = formatDeriveGraphResult(result);

      expect(output).toContain("up to date");
    });
  });

  // @scenario sc_derive_diff
  describe("sc_derive_diff: Show diff against existing graph", () => {
    test("identifies new states not in aide", () => {
      const derived: DerivedState[] = [
        { id: "st_a", screen: "screen_a", componentVariants: {} },
        { id: "st_b", screen: "screen_b", componentVariants: {} },
        { id: "st_c", screen: "screen_c", componentVariants: {} },
      ];

      const existing = {
        st_a: { props: { screen: "screen_a" } },
        st_b: { props: { screen: "screen_b" } },
      };

      const diff = diffGraph(derived, [], existing, {});

      expect(diff.newStates).toHaveLength(1);
      expect(diff.newStates[0].id).toBe("st_c");
    });

    test("identifies orphaned states in aide but not derived", () => {
      const derived: DerivedState[] = [
        { id: "st_a", screen: "screen_a", componentVariants: {} },
      ];

      const existing = {
        st_a: { props: { screen: "screen_a" } },
        st_orphan: { props: { screen: "screen_orphan" } },
      };

      const diff = diffGraph(derived, [], existing, {});

      expect(diff.orphanedStates).toHaveLength(1);
      expect(diff.orphanedStates[0]).toBe("st_orphan");
    });

    test("identifies new transitions", () => {
      const derivedTransitions: DerivedTransition[] = [
        { id: "tr_new", from: "st_a", to: "st_b", action: "New action" },
      ];

      const existingTransitions = {};

      const diff = diffGraph([], derivedTransitions, {}, existingTransitions);

      expect(diff.newTransitions).toHaveLength(1);
      expect(diff.newTransitions[0].id).toBe("tr_new");
    });

    test("identifies matching states/transitions", () => {
      const derived: DerivedState[] = [
        { id: "st_a", screen: "screen_a", componentVariants: {} },
      ];
      const derivedTransitions: DerivedTransition[] = [
        { id: "tr_x", from: "st_a", to: "st_b", action: "Action" },
      ];

      const existing = {
        st_a: { props: { screen: "screen_a" } },
      };
      const existingTransitions = {
        tr_x: { props: { from: "st_a", to: "st_b", action: "Action" } },
      };

      const diff = diffGraph(derived, derivedTransitions, existing, existingTransitions);

      expect(diff.matchingStates).toContain("st_a");
      expect(diff.matchingTransitions).toContain("tr_x");
    });
  });

  // @scenario sc_derive_idempotent
  describe("sc_derive_idempotent: Derivation is idempotent", () => {
    test("no changes when derived matches existing", () => {
      const derived: DerivedState[] = [
        { id: "st_a", screen: "screen_a", componentVariants: {} },
        { id: "st_b", screen: "screen_b", componentVariants: {} },
      ];
      const derivedTransitions: DerivedTransition[] = [
        { id: "tr_x", from: "st_a", to: "st_b", action: "Action" },
      ];

      const existing = {
        st_a: { props: { screen: "screen_a" } },
        st_b: { props: { screen: "screen_b" } },
      };
      const existingTransitions = {
        tr_x: { props: { from: "st_a", to: "st_b", action: "Action" } },
      };

      const diff = diffGraph(derived, derivedTransitions, existing, existingTransitions);

      expect(diff.newStates).toHaveLength(0);
      expect(diff.newTransitions).toHaveLength(0);
      expect(diff.orphanedStates).toHaveLength(0);
      expect(diff.orphanedTransitions).toHaveLength(0);
      expect(diff.hasChanges).toBe(false);
    });
  });
});
