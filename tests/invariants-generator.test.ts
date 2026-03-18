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
      framework: { name: "nextjs", version: "14.0.0", confidence: "high", router: "app", routePattern: "app/api/**/route.ts" },
      orm: { name: "prisma", version: "5.0.0", confidence: "high", schemaPath: "prisma/schema.prisma" },
      auth: null,
      payments: null,
    };

    test("generates route auth invariant with specific file pattern", async () => {
      const content = await generateInvariants(nextjsPrismaStack);

      expect(content).toContain("app/api/**/route.ts");
      expect(content).toContain("inv_route_auth");
    });

    test("generates timestamps invariant with schema path", async () => {
      const content = await generateInvariants(nextjsPrismaStack);

      expect(content).toContain("prisma/schema.prisma");
      expect(content).toContain("createdAt");
      expect(content).toContain("updatedAt");
    });

    test("generates soft-delete invariant", async () => {
      const content = await generateInvariants(nextjsPrismaStack);

      expect(content).toContain("deletedAt");
      expect(content).toContain("soft-delete");
    });

    test("generates no-raw-sql invariant with specific method names", async () => {
      const content = await generateInvariants(nextjsPrismaStack);

      expect(content).toContain("$queryRaw");
      expect(content).toContain("$executeRaw");
    });
  });

  describe("Next.js + Auth.js Stack", () => {
    const authjsStack: StackDetectionResult = {
      framework: { name: "nextjs", version: "14.0.0", confidence: "high", router: "app", routePattern: "app/api/**/route.ts" },
      orm: null,
      auth: { name: "authjs", confidence: "high", authFunction: "auth", sessionFunction: "auth()" },
      payments: null,
    };

    test("generates auth invariant with auth() function call", async () => {
      const content = await generateInvariants(authjsStack);

      expect(content).toContain("auth()");
      expect(content).toContain("session");
    });

    test("generates server action auth invariant", async () => {
      const content = await generateInvariants(authjsStack);

      expect(content).toContain("server action");
      expect(content).toContain("use server");
    });

    test("generates middleware matcher invariant", async () => {
      const content = await generateInvariants(authjsStack);

      expect(content).toContain("middleware.ts");
      expect(content).toContain("config.matcher");
    });
  });

  describe("Next.js + Clerk Stack", () => {
    const clerkStack: StackDetectionResult = {
      framework: { name: "nextjs", version: "14.0.0", confidence: "high", router: "app", routePattern: "app/api/**/route.ts" },
      orm: null,
      auth: { name: "clerk", confidence: "high", authFunction: "auth", sessionFunction: "auth()" },
      payments: null,
    };

    test("generates auth invariant with @clerk/nextjs reference", async () => {
      const content = await generateInvariants(clerkStack);

      expect(content).toContain("@clerk/nextjs");
      expect(content).toContain("auth()");
    });
  });

  describe("Stripe Stack", () => {
    const stripeStack: StackDetectionResult = {
      framework: { name: "nextjs", version: "14.0.0", confidence: "high", router: "app" },
      orm: null,
      auth: null,
      payments: { name: "stripe", confidence: "high", webhookPattern: "app/api/webhooks/stripe/route.ts", secretEnvVar: "STRIPE_SECRET_KEY" },
    };

    test("generates webhook signature verification invariant", async () => {
      const content = await generateInvariants(stripeStack);

      expect(content).toContain("constructEvent");
      expect(content).toContain("STRIPE_WEBHOOK_SECRET");
    });

    test("generates server-only secret key invariant", async () => {
      const content = await generateInvariants(stripeStack);

      expect(content).toContain("STRIPE_SECRET_KEY");
      expect(content).toContain("server-side");
    });

    test("generates idempotency key invariant", async () => {
      const content = await generateInvariants(stripeStack);

      expect(content).toContain("idempotencyKey");
    });
  });

  describe("Drizzle Stack", () => {
    const drizzleStack: StackDetectionResult = {
      framework: { name: "nextjs", version: "14.0.0", confidence: "high", router: "app" },
      orm: { name: "drizzle", confidence: "high", schemaPath: "src/db/schema.ts" },
      auth: null,
      payments: null,
    };

    test("generates timestamps invariant with Drizzle syntax", async () => {
      const content = await generateInvariants(drizzleStack);

      expect(content).toContain("src/db/schema.ts");
      expect(content).toContain("timestamp()");
      expect(content).toContain("defaultNow");
    });
  });

  describe("Invariant Structure", () => {
    const minimalStack: StackDetectionResult = {
      framework: { name: "nextjs", confidence: "high", router: "app" },
      orm: null,
      auth: null,
      payments: null,
    };

    test("each invariant has a unique stable ID", async () => {
      const content = await generateInvariants(minimalStack);
      const invariants = parseInvariants(content);

      const ids = invariants.map((inv) => inv.id);
      const uniqueIds = new Set(ids);

      expect(ids.length).toBeGreaterThan(0);
      expect(uniqueIds.size).toBe(ids.length);
    });

    test("invariant IDs follow inv_xxx format", async () => {
      const content = await generateInvariants(minimalStack);
      const invariants = parseInvariants(content);

      for (const inv of invariants) {
        expect(inv.id).toMatch(/^inv_[a-z_]+$/);
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
      const content = await generateInvariants(minimalStack);

      // Should have a title
      expect(content).toContain("# ");
      // Should have invariant sections
      expect(content).toContain("## ");
    });

    test("includes detected stack summary", async () => {
      const fullStack: StackDetectionResult = {
        framework: { name: "nextjs", confidence: "high", router: "app" },
        orm: { name: "prisma", confidence: "high" },
        auth: { name: "clerk", confidence: "high" },
        payments: { name: "stripe", confidence: "high" },
      };

      const content = await generateInvariants(fullStack);

      expect(content).toContain("Detected stack:");
      expect(content).toContain("nextjs");
      expect(content).toContain("prisma");
      expect(content).toContain("clerk");
      expect(content).toContain("stripe");
    });
  });

  describe("Empty/Unknown Stack", () => {
    test("generates minimal invariants for empty stack", async () => {
      const emptyStack: StackDetectionResult = {
        framework: null,
        orm: null,
        auth: null,
        payments: null,
      };

      const content = await generateInvariants(emptyStack);
      const invariants = parseInvariants(content);

      // Should still have at least one invariant (env security)
      expect(invariants.length).toBeGreaterThan(0);
      expect(content).toContain(".env");
    });
  });

  describe("Parsing", () => {
    test("parseInvariants extracts old format invariants", async () => {
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
    });

    test("parseInvariants extracts new aide format invariants", async () => {
      const markdown = `# Project Invariants

## Auth

- [ ] **inv_route_auth**: Every app/api/**/route.ts calls auth()

## Schema

- [ ] **inv_model_timestamps**: Every model has createdAt and updatedAt
`;

      const invariants = parseInvariants(markdown);

      expect(invariants).toHaveLength(2);
      expect(invariants[0]).toEqual({
        id: "inv_route_auth",
        category: "auth",
        statement: "Every app/api/**/route.ts calls auth()",
      });
      expect(invariants[1]).toEqual({
        id: "inv_model_timestamps",
        category: "schema",
        statement: "Every model has createdAt and updatedAt",
      });
    });
  });
});
