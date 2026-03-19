import { readdir } from "fs/promises";
import { join } from "path";

export interface DiscoveryResult {
  found: string[];
  error?: string;
}

export interface ResolvedAidePath {
  path: string;
  filename: string;
}

/**
 * Discover .aide files in a directory
 */
export async function discoverAideFiles(cwd: string): Promise<DiscoveryResult> {
  try {
    const files = await readdir(cwd);
    const aideFiles = files.filter((f) => f.endsWith(".aide"));
    return { found: aideFiles };
  } catch (error) {
    return { found: [], error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Resolve the aide file path for a project directory
 * - If explicitPath is provided, use it
 * - Otherwise, glob for *.aide in projectPath
 * - If exactly one found, use it
 * - If multiple found, throw error
 * - If none found, throw error
 *
 * @param projectPath - The project directory to search in
 * @param explicitPath - Optional explicit path to an aide file
 * @returns The resolved aide file path
 * @throws Error if no aide file found or multiple found without explicit path
 */
export async function resolveAidePath(
  projectPath: string,
  explicitPath?: string
): Promise<ResolvedAidePath> {
  // If explicit path provided, use it
  if (explicitPath) {
    const fullPath = explicitPath.startsWith("/")
      ? explicitPath
      : join(projectPath, explicitPath);
    const filename = explicitPath.split("/").pop() || explicitPath;
    return { path: fullPath, filename };
  }

  // Auto-discover
  const { found, error } = await discoverAideFiles(projectPath);

  if (error) {
    throw new Error(`Error discovering aide files: ${error}`);
  }

  if (found.length === 0) {
    throw new Error("No .aide file found. Run 'bantay aide init' to create one.");
  }

  if (found.length > 1) {
    throw new Error(
      `Multiple .aide files found. Specify one with --aide <path>\nFound: ${found.join(", ")}`
    );
  }

  return {
    path: join(projectPath, found[0]),
    filename: found[0],
  };
}

/**
 * Try to resolve aide path, returning null if not found (non-throwing version)
 */
export async function tryResolveAidePath(
  projectPath: string,
  explicitPath?: string
): Promise<ResolvedAidePath | null> {
  try {
    return await resolveAidePath(projectPath, explicitPath);
  } catch {
    return null;
  }
}
