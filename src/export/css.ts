/**
 * Export design tokens as CSS variables
 */

import { join } from "path";
import { readFile, writeFile } from "fs/promises";
import * as yaml from "js-yaml";
import { resolveAidePath } from "../aide/discovery";
import type { ExportOptions, ExportResult } from "./types";

interface AideEntity {
  display?: string;
  parent?: string;
  props?: Record<string, unknown>;
}

interface AideTree {
  entities: Record<string, AideEntity>;
  relationships: unknown[];
}

interface DesignToken {
  id: string;
  value: string;
}

/**
 * Extract design tokens from the aide tree.
 * Tokens are entities under design_system with a value prop.
 */
export function extractDesignTokens(tree: AideTree): DesignToken[] {
  const tokens: DesignToken[] = [];
  const entities = tree.entities || {};

  // Find all entities that are descendants of design_system and have a value prop
  // First, build parent chain lookup
  const parentChain = new Map<string, string[]>();

  function getAncestors(id: string): string[] {
    if (parentChain.has(id)) {
      return parentChain.get(id)!;
    }

    const entity = entities[id];
    if (!entity || !entity.parent) {
      parentChain.set(id, []);
      return [];
    }

    const ancestors = [entity.parent, ...getAncestors(entity.parent)];
    parentChain.set(id, ancestors);
    return ancestors;
  }

  // Find all token entities (those with value prop and design_system in ancestors)
  for (const [id, entity] of Object.entries(entities)) {
    if (!entity.props?.value) continue;

    const ancestors = getAncestors(id);
    if (ancestors.includes("design_system") || entity.parent === "design_system") {
      tokens.push({
        id,
        value: String(entity.props.value),
      });
    }
  }

  return tokens;
}

/**
 * Convert an entity ID to a CSS variable name.
 * Replaces underscores with dashes.
 */
export function tokenIdToCssVar(id: string): string {
  return `--${id.replace(/_/g, "-")}`;
}

/**
 * Generate CSS content from design tokens.
 */
export function generateCssContent(tokens: DesignToken[]): string {
  if (tokens.length === 0) {
    return "/* No design tokens found */\n:root {\n}\n";
  }

  const lines = tokens.map((token) => {
    const varName = tokenIdToCssVar(token.id);
    return `  ${varName}: ${token.value};`;
  });

  return `/* Design tokens exported from bantay.aide */\n:root {\n${lines.join("\n")}\n}\n`;
}

/**
 * Export CSS variables from design tokens in the aide.
 */
export async function exportCss(
  projectPath: string,
  options: ExportOptions = {}
): Promise<ExportResult> {
  // Resolve aide path
  const resolved = await resolveAidePath(projectPath, options.aidePath);
  const aidePath = resolved.path;

  // Parse aide file
  const aideContent = await readFile(aidePath, "utf-8");
  const aide = yaml.load(aideContent) as AideTree;

  // Extract design tokens
  const tokens = extractDesignTokens(aide);

  // Generate CSS content
  const content = generateCssContent(tokens);

  // Determine output path
  const outputPath = options.outputPath || join(projectPath, "bantay-tokens.css");

  // Write file if not dry run
  if (!options.dryRun) {
    await writeFile(outputPath, content);
  }

  return {
    target: "css" as any,
    outputPath,
    content,
    bytesWritten: Buffer.byteLength(content, "utf-8"),
  };
}
