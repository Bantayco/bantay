export interface FrameworkDetection {
  name: string;
  version?: string;
  confidence: "high" | "medium" | "low";
  router?: "app" | "pages";
  routePattern?: string; // e.g., "app/api/**/route.ts" or "pages/api/**/*.ts"
}

export interface OrmDetection {
  name: string;
  version?: string;
  confidence: "high" | "medium" | "low";
  schemaPath?: string;
}

export interface AuthDetection {
  name: string;
  version?: string;
  confidence: "high" | "medium" | "low";
  authFunction?: string; // e.g., "auth()" for Auth.js, "getAuth()" for Clerk
  sessionFunction?: string; // e.g., "getServerSession()" or "currentUser()"
}

export interface PaymentsDetection {
  name: string;
  version?: string;
  confidence: "high" | "medium" | "low";
  webhookPattern?: string; // e.g., "app/api/webhooks/stripe/route.ts"
  secretEnvVar?: string; // e.g., "STRIPE_SECRET_KEY"
}

export interface StackDetectionResult {
  framework: FrameworkDetection | null;
  orm: OrmDetection | null;
  auth: AuthDetection | null;
  payments: PaymentsDetection | null;
}

export interface Detector<T> {
  detect(projectPath: string): Promise<T | null>;
}
