import { describe, test, expect } from "bun:test";
import { generateOrchestrateCommand } from "../src/generators/claude-commands";

describe("Orchestrate Template", () => {
  describe("Plan validation checks", () => {
    test("contains 'Validate plan' section", () => {
      const content = generateOrchestrateCommand();
      expect(content).toContain("Validate plan");
    });

    test("contains 'aide coverage' check", () => {
      const content = generateOrchestrateCommand();
      expect(content.toLowerCase()).toContain("aide coverage");
    });

    test("contains 'file references' check", () => {
      const content = generateOrchestrateCommand();
      expect(content.toLowerCase()).toContain("file references");
    });

    test("contains 'interface contracts' check", () => {
      const content = generateOrchestrateCommand();
      expect(content.toLowerCase()).toContain("interface contracts");
    });

    test("contains 'dependency check' check", () => {
      const content = generateOrchestrateCommand();
      expect(content.toLowerCase()).toContain("dependency check");
    });

    test("contains 'invariant coverage' check", () => {
      const content = generateOrchestrateCommand();
      expect(content.toLowerCase()).toContain("invariant coverage");
    });
  });
});
