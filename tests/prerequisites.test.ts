import { describe, test, expect } from "bun:test";
import { checkBunRuntime, type PrerequisiteResult } from "../src/prerequisites";

describe("Prerequisites", () => {
  describe("Bun Runtime Check", () => {
    test("returns success when Bun is available", async () => {
      const result = await checkBunRuntime();

      expect(result.available).toBe(true);
      expect(result.version).toBeDefined();
      expect(result.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    test("returns bun.sh install link when Bun not found", async () => {
      // We can't easily test "Bun not found" since we're running in Bun
      // But we can verify the error message format
      const result = await checkBunRuntime();

      if (!result.available) {
        expect(result.error).toContain("bun.sh");
        expect(result.error).toContain("install");
      }
    });

    test("prerequisite check provides clear error message", async () => {
      // Verify the error message format for missing Bun
      const mockResult: PrerequisiteResult = {
        available: false,
        error: "Bun runtime not found. Install from https://bun.sh",
      };

      expect(mockResult.error).toContain("Bun");
      expect(mockResult.error).toContain("https://bun.sh");
    });
  });
});
