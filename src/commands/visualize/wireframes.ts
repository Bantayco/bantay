/**
 * Wireframe loading utilities
 */

import { join } from "path";
import { readFile } from "fs/promises";
import type { WireframeMap } from "./types";

/**
 * Load wireframe HTML files from wireframes/ directory
 */
export async function loadWireframes(projectPath: string): Promise<WireframeMap> {
  const wireframes: WireframeMap = {};
  const wireframesDir = join(projectPath, "wireframes");

  try {
    const { readdir } = await import("fs/promises");
    const entries = await readdir(wireframesDir).catch(() => []);

    for (const entry of entries) {
      if (entry.endsWith(".html")) {
        const compId = entry.replace(".html", "");
        const content = await readFile(join(wireframesDir, entry), "utf-8");
        wireframes[compId] = content;
      }
    }
  } catch {
    // wireframes directory doesn't exist, return empty map
  }

  return wireframes;
}
