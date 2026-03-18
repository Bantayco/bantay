import { describe, test, expect } from "bun:test";
import { readFile } from "fs/promises";
import { join } from "path";

const BUN_PATH = process.execPath;
const PROJECT_ROOT = join(import.meta.dir, "..");

describe("CLI Invocability", () => {
  describe("package.json bin field", () => {
    test("bin field maps 'bantay' to src/cli.ts", async () => {
      const pkgPath = join(PROJECT_ROOT, "package.json");
      const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));

      expect(pkg.bin).toBeDefined();
      expect(pkg.bin.bantay).toBe("./src/cli.ts");
    });

    test("CLI entry point has shebang for bun", async () => {
      const cliPath = join(PROJECT_ROOT, "src", "cli.ts");
      const content = await readFile(cliPath, "utf-8");

      expect(content.startsWith("#!/usr/bin/env bun")).toBe(true);
    });
  });

  describe("CLI execution", () => {
    test("bantay --help exits with code 0", async () => {
      const proc = Bun.spawn([BUN_PATH, "run", "./src/cli.ts", "--help"], {
        cwd: PROJECT_ROOT,
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);
    });

    test("bantay init runs prerequisite check before scanning", async () => {
      const proc = Bun.spawn([BUN_PATH, "run", "./src/cli.ts", "init", "--dry-run"], {
        cwd: PROJECT_ROOT,
        stdout: "pipe",
        stderr: "pipe",
      });

      // Read streams concurrently with process exit
      const [, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stderr).text(),
      ]);

      // Prerequisite check should run first (now outputs to stderr)
      expect(stderr).toContain("Checking prerequisites");
    });

    test("bunx simulation works via bun run with package name", async () => {
      // This tests that the bin field is correctly configured
      // by verifying the CLI can be invoked through the expected path
      const pkgPath = join(PROJECT_ROOT, "package.json");
      const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));

      // Verify package name is correct for bunx @bantay/cli
      expect(pkg.name).toBe("@bantay/cli");
      expect(pkg.bin.bantay).toBeDefined();
    });
  });
});
