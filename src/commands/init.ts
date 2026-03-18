import { writeFile, access } from "fs/promises";
import { join } from "path";
import { detectStack, type StackDetectionResult } from "../detectors";
import { generateInvariants } from "../generators/invariants";
import { generateConfig, configToYaml } from "../generators/config";

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

  return {
    success: true,
    filesCreated,
    warnings,
    detection,
  };
}
