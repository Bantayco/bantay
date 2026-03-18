import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { generateConfig, parseConfig, type BantayConfig } from "../src/generators/config";
import type { StackDetectionResult } from "../src/detectors";

describe("Config Generation", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "bantay-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("Next.js + Prisma Config", () => {
    const stack: StackDetectionResult = {
      framework: { name: "nextjs", version: "14.0.0", confidence: "high", router: "app" },
      orm: { name: "prisma", version: "5.0.0", confidence: "high", schemaPath: "prisma/schema.prisma" },
      auth: null,
    };

    test("generates config with source directories", async () => {
      const config = await generateConfig(stack, testDir);

      expect(config.source).toBeDefined();
      expect(config.source.include).toContain("src/**/*");
    });

    test("generates config with detected schema path", async () => {
      const config = await generateConfig(stack, testDir);

      expect(config.schema).toBeDefined();
      expect(config.schema?.prisma).toBe("prisma/schema.prisma");
    });

    test("generates config with route definitions for app router", async () => {
      const config = await generateConfig(stack, testDir);

      expect(config.routes).toBeDefined();
      expect(config.routes?.include).toContain("app/**/route.ts");
      expect(config.routes?.include).toContain("app/**/route.js");
    });

    test("generates config with route definitions for pages router", async () => {
      const pagesStack: StackDetectionResult = {
        framework: { name: "nextjs", version: "14.0.0", confidence: "high", router: "pages" },
        orm: null,
        auth: null,
      };

      const config = await generateConfig(pagesStack, testDir);

      expect(config.routes?.include).toContain("pages/api/**/*.ts");
      expect(config.routes?.include).toContain("pages/api/**/*.js");
    });
  });

  describe("YAML Output", () => {
    test("generates valid YAML string", async () => {
      const stack: StackDetectionResult = {
        framework: { name: "nextjs", confidence: "high", router: "app" },
        orm: { name: "prisma", confidence: "high", schemaPath: "prisma/schema.prisma" },
        auth: null,
      };

      const config = await generateConfig(stack, testDir);
      const yaml = configToYaml(config);

      // Should be parseable
      const parsed = parseConfig(yaml);
      expect(parsed.source.include).toEqual(config.source.include);
    });

    test("YAML includes comments for guidance", async () => {
      const stack: StackDetectionResult = {
        framework: { name: "nextjs", confidence: "high" },
        orm: null,
        auth: null,
      };

      const config = await generateConfig(stack, testDir);
      const yaml = configToYaml(config);

      expect(yaml).toContain("#");
    });
  });

  describe("Empty Stack Config", () => {
    test("generates config with placeholder paths for empty stack", async () => {
      const emptyStack: StackDetectionResult = {
        framework: null,
        orm: null,
        auth: null,
      };

      const config = await generateConfig(emptyStack, testDir);

      expect(config.source).toBeDefined();
      expect(config.source.include).toContain("src/**/*");
    });
  });

  describe("Config Parsing", () => {
    test("parseConfig extracts all fields from YAML", () => {
      const yaml = `
# Bantay configuration
source:
  include:
    - src/**/*
    - app/**/*
  exclude:
    - node_modules/**
    - .next/**

schema:
  prisma: prisma/schema.prisma

routes:
  include:
    - app/**/route.ts
`;

      const config = parseConfig(yaml);

      expect(config.source.include).toContain("src/**/*");
      expect(config.source.exclude).toContain("node_modules/**");
      expect(config.schema?.prisma).toBe("prisma/schema.prisma");
      expect(config.routes?.include).toContain("app/**/route.ts");
    });
  });
});

// Helper imported from generator
import { configToYaml } from "../src/generators/config";
