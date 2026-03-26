#!/usr/bin/env bun
import { runInit } from "./commands/init";
import { runCheck, formatCheckResults, formatCheckResultsJson } from "./commands/check";
import { checkAllPrerequisites } from "./prerequisites";
import {
  handleAideInit,
  handleAideAdd,
  handleAideUpdate,
  handleAideRemove,
  handleAideLink,
  handleAideShow,
  handleAideValidate,
  handleAideLock,
  handleAideDiff,
  printAideHelp,
} from "./commands/aide";
import { exportInvariants, exportClaude, exportCursor, exportCodex, exportCss, exportAll } from "./export";
import { runStatus, formatStatus } from "./commands/status";
import { runCi, type CiOptions } from "./commands/ci";
import { runTasks, formatTasks } from "./commands/tasks";
import { handleDiff } from "./commands/diff";
import { runVisualize } from "./commands/visualize";

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    process.exit(0);
  }

  // Check prerequisites before any command runs
  await runPrerequisiteCheck();

  if (command === "init") {
    await handleInit(args.slice(1));
  } else if (command === "check") {
    await handleCheck(args.slice(1));
  } else if (command === "aide") {
    await handleAide(args.slice(1));
  } else if (command === "ci") {
    await handleCi(args.slice(1));
  } else if (command === "export") {
    await handleExport(args.slice(1));
  } else if (command === "status") {
    await handleStatus(args.slice(1));
  } else if (command === "tasks") {
    await handleTasks(args.slice(1));
  } else if (command === "diff") {
    await handleDiff(args.slice(1));
  } else if (command === "visualize") {
    await handleVisualize(args.slice(1));
  } else {
    console.error(`Unknown command: ${command}`);
    console.error('Run "bantay help" for usage information.');
    process.exit(1);
  }
}

async function runPrerequisiteCheck() {
  console.error("Checking prerequisites...");
  const prereqs = await checkAllPrerequisites();

  if (!prereqs.passed) {
    console.error("\nPrerequisite check failed:\n");
    for (const { name, result } of prereqs.results) {
      if (!result.available) {
        console.error(`  ${name}: FAILED`);
        console.error(`    ${result.error}`);
      }
    }
    process.exit(1);
  }
}

function printHelp() {
  console.log(`
Bantay CLI - Enforce project invariants on every PR

Usage: bantay <command> [options]

Commands:
  init      Initialize Bantay in the current project
  check     Check all invariants against the codebase
  diff      Show classified aide changes (wraps aide diff)
  aide      Manage the aide entity tree (add, remove, link, show, validate, lock)
  ci        Generate CI workflow configuration
  export    Export invariants to agent context files
  status    Show scenario implementation status
  tasks     Generate task list from aide CUJs
  visualize Generate interactive HTML screen map from aide

Options:
  -h, --help    Show this help message

Examples:
  bantay init                Initialize in current directory
  bantay init --force        Regenerate slash commands
  bantay check               Run full invariant check
  bantay check --diff HEAD~1 Check only affected invariants
  bantay diff                Show classified aide changes
  bantay diff --json         Output changes as JSON
  bantay aide show           Show the aide entity tree
  bantay aide add inv_test --parent invariants --prop "statement=Test"
  bantay ci --github-actions Generate GitHub Actions workflow
  bantay export all          Export all targets
  bantay export invariants   Generate invariants.md from bantay.aide
  bantay export claude       Export to CLAUDE.md
  bantay export cursor       Export to .cursorrules
  bantay status              Show scenario implementation status
  bantay status --json       Output as JSON
  bantay tasks               Generate tasks for changed CUJs (requires lock)
  bantay tasks --all         Generate tasks for all CUJs
  bantay visualize           Generate visualizer from aide
  bantay visualize --output docs/map.html   Custom output path

Run "bantay aide help" for aide subcommand details.
`);
}

