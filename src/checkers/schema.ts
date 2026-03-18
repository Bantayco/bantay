import type { Checker, CheckResult, CheckerContext, CheckViolation } from "./types";
import type { Invariant } from "../generators/invariants";
import { readFile, access } from "fs/promises";
import { join } from "path";

interface PrismaModel {
  name: string;
  fields: string[];
  startLine: number;
}

function parsePrismaSchema(content: string): PrismaModel[] {
  const models: PrismaModel[] = [];
  const lines = content.split("\n");

  let currentModel: PrismaModel | null = null;
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Start of a model
    const modelMatch = trimmed.match(/^model\s+(\w+)\s*\{/);
    if (modelMatch) {
      currentModel = {
        name: modelMatch[1],
        fields: [],
        startLine: i + 1,
      };
      braceDepth = 1;
      continue;
    }

    if (currentModel) {
      // Track braces
      for (const char of trimmed) {
        if (char === "{") braceDepth++;
        if (char === "}") braceDepth--;
      }

      // Parse field name (first word of the line that isn't a comment or directive)
      if (!trimmed.startsWith("//") && !trimmed.startsWith("@@")) {
        const fieldMatch = trimmed.match(/^(\w+)\s+/);
        if (fieldMatch) {
          currentModel.fields.push(fieldMatch[1]);
        }
      }

      // End of model
      if (braceDepth === 0) {
        models.push(currentModel);
        currentModel = null;
      }
    }
  }

  return models;
}

function checkModelTimestamps(model: PrismaModel): { hasCreatedAt: boolean; hasUpdatedAt: boolean } {
  const fieldNames = model.fields.map((f) => f.toLowerCase());
  return {
    hasCreatedAt: fieldNames.includes("createdat"),
    hasUpdatedAt: fieldNames.includes("updatedat"),
  };
}

async function findSchemaPath(projectPath: string, configSchemaPath?: string): Promise<string | null> {
  // Try config path first
  if (configSchemaPath) {
    const fullPath = join(projectPath, configSchemaPath);
    try {
      await access(fullPath);
      return fullPath;
    } catch {
      // Config path doesn't exist, try defaults
    }
  }

  // Try common default locations
  const defaultPaths = [
    "prisma/schema.prisma",
    "schema.prisma",
  ];

  for (const defaultPath of defaultPaths) {
    const fullPath = join(projectPath, defaultPath);
    try {
      await access(fullPath);
      return fullPath;
    } catch {
      // Not found, try next
    }
  }

  return null;
}

export const schemaChecker: Checker = {
  category: "schema",

  async check(invariant: Invariant, context: CheckerContext): Promise<CheckResult> {
    const violations: CheckViolation[] = [];

    // Find schema file
    const schemaPath = await findSchemaPath(context.projectPath, context.config.schemaPath);

    if (!schemaPath) {
      return {
        invariant,
        status: "pass",
        violations: [],
        message: "No Prisma schema found",
      };
    }

    try {
      const content = await readFile(schemaPath, "utf-8");
      const models = parsePrismaSchema(content);

      for (const model of models) {
        const timestamps = checkModelTimestamps(model);
        const missingFields: string[] = [];

        if (!timestamps.hasCreatedAt) {
          missingFields.push("createdAt");
        }
        if (!timestamps.hasUpdatedAt) {
          missingFields.push("updatedAt");
        }

        if (missingFields.length > 0) {
          const relativePath = schemaPath.replace(context.projectPath + "/", "");
          violations.push({
            filePath: relativePath,
            line: model.startLine,
            message: `Model "${model.name}" is missing timestamp fields: ${missingFields.join(", ")}`,
          });
        }
      }
    } catch (error) {
      return {
        invariant,
        status: "skipped",
        violations: [],
        message: `Failed to read schema: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }

    return {
      invariant,
      status: violations.length > 0 ? "fail" : "pass",
      violations,
    };
  },
};
