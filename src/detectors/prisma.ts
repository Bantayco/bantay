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

export async function detect(projectPath: string): Promise<OrmDetection | null> {
  const pkg = await readPackageJson(projectPath);

  let version: string | undefined;
  let confidence: "high" | "medium" | "low" = "low";
  let detected = false;

  // Check package.json for prisma dependencies
  if (pkg) {
    const deps = (pkg.dependencies ?? {}) as Record<string, string>;
    const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;

    if (deps["@prisma/client"]) {
      version = deps["@prisma/client"];
      confidence = "high";
      detected = true;
    }

    if (devDeps.prisma) {
      version = version ?? devDeps.prisma;
      confidence = "high";
      detected = true;
    }
  }

  if (!detected) {
    return null;
  }

  // Find schema path
  let schemaPath: string | undefined;

  // Check for custom path in package.json
  if (pkg?.prisma && typeof pkg.prisma === "object") {
    const prismaConfig = pkg.prisma as Record<string, unknown>;
    if (typeof prismaConfig.schema === "string") {
      const customPath = prismaConfig.schema;
      if (await fileExists(join(projectPath, customPath))) {
        schemaPath = customPath;
      }
    }
  }

  // Check default location if no custom path
  if (!schemaPath) {
    const defaultPath = "prisma/schema.prisma";
    if (await fileExists(join(projectPath, defaultPath))) {
      schemaPath = defaultPath;
    }
  }

  return {
    name: "prisma",
    version,
    confidence,
    schemaPath,
  };
}
