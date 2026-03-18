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
