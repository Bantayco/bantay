import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir, readFile, access } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { runInit, type InitResult } from "../src/commands/init";

describe("Init Command", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "bantay-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("Full Integration", () => {
    test("creates invariants.md and bantay.config.yml for Next.js + Prisma project", async () => {
      // Setup Next.js + Prisma project
      await writeFile(
        join(testDir, "package.json"),
        JSON.stringify({
          dependencies: { next: "14.0.0", "@prisma/client": "5.0.0" },
          devDependencies: { prisma: "5.0.0" },
        })
      );
      await mkdir(join(testDir, "app"));
      await writeFile(join(testDir, "app", "page.tsx"), "");
      await mkdir(join(testDir, "prisma"));
      await writeFile(join(testDir, "prisma", "schema.prisma"), "");

      const result = await runInit(testDir);

      expect(result.success).toBe(true);
      expect(result.filesCreated).toContain("invariants.md");
      expect(result.filesCreated).toContain("bantay.config.yml");

      // Verify content (will fail if files don't exist)
      const invariantsPath = join(testDir, "invariants.md");
      const configPath = join(testDir, "bantay.config.yml");
      const invariantsContent = await readFile(invariantsPath, "utf-8");
      expect(invariantsContent).toContain("inv_route_auth");
      expect(invariantsContent).toContain("app/api/**/route.ts");
      expect(invariantsContent).toContain("inv_model_timestamps");
      expect(invariantsContent).toContain("prisma/schema.prisma");

      const configContent = await readFile(configPath, "utf-8");
      expect(configContent).toContain("prisma/schema.prisma");
    });

    test("displays detection results", async () => {
      await writeFile(
        join(testDir, "package.json"),
        JSON.stringify({
          dependencies: { next: "14.0.0" },
        })
      );

      const result = await runInit(testDir);

      expect(result.detection).toBeDefined();
      expect(result.detection.framework?.name).toBe("nextjs");
    });
  });

  describe("Empty Directory", () => {
    test("warns when no framework detected", async () => {
      const result = await runInit(testDir);

      expect(result.success).toBe(true);
      expect(result.warnings).toContain("No framework detected");
    });

    test("generates minimal invariants.md with universal defaults", async () => {
      const result = await runInit(testDir);

      expect(result.filesCreated).toContain("invariants.md");

      const content = await readFile(join(testDir, "invariants.md"), "utf-8");
      expect(content).toContain("# Project Invariants");
    });

    test("generates config with placeholder paths", async () => {
      const result = await runInit(testDir);

      expect(result.filesCreated).toContain("bantay.config.yml");

      const content = await readFile(join(testDir, "bantay.config.yml"), "utf-8");
      expect(content).toContain("src/**/*");
    });
  });

  describe("Already Initialized", () => {
    test("does NOT overwrite existing invariants.md", async () => {
      const existingContent = "# My Custom Invariants\n\n- [INV-999] custom | My rule";
      await writeFile(join(testDir, "invariants.md"), existingContent);

      const result = await runInit(testDir);

      expect(result.success).toBe(true);
      expect(result.filesCreated).not.toContain("invariants.md");
      expect(result.warnings).toContain("invariants.md already exists");

      // Verify content unchanged
      const content = await readFile(join(testDir, "invariants.md"), "utf-8");
      expect(content).toBe(existingContent);
    });

    test("offers to regenerate config only", async () => {
      await writeFile(join(testDir, "invariants.md"), "# Existing");
      await writeFile(
        join(testDir, "package.json"),
        JSON.stringify({ dependencies: { next: "14.0.0" } })
      );

      const result = await runInit(testDir, { regenerateConfig: true });

      expect(result.filesCreated).toContain("bantay.config.yml");
      expect(result.filesCreated).not.toContain("invariants.md");
    });
  });

  describe("Speed", () => {
    test("completes in under 1 second for simple project", async () => {
      await writeFile(
        join(testDir, "package.json"),
        JSON.stringify({
          dependencies: { next: "14.0.0", "@prisma/client": "5.0.0" },
        })
      );

      const start = performance.now();
      await runInit(testDir);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(1000);
    });
  });
});
