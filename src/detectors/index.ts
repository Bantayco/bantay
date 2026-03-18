export type {
  FrameworkDetection,
  OrmDetection,
  AuthDetection,
  PaymentsDetection,
  StackDetectionResult,
} from "./types";

import type { StackDetectionResult, FrameworkDetection, OrmDetection, AuthDetection, PaymentsDetection } from "./types";
import { detect as detectNextjs } from "./nextjs";
import { detect as detectPrisma } from "./prisma";
import { detect as detectDrizzle } from "./drizzle";
import { detect as detectAuthjs } from "./authjs";
import { detect as detectClerk } from "./clerk";
import { detect as detectStripe } from "./stripe";

// Registry of framework detectors
const frameworkDetectors: Array<(projectPath: string) => Promise<FrameworkDetection | null>> = [
  detectNextjs,
];

// Registry of ORM detectors
const ormDetectors: Array<(projectPath: string) => Promise<OrmDetection | null>> = [
  detectPrisma,
  detectDrizzle,
];

// Registry of auth detectors
const authDetectors: Array<(projectPath: string) => Promise<AuthDetection | null>> = [
  detectClerk,  // Check Clerk first (more specific)
  detectAuthjs,
];

// Registry of payments detectors
const paymentsDetectors: Array<(projectPath: string) => Promise<PaymentsDetection | null>> = [
  detectStripe,
];

export async function detectStack(projectPath: string): Promise<StackDetectionResult> {
  let framework: FrameworkDetection | null = null;
  let orm: OrmDetection | null = null;
  let auth: AuthDetection | null = null;
  let payments: PaymentsDetection | null = null;

  // Run framework detectors
  for (const detector of frameworkDetectors) {
    const result = await detector(projectPath);
    if (result && (!framework || result.confidence === "high")) {
      framework = result;
      if (result.confidence === "high") break;
    }
  }

  // Run ORM detectors
  for (const detector of ormDetectors) {
    const result = await detector(projectPath);
    if (result && (!orm || result.confidence === "high")) {
      orm = result;
      if (result.confidence === "high") break;
    }
  }

  // Run auth detectors
  for (const detector of authDetectors) {
    const result = await detector(projectPath);
    if (result && (!auth || result.confidence === "high")) {
      auth = result;
      if (result.confidence === "high") break;
    }
  }

  // Run payments detectors
  for (const detector of paymentsDetectors) {
    const result = await detector(projectPath);
    if (result && (!payments || result.confidence === "high")) {
      payments = result;
      if (result.confidence === "high") break;
    }
  }

  return { framework, orm, auth, payments };
}
