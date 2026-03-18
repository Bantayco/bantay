import type { Checker, CheckResult, CheckerContext, CheckViolation } from "./types";
import type { Invariant } from "../generators/invariants";
import { Glob } from "bun";
import { readFile } from "fs/promises";
import { join, relative } from "path";

// Auth patterns to look for in route files
const AUTH_PATTERNS = [
  // Next.js auth patterns
  /auth\(\)/,
  /getServerSession/,
  /useSession/,
  /withAuth/,
  /requireAuth/,
  /checkAuth/,
  /isAuthenticated/,
  /currentUser/,
  /getUser/,
  // Clerk patterns
  /auth\(\)\.protect/,
  /clerkMiddleware/,
  /SignedIn/,
  /SignedOut/,
  // Auth.js / NextAuth patterns
  /getSession/,
  /unstable_getServerSession/,
  // Supabase patterns
  /supabase\.auth/,
  /createServerClient/,
  // Generic patterns
  /middleware.*auth/i,
  /protected/i,
];

// Route handler exports that need auth
const ROUTE_EXPORTS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

async function findRouteFiles(
  projectPath: string,
  routeDirectories: string[]
): Promise<string[]> {
  const routeFiles: string[] = [];

  for (const routeDir of routeDirectories) {
    const pattern = "**/{route,page}.{ts,tsx,js,jsx}";
    const glob = new Glob(pattern);

    const dirPath = join(projectPath, routeDir);

    try {
      for await (const file of glob.scan({ cwd: dirPath, absolute: true })) {
        routeFiles.push(file);
      }
    } catch {
      // Directory doesn't exist, skip
    }
  }

  return routeFiles;
}

function hasAuthCheck(content: string): boolean {
  return AUTH_PATTERNS.some((pattern) => pattern.test(content));
}

function isApiRoute(content: string): boolean {
  // Check if file exports HTTP method handlers
  return ROUTE_EXPORTS.some((method) => {
    const pattern = new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\b`);
    return pattern.test(content);
  });
}

export const authChecker: Checker = {
  category: "auth",

  async check(invariant: Invariant, context: CheckerContext): Promise<CheckResult> {
    const violations: CheckViolation[] = [];
    const routeDirs = context.config.routeDirectories ?? ["app/api", "pages/api"];

    const routeFiles = await findRouteFiles(context.projectPath, routeDirs);

    for (const filePath of routeFiles) {
      try {
        const content = await readFile(filePath, "utf-8");

        // Only check API routes (files with HTTP method exports)
        if (!isApiRoute(content)) {
          continue;
        }

        // Check if any auth pattern is present
        if (!hasAuthCheck(content)) {
          violations.push({
            filePath: relative(context.projectPath, filePath),
            line: 1,
            message: "API route missing authentication check",
          });
        }
      } catch {
        // File read error, skip
      }
    }

    return {
      invariant,
      status: violations.length > 0 ? "fail" : "pass",
      violations,
    };
  },
};
