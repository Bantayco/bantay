/**
 * CI workflow generator
 *
 * Generates CI configuration for GitHub Actions, GitLab CI, or generic shell commands.
 */

import { readFile, writeFile, access, mkdir } from "fs/promises";
import { join, dirname } from "path";

export interface CiOptions {
  provider: "github-actions" | "gitlab" | "generic";
  force?: boolean;
}

export interface CiResult {
  provider: string;
  outputPath?: string;
  content: string;
  alreadyExists?: boolean;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate GitHub Actions workflow YAML
 */
function generateGitHubWorkflow(): string {
  return `name: Bantay Invariant Check

on:
  pull_request:
    branches: [main, master]
  push:
    branches: [main, master]

jobs:
  bantay-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install

      - name: Run Bantay check
        run: bunx @bantay/cli check --json > bantay-results.json 2>&1 || true

      - name: Upload results
        uses: actions/upload-artifact@v4
        with:
          name: bantay-results
          path: bantay-results.json

      - name: Check for failures
        run: |
          if grep -q '"status":"fail"' bantay-results.json; then
            echo "Invariant violations found!"
            cat bantay-results.json
            exit 1
          fi
          echo "All invariants pass!"
`;
}

/**
 * Generate GitLab CI configuration
 */
function generateGitLabConfig(): string {
  return `# Bantay invariant check stage
# Add this to your .gitlab-ci.yml

bantay:
  stage: test
  image: oven/bun:latest
  script:
    - bun install
    - bunx @bantay/cli check --json > bantay-results.json
  artifacts:
    paths:
      - bantay-results.json
    reports:
      dotenv: bantay-results.json
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH == "main"'
    - if: '$CI_COMMIT_BRANCH == "master"'
`;
}

/**
 * Generate generic CI instructions
 */
function generateGenericInstructions(): string {
  return `# Bantay CI Integration

Run these commands in your CI pipeline:

## Install Bun (if not available)
curl -fsSL https://bun.sh/install | bash

## Install dependencies
bun install

## Run invariant check
bunx @bantay/cli check

## For JSON output (recommended for CI parsing)
bunx @bantay/cli check --json > bantay-results.json

## Exit code
# - 0: All invariants pass
# - 1: One or more invariants failed
# - 2: Configuration error

## Example for common CI systems:

### CircleCI
# jobs:
#   bantay:
#     docker:
#       - image: oven/bun:latest
#     steps:
#       - checkout
#       - run: bun install
#       - run: bunx @bantay/cli check

### Jenkins (Jenkinsfile)
# stage('Bantay Check') {
#   steps {
#     sh 'curl -fsSL https://bun.sh/install | bash'
#     sh 'bun install'
#     sh 'bunx @bantay/cli check'
#   }
# }

### Azure Pipelines
# - script: |
#     curl -fsSL https://bun.sh/install | bash
#     export PATH="$HOME/.bun/bin:$PATH"
#     bun install
#     bunx @bantay/cli check
#   displayName: 'Run Bantay check'
`;
}

/**
 * Run CI generator
 */
export async function runCi(
  projectPath: string,
  options: CiOptions
): Promise<CiResult> {
  const { provider, force } = options;

  if (provider === "github-actions") {
    const workflowDir = join(projectPath, ".github", "workflows");
    const outputPath = join(workflowDir, "bantay.yml");

    // Check if file already exists
    if (await fileExists(outputPath)) {
      if (!force) {
        return {
          provider: "github-actions",
          outputPath,
          content: "",
          alreadyExists: true,
        };
      }
    }

    // Create directory if needed
    await mkdir(workflowDir, { recursive: true });

    // Generate and write workflow
    const content = generateGitHubWorkflow();
    await writeFile(outputPath, content, "utf-8");

    return {
      provider: "github-actions",
      outputPath,
      content,
    };
  }

  if (provider === "gitlab") {
    const outputPath = join(projectPath, ".gitlab-ci.bantay.yml");

    // Check if file already exists
    if (await fileExists(outputPath)) {
      if (!force) {
        return {
          provider: "gitlab",
          outputPath,
          content: "",
          alreadyExists: true,
        };
      }
    }

    // Generate and write config
    const content = generateGitLabConfig();
    await writeFile(outputPath, content, "utf-8");

    return {
      provider: "gitlab",
      outputPath,
      content,
    };
  }

  // Generic - just return instructions, don't write file
  return {
    provider: "generic",
    content: generateGenericInstructions(),
  };
}
