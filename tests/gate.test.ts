import { describe, test, expect } from "bun:test";
import { parse } from "@bantay/aide";
import { MockDecisionModel } from "../src/decision";
import { gateProposal, buildGateQuestions, extractVocabulary, exitCodeFor, OUT_OF_VOCABULARY } from "../src/commands/gate";

const aide = parse(`
entities:
  app: { display: page, props: { title: Editor } }
  invariants: { parent: app }
  inv_no_data_loss:
    parent: invariants
    props: { statement: Unsaved work is never discarded without confirmation, category: data_integrity }
  inv_autosave:
    parent: invariants
    props: { statement: Every save writes to disk within 1s, category: performance }
  screen_editor: { parent: app, props: { name: Editor } }
  comp_save: { parent: screen_editor, props: { name: Save button, variants: [idle, busy] } }
  st_clean: { parent: app, props: { screen: screen_editor, initial: true, comp_save: idle } }
  st_dirty: { parent: app, props: { screen: screen_editor, comp_save: idle } }
  st_saving: { parent: app, props: { screen: screen_editor, comp_save: busy } }
  tr_edit: { parent: app, props: { from: st_clean, to: st_dirty, action: Type in the editor } }
  tr_save: { parent: app, props: { from: st_dirty, to: st_saving, action: Tap Save, trigger: comp_save } }
  tr_saved: { parent: app, props: { from: st_saving, to: st_clean, action: Save completes } }
relationships: []
`);

const choice = (choice: string, confidence: number) => ({
  type: "choice" as const,
  choice,
  confidence,
  probabilities: { [choice]: confidence, [OUT_OF_VOCABULARY]: 1 - confidence },
});
const noul = (p: number) => ({ type: "noul" as const, probability: p });

describe("vocabulary extraction", () => {
  test("collects tr_*, st_*, inv_*", () => {
    const v = extractVocabulary(aide);
    expect(Object.keys(v.transitions).sort()).toEqual(["tr_edit", "tr_save", "tr_saved"]);
    expect(v.states.st_clean).toEqual({ screen: "screen_editor", variants: { comp_save: "idle" }, initial: true });
    expect(Object.keys(v.invariants)).toEqual(["inv_no_data_loss", "inv_autosave"]);
  });

  test("questions: one choice over the closed vocabulary + out_of_vocabulary, one noul per invariant", () => {
    const q = buildGateQuestions(extractVocabulary(aide));
    expect(q.transition.type).toBe("choice");
    const criteria = (q.transition as { criteria: Record<string, string> }).criteria;
    expect(Object.keys(criteria).sort()).toEqual([OUT_OF_VOCABULARY, "tr_edit", "tr_save", "tr_saved"]);
    expect(criteria.tr_save).toContain("st_dirty → st_saving");
    expect(q.inv_no_data_loss.type).toBe("noul");
  });

  test("--from narrows the vocabulary to transitions leaving that state", () => {
    const q = buildGateQuestions(extractVocabulary(aide), "st_dirty");
    const criteria = (q.transition as { criteria: Record<string, string> }).criteria;
    expect(Object.keys(criteria).sort()).toEqual([OUT_OF_VOCABULARY, "tr_save"]);
  });
});

describe("gate decisions", () => {
  const threshold = 0.8;

  test("allow: confident match, no invariant at risk", async () => {
    const oracle = new MockDecisionModel({ transition: choice("tr_save", 0.95), inv_no_data_loss: noul(0.05), inv_autosave: noul(0.1) });
    const r = await gateProposal(aide, oracle, { proposal: "User taps Save", threshold });
    expect(r.decision).toBe("allow");
    expect(r.transition?.id).toBe("tr_save");
    expect(exitCodeFor(r.decision)).toBe(0);
    // the oracle saw the proposal and the vocabulary as state
    expect((oracle.requests[0].state as { proposal: string }).proposal).toBe("User taps Save");
  });

  test("reject: confidently out of vocabulary", async () => {
    const oracle = new MockDecisionModel({ transition: choice(OUT_OF_VOCABULARY, 0.9), inv_no_data_loss: noul(0), inv_autosave: noul(0) });
    const r = await gateProposal(aide, oracle, { proposal: "Add a dark mode toggle", threshold });
    expect(r.decision).toBe("reject");
    expect(r.reason).toMatch(/out of vocabulary/);
    expect(exitCodeFor(r.decision)).toBe(1);
  });

  test("escalate: not confident", async () => {
    const oracle = new MockDecisionModel({ transition: choice("tr_edit", 0.55), inv_no_data_loss: noul(0.1), inv_autosave: noul(0.1) });
    const r = await gateProposal(aide, oracle, { proposal: "Change something", threshold });
    expect(r.decision).toBe("escalate");
    expect(exitCodeFor(r.decision)).toBe(2);
  });

  test("reject: invariant would be violated even when the transition matches", async () => {
    const oracle = new MockDecisionModel({ transition: choice("tr_saved", 0.9), inv_no_data_loss: noul(0.92), inv_autosave: noul(0.1) });
    const r = await gateProposal(aide, oracle, { proposal: "Discard buffer and mark clean", threshold });
    expect(r.decision).toBe("reject");
    expect(r.reason).toContain("inv_no_data_loss");
    expect(r.invariantsAtRisk[0].id).toBe("inv_no_data_loss");
  });

  test("escalate: invariant in the uncertain band", async () => {
    const oracle = new MockDecisionModel({ transition: choice("tr_save", 0.9), inv_no_data_loss: noul(0.1), inv_autosave: noul(0.4) });
    const r = await gateProposal(aide, oracle, { proposal: "Tap Save (slow disk)", threshold });
    expect(r.decision).toBe("escalate");
    expect(r.reason).toContain("inv_autosave");
  });

  test("reject: matched transition does not start at --from", async () => {
    const oracle = new MockDecisionModel({ transition: choice("tr_save", 0.95), inv_no_data_loss: noul(0), inv_autosave: noul(0) });
    const r = await gateProposal(aide, oracle, { proposal: "Tap Save", from: "st_clean", threshold });
    // vocabulary narrowed to tr_edit only, but mock still answered tr_save → mismatch
    expect(r.decision).toBe("reject");
    expect(r.reason).toContain("st_clean");
  });

  test("escalate: aide has no transitions at all", async () => {
    const empty = parse("entities:\n  app: {}\nrelationships: []\n");
    const oracle = new MockDecisionModel();
    const r = await gateProposal(empty, oracle, { proposal: "anything", threshold });
    expect(r.decision).toBe("escalate");
    expect(oracle.requests).toHaveLength(0);
  });
});
