/**
 * no-clobber.ts — enforces inv_no_clobber
 *
 * Create a CLAUDE.md with user content above and below where markers would go.
 * Run bantay export claude. Fail if any content outside <!-- bantay:start/end --> changed.
 */

import { mkdir, writeFile, readFile, rm, copyFile } from "fs/promises";
import { join } from "path";
import { spawn } from "bun";
import { tmpdir } from "os";

export const name = "no-clobber";
export const description =
  "Ensures bantay export never modifies content outside its delimited section";

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

const USER_CONTENT_BEFORE = `# My Project

This is my custom documentation that should NEVER be modified.

## Important Notes

- Note 1: Custom content
- Note 2: More custom content

`;

const USER_CONTENT_AFTER = `

## My Custom Section

This section comes after Bantay and should also be preserved.

### Subsection

More custom content here that must not change.
`;

export async function check(config: CheckerConfig): Promise<CheckResult> {
  const violations: Violation[] = [];
  const testDir = join(tmpdir(), `bantay-no-clobber-test-${Date.now()}`);

  try {
    // Create test project structure
    await mkdir(testDir, { recursive: true });

    // Copy necessary files from the real project
    await copyFile(
      join(config.projectPath, "bantay.aide"),
      join(testDir, "bantay.aide")
    );
    await copyFile(
      join(config.projectPath, "bantay.config.yml"),
      join(testDir, "bantay.config.yml")
    );

    // Create CLAUDE.md with user content and existing bantay section
    const initialContent = `${USER_CONTENT_BEFORE}<!-- bantay:start -->

## Old Bantay Content

This will be replaced.

<!-- bantay:end -->${USER_CONTENT_AFTER}`;

    await writeFile(join(testDir, "CLAUDE.md"), initialContent);

    // Run bantay export claude
    const cliPath = join(config.projectPath, "src", "cli.ts");
    const proc = spawn({
      cmd: [process.execPath, "run", cliPath, "export", "claude"],
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    await proc.exited;

    // Read the result
    const resultContent = await readFile(join(testDir, "CLAUDE.md"), "utf-8");

    // Find markers at the start of lines (not inline mentions in content)
    function findMarkerAtLineStart(content: string, marker: string): number {
      const regex = new RegExp(`^[ \\t]*${marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m");
      const match = content.match(regex);
      return match && match.index !== undefined ? content.indexOf(marker, match.index) : -1;
    }

    const startMarkerIndex = findMarkerAtLineStart(resultContent, "<!-- bantay:start -->");
    const endMarkerIndex = findMarkerAtLineStart(resultContent, "<!-- bantay:end -->");

    if (startMarkerIndex === -1 || endMarkerIndex === -1) {
      violations.push({
        file: "CLAUDE.md",
        line: 0,
        message: "Bantay markers not found in output",
      });
    } else {
      const beforeContent = resultContent.substring(0, startMarkerIndex);
      const afterContent = resultContent.substring(
        endMarkerIndex + "<!-- bantay:end -->".length
      );

      // Check if user content before markers is preserved
      // Normalize whitespace at boundaries for comparison
      const expectedBefore = USER_CONTENT_BEFORE.trimEnd();
      const actualBefore = beforeContent.trimEnd();
      if (actualBefore !== expectedBefore) {
        violations.push({
          file: "CLAUDE.md",
          line: 1,
          message: "Content before <!-- bantay:start --> was modified",
        });
      }

      // Check if user content after markers is preserved
      // Normalize leading whitespace for comparison (export may adjust newlines)
      const expectedAfter = USER_CONTENT_AFTER.trim();
      const actualAfter = afterContent.trim();
      if (actualAfter !== expectedAfter) {
        const afterLineNum =
          resultContent.substring(0, endMarkerIndex).split("\n").length + 1;
        violations.push({
          file: "CLAUDE.md",
          line: afterLineNum,
          message: "Content after <!-- bantay:end --> was modified",
        });
      }
    }
  } catch (error) {
    violations.push({
      file: "no-clobber.ts",
      line: 0,
      message: `Test failed: ${error instanceof Error ? error.message : error}`,
    });
  } finally {
    // Cleanup
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }

  return {
    pass: violations.length === 0,
    violations,
  };
}
