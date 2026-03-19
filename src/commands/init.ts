import { writeFile, access, mkdir } from "fs/promises";
import { join } from "path";
import { detectStack, type StackDetectionResult } from "../detectors";
import { generateInvariants } from "../generators/invariants";
import { generateConfig, configToYaml } from "../generators/config";
import {
  generateInterviewCommand,
  generateStatusCommand,
  generateCheckCommand,
} from "../generators/claude-commands";

export interface InitOptions {
  regenerateConfig?: boolean;
}

export interface InitResult {
  success: boolean;
  filesCreated: string[];
  warnings: string[];
  detection: StackDetectionResult;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function runInit(
  projectPath: string,
  options?: InitOptions
): Promise<InitResult> {
  const filesCreated: string[] = [];
  const warnings: string[] = [];

  // Detect stack
  const detection = await detectStack(projectPath);

  // Add warnings for missing detections
  if (!detection.framework) {
    warnings.push("No framework detected");
  }

  const invariantsPath = join(projectPath, "invariants.md");
  const configPath = join(projectPath, "bantay.config.yml");

  // Check if invariants.md already exists
  const invariantsExists = await fileExists(invariantsPath);

  if (invariantsExists) {
    warnings.push("invariants.md already exists");
  }

  // Generate invariants.md if it doesn't exist
  if (!invariantsExists) {
    const invariantsContent = await generateInvariants(detection);
    await writeFile(invariantsPath, invariantsContent);
    filesCreated.push("invariants.md");
  }

  // Generate config (always, or when regenerateConfig is true)
  const shouldGenerateConfig = !invariantsExists || options?.regenerateConfig;

  if (shouldGenerateConfig) {
    const config = await generateConfig(detection, projectPath);
    const configContent = configToYaml(config);
    await writeFile(configPath, configContent);
    filesCreated.push("bantay.config.yml");
  }

  // Generate Claude Code slash commands
  const claudeCommandsDir = join(projectPath, ".claude", "commands");
  await mkdir(claudeCommandsDir, { recursive: true });

  const interviewPath = join(claudeCommandsDir, "bantay-interview.md");
  const statusPath = join(claudeCommandsDir, "bantay-status.md");
  const checkPath = join(claudeCommandsDir, "bantay-check.md");

  // Only create if they don't exist (don't overwrite user customizations)
  if (!(await fileExists(interviewPath))) {
    await writeFile(interviewPath, generateInterviewCommand());
    filesCreated.push(".claude/commands/bantay-interview.md");
  }

  if (!(await fileExists(statusPath))) {
    await writeFile(statusPath, generateStatusCommand());
    filesCreated.push(".claude/commands/bantay-status.md");
  }

  if (!(await fileExists(checkPath))) {
    await writeFile(checkPath, generateCheckCommand());
    filesCreated.push(".claude/commands/bantay-check.md");
  }

  return {
    success: true,
    filesCreated,
    warnings,
    detection,
  };
}
