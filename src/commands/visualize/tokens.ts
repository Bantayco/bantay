/**
 * Token extraction functions for design system tokens
 */

import type { AideTree, TokenVar } from "./types";

/**
 * Extract CSS variables from entities with props.type === "token".
 * Each prop (except "type" and "text" description) becomes a CSS variable.
 * Pattern: --{entity_id}-{prop_key}: {prop_value};
 */
export function extractTokenTypeVars(aide: AideTree): TokenVar[] {
  const vars: TokenVar[] = [];
  const entities = aide.entities || {};

  for (const [id, entity] of Object.entries(entities)) {
    if (entity.props?.type === "token") {
      for (const [key, value] of Object.entries(entity.props)) {
        if (key === "type") continue;

        const varName = `--${id.replace(/_/g, "-")}-${key.replace(/_/g, "-")}`;
        vars.push({
          name: varName,
          value: String(value),
        });
      }
    }
  }

  return vars;
}

/**
 * Extract dark mode CSS variables from entities with props.type === "token-dark".
 * The entity ID suffix "_dark" is stripped to get the variable namespace.
 * Pattern: ds_colors_dark prop text → --ds-colors-text (in dark block)
 */
export function extractDarkModeTokenVars(aide: AideTree): TokenVar[] {
  const vars: TokenVar[] = [];
  const entities = aide.entities || {};

  for (const [id, entity] of Object.entries(entities)) {
    if (entity.props?.type === "token-dark") {
      const namespace = id.replace(/_dark$/, "");

      for (const [key, value] of Object.entries(entity.props)) {
        if (key === "type") continue;

        const varName = `--${namespace.replace(/_/g, "-")}-${key.replace(/_/g, "-")}`;
        vars.push({
          name: varName,
          value: String(value),
        });
      }
    }
  }

  return vars;
}