async function handleInit(args: string[]) {
  const projectPath = process.cwd();
  const regenerateConfig = args.includes("--regenerate-config");
  const force = args.includes("--force");
  const dryRun = args.includes("--dry-run");

  console.log("Initializing Bantay...\n");

  if (dryRun) {
    console.log("Dry run mode - no files will be created.");
    process.exit(0);
  }

  try {
    const result = await runInit(projectPath, { regenerateConfig, force });

    // Display detection results
    console.log("Stack Detection:");
    if (result.detection.framework) {
      console.log(`  Framework: ${result.detection.framework.name} (${result.detection.framework.confidence} confidence)`);
      if (result.detection.framework.router) {
        console.log(`    Router: ${result.detection.framework.router}`);
      }
    } else {
      console.log("  Framework: Not detected");
    }

    if (result.detection.orm) {
      console.log(`  ORM: ${result.detection.orm.name} (${result.detection.orm.confidence} confidence)`);
      if (result.detection.orm.schemaPath) {
        console.log(`    Schema: ${result.detection.orm.schemaPath}`);
      }
    } else {
      console.log("  ORM: Not detected");
    }

    if (result.detection.auth) {
      console.log(`  Auth: ${result.detection.auth.name} (${result.detection.auth.confidence} confidence)`);
    } else {
      console.log("  Auth: Not detected");
    }

    if (result.detection.payments) {
      console.log(`  Payments: ${result.detection.payments.name} (${result.detection.payments.confidence} confidence)`);
    } else {
      console.log("  Payments: Not detected");
    }

    console.log("");

    // Display warnings
    for (const warning of result.warnings) {
      console.log(`Warning: ${warning}`);
    }

    // Display created files
    if (result.filesCreated.length > 0) {
      console.log("\nCreated files:");
      for (const file of result.filesCreated) {
        console.log(`  - ${file}`);
      }
    }

    console.log("\nBantay initialized successfully!");
    console.log("Edit invariants.md to customize your project invariants.");
    console.log('Run "bantay check" to verify invariants.');

    process.exit(0);
  } catch (error) {
    console.error("Error initializing Bantay:", error);
    process.exit(1);
  }
}

async function handleCheck(args: string[]) {
  const projectPath = process.cwd();

  // Parse options
  const idIndex = args.indexOf("--id");
  const diffIndex = args.indexOf("--diff");
  const jsonOutput = args.includes("--json");

  const options: { id?: string; diff?: string } = {};

  if (idIndex !== -1 && args[idIndex + 1]) {
    options.id = args[idIndex + 1];
  }

  if (diffIndex !== -1) {
    options.diff = args[diffIndex + 1] || "HEAD";
  }

  try {
    const summary = await runCheck(projectPath, options);

    if (jsonOutput) {
      // JSON output to stdout, nothing to stderr
      const jsonResult = await formatCheckResultsJson(summary, projectPath);
      console.log(JSON.stringify(jsonResult, null, 2));
    } else {
      // Human-readable output to stderr
      const output = formatCheckResults(summary);
      console.error(output);
    }

    // Exit non-zero if any invariants failed
    if (summary.failed > 0) {
      process.exit(1);
    }

    process.exit(0);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error("Error running check:", error);
    }
    process.exit(1);
  }
}

async function handleExport(args: string[]) {
  const projectPath = process.cwd();

  // Parse target from args
  // Formats: bantay export invariants, bantay export claude, bantay export cursor
  // Or: bantay export --target claude
  const targetIndex = args.indexOf("--target");
  let target: string;

  if (targetIndex !== -1 && args[targetIndex + 1]) {
    target = args[targetIndex + 1];
  } else if (args[0] && !args[0].startsWith("-")) {
    target = args[0];
  } else {
    console.error("Usage: bantay export <target>");
    console.error("");
    console.error("Targets:");
    console.error("  all         Export all targets (invariants, claude, cursor, codex, css)");
    console.error("  invariants  Generate invariants.md from bantay.aide");
    console.error("  claude      Export to CLAUDE.md with section markers");
    console.error("  cursor      Export to .cursorrules with section markers");
    console.error("  codex       Export to AGENTS.md with section markers");
    console.error("  css         Export design tokens to bantay-tokens.css");
    console.error("");
    console.error("Examples:");
    console.error("  bantay export invariants");
    console.error("  bantay export claude");
    console.error("  bantay export codex");
    console.error("  bantay export css");
    console.error("  bantay export --target cursor");
    process.exit(1);
  }

  const dryRun = args.includes("--dry-run");

  try {
    if (target === "all") {
      const results = await exportAll(projectPath, { dryRun });
      console.log("Exported all targets:");
      for (const r of results) {
        console.log(`  ${r.target}: ${r.outputPath} (${r.bytesWritten} bytes)`);
      }
    } else if (target === "invariants") {
      const result = await exportInvariants(projectPath, { dryRun });
      console.log(`Exported invariants to ${result.outputPath}`);
      console.log(`  ${result.bytesWritten} bytes written`);
    } else if (target === "claude") {
      const result = await exportClaude(projectPath, { dryRun });
      console.log(`Exported to ${result.outputPath}`);
      console.log(`  ${result.bytesWritten} bytes written`);
    } else if (target === "cursor") {
      const result = await exportCursor(projectPath, { dryRun });
      console.log(`Exported to ${result.outputPath}`);
      console.log(`  ${result.bytesWritten} bytes written`);
    } else if (target === "codex") {
      const result = await exportCodex(projectPath, { dryRun });
      console.log(`Exported to ${result.outputPath}`);
      console.log(`  ${result.bytesWritten} bytes written`);
    } else if (target === "css") {
      const result = await exportCss(projectPath, { dryRun });
      console.log(`Exported to ${result.outputPath}`);
      console.log(`  ${result.bytesWritten} bytes written`);
    } else {
      console.error(`Unknown export target: ${target}`);
      console.error('Valid targets: all, invariants, claude, cursor, codex, css');
      process.exit(1);
    }

    if (dryRun) {
      console.log("\n(Dry run - no files were written)");
    }

    process.exit(0);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error("Error running export:", error);
    }
    process.exit(1);
  }
}

