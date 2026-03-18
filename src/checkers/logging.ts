import type { Checker, CheckResult, CheckerContext, CheckViolation } from "./types";
import type { Invariant } from "../generators/invariants";
import { Glob } from "bun";
import { readFile } from "fs/promises";
import { join, relative } from "path";

// PII field names to detect in log statements
const PII_PATTERNS = [
  /\bemail\b/i,
  /\bpassword\b/i,
  /\bssn\b/i,
  /\bsocialSecurityNumber\b/i,
  /\bsocial_security_number\b/i,
  /\bcreditCard\b/i,
  /\bcredit_card\b/i,
  /\bcardNumber\b/i,
  /\bcard_number\b/i,
  /\bcvv\b/i,
  /\bpin\b/i,
  /\bdateOfBirth\b/i,
  /\bdate_of_birth\b/i,
  /\bdob\b/i,
  /\bphoneNumber\b/i,
  /\bphone_number\b/i,
  /\baddress\b/i,
  /\bsecret\b/i,
  /\btoken\b/i,
  /\bapiKey\b/i,
  /\bapi_key\b/i,
  /\bprivateKey\b/i,
  /\bprivate_key\b/i,
];

// Log statement patterns
const LOG_PATTERNS = [
  /console\.(log|warn|error|info|debug)\s*\([^)]*$/,
  /console\.(log|warn|error|info|debug)\s*\(.*\)/,
  /logger\.(log|warn|error|info|debug)\s*\(.*\)/,
  /log\.(log|warn|error|info|debug)\s*\(.*\)/,
];

interface LogViolation {
  line: number;
  piiField: string;
  logContent: string;
}

function findPiiInLogStatements(content: string): LogViolation[] {
  const violations: LogViolation[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if this line contains a log statement
    const isLogStatement = LOG_PATTERNS.some((pattern) => pattern.test(line));

    if (isLogStatement) {
      // Check for PII patterns in the log statement
      for (const piiPattern of PII_PATTERNS) {
        if (piiPattern.test(line)) {
          const match = line.match(piiPattern);
          violations.push({
            line: i + 1,
            piiField: match ? match[0] : "unknown",
            logContent: line.trim(),
          });
          break; // Only report one PII field per line
        }
      }
    }
  }

  return violations;
}

async function scanSourceFiles(projectPath: string, sourceDirectories: string[]): Promise<string[]> {
  const files: string[] = [];
  const pattern = "**/*.{ts,tsx,js,jsx}";

  for (const srcDir of sourceDirectories) {
    const glob = new Glob(pattern);
    const dirPath = join(projectPath, srcDir);

    try {
      for await (const file of glob.scan({ cwd: dirPath, absolute: true })) {
        // Skip node_modules
        if (!file.includes("node_modules")) {
          files.push(file);
        }
      }
    } catch {
      // Directory doesn't exist, skip
    }
  }

  return files;
}

export const loggingChecker: Checker = {
  category: "logging",

  async check(invariant: Invariant, context: CheckerContext): Promise<CheckResult> {
    const violations: CheckViolation[] = [];
    const sourceFiles = await scanSourceFiles(
      context.projectPath,
      context.config.sourceDirectories
    );

    for (const filePath of sourceFiles) {
      try {
        const content = await readFile(filePath, "utf-8");
        const piiViolations = findPiiInLogStatements(content);

        for (const violation of piiViolations) {
          violations.push({
            filePath: relative(context.projectPath, filePath),
            line: violation.line,
            message: `Log statement contains PII field "${violation.piiField}"`,
          });
        }
      } catch {
        // File read error, skip
      }
    }

    return {
      invariant,
      status: violations.length > 0 ? "fail" : "pass",
      violations,
    };
  },
};
