/**
 * no-network.ts — enforces inv_no_network
 *
 * Scan src/ for fetch(), http., https., net., dns.,
 * XMLHttpRequest, WebSocket. Any network API usage is a violation.
 * Zero tolerance.
 */

import { readdir, readFile } from "fs/promises";
import { join, relative } from "path";

export const name = "no-network";
export const description =
  "Ensures Bantay CLI makes zero network requests during any operation";

interface Violation {
  file: string;
  line: number;
  message: string;
}

interface CheckResult {
  pass: boolean;
  violations: Violation[];
}

interface CheckerConfig {
  projectPath: string;
}

const NETWORK_PATTERNS = [
  { pattern: /\bfetch\s*\(/, message: "fetch() is forbidden - no network requests allowed" },
  { pattern: /\bhttp\./, message: "http module usage is forbidden - no network requests allowed" },
  { pattern: /\bhttps\./, message: "https module usage is forbidden - no network requests allowed" },
  { pattern: /\bnet\./, message: "net module usage is forbidden - no network requests allowed" },
  { pattern: /\bdns\./, message: "dns module usage is forbidden - no network requests allowed" },
  { pattern: /\bXMLHttpRequest\b/, message: "XMLHttpRequest is forbidden - no network requests allowed" },
  { pattern: /\bWebSocket\b/, message: "WebSocket is forbidden - no network requests allowed" },
  { pattern: /\baxios\b/, message: "axios is forbidden - no network requests allowed" },
  { pattern: /\bgot\b\s*\(/, message: "got() is forbidden - no network requests allowed" },
  { pattern: /\bnode-fetch\b/, message: "node-fetch is forbidden - no network requests allowed" },
  { pattern: /require\s*\(\s*['"]https?['"]/, message: "http/https require is forbidden" },
  { pattern: /from\s+['"]https?['"]/, message: "http/https import is forbidden" },
  { pattern: /require\s*\(\s*['"]net['"]/, message: "net require is forbidden" },
  { pattern: /from\s+['"]net['"]/, message: "net import is forbidden" },
  { pattern: /require\s*\(\s*['"]dns['"]/, message: "dns require is forbidden" },
  { pattern: /from\s+['"]dns['"]/, message: "dns import is forbidden" },
];

async function getFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".git") {
        files.push(...(await getFiles(fullPath)));
      }
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".js")) {
      files.push(fullPath);
    }
  }

  return files;
}

export async function check(config: CheckerConfig): Promise<CheckResult> {
  const violations: Violation[] = [];
  const srcDir = join(config.projectPath, "src");

  let files: string[];
  try {
    files = await getFiles(srcDir);
  } catch {
    return { pass: true, violations: [] };
  }

  for (const filePath of files) {
    const content = await readFile(filePath, "utf-8");
    const lines = content.split("\n");
    const relPath = relative(config.projectPath, filePath);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Skip comments
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) {
        continue;
      }

      for (const { pattern, message } of NETWORK_PATTERNS) {
        if (pattern.test(line)) {
          violations.push({
            file: relPath,
            line: lineNum,
            message,
          });
        }
      }
    }
  }

  return {
    pass: violations.length === 0,
    violations,
  };
}
