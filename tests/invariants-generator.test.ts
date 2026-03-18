import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { generateInvariants, type Invariant, parseInvariants } from "../src/generators/invariants";
import type { StackDetectionResult } from "../src/detectors";

describe("Invariants Generation", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "bantay-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("Next.js + Prisma Stack", () => {
    const nextjsPrismaStack: StackDetectionResult = {
      framework: { name: "nextjs", version: "14.0.0", confidence: "high", router: "app" },
      orm: { name: "prisma", version: "5.0.0", confidence: "high", schemaPath: "prisma/schema.prisma" },
      auth: null,
    };

    test("generates auth-on-routes invariant", async () => {
      const content = await generateInvariants(nextjsPrismaStack);

      expect(content).toContain("auth-on-routes");
      expect(content).toContain("route");
    });

    test("generates timestamps-on-tables invariant", async () => {
      const content = await generateInvariants(nextjsPrismaStack);

      expect(content).toContain("timestamps-on-tables");
      expect(content).toContain("createdAt");
      expect(content).toContain("updatedAt");
    });

    test("generates soft-deletes invariant", async () => {
      const content = await generateInvariants(nextjsPrismaStack);

      expect(content).toContain("soft-delete");
    });

    test("generates no-raw-sql invariant", async () => {
      const content = await generateInvariants(nextjsPrismaStack);

      expect(content).toContain("no-raw-sql");
    });
  });

  describe("Invariant Structure", () => {
    const minimalStack: StackDetectionResult = {
      framework: { name: "nextjs", confidence: "high" },
      orm: null,
      auth: null,
    };

    test("each invariant has a unique stable ID", async () => {
      const content = await generateInvariants(minimalStack);
      const invariants = parseInvariants(content);

      const ids = invariants.map((inv) => inv.id);
      const uniqueIds = new Set(ids);

      expect(ids.length).toBeGreaterThan(0);
      expect(uniqueIds.size).toBe(ids.length);
    });

    test("invariant IDs follow INV-XXX format", async () => {
      const content = await generateInvariants(minimalStack);
      const invariants = parseInvariants(content);

      for (const inv of invariants) {
        expect(inv.id).toMatch(/^INV-\d{3}$/);
      }
    });

    test("each invariant has a category", async () => {
      const content = await generateInvariants(minimalStack);
      const invariants = parseInvariants(content);

      for (const inv of invariants) {
        expect(inv.category).toBeDefined();
        expect(inv.category.length).toBeGreaterThan(0);
      }
    });

    test("invariants are valid markdown", async () => {
      const minimalStack: StackDetectionResult = {
        framework: { name: "nextjs", confidence: "high" },
        orm: null,
        auth: null,
      };

      const content = await generateInvariants(minimalStack);

      // Should have a title
      expect(content).toContain("# ");
      // Should have invariant sections
      expect(content).toContain("## ");
    });
  });

  describe("Empty/Unknown Stack", () => {
    test("generates universal defaults for empty stack", async () => {
      const emptyStack: StackDetectionResult = {
        framework: null,
        orm: null,
        auth: null,
      };

      const content = await generateInvariants(emptyStack);
      const invariants = parseInvariants(content);

      // Should still have some universal invariants
      expect(invariants.length).toBeGreaterThan(0);
    });
  });

  describe("Parsing", () => {
    test("parseInvariants extracts all invariants from markdown", async () => {
      const markdown = `# Project Invariants

## Authentication
- [INV-001] auth | All API routes must check authentication

## Database
- [INV-002] schema | All tables must have createdAt and updatedAt timestamps
- [INV-003] schema | No raw SQL queries allowed
`;

      const invariants = parseInvariants(markdown);

      expect(invariants).toHaveLength(3);
      expect(invariants[0]).toEqual({
        id: "INV-001",
        category: "auth",
        statement: "All API routes must check authentication",
      });
      expect(invariants[1]).toEqual({
        id: "INV-002",
        category: "schema",
        statement: "All tables must have createdAt and updatedAt timestamps",
      });
    });
  });
});
