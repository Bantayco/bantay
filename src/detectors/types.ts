export interface FrameworkDetection {
  name: string;
  version?: string;
  confidence: "high" | "medium" | "low";
  router?: "app" | "pages";
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
}

export interface StackDetectionResult {
  framework: FrameworkDetection | null;
  orm: OrmDetection | null;
  auth: AuthDetection | null;
}

export interface Detector<T> {
  detect(projectPath: string): Promise<T | null>;
}
