export type {
  FrameworkDetection,
  OrmDetection,
  AuthDetection,
  StackDetectionResult,
} from "./types";

import type { StackDetectionResult, FrameworkDetection, OrmDetection, AuthDetection } from "./types";
import { detect as detectNextjs } from "./nextjs";
import { detect as detectPrisma } from "./prisma";

// Registry of framework detectors
const frameworkDetectors: Array<() => typeof detectNextjs> = [
  () => detectNextjs,
];

// Registry of ORM detectors
const ormDetectors: Array<() => typeof detectPrisma> = [
  () => detectPrisma,
];

// Registry of auth detectors (none yet)
const authDetectors: Array<() => (projectPath: string) => Promise<AuthDetection | null>> = [];

export async function detectStack(projectPath: string): Promise<StackDetectionResult> {
  let framework: FrameworkDetection | null = null;
  let orm: OrmDetection | null = null;
  let auth: AuthDetection | null = null;

  // Run framework detectors
  for (const getDetector of frameworkDetectors) {
    const detector = getDetector();
    const result = await detector(projectPath);
    if (result && (!framework || result.confidence === "high")) {
      framework = result;
      if (result.confidence === "high") break;
    }
  }

  // Run ORM detectors
  for (const getDetector of ormDetectors) {
    const detector = getDetector();
    const result = await detector(projectPath);
    if (result && (!orm || result.confidence === "high")) {
      orm = result;
      if (result.confidence === "high") break;
    }
  }

  // Run auth detectors
  for (const getDetector of authDetectors) {
    const detector = getDetector();
    const result = await detector(projectPath);
    if (result && (!auth || result.confidence === "high")) {
      auth = result;
      if (result.confidence === "high") break;
    }
  }

  return { framework, orm, auth };
}
