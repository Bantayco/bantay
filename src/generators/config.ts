import type { StackDetectionResult } from "../detectors";

export interface BantayConfig {
  source: {
    include: string[];
    exclude?: string[];
  };
  schema?: {
    prisma?: string;
  };
  routes?: {
    include: string[];
  };
}

export async function generateConfig(
  stack: StackDetectionResult,
  _projectPath: string
): Promise<BantayConfig> {
  const config: BantayConfig = {
    source: {
      include: ["src/**/*"],
      exclude: ["node_modules/**", "dist/**", ".next/**", "build/**"],
    },
  };

  // Add app directory for Next.js app router
  if (stack.framework?.name === "nextjs") {
    if (stack.framework.router === "app") {
      config.source.include.push("app/**/*");
      config.routes = {
        include: ["app/**/route.ts", "app/**/route.js"],
      };
    } else if (stack.framework.router === "pages") {
      config.source.include.push("pages/**/*");
      config.routes = {
        include: ["pages/api/**/*.ts", "pages/api/**/*.js"],
      };
    }
  }

  // Add Prisma schema path
  if (stack.orm?.name === "prisma" && stack.orm.schemaPath) {
    config.schema = {
      prisma: stack.orm.schemaPath,
    };
  }

  return config;
}

export function configToYaml(config: BantayConfig): string {
  const lines: string[] = [
    "# Bantay configuration",
    "# Edit this file to customize invariant checking",
    "",
  ];

  // Source section
  lines.push("source:");
  lines.push("  include:");
  for (const pattern of config.source.include) {
    lines.push(`    - ${pattern}`);
  }

  if (config.source.exclude && config.source.exclude.length > 0) {
    lines.push("  exclude:");
    for (const pattern of config.source.exclude) {
      lines.push(`    - ${pattern}`);
    }
  }

  // Schema section
  if (config.schema) {
    lines.push("");
    lines.push("schema:");
    if (config.schema.prisma) {
      lines.push(`  prisma: ${config.schema.prisma}`);
    }
  }

  // Routes section
  if (config.routes) {
    lines.push("");
    lines.push("routes:");
    lines.push("  include:");
    for (const pattern of config.routes.include) {
      lines.push(`    - ${pattern}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

export function parseConfig(yaml: string): BantayConfig {
  const config: BantayConfig = {
    source: {
      include: [],
    },
  };

  const lines = yaml.split("\n");
  let currentSection: string | null = null;
  let currentSubsection: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (trimmed.startsWith("#") || trimmed === "") {
      continue;
    }

    // Check for top-level sections
    if (!line.startsWith(" ") && !line.startsWith("\t")) {
      if (trimmed.startsWith("source:")) {
        currentSection = "source";
        currentSubsection = null;
      } else if (trimmed.startsWith("schema:")) {
        currentSection = "schema";
        currentSubsection = null;
      } else if (trimmed.startsWith("routes:")) {
        currentSection = "routes";
        currentSubsection = null;
      }
      continue;
    }

    // Check for subsections
    if (trimmed.startsWith("include:")) {
      currentSubsection = "include";
      continue;
    } else if (trimmed.startsWith("exclude:")) {
      currentSubsection = "exclude";
      continue;
    }

    // Handle list items
    if (trimmed.startsWith("- ")) {
      const value = trimmed.slice(2);

      if (currentSection === "source" && currentSubsection === "include") {
        config.source.include.push(value);
      } else if (currentSection === "source" && currentSubsection === "exclude") {
        config.source.exclude = config.source.exclude ?? [];
        config.source.exclude.push(value);
      } else if (currentSection === "routes" && currentSubsection === "include") {
        config.routes = config.routes ?? { include: [] };
        config.routes.include.push(value);
      }
      continue;
    }

    // Handle key-value pairs
    if (trimmed.includes(":")) {
      const [key, ...rest] = trimmed.split(":");
      const value = rest.join(":").trim();

      if (currentSection === "schema") {
        if (key.trim() === "prisma") {
          config.schema = config.schema ?? {};
          config.schema.prisma = value;
        }
      }
    }
  }

  return config;
}
