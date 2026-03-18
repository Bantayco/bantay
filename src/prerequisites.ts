export interface PrerequisiteResult {
  available: boolean;
  version?: string;
  error?: string;
}

export async function checkBunRuntime(): Promise<PrerequisiteResult> {
  // Check if we're running in Bun by checking for Bun global
  if (typeof Bun !== "undefined" && Bun.version) {
    return {
      available: true,
      version: Bun.version,
    };
  }

  return {
    available: false,
    error: "Bun runtime not found. Install from https://bun.sh",
  };
}

export async function checkAllPrerequisites(): Promise<{
  passed: boolean;
  results: { name: string; result: PrerequisiteResult }[];
}> {
  const bunResult = await checkBunRuntime();

  const results = [{ name: "Bun Runtime", result: bunResult }];

  const passed = results.every((r) => r.result.available);

  return { passed, results };
}
