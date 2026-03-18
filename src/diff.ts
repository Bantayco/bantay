import { join } from "path";

export interface DiffResult {
  changedFiles: string[];
  categories: Set<string>;
}

// Maps file patterns to invariant categories they affect
const FILE_CATEGORY_MAP: Array<{ pattern: RegExp; category: string }> = [
  // Route files affect auth invariants
  { pattern: /\/(api|routes)\/.*\.(ts|tsx|js|jsx)$/, category: "auth" },
  { pattern: /route\.(ts|tsx|js|jsx)$/, category: "auth" },
  { pattern: /page\.(ts|tsx|js|jsx)$/, category: "auth" },

  // Schema/migration files affect schema invariants
  { pattern: /schema\.prisma$/, category: "schema" },
  { pattern: /migrations?\//, category: "schema" },
  { pattern: /\.sql$/, category: "schema" },

  // Log-related files affect logging invariants
  { pattern: /log(ger)?\./, category: "logging" },
  { pattern: /console\./, category: "logging" },
];

export async function getGitDiff(
  projectPath: string,
  ref: string = "HEAD"
): Promise<DiffResult> {
  const changedFiles: string[] = [];
  const categories = new Set<string>();

  try {
    // Get list of changed files
    const proc = Bun.spawn(["git", "diff", "--name-only", ref], {
      cwd: projectPath,
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      // Also try with staged files for uncommitted changes
      const stagedProc = Bun.spawn(["git", "diff", "--name-only", "--cached"], {
        cwd: projectPath,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stagedOutput = await new Response(stagedProc.stdout).text();
      await stagedProc.exited;

      const unstagedProc = Bun.spawn(["git", "diff", "--name-only"], {
        cwd: projectPath,
        stdout: "pipe",
        stderr: "pipe",
      });
      const unstagedOutput = await new Response(unstagedProc.stdout).text();
      await unstagedProc.exited;

      const files = new Set([
        ...stagedOutput.trim().split("\n").filter(Boolean),
        ...unstagedOutput.trim().split("\n").filter(Boolean),
      ]);

      changedFiles.push(...files);
    } else {
      changedFiles.push(...output.trim().split("\n").filter(Boolean));
    }

    // Also include untracked files that are new
    const untrackedProc = Bun.spawn(
      ["git", "ls-files", "--others", "--exclude-standard"],
      {
        cwd: projectPath,
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    const untrackedOutput = await new Response(untrackedProc.stdout).text();
    await untrackedProc.exited;

    const untrackedFiles = untrackedOutput.trim().split("\n").filter(Boolean);
    for (const file of untrackedFiles) {
      if (!changedFiles.includes(file)) {
        changedFiles.push(file);
      }
    }

    // Determine which categories are affected
    for (const file of changedFiles) {
      for (const { pattern, category } of FILE_CATEGORY_MAP) {
        if (pattern.test(file)) {
          categories.add(category);
        }
      }
    }

    // If no specific categories matched but there are changes, include all
    // This ensures we don't miss invariants for file types we don't recognize
    if (changedFiles.length > 0 && categories.size === 0) {
      // Default: check all categories when we can't determine specifics
      categories.add("*");
    }

    return { changedFiles, categories };
  } catch {
    // Not a git repo or git not available - check everything
    return { changedFiles: [], categories: new Set(["*"]) };
  }
}

export function shouldCheckInvariant(
  invariantCategory: string,
  affectedCategories: Set<string>
): boolean {
  // If "*" is in affected categories, check everything
  if (affectedCategories.has("*")) {
    return true;
  }

  // Check if this invariant's category is affected
  return affectedCategories.has(invariantCategory);
}
