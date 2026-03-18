import { readFile } from "fs/promises";
import type { BantayConfig } from "./checkers/types";

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

function parseYamlConfig(content: string): BantayConfig {
  const config: BantayConfig = {
    sourceDirectories: [],
  };

  const lines = content.split("\n");
  let currentKey: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    // Check for list item
    if (trimmed.startsWith("- ")) {
      const value = trimmed.slice(2).trim();
      if (currentKey === "sourceDirectories") {
        config.sourceDirectories.push(value);
      } else if (currentKey === "routeDirectories") {
        if (!config.routeDirectories) {
          config.routeDirectories = [];
        }
        config.routeDirectories.push(value);
      }
      continue;
    }

    // Check for key
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex > 0) {
      const key = trimmed.slice(0, colonIndex).trim();
      const value = trimmed.slice(colonIndex + 1).trim();

      if (key === "schemaPath" && value) {
        config.schemaPath = value;
      } else {
        currentKey = key;
      }
    }
  }

  return config;
}
