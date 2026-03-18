import { readFile, access, readdir } from "fs/promises";
import { join } from "path";
import type { PaymentsDetection } from "./types";

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

async function findWebhookPattern(projectPath: string): Promise<string | undefined> {
  // Check common webhook locations
  const patterns = [
    { path: "app/api/webhooks/stripe/route.ts", pattern: "app/api/webhooks/stripe/route.ts" },
    { path: "app/api/webhook/stripe/route.ts", pattern: "app/api/webhook/stripe/route.ts" },
    { path: "app/api/stripe/webhook/route.ts", pattern: "app/api/stripe/webhook/route.ts" },
    { path: "app/webhooks/stripe/route.ts", pattern: "app/webhooks/stripe/route.ts" },
    { path: "src/app/api/webhooks/stripe/route.ts", pattern: "src/app/api/webhooks/stripe/route.ts" },
    { path: "pages/api/webhooks/stripe.ts", pattern: "pages/api/webhooks/stripe.ts" },
    { path: "pages/api/webhook/stripe.ts", pattern: "pages/api/webhook/stripe.ts" },
  ];

  for (const { path, pattern } of patterns) {
    if (await fileExists(join(projectPath, path))) {
      return pattern;
    }
  }

  return undefined;
}

export async function detect(projectPath: string): Promise<PaymentsDetection | null> {
  const pkg = await readPackageJson(projectPath);

  let version: string | undefined;
  let confidence: "high" | "medium" | "low" = "low";
  let detected = false;

  // Check package.json for stripe dependency
  if (pkg) {
    const deps = (pkg.dependencies ?? {}) as Record<string, string>;
    const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;

    if (deps.stripe) {
      version = deps.stripe;
      confidence = "high";
      detected = true;
    } else if (devDeps.stripe) {
      version = devDeps.stripe;
      confidence = "medium";
      detected = true;
    }

    // Also check for @stripe/stripe-js (client-side)
    if (deps["@stripe/stripe-js"] || devDeps["@stripe/stripe-js"]) {
      detected = true;
      if (confidence === "low") {
        confidence = "medium";
      }
    }
  }

  if (!detected) {
    return null;
  }

  const webhookPattern = await findWebhookPattern(projectPath);

  return {
    name: "stripe",
    version,
    confidence,
    webhookPattern,
    secretEnvVar: "STRIPE_SECRET_KEY",
  };
}
