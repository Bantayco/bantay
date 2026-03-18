import { readFile, access } from "fs/promises";
import { join } from "path";
import type { OrmDetection } from "./types";

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readPackageJson(projectPath: string): Promise<Record<string, unknown> | null> {
  try {
    const content = await readFile(join(projectPath, "package.json"), "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function findSchemaPath(projectPath: string): Promise<string | undefined> {
  // Check common Drizzle schema locations
  const paths = [
    "drizzle/schema.ts",
    "src/db/schema.ts",
    "src/drizzle/schema.ts",
    "lib/db/schema.ts",
    "lib/drizzle/schema.ts",
    "db/schema.ts",
    "schema.ts",
    "src/schema.ts",
  ];

  for (const path of paths) {
    if (await fileExists(join(projectPath, path))) {
      return path;
    }
  }

  return undefined;
}

export async function detect(projectPath: string): Promise<OrmDetection | null> {
  const pkg = await readPackageJson(projectPath);

  let version: string | undefined;
  let confidence: "high" | "medium" | "low" = "low";
  let detected = false;

  if (pkg) {
    const deps = (pkg.dependencies ?? {}) as Record<string, string>;
    const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;

    // Check for drizzle-orm
    if (deps["drizzle-orm"]) {
      version = deps["drizzle-orm"];
      confidence = "high";
      detected = true;
    } else if (devDeps["drizzle-orm"]) {
      version = devDeps["drizzle-orm"];
      confidence = "medium";
      detected = true;
    }

    // Check for drizzle-kit (CLI tool)
    if (deps["drizzle-kit"] || devDeps["drizzle-kit"]) {
      detected = true;
      if (confidence === "low") {
        confidence = "high";
      }
    }
  }

  // Check for drizzle.config.ts
  const configFiles = [
    "drizzle.config.ts",
    "drizzle.config.js",
    "drizzle.config.json",
  ];

  for (const configFile of configFiles) {
    if (await fileExists(join(projectPath, configFile))) {
      detected = true;
      if (confidence === "low") {
        confidence = "high";
      }
      break;
    }
  }

  if (!detected) {
    return null;
  }

  const schemaPath = await findSchemaPath(projectPath);

  return {
    name: "drizzle",
    version,
    confidence,
    schemaPath,
  };
}
