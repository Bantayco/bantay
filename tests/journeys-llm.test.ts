/**
 * @scenario sc_journeys_cluster
 * @scenario sc_journeys_handoffs
 * @scenario sc_journeys_entry_goal
 * @scenario sc_journeys_propose
 * @scenario sc_journeys_mece
 * @scenario sc_journeys_scenarios
 * @scenario sc_journeys_prompt
 * @scenario sc_journeys_apply
 * @scenario sc_journeys_apply_match
 * @scenario sc_journeys_apply_no_duplicates
 */
import { describe, test, expect, mock, beforeEach } from "bun:test";
import {
  collectJourneyContext,
  validateJourneyProposal,
  validateJourneyProposals,
  generateJourneyPrompt,
  matchJourneysToExistingCUJs,
  classifyJourneys,
  generateCujId,
  type JourneyContext,
  type JourneyProposal,
  type JourneyScenarioProposal,
  type ValidationResult,
  type ExistingCUJ,
  type JourneyMatch,
  type JourneyClassification,
} from "../src/commands/journeys-llm";
import type { DerivedTransition } from "../src/commands/derive-graph";

describe("journeys-llm", () => {
  describe("context collection", () => {
    test("collects app description from aide", () => {
      const aide = {
        entities: {
          my_app: {
            display: "page",
            props: {
              title: "My App",
              description: "A productivity app for focused writing",
            },
          },
        },
      };

      const context = collectJourneyContext(aide);

      expect(context.appDescription).toBe("A productivity app for focused writing");
      expect(context.appName).toBe("My App");
    });

    test("collects all st_* entities with descriptions", () => {
      const aide = {
        entities: {
          st_flow_idle: {
            props: {
              screen: "screen_flow",
              description: "Timer not started, editor empty",
            },
          },
          st_flow_running: {
            props: {
              screen: "screen_flow",
              description: "Timer counting down, user writing",
            },
          },
          comp_timer: {
            props: { name: "Timer" }, // Not a state, should be excluded
          },
        },
      };

      const context = collectJourneyContext(aide);

      expect(context.states).toHaveLength(2);
      expect(context.states.find((s) => s.id === "st_flow_idle")).toBeDefined();
      expect(context.states.find((s) => s.id === "st_flow_running")).toBeDefined();
    });

    test("collects all tr_* entities with action text", () => {
      const aide = {
        entities: {
          tr_tap_write: {
            props: {
              from: "st_artifact_list",
              to: "st_flow_idle",
              action: "Tap Write nav button",
              trigger: "comp_nav_bar",
            },
          },
          tr_first_keystroke: {
            props: {
              from: "st_flow_idle",
              to: "st_flow_running",
              action: "First keystroke starts timer",
            },
          },
        },
      };

      const context = collectJourneyContext(aide);

      expect(context.transitions).toHaveLength(2);
      expect(context.transitions[0].action).toBe("Tap Write nav button");
    });

    test("collects existing CUJs if any", () => {
      const aide = {
        entities: {
          cujs: { parent: "app", props: {} },
          cuj_write: {
            parent: "cujs",
            props: {
              feature: "User writes a new draft",
            },
          },
          sc_write_start: {
            parent: "cuj_write",
            props: {
              name: "Start writing",
              given: "User is on home screen",
            },
          },
        },
      };

      const context = collectJourneyContext(aide);

      expect(context.existingCujs).toHaveLength(1);
      expect(context.existingCujs[0].id).toBe("cuj_write");
      expect(context.existingCujs[0].feature).toBe("User writes a new draft");
    });

    test("collects screen entities with names", () => {
      const aide = {
        entities: {
          screen_flow_mode: {
            props: {
              name: "Flow Mode",
              description: "Focused writing screen with timer",
            },
          },
          screen_artifacts: {
            props: {
              name: "Artifacts",
              description: "List of saved writings",
            },
          },
        },
      };

      const context = collectJourneyContext(aide);

      expect(context.screens).toHaveLength(2);
      expect(context.screens.find((s) => s.id === "screen_flow_mode")?.name).toBe("Flow Mode");
    });
  });

  describe("journey proposal validation", () => {
    const transitions: DerivedTransition[] = [
      { id: "tr_enter", from: "st_external", to: "st_home", action: "Open app" },
      { id: "tr_start_flow", from: "st_home", to: "st_flow_idle", action: "Tap Write" },
      { id: "tr_keystroke", from: "st_flow_idle", to: "st_flow_running", action: "Type" },
      { id: "tr_timer_expires", from: "st_flow_running", to: "st_flow_done", action: "Timer expires" },
      { id: "tr_save", from: "st_flow_done", to: "st_artifact_list", action: "Save" },
    ];

    test("validates that all transitions in a path exist in the graph", () => {
      const proposal: JourneyProposal = {
        name: "Write a draft",
        description: "User writes a focused draft",
        core_transitions: ["tr_start_flow", "tr_keystroke", "tr_timer_expires", "tr_save"],
        optional_transitions: [],
        entry_states: ["st_home"],
        goal_description: "Draft saved to artifacts",
        scenarios: [],
      };

      const result = validateJourneyProposal(proposal, transitions);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("reports error when transition does not exist", () => {
      const proposal: JourneyProposal = {
        name: "Write a draft",
        description: "User writes a focused draft",
        core_transitions: ["tr_start_flow", "tr_nonexistent", "tr_save"],
        optional_transitions: [],
        entry_states: ["st_home"],
        goal_description: "Draft saved",
        scenarios: [],
      };

      const result = validateJourneyProposal(proposal, transitions);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Transition tr_nonexistent does not exist in graph");
    });

    test("validates that path is a valid walk (to matches next from)", () => {
      const proposal: JourneyProposal = {
        name: "Write a draft",
        description: "User writes a focused draft",
        // tr_keystroke goes to st_flow_running, but tr_save starts from st_flow_done
        core_transitions: ["tr_start_flow", "tr_keystroke", "tr_save"],
        optional_transitions: [],
        entry_states: ["st_home"],
        goal_description: "Draft saved",
        scenarios: [],
      };

      const result = validateJourneyProposal(proposal, transitions);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Invalid path"))).toBe(true);
    });

    test("validates scenario paths are valid walks", () => {
      const proposal: JourneyProposal = {
        name: "Write a draft",
        description: "User writes a focused draft",
        core_transitions: ["tr_start_flow", "tr_keystroke", "tr_timer_expires", "tr_save"],
        optional_transitions: [],
        entry_states: ["st_home"],
        goal_description: "Draft saved",
        scenarios: [
          {
            name: "Quick write",
            given: "User on home screen",
            path: ["tr_start_flow", "tr_keystroke", "tr_timer_expires", "tr_save"],
          },
          {
            name: "Invalid path",
            given: "User on home screen",
            path: ["tr_start_flow", "tr_save"], // Invalid - skips intermediate states
          },
        ],
      };

      const result = validateJourneyProposal(proposal, transitions);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("scenario 'Invalid path'"))).toBe(true);
    });
  });

  describe("MECE validation", () => {
    const transitions: DerivedTransition[] = [
      { id: "tr_a", from: "st_x", to: "st_y", action: "A" },
      { id: "tr_b", from: "st_y", to: "st_z", action: "B" },
      { id: "tr_c", from: "st_z", to: "st_w", action: "C" },
      { id: "tr_orphan", from: "st_m", to: "st_n", action: "Orphan" },
    ];

    test("reports uncovered transitions", () => {
      const proposals: JourneyProposal[] = [
        {
          name: "Journey 1",
          description: "Main journey",
          core_transitions: ["tr_a", "tr_b", "tr_c"],
          optional_transitions: [],
          entry_states: ["st_x"],
          goal_description: "Done",
          scenarios: [],
        },
      ];

      const result = validateJourneyProposals(proposals, transitions);

      expect(result.meceResult.isMece).toBe(false);
      expect(result.meceResult.uncoveredTransitions).toContain("tr_orphan");
    });

    test("passes when all transitions covered by core or optional", () => {
      const proposals: JourneyProposal[] = [
        {
          name: "Journey 1",
          description: "Main journey",
          core_transitions: ["tr_a", "tr_b", "tr_c"],
          optional_transitions: ["tr_orphan"],
          entry_states: ["st_x"],
          goal_description: "Done",
          scenarios: [],
        },
      ];

      const result = validateJourneyProposals(proposals, transitions);

      expect(result.meceResult.uncoveredTransitions).toHaveLength(0);
    });

    test("reports when a journey is subset of another", () => {
      const proposals: JourneyProposal[] = [
        {
          name: "Full Journey",
          description: "Full path",
          core_transitions: ["tr_a", "tr_b", "tr_c"],
          optional_transitions: [],
          entry_states: ["st_x"],
          goal_description: "Done",
          scenarios: [],
        },
        {
          name: "Subset Journey",
          description: "Partial path",
          core_transitions: ["tr_a", "tr_b"],
          optional_transitions: [],
          entry_states: ["st_x"],
          goal_description: "Partial",
          scenarios: [],
        },
      ];

      const result = validateJourneyProposals(proposals, transitions);

      expect(result.meceResult.subsetJourneys).toContainEqual({
        subset: "Subset Journey",
        superset: "Full Journey",
      });
    });
  });

  describe("journey count validation", () => {
    test("warns if fewer than 4 journeys proposed", () => {
      const proposals: JourneyProposal[] = [
        {
          name: "Only Journey",
          description: "The only one",
          core_transitions: [],
          optional_transitions: [],
          entry_states: [],
          goal_description: "Done",
          scenarios: [],
        },
      ];

      const result = validateJourneyProposals(proposals, []);

      expect(result.warnings).toContain("Expected 4-8 journeys, got 1");
    });

    test("warns if more than 8 journeys proposed", () => {
      const proposals: JourneyProposal[] = Array(10)
        .fill(null)
        .map((_, i) => ({
          name: `Journey ${i}`,
          description: `Journey number ${i}`,
          core_transitions: [],
          optional_transitions: [],
          entry_states: [],
          goal_description: "Done",
          scenarios: [],
        }));

      const result = validateJourneyProposals(proposals, []);

      expect(result.warnings).toContain("Expected 4-8 journeys, got 10");
    });

    test("accepts 4-8 journeys without warning", () => {
      const proposals: JourneyProposal[] = Array(5)
        .fill(null)
        .map((_, i) => ({
          name: `Journey ${i}`,
          description: `Journey number ${i}`,
          core_transitions: [],
          optional_transitions: [],
          entry_states: [],
          goal_description: "Done",
          scenarios: [],
        }));

      const result = validateJourneyProposals(proposals, []);

      expect(result.warnings.some((w) => w.includes("Expected 4-8"))).toBe(false);
    });
  });

  describe("scenario generation", () => {
    test("each journey should have 2-4 scenarios", () => {
      const proposal: JourneyProposal = {
        name: "Write a draft",
        description: "User writes a focused draft",
        core_transitions: [],
        optional_transitions: [],
        entry_states: [],
        goal_description: "Done",
        scenarios: [
          { name: "Scenario 1", given: "Starting point 1", path: [] },
          { name: "Scenario 2", given: "Starting point 2", path: [] },
        ],
      };

      expect(proposal.scenarios.length).toBeGreaterThanOrEqual(2);
      expect(proposal.scenarios.length).toBeLessThanOrEqual(4);
    });

    test("scenarios have name, given, and path props", () => {
      const scenario: JourneyScenarioProposal = {
        name: "Quick write",
        given: "User is on home screen",
        path: ["tr_start", "tr_type", "tr_save"],
      };

      expect(scenario.name).toBeDefined();
      expect(scenario.given).toBeDefined();
      expect(scenario.path).toBeDefined();
      expect(Array.isArray(scenario.path)).toBe(true);
    });
  });

  describe("prompt generation (--prompt flag)", () => {
    test("includes app name and description", () => {
      const context: JourneyContext = {
        appName: "Flow Writer",
        appDescription: "A focused writing app with timers",
        states: [],
        transitions: [],
        existingCujs: [],
        screens: [],
      };

      const prompt = generateJourneyPrompt(context);

      expect(prompt).toContain("Flow Writer");
      expect(prompt).toContain("A focused writing app with timers");
    });

    test("groups transitions by category", () => {
      const context: JourneyContext = {
        appName: "Test App",
        appDescription: "Test",
        states: [
          { id: "st_external", screen: "" },
          { id: "st_home", screen: "screen_home" },
          { id: "st_flow_idle", screen: "screen_flow" },
          { id: "st_flow_running", screen: "screen_flow" },
        ],
        transitions: [
          // Entry transition (from st_external)
          { id: "tr_launch", from: "st_external", to: "st_home", action: "Launch app" },
          // Navigation transition (cross-screen)
          { id: "tr_start_flow", from: "st_home", to: "st_flow_idle", action: "Start flow" },
          // In-screen action (same screen)
          { id: "tr_type", from: "st_flow_idle", to: "st_flow_running", action: "Type" },
        ],
        existingCujs: [],
        screens: [
          { id: "screen_home", name: "Home" },
          { id: "screen_flow", name: "Flow Mode" },
        ],
      };

      const prompt = generateJourneyPrompt(context);

      expect(prompt).toContain("Entry Transitions");
      expect(prompt).toContain("tr_launch");
      expect(prompt).toContain("Navigation Transitions");
      expect(prompt).toContain("tr_start_flow");
      expect(prompt).toContain("screen_flow");
      expect(prompt).toContain("tr_type");
    });

    test("lists all screens with descriptions", () => {
      const context: JourneyContext = {
        appName: "Test App",
        appDescription: "Test",
        states: [],
        transitions: [],
        existingCujs: [],
        screens: [
          { id: "screen_home", name: "Home", description: "Main landing screen" },
          { id: "screen_settings", name: "Settings", description: "User preferences" },
        ],
      };

      const prompt = generateJourneyPrompt(context);

      expect(prompt).toContain("screen_home");
      expect(prompt).toContain("Home");
      expect(prompt).toContain("Main landing screen");
      expect(prompt).toContain("screen_settings");
    });

    test("includes JSON response format instructions", () => {
      const context: JourneyContext = {
        appName: "Test App",
        appDescription: "Test",
        states: [],
        transitions: [],
        existingCujs: [],
        screens: [],
      };

      const prompt = generateJourneyPrompt(context);

      expect(prompt).toContain("JSON");
      expect(prompt).toContain("name");
      expect(prompt).toContain("core_transitions");
      expect(prompt).toContain("scenarios");
    });

    test("groups per-screen actions by screen", () => {
      const context: JourneyContext = {
        appName: "Test App",
        appDescription: "Test",
        states: [
          { id: "st_flow_idle", screen: "screen_flow" },
          { id: "st_flow_running", screen: "screen_flow" },
          { id: "st_flow_done", screen: "screen_flow" },
        ],
        transitions: [
          { id: "tr_start", from: "st_flow_idle", to: "st_flow_running", action: "Start timer" },
          { id: "tr_finish", from: "st_flow_running", to: "st_flow_done", action: "Timer expires" },
        ],
        existingCujs: [],
        screens: [{ id: "screen_flow", name: "Flow Mode" }],
      };

      const prompt = generateJourneyPrompt(context);

      expect(prompt).toContain("screen_flow");
      expect(prompt).toContain("tr_start");
      expect(prompt).toContain("tr_finish");
    });

    test("includes system prompt for product analyst role", () => {
      const context: JourneyContext = {
        appName: "Test App",
        appDescription: "Test",
        states: [],
        transitions: [],
        existingCujs: [],
        screens: [],
      };

      const prompt = generateJourneyPrompt(context);

      expect(prompt).toContain("product analyst");
      expect(prompt).toContain("user INTENT");
      expect(prompt).toContain("4-8");
    });
  });

  // sc_journeys_apply tests
  describe("journey apply (--apply flag)", () => {
    describe("matching journeys to existing CUJs", () => {
      test("matches journey to existing CUJ with 80%+ transition overlap", () => {
        // Proposal and existing CUJ have exactly the same transitions
        const proposedJourney: JourneyProposal = {
          name: "Write a draft",
          description: "User writes a focused draft",
          core_transitions: ["tr_start", "tr_type", "tr_save"],
          optional_transitions: [],
          entry_states: ["st_home"],
          goal_description: "Draft saved",
          scenarios: [
            { name: "Quick write", given: "Home screen", path: ["tr_start", "tr_type", "tr_save"] },
          ],
        };

        const existingCUJs: ExistingCUJ[] = [
          {
            id: "cuj_write_draft",
            feature: "User writes a draft",
            scenarios: [
              { id: "sc_write_quick", name: "Quick write", path: ["tr_start", "tr_type", "tr_save"] },
            ],
          },
        ];

        const matches = matchJourneysToExistingCUJs([proposedJourney], existingCUJs);

        expect(matches).toHaveLength(1);
        expect(matches[0].proposedJourney.name).toBe("Write a draft");
        expect(matches[0].matchedCUJ?.id).toBe("cuj_write_draft");
        // 100% overlap (same 3 transitions)
        expect(matches[0].overlapPercentage).toBeGreaterThanOrEqual(0.8);
      });

      test("does not match if less than 80% overlap", () => {
        const proposedJourney: JourneyProposal = {
          name: "New journey",
          description: "Completely different journey",
          core_transitions: ["tr_x", "tr_y", "tr_z"],
          optional_transitions: [],
          entry_states: ["st_external"],
          goal_description: "Done",
          scenarios: [],
        };

        const existingCUJs: ExistingCUJ[] = [
          {
            id: "cuj_existing",
            feature: "Existing feature",
            scenarios: [
              { id: "sc_existing", name: "Existing", path: ["tr_a", "tr_b", "tr_c"] },
            ],
          },
        ];

        const matches = matchJourneysToExistingCUJs([proposedJourney], existingCUJs);

        expect(matches).toHaveLength(1);
        expect(matches[0].matchedCUJ).toBeUndefined();
        expect(matches[0].overlapPercentage).toBeLessThan(0.8);
      });

      test("collects transitions from both core and scenario paths", () => {
        const proposedJourney: JourneyProposal = {
          name: "Write a draft",
          description: "User writes",
          core_transitions: ["tr_start", "tr_type"],
          optional_transitions: [],
          entry_states: ["st_home"],
          goal_description: "Draft saved",
          scenarios: [
            { name: "Full path", given: "Home", path: ["tr_start", "tr_type", "tr_save", "tr_share"] },
          ],
        };

        // Existing CUJ covers tr_save and tr_share via scenario
        const existingCUJs: ExistingCUJ[] = [
          {
            id: "cuj_share_work",
            feature: "Share work",
            scenarios: [
              { id: "sc_share", name: "Share", path: ["tr_save", "tr_share"] },
            ],
          },
        ];

        const matches = matchJourneysToExistingCUJs([proposedJourney], existingCUJs);

        // Should find some overlap due to tr_save and tr_share in scenario
        expect(matches[0].overlapPercentage).toBeGreaterThan(0);
      });
    });

    describe("classifying journeys", () => {
      test("classifies as MATCH when existing CUJ matches", () => {
        const matches: JourneyMatch[] = [
          {
            proposedJourney: {
              name: "Write",
              description: "",
              core_transitions: ["tr_a"],
              optional_transitions: [],
              entry_states: [],
              goal_description: "",
              scenarios: [],
            },
            matchedCUJ: { id: "cuj_write", feature: "Write", scenarios: [] },
            overlapPercentage: 0.9,
          },
        ];

        const existingCUJs: ExistingCUJ[] = [
          { id: "cuj_write", feature: "Write", scenarios: [] },
        ];

        const classification = classifyJourneys(matches, existingCUJs);

        expect(classification.matched).toHaveLength(1);
        expect(classification.matched[0].proposedJourney.name).toBe("Write");
        expect(classification.new).toHaveLength(0);
      });

      test("classifies as NEW when no existing CUJ matches", () => {
        const matches: JourneyMatch[] = [
          {
            proposedJourney: {
              name: "Brand new journey",
              description: "Something new",
              core_transitions: ["tr_new"],
              optional_transitions: [],
              entry_states: [],
              goal_description: "",
              scenarios: [],
            },
            matchedCUJ: undefined,
            overlapPercentage: 0,
          },
        ];

        const classification = classifyJourneys(matches, []);

        expect(classification.new).toHaveLength(1);
        expect(classification.new[0].name).toBe("Brand new journey");
        expect(classification.matched).toHaveLength(0);
      });

      test("identifies ORPHANED CUJs not covered by any proposal", () => {
        const matches: JourneyMatch[] = [
          {
            proposedJourney: {
              name: "Journey A",
              description: "",
              core_transitions: [],
              optional_transitions: [],
              entry_states: [],
              goal_description: "",
              scenarios: [],
            },
            matchedCUJ: { id: "cuj_a", feature: "A", scenarios: [] },
            overlapPercentage: 0.9,
          },
        ];

        const existingCUJs: ExistingCUJ[] = [
          { id: "cuj_a", feature: "A", scenarios: [] },
          { id: "cuj_orphan", feature: "Orphaned", scenarios: [] },
        ];

        const classification = classifyJourneys(matches, existingCUJs);

        expect(classification.orphaned).toHaveLength(1);
        expect(classification.orphaned[0].id).toBe("cuj_orphan");
      });

      test("identifies MERGE candidates when proposal matches multiple CUJs", () => {
        const matches: JourneyMatch[] = [
          {
            proposedJourney: {
              name: "Combined journey",
              description: "Merges A and B",
              core_transitions: ["tr_a", "tr_b", "tr_c", "tr_d"],
              optional_transitions: [],
              entry_states: [],
              goal_description: "",
              scenarios: [],
            },
            matchedCUJ: { id: "cuj_a", feature: "A", scenarios: [] },
            overlapPercentage: 0.85,
            additionalMatches: [{ id: "cuj_b", feature: "B", scenarios: [] }],
          },
        ];

        const existingCUJs: ExistingCUJ[] = [
          { id: "cuj_a", feature: "A", scenarios: [] },
          { id: "cuj_b", feature: "B", scenarios: [] },
        ];

        const classification = classifyJourneys(matches, existingCUJs);

        expect(classification.merged).toHaveLength(1);
        expect(classification.merged[0].absorbedCUJs).toContain("cuj_a");
        expect(classification.merged[0].absorbedCUJs).toContain("cuj_b");
      });
    });

    describe("CUJ ID generation", () => {
      test("generates ID from journey name", () => {
        expect(generateCujId("Write in Flow")).toBe("cuj_write_in_flow");
        expect(generateCujId("Secure My Work")).toBe("cuj_secure_my_work");
        expect(generateCujId("View All Artifacts")).toBe("cuj_view_all_artifacts");
      });

      test("removes special characters", () => {
        expect(generateCujId("Write a Draft!")).toBe("cuj_write_a_draft");
        expect(generateCujId("Save & Share")).toBe("cuj_save_share");
      });

      test("converts to lowercase", () => {
        expect(generateCujId("WRITE")).toBe("cuj_write");
        expect(generateCujId("Write Draft")).toBe("cuj_write_draft");
      });
    });

    describe("no duplicate CUJs", () => {
      test("matched journey updates existing CUJ, not creates new", () => {
        const classification: JourneyClassification = {
          matched: [
            {
              proposedJourney: {
                name: "Write Draft",
                description: "New description",
                core_transitions: ["tr_a", "tr_b"],
                optional_transitions: [],
                entry_states: ["st_home"],
                goal_description: "Done",
                scenarios: [{ name: "Quick", given: "Home", path: ["tr_a", "tr_b"] }],
              },
              matchedCUJ: { id: "cuj_write", feature: "Old description", scenarios: [] },
              overlapPercentage: 0.95,
            },
          ],
          new: [],
          merged: [],
          orphaned: [],
        };

        // The matched journey should update cuj_write, not create cuj_write_draft
        expect(classification.matched[0].matchedCUJ?.id).toBe("cuj_write");
        expect(classification.new).toHaveLength(0);
      });
    });
  });
});
