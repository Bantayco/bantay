import { readFile, access, readdir } from "fs/promises";
import { join } from "path";
import type { FrameworkDetection } from "./types";

export interface NextjsDetector {
  name: "nextjs";
  detect(projectPath: string): Promise<FrameworkDetection | null>;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function dirExists(path: string): Promise<boolean> {
  try {
    await access(path);
    const entries = await readdir(path);
    return entries.length >= 0; // It's a directory if readdir works
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

export async function detect(projectPath: string): Promise<FrameworkDetection | null> {
  const pkg = await readPackageJson(projectPath);

  let version: string | undefined;
  let confidence: "high" | "medium" | "low" = "low";
  let detected = false;

  // Check package.json for next dependency
  if (pkg) {
    const deps = (pkg.dependencies ?? {}) as Record<string, string>;
    const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;

    if (deps.next) {
      version = deps.next;
      confidence = "high";
      detected = true;
    } else if (devDeps.next) {
      version = devDeps.next;
      confidence = "high";
      detected = true;
    }
  }

  // Check for next.config.js or next.config.mjs
  const configFiles = ["next.config.js", "next.config.mjs", "next.config.ts"];
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

  // Detect router type
  let router: "app" | "pages" | undefined;

  const hasAppDir = await dirExists(join(projectPath, "app"));
  const hasPagesDir = await dirExists(join(projectPath, "pages"));
  const hasSrcAppDir = await dirExists(join(projectPath, "src", "app"));
  const hasSrcPagesDir = await dirExists(join(projectPath, "src", "pages"));

  if (hasAppDir || hasSrcAppDir) {
    router = "app";
  } else if (hasPagesDir || hasSrcPagesDir) {
    router = "pages";
  }

  return {
    name: "nextjs",
    version,
    confidence,
    router,
  };
}
