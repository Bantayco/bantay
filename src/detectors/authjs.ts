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
  let authFunction: string | undefined;
  let sessionFunction: string | undefined;

  if (pkg) {
    const deps = (pkg.dependencies ?? {}) as Record<string, string>;
    const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;

    // Check for next-auth (Auth.js v4)
    if (deps["next-auth"]) {
      version = deps["next-auth"];
      confidence = "high";
      detected = true;
      authFunction = "getServerSession";
      sessionFunction = "getServerSession(authOptions)";
    }

    // Check for @auth/nextjs (Auth.js v5)
    if (deps["@auth/nextjs-auth"]) {
      version = deps["@auth/nextjs-auth"];
      confidence = "high";
      detected = true;
      authFunction = "auth";
      sessionFunction = "auth()";
    }

    // Check for auth.js v5 with new package name
    if (deps["next-auth"] && version?.startsWith("5")) {
      authFunction = "auth";
      sessionFunction = "auth()";
    }
  }

  // Check for auth config files
  const configFiles = [
    "auth.ts",
    "auth.config.ts",
    "lib/auth.ts",
    "src/auth.ts",
    "src/lib/auth.ts",
    "app/api/auth/[...nextauth]/route.ts",
  ];

  for (const configFile of configFiles) {
    if (await fileExists(join(projectPath, configFile))) {
      detected = true;
      if (confidence === "low") {
        confidence = "medium";
      }
      break;
    }
  }

  if (!detected) {
    return null;
  }

  return {
    name: "authjs",
    version,
    confidence,
    authFunction,
    sessionFunction,
  };
}
