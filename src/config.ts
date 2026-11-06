import { readFile } from "fs/promises";
import * as yaml from "js-yaml";
import type { BantayConfig } from "./checkers/types";
import type { DecisionConfig } from "./decision/types";

export async function loadConfig(projectPath: string): Promise<BantayConfig> {
  const configPath = `${projectPath}/bantay.config.yml`;

  try {
    const content = await readFile(configPath, "utf-8");
    return parseYamlConfig(content);
  } catch {
    // Default config if file doesn't exist
    return {
      sourceDirectories: ["src"],
    };
  }
}

/**
 * Parse bantay.config.yml.
 *
 *   sourceDirectories: [src]
 *   routeDirectories: [app/api]
 *   schemaPath: prisma/schema.prisma
 *   decision:
 *     provider: jev          # jev | systemone | ollama | anthropic | mock | none
 *     model: jev-latest
 *     baseUrl: https://...   # gateway / self-hosted / ollama host
 *     apiKeyEnv: TYPESAFE_API_KEY
 *     threshold: 0.8
 */
export function parseYamlConfig(content: string): BantayConfig {
  const raw = (yaml.load(content) ?? {}) as Record<string, unknown>;

  const list = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.map(String) : typeof v === "string" && v ? [v] : undefined;

  const config: BantayConfig = {
    sourceDirectories: list(raw.sourceDirectories) ?? [],
  };

  const routes = list(raw.routeDirectories);
  if (routes) config.routeDirectories = routes;

  if (typeof raw.schemaPath === "string" && raw.schemaPath) {
    config.schemaPath = raw.schemaPath;
  }

  if (raw.decision && typeof raw.decision === "object") {
    const d = raw.decision as Record<string, unknown>;
    const decision: DecisionConfig = {
      provider: (typeof d.provider === "string" ? d.provider : "none") as DecisionConfig["provider"],
    };
    if (typeof d.model === "string") decision.model = d.model;
    if (typeof d.baseUrl === "string") decision.baseUrl = d.baseUrl;
    if (typeof d.apiKeyEnv === "string") decision.apiKeyEnv = d.apiKeyEnv;
    if (typeof d.threshold === "number") decision.threshold = d.threshold;
    config.decision = decision;
  }

  return config;
}