async function handleCi(args: string[]) {
  const projectPath = process.cwd();

  // Parse provider from args
  const hasGitHub = args.includes("--github-actions") || args.includes("--github");
  const hasGitLab = args.includes("--gitlab");
  const force = args.includes("--force");

  let provider: "github-actions" | "gitlab" | "generic";

  if (hasGitHub) {
    provider = "github-actions";
  } else if (hasGitLab) {
    provider = "gitlab";
  } else {
    provider = "generic";
  }

  try {
    const result = await runCi(projectPath, { provider, force });

    if (result.alreadyExists) {
      console.error(`${result.outputPath} already exists.`);
      console.error("Use --force to overwrite.");
      process.exit(1);
    }

    if (provider === "generic") {
      console.log(result.content);
    } else {
      console.log(`Generated ${result.outputPath}`);
    }

    process.exit(0);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error("Error running ci:", error);
    }
    process.exit(1);
  }
}

async function handleStatus(args: string[]) {
  const projectPath = process.cwd();
  const jsonOutput = args.includes("--json");

  try {
    const result = await runStatus(projectPath, { json: jsonOutput });

    if (jsonOutput) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatStatus(result));
    }

    process.exit(0);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error("Error running status:", error);
    }
    process.exit(1);
  }
}

async function handleTasks(args: string[]) {
  const projectPath = process.cwd();
  const allFlag = args.includes("--all");

  // Parse --aide option
  const aideIndex = args.indexOf("--aide");
  const aideFile = aideIndex !== -1 ? args[aideIndex + 1] : undefined;

  try {
    const result = await runTasks(projectPath, { all: allFlag, aide: aideFile });
    console.log(formatTasks(result));
    process.exit(0);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error("Error running tasks:", error);
    }
    process.exit(1);
  }
}

async function handleVisualize(args: string[]) {
  // Parse options
  const aideIndex = args.indexOf("--aide");
  const outputIndex = args.indexOf("--output");

  const options: { aide?: string; output?: string } = {};

  // Check for positional argument (first non-option arg that ends in .aide)
  const positionalArg = args.find((arg, idx) => {
    if (arg.startsWith("--")) return false;
    // Skip if this arg is the value for --aide or --output
    if (aideIndex !== -1 && idx === aideIndex + 1) return false;
    if (outputIndex !== -1 && idx === outputIndex + 1) return false;
    return arg.endsWith(".aide");
  });
  if (positionalArg) {
    options.aide = positionalArg;
  }

  if (aideIndex !== -1 && args[aideIndex + 1]) {
    options.aide = args[aideIndex + 1];
  }

  if (outputIndex !== -1 && args[outputIndex + 1]) {
    options.output = args[outputIndex + 1];
  }

  // Derive project path from aide file path if it's absolute, otherwise use cwd
  let projectPath = process.cwd();
  if (options.aide && options.aide.startsWith("/")) {
    const { dirname } = await import("path");
    projectPath = dirname(options.aide);
  }

  try {
    const result = await runVisualize(projectPath, options);
    console.error(`Generated visualizer: ${result.outputPath}`);
    console.error(`  ${result.bytesWritten} bytes written`);
    process.exit(0);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error("Error running visualize:", error);
    }
    process.exit(1);
  }
}

async function handleAide(args: string[]) {
  const subcommand = args[0];

  if (!subcommand || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    printAideHelp();
    process.exit(0);
  }

  const subArgs = args.slice(1);

  if (subcommand === "init") {
    await handleAideInit(subArgs);
  } else if (subcommand === "add") {
    await handleAideAdd(subArgs);
  } else if (subcommand === "update") {
    await handleAideUpdate(subArgs);
  } else if (subcommand === "remove") {
    await handleAideRemove(subArgs);
  } else if (subcommand === "link") {
    await handleAideLink(subArgs);
  } else if (subcommand === "show") {
    await handleAideShow(subArgs);
  } else if (subcommand === "validate") {
    await handleAideValidate(subArgs);
  } else if (subcommand === "lock") {
    await handleAideLock(subArgs);
  } else if (subcommand === "diff") {
    await handleAideDiff(subArgs);
  } else {
    console.error(`Unknown aide subcommand: ${subcommand}`);
    console.error('Run "bantay aide help" for usage information.');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
