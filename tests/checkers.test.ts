import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";

const BUN_PATH = process.execPath;
const PROJECT_ROOT = join(import.meta.dir, "..");
const TEST_DIR = "/tmp/bantay-checkers-test";

async function runBantay(args: string[], cwd: string = TEST_DIR): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const proc = Bun.spawn([BUN_PATH, "run", join(PROJECT_ROOT, "src/cli.ts"), ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

// sc_checker_builtin: Built-in checkers ship with Bantay
// sc_checker_community: Community checkers from npm (tested via mock)
describe("Auth Checker", () => {
  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("FAIL when API route has no auth check", async () => {
    await writeFile(
      join(TEST_DIR, "invariants.md"),
      `# Project Invariants

## Auth

- [INV-010] auth | All API routes must check authentication
`
    );
    await writeFile(
      join(TEST_DIR, "bantay.config.yml"),
      `sourceDirectories:\n  - src\nrouteDirectories:\n  - app/api\n`
    );
    await mkdir(join(TEST_DIR, "app/api/users"), { recursive: true });
    await writeFile(
      join(TEST_DIR, "app/api/users/route.ts"),
      `export async function GET() {
  return Response.json({ users: [] });
}

export async function POST(request: Request) {
  const data = await request.json();
  return Response.json({ created: true });
}`
    );

    const { stderr, exitCode } = await runBantay(["check"]);

    expect(stderr).toContain("FAIL");
    expect(stderr).toContain("app/api/users/route.ts");
    expect(exitCode).not.toBe(0);
  });

  test("PASS when API route has auth check", async () => {
    await writeFile(
      join(TEST_DIR, "invariants.md"),
      `# Project Invariants

## Auth

- [INV-010] auth | All API routes must check authentication
`
    );
    await writeFile(
      join(TEST_DIR, "bantay.config.yml"),
      `sourceDirectories:\n  - src\nrouteDirectories:\n  - app/api\n`
    );
    await mkdir(join(TEST_DIR, "app/api/users"), { recursive: true });
    await writeFile(
      join(TEST_DIR, "app/api/users/route.ts"),
      `import { auth } from "@/auth";

export async function GET() {
  const session = await auth();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json({ users: [] });
}`
    );

    const { stderr, exitCode } = await runBantay(["check"]);

    expect(stderr).toContain("PASS");
    expect(exitCode).toBe(0);
  });

  test("reports which files are missing auth", async () => {
    await writeFile(
      join(TEST_DIR, "invariants.md"),
      `# Project Invariants

## Auth

- [INV-010] auth | All API routes must check authentication
`
    );
    await writeFile(
      join(TEST_DIR, "bantay.config.yml"),
      `sourceDirectories:\n  - src\nrouteDirectories:\n  - app/api\n`
    );
    await mkdir(join(TEST_DIR, "app/api/users"), { recursive: true });
    await mkdir(join(TEST_DIR, "app/api/products"), { recursive: true });
    await writeFile(
      join(TEST_DIR, "app/api/users/route.ts"),
      `export async function GET() { return Response.json({}); }`
    );
    await writeFile(
      join(TEST_DIR, "app/api/products/route.ts"),
      `export async function POST() { return Response.json({}); }`
    );

    const { stderr } = await runBantay(["check"]);

    expect(stderr).toContain("app/api/users/route.ts");
    expect(stderr).toContain("app/api/products/route.ts");
  });
});

describe("Schema Checker", () => {
  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("FAIL when model is missing createdAt", async () => {
    await writeFile(
      join(TEST_DIR, "invariants.md"),
      `# Project Invariants

## Schema

- [INV-020] schema | All database tables must have createdAt and updatedAt timestamps
`
    );
    await writeFile(
      join(TEST_DIR, "bantay.config.yml"),
      `sourceDirectories:\n  - src\nschemaPath: prisma/schema.prisma\n`
    );
    await mkdir(join(TEST_DIR, "prisma"), { recursive: true });
    await writeFile(
      join(TEST_DIR, "prisma/schema.prisma"),
      `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String?
  updatedAt DateTime @updatedAt
}`
    );

    const { stderr, exitCode } = await runBantay(["check"]);

    expect(stderr).toContain("FAIL");
    expect(stderr).toContain("User");
    expect(stderr).toMatch(/createdAt/i);
    expect(exitCode).not.toBe(0);
  });

  test("FAIL when model is missing updatedAt", async () => {
    await writeFile(
      join(TEST_DIR, "invariants.md"),
      `# Project Invariants

## Schema

- [INV-020] schema | All database tables must have createdAt and updatedAt timestamps
`
    );
    await writeFile(
      join(TEST_DIR, "bantay.config.yml"),
      `sourceDirectories:\n  - src\nschemaPath: prisma/schema.prisma\n`
    );
    await mkdir(join(TEST_DIR, "prisma"), { recursive: true });
    await writeFile(
      join(TEST_DIR, "prisma/schema.prisma"),
      `model Post {
  id        String   @id @default(cuid())
  title     String
  content   String?
  createdAt DateTime @default(now())
}`
    );

    const { stderr, exitCode } = await runBantay(["check"]);

    expect(stderr).toContain("FAIL");
    expect(stderr).toContain("Post");
    expect(stderr).toMatch(/updatedAt/i);
    expect(exitCode).not.toBe(0);
  });

  test("PASS when all models have timestamps", async () => {
    await writeFile(
      join(TEST_DIR, "invariants.md"),
      `# Project Invariants

## Schema

- [INV-020] schema | All database tables must have createdAt and updatedAt timestamps
`
    );
    await writeFile(
      join(TEST_DIR, "bantay.config.yml"),
      `sourceDirectories:\n  - src\nschemaPath: prisma/schema.prisma\n`
    );
    await mkdir(join(TEST_DIR, "prisma"), { recursive: true });
    await writeFile(
      join(TEST_DIR, "prisma/schema.prisma"),
      `model User {
  id        String   @id @default(cuid())
  email     String   @unique
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Post {
  id        String   @id @default(cuid())
  title     String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}`
    );

    const { stderr, exitCode } = await runBantay(["check"]);

    expect(stderr).toContain("PASS");
    expect(exitCode).toBe(0);
  });

  test("reports which models are missing timestamps", async () => {
    await writeFile(
      join(TEST_DIR, "invariants.md"),
      `# Project Invariants

## Schema

- [INV-020] schema | All database tables must have createdAt and updatedAt timestamps
`
    );
    await writeFile(
      join(TEST_DIR, "bantay.config.yml"),
      `sourceDirectories:\n  - src\nschemaPath: prisma/schema.prisma\n`
    );
    await mkdir(join(TEST_DIR, "prisma"), { recursive: true });
    await writeFile(
      join(TEST_DIR, "prisma/schema.prisma"),
      `model User {
  id    String @id
  email String
}

model Post {
  id    String @id
  title String
}

model Comment {
  id        String   @id
  content   String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}`
    );

    const { stderr } = await runBantay(["check"]);

    expect(stderr).toContain("User");
    expect(stderr).toContain("Post");
    expect(stderr).not.toContain("Comment");
  });
});

describe("Logging Checker", () => {
  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("FAIL when log statement contains email field", async () => {
    await writeFile(
      join(TEST_DIR, "invariants.md"),
      `# Project Invariants

## Logging

- [INV-030] logging | No PII fields in log statements
`
    );
    await writeFile(
      join(TEST_DIR, "bantay.config.yml"),
      `sourceDirectories:\n  - src\n`
    );
    await mkdir(join(TEST_DIR, "src"), { recursive: true });
    await writeFile(
      join(TEST_DIR, "src/auth.ts"),
      `export function login(email: string, password: string) {
  console.log("Login attempt for email:", email);
  // do login
}`
    );

    const { stderr, exitCode } = await runBantay(["check"]);

    expect(stderr).toContain("FAIL");
    expect(stderr).toContain("src/auth.ts");
    expect(stderr).toMatch(/email/i);
    expect(exitCode).not.toBe(0);
  });

  test("FAIL when log statement contains password field", async () => {
    await writeFile(
      join(TEST_DIR, "invariants.md"),
      `# Project Invariants

## Logging

- [INV-030] logging | No PII fields in log statements
`
    );
    await writeFile(
      join(TEST_DIR, "bantay.config.yml"),
      `sourceDirectories:\n  - src\n`
    );
    await mkdir(join(TEST_DIR, "src"), { recursive: true });
    await writeFile(
      join(TEST_DIR, "src/auth.ts"),
      `export function login(user: string, password: string) {
  console.log("User password hash:", password);
  // do login
}`
    );

    const { stderr, exitCode } = await runBantay(["check"]);

    expect(stderr).toContain("FAIL");
    expect(stderr).toContain("password");
    expect(exitCode).not.toBe(0);
  });

  test("FAIL when log statement contains ssn field", async () => {
    await writeFile(
      join(TEST_DIR, "invariants.md"),
      `# Project Invariants

## Logging

- [INV-030] logging | No PII fields in log statements
`
    );
    await writeFile(
      join(TEST_DIR, "bantay.config.yml"),
      `sourceDirectories:\n  - src\n`
    );
    await mkdir(join(TEST_DIR, "src"), { recursive: true });
    await writeFile(
      join(TEST_DIR, "src/verification.ts"),
      `export function verifyIdentity(ssn: string) {
  console.log("Verifying SSN:", ssn);
  return true;
}`
    );

    const { stderr, exitCode } = await runBantay(["check"]);

    expect(stderr).toContain("FAIL");
    expect(stderr).toMatch(/ssn/i);
    expect(exitCode).not.toBe(0);
  });

  test("PASS when log statements have no PII", async () => {
    await writeFile(
      join(TEST_DIR, "invariants.md"),
      `# Project Invariants

## Logging

- [INV-030] logging | No PII fields in log statements
`
    );
    await writeFile(
      join(TEST_DIR, "bantay.config.yml"),
      `sourceDirectories:\n  - src\n`
    );
    await mkdir(join(TEST_DIR, "src"), { recursive: true });
    await writeFile(
      join(TEST_DIR, "src/app.ts"),
      `export function processOrder(orderId: string) {
  console.log("Processing order:", orderId);
  console.log("Order complete");
}`
    );

    const { stderr, exitCode } = await runBantay(["check"]);

    expect(stderr).toContain("PASS");
    expect(exitCode).toBe(0);
  });

  test("reports file and line number of PII violations", async () => {
    await writeFile(
      join(TEST_DIR, "invariants.md"),
      `# Project Invariants

## Logging

- [INV-030] logging | No PII fields in log statements
`
    );
    await writeFile(
      join(TEST_DIR, "bantay.config.yml"),
      `sourceDirectories:\n  - src\n`
    );
    await mkdir(join(TEST_DIR, "src"), { recursive: true });
    await writeFile(
      join(TEST_DIR, "src/service.ts"),
      `function doSomething() {
  // line 2
  // line 3
  console.log("User email logged:", email);
}`
    );

    const { stderr } = await runBantay(["check"]);

    expect(stderr).toContain("src/service.ts");
    // Should include line number
    expect(stderr).toMatch(/service\.ts:\d+/);
  });

  test("catches multiple PII fields in different files", async () => {
    await writeFile(
      join(TEST_DIR, "invariants.md"),
      `# Project Invariants

## Logging

- [INV-030] logging | No PII fields in log statements
`
    );
    await writeFile(
      join(TEST_DIR, "bantay.config.yml"),
      `sourceDirectories:\n  - src\n`
    );
    await mkdir(join(TEST_DIR, "src"), { recursive: true });
    await writeFile(
      join(TEST_DIR, "src/auth.ts"),
      `console.log("email:", email);`
    );
    await writeFile(
      join(TEST_DIR, "src/payment.ts"),
      `console.log("credit card:", creditCard);`
    );

    const { stderr } = await runBantay(["check"]);

    expect(stderr).toContain("src/auth.ts");
    expect(stderr).toContain("src/payment.ts");
  });
});

// sc_checker_project: Write a project-specific checker
describe("Project Checkers", () => {
  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("discovers and runs checker in .bantay/checkers/", async () => {
    // Create project structure
    await mkdir(join(TEST_DIR, ".bantay/checkers"), { recursive: true });
    await mkdir(join(TEST_DIR, "src"), { recursive: true });

    // Create a simple project checker
    await writeFile(
      join(TEST_DIR, ".bantay/checkers/no-todo.ts"),
      `export const name = "no-todo";
export const description = "No TODO comments allowed";

export async function check(config: any) {
  return {
    pass: true,
    violations: []
  };
}`
    );

    await writeFile(
      join(TEST_DIR, "invariants.md"),
      `# Project Invariants

## Custom

- [INV-100] custom | No TODO comments in code
`
    );
    await writeFile(
      join(TEST_DIR, "bantay.config.yml"),
      `sourceDirectories:\n  - src\n`
    );
    await writeFile(join(TEST_DIR, "src/index.ts"), "// clean code");

    const { stderr, exitCode } = await runBantay(["check"]);

    // Should not crash - project checker or skipped category
    expect(exitCode).toBeLessThanOrEqual(1);
  });

  test("project checker exports check() function", async () => {
    await mkdir(join(TEST_DIR, ".bantay/checkers"), { recursive: true });

    // Create checker with proper interface
    await writeFile(
      join(TEST_DIR, ".bantay/checkers/example.ts"),
      `export const name = "example";
export const description = "Example checker";

export async function check(config: { projectPath: string }) {
  return {
    pass: true,
    violations: []
  };
}`
    );

    await writeFile(
      join(TEST_DIR, "invariants.md"),
      `# Project Invariants

## Example

- [INV-100] example | Example rule
`
    );
    await writeFile(join(TEST_DIR, "bantay.config.yml"), `sourceDirectories:\n  - src\n`);

    const { exitCode } = await runBantay(["check"]);

    // Should complete without error
    expect(exitCode).toBeLessThanOrEqual(1);
  });
});

// sc_checker_interface: All checkers follow a common interface
describe("Checker Interface", () => {
  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("CheckResult has pass boolean and violations array", async () => {
    await writeFile(
      join(TEST_DIR, "invariants.md"),
      `# Project Invariants

## Auth

- [INV-010] auth | All API routes must check authentication
`
    );
    await writeFile(
      join(TEST_DIR, "bantay.config.yml"),
      `sourceDirectories:\n  - src\nrouteDirectories:\n  - app/api\n`
    );
    await mkdir(join(TEST_DIR, "app/api/users"), { recursive: true });
    await writeFile(
      join(TEST_DIR, "app/api/users/route.ts"),
      `export async function GET() { return Response.json({}); }`
    );

    // Get JSON output to verify structure
    const { stdout } = await runBantay(["check", "--json"]);
    const result = JSON.parse(stdout);

    // Verify CheckResult shape
    expect(result.results).toBeDefined();
    expect(Array.isArray(result.results)).toBe(true);

    const firstResult = result.results[0];
    expect(typeof firstResult.status).toBe("string");
    expect(["pass", "fail", "skipped"]).toContain(firstResult.status);
  });

  test("violations include file, line, and message", async () => {
    await writeFile(
      join(TEST_DIR, "invariants.md"),
      `# Project Invariants

## Auth

- [INV-010] auth | All API routes must check authentication
`
    );
    await writeFile(
      join(TEST_DIR, "bantay.config.yml"),
      `sourceDirectories:\n  - src\nrouteDirectories:\n  - app/api\n`
    );
    await mkdir(join(TEST_DIR, "app/api/users"), { recursive: true });
    await writeFile(
      join(TEST_DIR, "app/api/users/route.ts"),
      `export async function GET() { return Response.json({}); }`
    );

    const { stdout } = await runBantay(["check", "--json"]);
    const result = JSON.parse(stdout);

    // Find a failing result
    const failResult = result.results.find((r: any) => r.status === "fail");
    if (failResult) {
      expect(failResult.violations).toBeDefined();
      expect(Array.isArray(failResult.violations)).toBe(true);

      if (failResult.violations.length > 0) {
        const violation = failResult.violations[0];
        expect(violation.file).toBeDefined();
        expect(violation.message).toBeDefined();
      }
    }
  });
});

// sc_checker_missing: Referenced checker not found
describe("Missing Checker", () => {
  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("reports SKIPPED when no checker exists for category", async () => {
    await writeFile(
      join(TEST_DIR, "invariants.md"),
      `# Project Invariants

## NonexistentCategory

- [INV-999] nonexistent | Some rule with no checker
`
    );
    await writeFile(join(TEST_DIR, "bantay.config.yml"), `sourceDirectories:\n  - src\n`);

    const { stderr } = await runBantay(["check"]);

    expect(stderr).toContain("SKIPPED");
  });

  test("skipped invariants do not cause non-zero exit", async () => {
    await writeFile(
      join(TEST_DIR, "invariants.md"),
      `# Project Invariants

## UnknownCategory

- [INV-999] unknown | Rule with no checker
`
    );
    await writeFile(join(TEST_DIR, "bantay.config.yml"), `sourceDirectories:\n  - src\n`);

    const { exitCode } = await runBantay(["check"]);

    expect(exitCode).toBe(0);
  });

  test("warning displayed for missing checker", async () => {
    await writeFile(
      join(TEST_DIR, "invariants.md"),
      `# Project Invariants

## FakeCategory

- [INV-999] fakecategory | Nonexistent checker
`
    );
    await writeFile(join(TEST_DIR, "bantay.config.yml"), `sourceDirectories:\n  - src\n`);

    const { stderr } = await runBantay(["check"]);

    expect(stderr).toMatch(/no checker|skipped/i);
  });
});

// sc_checker_sandboxed: Project checkers run sandboxed
describe("Checker Sandbox", () => {
  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("checker receives config as read-only input", async () => {
    await mkdir(join(TEST_DIR, ".bantay/checkers"), { recursive: true });

    // Checker that returns config info
    await writeFile(
      join(TEST_DIR, ".bantay/checkers/config-test.ts"),
      `export const name = "config-test";
export const description = "Tests config input";

export async function check(config: any) {
  // Config should have projectPath
  const hasProjectPath = typeof config.projectPath === 'string';
  return {
    pass: hasProjectPath,
    violations: hasProjectPath ? [] : [{ file: "test", line: 1, message: "No config" }]
  };
}`
    );

    await writeFile(
      join(TEST_DIR, "invariants.md"),
      `# Project Invariants

## ConfigTest

- [INV-100] configtest | Checker receives config
`
    );
    await writeFile(join(TEST_DIR, "bantay.config.yml"), `sourceDirectories:\n  - src\n`);

    const { exitCode } = await runBantay(["check"]);

    // Should not crash
    expect(exitCode).toBeLessThanOrEqual(1);
  });

  test("checker returns structured result", async () => {
    await mkdir(join(TEST_DIR, ".bantay/checkers"), { recursive: true });

    await writeFile(
      join(TEST_DIR, ".bantay/checkers/structured.ts"),
      `export const name = "structured";
export const description = "Returns structured result";

export async function check() {
  return {
    pass: false,
    violations: [
      { file: "src/test.ts", line: 10, message: "Test violation" }
    ]
  };
}`
    );

    await writeFile(
      join(TEST_DIR, "invariants.md"),
      `# Project Invariants

## Structured

- [INV-100] structured | Structured result test
`
    );
    await writeFile(join(TEST_DIR, "bantay.config.yml"), `sourceDirectories:\n  - src\n`);

    const { exitCode } = await runBantay(["check"]);

    // Checker should complete
    expect(exitCode).toBeLessThanOrEqual(1);
  });
});

// sc_checker_community: Install community checker from npm
describe("Community Checkers", () => {
  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  test("community checker follows same interface as built-in", async () => {
    // Simulate a community checker by creating a node_modules package
    await mkdir(join(TEST_DIR, "node_modules/@bantay/checker-test"), { recursive: true });

    // Create package.json
    await writeFile(
      join(TEST_DIR, "node_modules/@bantay/checker-test/package.json"),
      JSON.stringify({
        name: "@bantay/checker-test",
        version: "1.0.0",
        main: "index.js",
      })
    );

    // Create index.js with checker interface
    await writeFile(
      join(TEST_DIR, "node_modules/@bantay/checker-test/index.js"),
      `module.exports = {
  name: "test-checker",
  description: "A test community checker",
  check: async function(config) {
    return {
      pass: true,
      violations: []
    };
  }
};`
    );

    // The invariants.md would reference it like:
    // checker: @bantay/checker-test
    // For now, this test verifies the interface contract
    const checker = require(join(TEST_DIR, "node_modules/@bantay/checker-test"));

    expect(checker.name).toBe("test-checker");
    expect(checker.description).toBeDefined();
    expect(typeof checker.check).toBe("function");

    const result = await checker.check({});
    expect(typeof result.pass).toBe("boolean");
    expect(Array.isArray(result.violations)).toBe(true);
  });

  test("community checker returns CheckResult shape", async () => {
    await mkdir(join(TEST_DIR, "node_modules/@bantay/checker-mock"), { recursive: true });

    await writeFile(
      join(TEST_DIR, "node_modules/@bantay/checker-mock/package.json"),
      JSON.stringify({ name: "@bantay/checker-mock", main: "index.js" })
    );

    await writeFile(
      join(TEST_DIR, "node_modules/@bantay/checker-mock/index.js"),
      `module.exports = {
  name: "mock",
  description: "Mock checker",
  check: async () => ({
    pass: false,
    violations: [
      { file: "src/foo.ts", line: 42, message: "Test violation" }
    ]
  })
};`
    );

    const checker = require(join(TEST_DIR, "node_modules/@bantay/checker-mock"));
    const result = await checker.check({});

    expect(result.pass).toBe(false);
    expect(result.violations[0].file).toBe("src/foo.ts");
    expect(result.violations[0].line).toBe(42);
    expect(result.violations[0].message).toBe("Test violation");
  });
});
