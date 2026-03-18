import { readFile, access } from "fs/promises";
import { join } from "path";
import type { AuthDetection } from "./types";

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

export async function detect(projectPath: string): Promise<AuthDetection | null> {
  const pkg = await readPackageJson(projectPath);

  let version: string | undefined;
  let confidence: "high" | "medium" | "low" = "low";
  let detected = false;

  if (pkg) {
    const deps = (pkg.dependencies ?? {}) as Record<string, string>;
    const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;

    // Check for @clerk/nextjs
    if (deps["@clerk/nextjs"]) {
      version = deps["@clerk/nextjs"];
      confidence = "high";
      detected = true;
    } else if (devDeps["@clerk/nextjs"]) {
      version = devDeps["@clerk/nextjs"];
      confidence = "medium";
      detected = true;
    }

    // Check for @clerk/clerk-sdk-node
    if (deps["@clerk/clerk-sdk-node"] || devDeps["@clerk/clerk-sdk-node"]) {
      detected = true;
      if (confidence === "low") {
        confidence = "high";
      }
    }
  }

  // Check for Clerk middleware
  const middlewareFiles = [
    "middleware.ts",
    "middleware.js",
    "src/middleware.ts",
    "src/middleware.js",
  ];

  for (const middlewareFile of middlewareFiles) {
    if (await fileExists(join(projectPath, middlewareFile))) {
      try {
        const content = await readFile(join(projectPath, middlewareFile), "utf-8");
        if (content.includes("@clerk") || content.includes("clerkMiddleware") || content.includes("authMiddleware")) {
          detected = true;
          confidence = "high";
          break;
        }
      } catch {
        // Ignore read errors
      }
    }
  }

  if (!detected) {
    return null;
  }

  return {
    name: "clerk",
    version,
    confidence,
    authFunction: "auth",
    sessionFunction: "auth()",
  };
}
