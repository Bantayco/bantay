/**
 * Generators for Claude Code slash command files
 *
 * These files are placed in .claude/commands/ and appear as
 * slash commands in Claude Code (e.g., /bantay-interview)
 *
 * Prompts are stored as markdown files in src/templates/commands/
 * for readability and easy editing.
 */

import { readFileSync } from "fs";
import { join } from "path";

/**
 * Generate the bantay-interview.md command
 *
 * This command guides Claude through an interactive session to
 * build out the project's aide structure through conversation.
 */
export function generateInterviewCommand(): string {
  return readFileSync(
    join(__dirname, "../templates/commands/bantay-interview.md"),
    "utf-8"
  );
}

/**
 * Generate the bantay-status.md command
 *
 * This command runs bantay status and discusses the results.
 */
export function generateStatusCommand(): string {
  return readFileSync(
    join(__dirname, "../templates/commands/bantay-status.md"),
    "utf-8"
  );
}

/**
 * Generate the bantay-check.md command
 *
 * This command runs bantay check and helps fix any failures.
 */
export function generateCheckCommand(): string {
  return readFileSync(
    join(__dirname, "../templates/commands/bantay-check.md"),
    "utf-8"
  );
}
