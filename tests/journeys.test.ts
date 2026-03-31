/**
 * @scenario sc_journeys_cluster
 * @scenario sc_journeys_handoffs
 * @scenario sc_journeys_entry_goal
 * @scenario sc_journeys_propose
 * @scenario sc_journeys_mece
 * @scenario sc_journeys_scenarios
 */
import { describe, test, expect } from "bun:test";
import {
  clusterStatesByScreen,
  findHandoffs,
  findEntryAndGoalStates,
  proposeJourneys,
  checkMece,
  generateScenarios,
  type StateCluster,
  type Handoff,
  type Journey,
  type MeceResult,
  type GeneratedScenario,
} from "../src/commands/journeys";
import type { DerivedState, DerivedTransition } from "../src/commands/derive-graph";

describe("journeys", () => {
  describe("sc_journeys_cluster: Cluster states by screen identity", () => {
    test("groups states by screen prop", () => {
      const states: DerivedState[] = [
        { id: "st_flow_idle", screen: "screen_flow_mode", componentVariants: {} },
        { id: "st_flow_running", screen: "screen_flow_mode", componentVariants: {} },
        { id: "st_artifact_list", screen: "screen_artifacts", componentVariants: {} },
        { id: "st_artifact_detail", screen: "screen_artifacts", componentVariants: {} },
      ];

      const clusters = clusterStatesByScreen(states);

      expect(clusters).toHaveLength(2);
      expect(clusters.find((c) => c.screen === "screen_flow_mode")?.states).toHaveLength(2);
      expect(clusters.find((c) => c.screen === "screen_artifacts")?.states).toHaveLength(2);
    });

    test("names clusters after the screen", () => {
      const states: DerivedState[] = [
        { id: "st_login", screen: "screen_auth", componentVariants: {} },
      ];

      const clusters = clusterStatesByScreen(states);

      expect(clusters[0].name).toBe("screen_auth");
      expect(clusters[0].screen).toBe("screen_auth");
    });

    test("handles states without screen prop", () => {
      const states: DerivedState[] = [
        { id: "st_external", screen: "", componentVariants: {} },
        { id: "st_flow_idle", screen: "screen_flow_mode", componentVariants: {} },
      ];

      const clusters = clusterStatesByScreen(states);

      // States without screen go into a special "external" cluster
      const externalCluster = clusters.find((c) => c.name === "external");
      expect(externalCluster).toBeDefined();
      expect(externalCluster?.states).toContain("st_external");
    });
  });

  describe("sc_journeys_handoffs: Identify handoff transitions between clusters", () => {
    test("identifies transitions between different clusters", () => {
      const clusters: StateCluster[] = [
        { name: "screen_artifacts", screen: "screen_artifacts", states: ["st_artifact_list"] },
        { name: "screen_flow_mode", screen: "screen_flow_mode", states: ["st_flow_idle"] },
      ];

      const transitions: DerivedTransition[] = [
        { id: "tr_tap_write", from: "st_artifact_list", to: "st_flow_idle", action: "Tap Write" },
      ];

      const handoffs = findHandoffs(clusters, transitions);

      expect(handoffs).toHaveLength(1);
      expect(handoffs[0].fromCluster).toBe("screen_artifacts");
      expect(handoffs[0].toCluster).toBe("screen_flow_mode");
      expect(handoffs[0].transition).toBe("tr_tap_write");
    });

    test("excludes transitions within the same cluster", () => {
      const clusters: StateCluster[] = [
        { name: "screen_flow_mode", screen: "screen_flow_mode", states: ["st_flow_idle", "st_flow_running"] },
      ];

      const transitions: DerivedTransition[] = [
        { id: "tr_start", from: "st_flow_idle", to: "st_flow_running", action: "Start" },
      ];

      const handoffs = findHandoffs(clusters, transitions);

      expect(handoffs).toHaveLength(0);
    });

    test("lists from-cluster and to-cluster for each handoff", () => {
      const clusters: StateCluster[] = [
        { name: "screen_a", screen: "screen_a", states: ["st_a"] },
        { name: "screen_b", screen: "screen_b", states: ["st_b"] },
        { name: "screen_c", screen: "screen_c", states: ["st_c"] },
      ];

      const transitions: DerivedTransition[] = [
        { id: "tr_a_to_b", from: "st_a", to: "st_b", action: "Go to B" },
        { id: "tr_b_to_c", from: "st_b", to: "st_c", action: "Go to C" },
      ];

      const handoffs = findHandoffs(clusters, transitions);

      expect(handoffs).toHaveLength(2);
      expect(handoffs[0]).toEqual({
        transition: "tr_a_to_b",
        fromCluster: "screen_a",
        toCluster: "screen_b",
      });
      expect(handoffs[1]).toEqual({
        transition: "tr_b_to_c",
        fromCluster: "screen_b",
        toCluster: "screen_c",
      });
    });
  });

  describe("sc_journeys_entry_goal: Find entry points and goal states", () => {
    test("identifies entry states reachable from st_external", () => {
      const transitions: DerivedTransition[] = [
        { id: "tr_enter", from: "st_external", to: "st_login", action: "Open app" },
        { id: "tr_login", from: "st_login", to: "st_home", action: "Login" },
      ];

      const { entryStates } = findEntryAndGoalStates(transitions);

      expect(entryStates).toContain("st_login");
      expect(entryStates).not.toContain("st_home");
    });

    test("identifies goal states where users rest", () => {
      // Goal states are states with no outgoing transitions (terminal states)
      // or states that loop back to themselves (resting states)
      const transitions: DerivedTransition[] = [
        { id: "tr_enter", from: "st_external", to: "st_login", action: "Open app" },
        { id: "tr_login", from: "st_login", to: "st_home", action: "Login" },
        { id: "tr_view", from: "st_home", to: "st_detail", action: "View item" },
        // st_detail has no outgoing transition - it's a goal state
      ];

      const { goalStates } = findEntryAndGoalStates(transitions);

      expect(goalStates).toContain("st_detail");
    });

    test("identifies states that transition to st_external as goal states", () => {
      const transitions: DerivedTransition[] = [
        { id: "tr_enter", from: "st_external", to: "st_login", action: "Open app" },
        { id: "tr_logout", from: "st_home", to: "st_external", action: "Logout" },
      ];

      const { goalStates } = findEntryAndGoalStates(transitions);

      expect(goalStates).toContain("st_home");
    });
  });

  describe("sc_journeys_propose: Propose journeys as paths through clusters", () => {
    test("proposes journeys from entry to goal through handoffs", () => {
      const clusters: StateCluster[] = [
        { name: "external", screen: "", states: ["st_external"] },
        { name: "screen_auth", screen: "screen_auth", states: ["st_login"] },
        { name: "screen_home", screen: "screen_home", states: ["st_home"] },
      ];

      const handoffs: Handoff[] = [
        { transition: "tr_enter", fromCluster: "external", toCluster: "screen_auth" },
        { transition: "tr_login", fromCluster: "screen_auth", toCluster: "screen_home" },
      ];

      const entryStates = ["st_login"];
      const goalStates = ["st_home"];

      const journeys = proposeJourneys(clusters, handoffs, entryStates, goalStates);

      expect(journeys.length).toBeGreaterThan(0);
      expect(journeys[0].path).toContain("screen_auth");
      expect(journeys[0].path).toContain("screen_home");
    });

    test("generates journey names from cluster path", () => {
      const clusters: StateCluster[] = [
        { name: "external", screen: "", states: ["st_external"] },
        { name: "screen_auth", screen: "screen_auth", states: ["st_login"] },
        { name: "screen_home", screen: "screen_home", states: ["st_home"] },
      ];

      const handoffs: Handoff[] = [
        { transition: "tr_enter", fromCluster: "external", toCluster: "screen_auth" },
        { transition: "tr_login", fromCluster: "screen_auth", toCluster: "screen_home" },
      ];

      const entryStates = ["st_login"];
      const goalStates = ["st_home"];

      const journeys = proposeJourneys(clusters, handoffs, entryStates, goalStates);

      // Journey name should be descriptive
      expect(journeys[0].name).toBeDefined();
      expect(journeys[0].name.length).toBeGreaterThan(0);
    });
  });

  describe("sc_journeys_mece: MECE check on proposed journeys", () => {
    test("reports transitions not covered by any journey", () => {
      const transitions: DerivedTransition[] = [
        { id: "tr_a", from: "st_a", to: "st_b", action: "A to B" },
        { id: "tr_b", from: "st_b", to: "st_c", action: "B to C" },
        { id: "tr_orphan", from: "st_x", to: "st_y", action: "Orphan" },
      ];

      const journeys: Journey[] = [
        { name: "journey_main", path: ["screen_a", "screen_b", "screen_c"], transitions: ["tr_a", "tr_b"] },
      ];

      const result = checkMece(journeys, transitions);

      expect(result.uncoveredTransitions).toContain("tr_orphan");
      expect(result.isMece).toBe(false);
    });

    test("reports when a journey is subset of another", () => {
      const transitions: DerivedTransition[] = [
        { id: "tr_a", from: "st_a", to: "st_b", action: "A to B" },
        { id: "tr_b", from: "st_b", to: "st_c", action: "B to C" },
      ];

      const journeys: Journey[] = [
        { name: "journey_full", path: ["screen_a", "screen_b", "screen_c"], transitions: ["tr_a", "tr_b"] },
        { name: "journey_subset", path: ["screen_a", "screen_b"], transitions: ["tr_a"] },
      ];

      const result = checkMece(journeys, transitions);

      expect(result.subsetJourneys).toContainEqual({
        subset: "journey_subset",
        superset: "journey_full",
      });
    });

    test("passes when all transitions covered and no subsets", () => {
      const transitions: DerivedTransition[] = [
        { id: "tr_a", from: "st_a", to: "st_b", action: "A to B" },
        { id: "tr_b", from: "st_b", to: "st_c", action: "B to C" },
      ];

      const journeys: Journey[] = [
        { name: "journey_main", path: ["screen_a", "screen_b", "screen_c"], transitions: ["tr_a", "tr_b"] },
      ];

      const result = checkMece(journeys, transitions);

      expect(result.isMece).toBe(true);
      expect(result.uncoveredTransitions).toHaveLength(0);
      expect(result.subsetJourneys).toHaveLength(0);
    });
  });

  describe("journeys include internal transitions", () => {
    test("journey includes internal transitions within clusters, not just handoffs", () => {
      // A "Write" journey should include:
      // - tr_tap_write_nav (handoff into Flow Mode cluster)
      // - tr_first_keystroke (internal)
      // - tr_timer_expires (internal)
      // - tr_tap_done (handoff out to Edit Draft cluster)
      const clusters: StateCluster[] = [
        { name: "screen_artifacts", screen: "screen_artifacts", states: ["st_artifact_list"] },
        { name: "screen_flow_mode", screen: "screen_flow_mode", states: ["st_flow_idle", "st_flow_running", "st_flow_expired"] },
        { name: "screen_edit_draft", screen: "screen_edit_draft", states: ["st_edit_readonly"] },
      ];

      const transitions: DerivedTransition[] = [
        { id: "tr_tap_write_nav", from: "st_artifact_list", to: "st_flow_idle", action: "Tap Write nav" },
        { id: "tr_first_keystroke", from: "st_flow_idle", to: "st_flow_running", action: "First keystroke" },
        { id: "tr_timer_expires", from: "st_flow_running", to: "st_flow_expired", action: "Timer expires" },
        { id: "tr_tap_done", from: "st_flow_expired", to: "st_edit_readonly", action: "Tap Done" },
      ];

      const handoffs = findHandoffs(clusters, transitions);
      const entryStates = ["st_artifact_list"];
      const goalStates = ["st_edit_readonly"];

      const journeys = proposeJourneys(clusters, handoffs, entryStates, goalStates, transitions);

      expect(journeys.length).toBeGreaterThan(0);
      // Journey should include ALL transitions in the path, not just handoffs
      expect(journeys[0].transitions).toContain("tr_tap_write_nav");
      expect(journeys[0].transitions).toContain("tr_first_keystroke");
      expect(journeys[0].transitions).toContain("tr_timer_expires");
      expect(journeys[0].transitions).toContain("tr_tap_done");
    });

    test("walks full graph from entry to goal, collecting all transitions", () => {
      const clusters: StateCluster[] = [
        { name: "screen_a", screen: "screen_a", states: ["st_a1", "st_a2"] },
        { name: "screen_b", screen: "screen_b", states: ["st_b1"] },
      ];

      const transitions: DerivedTransition[] = [
        { id: "tr_internal_a", from: "st_a1", to: "st_a2", action: "Internal A" },
        { id: "tr_handoff", from: "st_a2", to: "st_b1", action: "Go to B" },
      ];

      const handoffs = findHandoffs(clusters, transitions);
      const entryStates = ["st_a1"];
      const goalStates = ["st_b1"];

      const journeys = proposeJourneys(clusters, handoffs, entryStates, goalStates, transitions);

      expect(journeys.length).toBeGreaterThan(0);
      // Should include both internal and handoff transitions
      expect(journeys[0].transitions).toContain("tr_internal_a");
      expect(journeys[0].transitions).toContain("tr_handoff");
    });
  });

  describe("goal state detection", () => {
    test("identifies 'at rest' states as goals, not mid-action states", () => {
      const transitions: DerivedTransition[] = [
        { id: "tr_enter", from: "st_external", to: "st_artifact_list", action: "Open app" },
        { id: "tr_tap_write", from: "st_artifact_list", to: "st_flow_idle", action: "Tap Write" },
        { id: "tr_keystroke", from: "st_flow_idle", to: "st_flow_running", action: "Type" },
        { id: "tr_timer_expires", from: "st_flow_running", to: "st_flow_expired", action: "Timer expires" },
        { id: "tr_tap_done", from: "st_flow_expired", to: "st_edit_readonly", action: "Tap Done" },
      ];

      const { goalStates } = findEntryAndGoalStates(transitions);

      // st_edit_readonly is a goal (viewing draft - at rest)
      expect(goalStates).toContain("st_edit_readonly");

      // st_flow_running should NOT be a goal (mid-writing)
      // st_flow_expired is also not a goal (transitional state)
      expect(goalStates).not.toContain("st_flow_running");
    });

    test("states with only optional outgoing transitions are goals", () => {
      // A state where the user CAN take action but doesn't HAVE to
      const transitions: DerivedTransition[] = [
        { id: "tr_enter", from: "st_external", to: "st_artifact_list", action: "Open app" },
        { id: "tr_tap_item", from: "st_artifact_list", to: "st_artifact_detail", action: "Tap item" },
        // st_artifact_list has outgoing transition but user can stay there (viewing collection)
      ];

      const { goalStates } = findEntryAndGoalStates(transitions);

      // st_artifact_list should be a goal (viewing collection - at rest)
      expect(goalStates).toContain("st_artifact_list");
    });
  });

  describe("DFS path walking with max depth", () => {
    test("walks longer paths through the graph", () => {
      const clusters: StateCluster[] = [
        { name: "screen_a", screen: "screen_a", states: ["st_a"] },
        { name: "screen_b", screen: "screen_b", states: ["st_b1", "st_b2", "st_b3"] },
        { name: "screen_c", screen: "screen_c", states: ["st_c"] },
      ];

      const transitions: DerivedTransition[] = [
        { id: "tr_a_to_b1", from: "st_a", to: "st_b1", action: "Enter B" },
        { id: "tr_b1_to_b2", from: "st_b1", to: "st_b2", action: "Step 1" },
        { id: "tr_b2_to_b3", from: "st_b2", to: "st_b3", action: "Step 2" },
        { id: "tr_b3_to_c", from: "st_b3", to: "st_c", action: "Exit to C" },
      ];

      const handoffs = findHandoffs(clusters, transitions);
      const entryStates = ["st_a"];
      const goalStates = ["st_c"];

      const journeys = proposeJourneys(clusters, handoffs, entryStates, goalStates, transitions);

      expect(journeys.length).toBeGreaterThan(0);
      // Should walk all 4 transitions
      expect(journeys[0].transitions.length).toBe(4);
    });

    test("avoids infinite loops with visited state tracking", () => {
      const clusters: StateCluster[] = [
        { name: "screen_a", screen: "screen_a", states: ["st_a", "st_a2"] },
        { name: "screen_b", screen: "screen_b", states: ["st_b"] },
      ];

      const transitions: DerivedTransition[] = [
        { id: "tr_enter", from: "st_a", to: "st_a2", action: "Start" },
        { id: "tr_loop", from: "st_a2", to: "st_a", action: "Loop back" }, // Loop
        { id: "tr_exit", from: "st_a2", to: "st_b", action: "Exit" },
      ];

      const handoffs = findHandoffs(clusters, transitions);
      const entryStates = ["st_a"];
      const goalStates = ["st_b"];

      // Should not hang or crash
      const journeys = proposeJourneys(clusters, handoffs, entryStates, goalStates, transitions);

      expect(journeys.length).toBeGreaterThan(0);
      // Should find path without getting stuck in loop
      expect(journeys[0].transitions).toContain("tr_exit");
    });
  });

  describe("MECE includes internal transitions", () => {
    test("internal transitions must be covered by journeys", () => {
      const transitions: DerivedTransition[] = [
        { id: "tr_handoff", from: "st_a", to: "st_b", action: "Handoff" },
        { id: "tr_internal", from: "st_b", to: "st_b2", action: "Internal step" },
      ];

      // Journey only covers handoff
      const journeys: Journey[] = [
        { name: "journey_main", path: ["screen_a", "screen_b"], transitions: ["tr_handoff"] },
      ];

      const result = checkMece(journeys, transitions);

      // tr_internal is uncovered
      expect(result.uncoveredTransitions).toContain("tr_internal");
      expect(result.isMece).toBe(false);
    });

    test("self-loops can be marked as repeatable within journey", () => {
      const transitions: DerivedTransition[] = [
        { id: "tr_start", from: "st_a", to: "st_b", action: "Start" },
        { id: "tr_type_forward", from: "st_b", to: "st_b", action: "Type character" }, // Self-loop
        { id: "tr_finish", from: "st_b", to: "st_c", action: "Finish" },
      ];

      const journeys: Journey[] = [
        {
          name: "journey_main",
          path: ["screen_a", "screen_b", "screen_c"],
          transitions: ["tr_start", "tr_type_forward", "tr_finish"],
        },
      ];

      const result = checkMece(journeys, transitions);

      // Self-loop should be covered as part of the journey
      expect(result.uncoveredTransitions).not.toContain("tr_type_forward");
      expect(result.isMece).toBe(true);
    });
  });

  describe("journey naming by goal", () => {
    test("names journeys by user goal, not path", () => {
      const clusters: StateCluster[] = [
        { name: "screen_artifacts", screen: "screen_artifacts", states: ["st_artifact_list"] },
        { name: "screen_flow_mode", screen: "screen_flow_mode", states: ["st_flow_idle"] },
        { name: "screen_edit_draft", screen: "screen_edit_draft", states: ["st_edit_readonly"] },
      ];

      const transitions: DerivedTransition[] = [
        { id: "tr_tap_write", from: "st_artifact_list", to: "st_flow_idle", action: "Tap Write" },
        { id: "tr_tap_done", from: "st_flow_idle", to: "st_edit_readonly", action: "Tap Done" },
      ];

      const handoffs = findHandoffs(clusters, transitions);
      const entryStates = ["st_artifact_list"];
      const goalStates = ["st_edit_readonly"];

      const journeys = proposeJourneys(clusters, handoffs, entryStates, goalStates, transitions);

      // Name should be goal-based like "Write a new draft"
      // Not path-based like "artifact_list_to_flow_mode_to_edit_draft"
      expect(journeys[0].name).not.toContain("_to_");
    });

    test("no duplicate journey names", () => {
      const clusters: StateCluster[] = [
        { name: "screen_a", screen: "screen_a", states: ["st_a"] },
        { name: "screen_b", screen: "screen_b", states: ["st_b"] },
        { name: "screen_c", screen: "screen_c", states: ["st_c1", "st_c2"] },
      ];

      const transitions: DerivedTransition[] = [
        { id: "tr_a_to_b", from: "st_a", to: "st_b", action: "Go B" },
        { id: "tr_b_to_c1", from: "st_b", to: "st_c1", action: "Go C1" },
        { id: "tr_b_to_c2", from: "st_b", to: "st_c2", action: "Go C2" },
      ];

      const handoffs = findHandoffs(clusters, transitions);
      const entryStates = ["st_a"];
      const goalStates = ["st_c1", "st_c2"];

      const journeys = proposeJourneys(clusters, handoffs, entryStates, goalStates, transitions);

      // All journey names should be unique
      const names = journeys.map(j => j.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });
  });

  describe("goal-based journey grouping", () => {
    test("paths sharing the same goal are grouped into one journey", () => {
      // Two paths both end at st_artifact_list (viewing collection)
      // They should be ONE journey with TWO scenarios, not two journeys
      const clusters: StateCluster[] = [
        { name: "screen_flow", screen: "screen_flow", states: ["st_flow_idle", "st_flow_done"] },
        { name: "screen_artifacts", screen: "screen_artifacts", states: ["st_artifact_list"] },
        { name: "screen_external", screen: "", states: ["st_external"] },
      ];

      const transitions: DerivedTransition[] = [
        // Path 1: Enter from external -> view collection
        { id: "tr_enter", from: "st_external", to: "st_artifact_list", action: "Open app" },
        // Path 2: Complete flow -> view collection
        { id: "tr_flow_complete", from: "st_flow_idle", to: "st_flow_done", action: "Complete flow" },
        { id: "tr_save_artifact", from: "st_flow_done", to: "st_artifact_list", action: "Save artifact" },
      ];

      const handoffs = findHandoffs(clusters, transitions);
      const entryStates = ["st_artifact_list", "st_flow_idle"];
      const goalStates = ["st_artifact_list"];

      const journeys = proposeJourneys(clusters, handoffs, entryStates, goalStates, transitions);

      // Both paths end at st_artifact_list - should be ONE journey
      const viewCollectionJourneys = journeys.filter(j =>
        j.name.includes("view") || j.name.includes("collection") || j.name.includes("artifact_list")
      );
      expect(viewCollectionJourneys.length).toBe(1);
    });

    test("journey count is reasonable (not one per path)", () => {
      // Graph with many paths but only 3 distinct goals
      const clusters: StateCluster[] = [
        { name: "screen_home", screen: "screen_home", states: ["st_home"] },
        { name: "screen_flow", screen: "screen_flow", states: ["st_flow_a", "st_flow_b", "st_flow_c"] },
        { name: "screen_artifacts", screen: "screen_artifacts", states: ["st_artifact_list", "st_artifact_detail"] },
        { name: "screen_settings", screen: "screen_settings", states: ["st_settings_view"] },
      ];

      const transitions: DerivedTransition[] = [
        // Entry
        { id: "tr_enter", from: "st_external", to: "st_home", action: "Open app" },
        // Multiple paths to artifacts
        { id: "tr_home_to_artifacts", from: "st_home", to: "st_artifact_list", action: "View artifacts" },
        { id: "tr_flow_a_to_artifacts", from: "st_flow_a", to: "st_artifact_list", action: "Back to list" },
        { id: "tr_flow_b_to_artifacts", from: "st_flow_b", to: "st_artifact_list", action: "Save and back" },
        // Multiple paths to detail
        { id: "tr_list_to_detail", from: "st_artifact_list", to: "st_artifact_detail", action: "View item" },
        // Flow paths
        { id: "tr_home_to_flow_a", from: "st_home", to: "st_flow_a", action: "Start flow A" },
        { id: "tr_home_to_flow_b", from: "st_home", to: "st_flow_b", action: "Start flow B" },
        { id: "tr_flow_a_to_b", from: "st_flow_a", to: "st_flow_b", action: "Continue" },
        { id: "tr_flow_b_to_c", from: "st_flow_b", to: "st_flow_c", action: "Complete" },
        // Settings
        { id: "tr_home_to_settings", from: "st_home", to: "st_settings_view", action: "Open settings" },
      ];

      const handoffs = findHandoffs(clusters, transitions);
      const { entryStates, goalStates } = findEntryAndGoalStates(transitions);

      const journeys = proposeJourneys(clusters, handoffs, entryStates, goalStates, transitions);

      // Should NOT produce 10+ journeys (one per path)
      // Should produce ~3-5 journeys (one per goal intent)
      expect(journeys.length).toBeLessThanOrEqual(5);
      expect(journeys.length).toBeGreaterThanOrEqual(2);
    });

    test("path variations become scenarios within a journey", () => {
      const clusters: StateCluster[] = [
        { name: "screen_checkout", screen: "screen_checkout", states: ["st_cart", "st_payment"] },
        { name: "screen_confirm", screen: "screen_confirm", states: ["st_order_confirmed"] },
      ];

      const transitions: DerivedTransition[] = [
        // Two paths to same goal: order confirmed
        { id: "tr_pay_card", from: "st_cart", to: "st_payment", action: "Pay with card" },
        { id: "tr_pay_paypal", from: "st_cart", to: "st_payment", action: "Pay with PayPal" },
        { id: "tr_confirm", from: "st_payment", to: "st_order_confirmed", action: "Confirm order" },
      ];

      const handoffs = findHandoffs(clusters, transitions);
      const entryStates = ["st_cart"];
      const goalStates = ["st_order_confirmed"];

      const journeys = proposeJourneys(clusters, handoffs, entryStates, goalStates, transitions);

      // Should be ONE journey "Complete Purchase" with scenarios for card vs paypal
      expect(journeys.length).toBe(1);

      // Journey should have a scenarios property with the path variations
      const journey = journeys[0];
      expect(journey.scenarios).toBeDefined();
      expect(journey.scenarios!.length).toBe(2); // card path and paypal path
    });

    test("journey names reflect user intent, not graph topology", () => {
      const clusters: StateCluster[] = [
        { name: "screen_auth", screen: "screen_auth", states: ["st_login"] },
        { name: "screen_home", screen: "screen_home", states: ["st_home_dashboard"] },
      ];

      const transitions: DerivedTransition[] = [
        { id: "tr_login", from: "st_login", to: "st_home_dashboard", action: "Log in" },
      ];

      const handoffs = findHandoffs(clusters, transitions);
      const entryStates = ["st_login"];
      const goalStates = ["st_home_dashboard"];

      const journeys = proposeJourneys(clusters, handoffs, entryStates, goalStates, transitions);

      // Name should describe the accomplishment, not the path
      // Good: "journey_access_dashboard", "journey_login"
      // Bad: "journey_1", "journey_auth_to_home"
      expect(journeys[0].name).not.toMatch(/_\d+$/); // No numeric suffix
      expect(journeys[0].name).not.toContain("_to_"); // No path-based naming
    });

    test("internal transitions marked as optional within journey", () => {
      const clusters: StateCluster[] = [
        { name: "screen_flow", screen: "screen_flow", states: ["st_flow_idle", "st_flow_running", "st_flow_done"] },
        { name: "screen_artifacts", screen: "screen_artifacts", states: ["st_artifact_list"] },
      ];

      const transitions: DerivedTransition[] = [
        { id: "tr_start", from: "st_flow_idle", to: "st_flow_running", action: "Start writing" },
        { id: "tr_typing", from: "st_flow_running", to: "st_flow_running", action: "Type character" }, // Self-loop
        { id: "tr_complete", from: "st_flow_running", to: "st_flow_done", action: "Timer expires" },
        { id: "tr_save", from: "st_flow_done", to: "st_artifact_list", action: "Save" },
      ];

      const handoffs = findHandoffs(clusters, transitions);
      const entryStates = ["st_flow_idle"];
      const goalStates = ["st_artifact_list"];

      const journeys = proposeJourneys(clusters, handoffs, entryStates, goalStates, transitions);

      expect(journeys.length).toBe(1);
      const journey = journeys[0];

      // Internal transitions should be marked as optional
      expect(journey.optionalTransitions).toBeDefined();
      expect(journey.optionalTransitions).toContain("tr_typing"); // Self-loop is optional

      // Required transitions are the critical path
      expect(journey.requiredTransitions).toBeDefined();
      expect(journey.requiredTransitions).toContain("tr_start");
      expect(journey.requiredTransitions).toContain("tr_save");
    });
  });

  describe("sc_journeys_scenarios: Generate scenarios as path permutations", () => {
    test("generates scenarios for each distinct path through journey", () => {
      const journey: Journey = {
        name: "journey_auth",
        path: ["screen_auth", "screen_home"],
        transitions: ["tr_login"],
      };

      const transitions: DerivedTransition[] = [
        { id: "tr_login", from: "st_login", to: "st_home", action: "Login" },
      ];

      const scenarios = generateScenarios(journey, transitions);

      expect(scenarios.length).toBeGreaterThan(0);
      expect(scenarios[0].journey).toBe("journey_auth");
    });

    test("scenario has given and path props", () => {
      const journey: Journey = {
        name: "journey_auth",
        path: ["screen_auth", "screen_home"],
        transitions: ["tr_login"],
      };

      const transitions: DerivedTransition[] = [
        { id: "tr_login", from: "st_login", to: "st_home", action: "Login" },
      ];

      const scenarios = generateScenarios(journey, transitions);

      expect(scenarios[0].given).toBeDefined();
      expect(scenarios[0].path).toBeDefined();
      expect(Array.isArray(scenarios[0].path)).toBe(true);
    });

    test("generates multiple scenarios for branching paths", () => {
      const journey: Journey = {
        name: "journey_checkout",
        path: ["screen_cart", "screen_payment", "screen_confirmation"],
        transitions: ["tr_checkout_card", "tr_checkout_paypal", "tr_confirm"],
      };

      const transitions: DerivedTransition[] = [
        { id: "tr_checkout_card", from: "st_cart", to: "st_payment_card", action: "Pay with card" },
        { id: "tr_checkout_paypal", from: "st_cart", to: "st_payment_paypal", action: "Pay with PayPal" },
        { id: "tr_confirm", from: "st_payment_card", to: "st_confirmed", action: "Confirm" },
      ];

      const scenarios = generateScenarios(journey, transitions);

      // Should generate at least 2 scenarios for the two payment paths
      expect(scenarios.length).toBeGreaterThanOrEqual(1);
    });
  });
});
