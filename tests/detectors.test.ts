import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { detectStack, type StackDetectionResult } from "../src/detectors";

describe("Stack Detection", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "bantay-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("Next.js Detection", () => {
    test("detects Next.js from package.json dependency", async () => {
      await writeFile(
        join(testDir, "package.json"),
        JSON.stringify({
          dependencies: { next: "14.0.0" },
        })
      );

      const result = await detectStack(testDir);

      expect(result.framework?.name).toBe("nextjs");
      expect(result.framework?.version).toBe("14.0.0");
      expect(result.framework?.confidence).toBe("high");
    });

    test("detects Next.js from next.config.js", async () => {
      await writeFile(
        join(testDir, "package.json"),
        JSON.stringify({ dependencies: {} })
      );
      await writeFile(
        join(testDir, "next.config.js"),
        "module.exports = { reactStrictMode: true };"
      );

      const result = await detectStack(testDir);

      expect(result.framework?.name).toBe("nextjs");
      expect(result.framework?.confidence).toBe("high");
    });

    test("detects Next.js from next.config.mjs", async () => {
      await writeFile(
        join(testDir, "package.json"),
        JSON.stringify({ dependencies: {} })
      );
      await writeFile(
        join(testDir, "next.config.mjs"),
        "export default { reactStrictMode: true };"
      );

      const result = await detectStack(testDir);

      expect(result.framework?.name).toBe("nextjs");
    });

    test("detects Next.js app router from app directory", async () => {
      await writeFile(
        join(testDir, "package.json"),
        JSON.stringify({ dependencies: { next: "14.0.0" } })
      );
      await mkdir(join(testDir, "app"));
      await writeFile(join(testDir, "app", "page.tsx"), "export default function Home() {}");

      const result = await detectStack(testDir);

      expect(result.framework?.name).toBe("nextjs");
      expect(result.framework?.router).toBe("app");
    });

    test("detects Next.js pages router from pages directory", async () => {
      await writeFile(
        join(testDir, "package.json"),
        JSON.stringify({ dependencies: { next: "14.0.0" } })
      );
      await mkdir(join(testDir, "pages"));
      await writeFile(join(testDir, "pages", "index.tsx"), "export default function Home() {}");

      const result = await detectStack(testDir);

      expect(result.framework?.name).toBe("nextjs");
      expect(result.framework?.router).toBe("pages");
    });
  });

  describe("Prisma Detection", () => {
    test("detects Prisma from package.json dependency", async () => {
      await writeFile(
        join(testDir, "package.json"),
        JSON.stringify({
          dependencies: { "@prisma/client": "5.0.0" },
          devDependencies: { prisma: "5.0.0" },
        })
      );

      const result = await detectStack(testDir);

      expect(result.orm?.name).toBe("prisma");
      expect(result.orm?.version).toBe("5.0.0");
      expect(result.orm?.confidence).toBe("high");
    });

    test("detects Prisma schema file location", async () => {
      await writeFile(
        join(testDir, "package.json"),
        JSON.stringify({
          dependencies: { "@prisma/client": "5.0.0" },
        })
      );
      await mkdir(join(testDir, "prisma"));
      await writeFile(
        join(testDir, "prisma", "schema.prisma"),
        "generator client { provider = \"prisma-client-js\" }"
      );

      const result = await detectStack(testDir);

      expect(result.orm?.name).toBe("prisma");
      expect(result.orm?.schemaPath).toBe("prisma/schema.prisma");
    });

    test("detects custom Prisma schema location from package.json", async () => {
      await writeFile(
        join(testDir, "package.json"),
        JSON.stringify({
          dependencies: { "@prisma/client": "5.0.0" },
          prisma: { schema: "db/schema.prisma" },
        })
      );
      await mkdir(join(testDir, "db"));
      await writeFile(
        join(testDir, "db", "schema.prisma"),
        "generator client { provider = \"prisma-client-js\" }"
      );

      const result = await detectStack(testDir);

      expect(result.orm?.schemaPath).toBe("db/schema.prisma");
    });
  });

  describe("Combined Stack Detection", () => {
    test("detects Next.js + Prisma stack together", async () => {
      await writeFile(
        join(testDir, "package.json"),
        JSON.stringify({
          dependencies: {
            next: "14.0.0",
            "@prisma/client": "5.0.0",
          },
          devDependencies: {
            prisma: "5.0.0",
          },
        })
      );
      await mkdir(join(testDir, "app"));
      await writeFile(join(testDir, "app", "page.tsx"), "");
      await mkdir(join(testDir, "prisma"));
      await writeFile(join(testDir, "prisma", "schema.prisma"), "");

      const result = await detectStack(testDir);

      expect(result.framework?.name).toBe("nextjs");
      expect(result.orm?.name).toBe("prisma");
    });
  });

  describe("Stripe Detection", () => {
    test("detects Stripe from package.json dependency", async () => {
      await writeFile(
        join(testDir, "package.json"),
        JSON.stringify({
          dependencies: { stripe: "14.0.0" },
        })
      );

      const result = await detectStack(testDir);

      expect(result.payments?.name).toBe("stripe");
      expect(result.payments?.confidence).toBe("high");
    });

    test("detects Stripe webhook pattern", async () => {
      await writeFile(
        join(testDir, "package.json"),
        JSON.stringify({
          dependencies: { stripe: "14.0.0" },
        })
      );
      await mkdir(join(testDir, "app", "api", "webhooks", "stripe"), { recursive: true });
      await writeFile(
        join(testDir, "app", "api", "webhooks", "stripe", "route.ts"),
        "export async function POST() {}"
      );

      const result = await detectStack(testDir);

      expect(result.payments?.webhookPattern).toBe("app/api/webhooks/stripe/route.ts");
    });
  });

  describe("Auth.js Detection", () => {
    test("detects next-auth from package.json", async () => {
      await writeFile(
        join(testDir, "package.json"),
        JSON.stringify({
          dependencies: { "next-auth": "4.24.0" },
        })
      );

      const result = await detectStack(testDir);

      expect(result.auth?.name).toBe("authjs");
      expect(result.auth?.confidence).toBe("high");
    });
  });

  describe("Clerk Detection", () => {
    test("detects Clerk from package.json", async () => {
      await writeFile(
        join(testDir, "package.json"),
        JSON.stringify({
          dependencies: { "@clerk/nextjs": "4.29.0" },
        })
      );

      const result = await detectStack(testDir);

      expect(result.auth?.name).toBe("clerk");
      expect(result.auth?.confidence).toBe("high");
    });
  });

  describe("Drizzle Detection", () => {
    test("detects Drizzle from package.json", async () => {
      await writeFile(
        join(testDir, "package.json"),
        JSON.stringify({
          dependencies: { "drizzle-orm": "0.29.0" },
        })
      );

      const result = await detectStack(testDir);

      expect(result.orm?.name).toBe("drizzle");
      expect(result.orm?.confidence).toBe("high");
    });

    test("detects Drizzle schema location", async () => {
      await writeFile(
        join(testDir, "package.json"),
        JSON.stringify({
          dependencies: { "drizzle-orm": "0.29.0" },
        })
      );
      await mkdir(join(testDir, "src", "db"), { recursive: true });
      await writeFile(
        join(testDir, "src", "db", "schema.ts"),
        "export const users = pgTable('users', {});"
      );

      const result = await detectStack(testDir);

      expect(result.orm?.schemaPath).toBe("src/db/schema.ts");
    });
  });

  describe("Empty/Unknown Project", () => {
    test("returns null detections for empty directory", async () => {
      const result = await detectStack(testDir);

      expect(result.framework).toBeNull();
      expect(result.orm).toBeNull();
      expect(result.auth).toBeNull();
      expect(result.payments).toBeNull();
    });

    test("returns null detections for project with no recognized framework", async () => {
      await writeFile(
        join(testDir, "package.json"),
        JSON.stringify({
          dependencies: { lodash: "4.0.0" },
        })
      );

      const result = await detectStack(testDir);

      expect(result.framework).toBeNull();
    });
  });

  describe("Detection Speed", () => {
    test("completes detection in under 1 second for simple project", async () => {
      await writeFile(
        join(testDir, "package.json"),
        JSON.stringify({
          dependencies: { next: "14.0.0", "@prisma/client": "5.0.0" },
        })
      );

      const start = performance.now();
      await detectStack(testDir);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(1000);
    });
  });
});
