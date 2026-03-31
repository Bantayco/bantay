import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

// sc_reverse_fresh: Extract aide from code with no existing aide
// sc_reverse_reconcile: Reconcile code changes against existing aide
// sc_reverse_apply: Apply reverse proposals from JSON
// sc_reverse_focus: Focus scan on specific part of codebase

describe("bantay reverse", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "bantay-reverse-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  async function runBantay(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const proc = Bun.spawn(["bun", "run", join(import.meta.dir, "../src/cli.ts"), ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    return { stdout, stderr, exitCode };
  }

  describe("sc_reverse_fresh: Extract aide from code with no existing aide", () => {
    test("generates structured prompt from package.json", async () => {
      // Given: A codebase with no .aide file
      await writeFile(
        join(testDir, "package.json"),
        JSON.stringify({
          name: "my-app",
          description: "A test application",
          dependencies: { react: "^18.0.0", "next": "^14.0.0" },
        })
      );

      // When: Developer runs bantay reverse --prompt
      const { stdout, exitCode } = await runBantay(["reverse", "--prompt"], testDir);

      // Then: Structured prompt output with codebase summary
      expect(exitCode).toBe(0);
      expect(stdout).toContain("my-app");
      expect(stdout).toContain("A test application");
      expect(stdout).toContain("react");
      expect(stdout).toContain("next");
    });

    test("includes README content in prompt", async () => {
      await writeFile(join(testDir, "package.json"), JSON.stringify({ name: "test-app" }));
      await writeFile(join(testDir, "README.md"), "# My App\n\nThis is a great application that does things.");

      const { stdout, exitCode } = await runBantay(["reverse", "--prompt"], testDir);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("My App");
      expect(stdout).toContain("great application");
    });

    test("includes CLAUDE.md content in prompt", async () => {
      await writeFile(join(testDir, "package.json"), JSON.stringify({ name: "test-app" }));
      await writeFile(join(testDir, "CLAUDE.md"), "# Architecture\n\nThis app uses clean architecture.");

      const { stdout, exitCode } = await runBantay(["reverse", "--prompt"], testDir);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Architecture");
      expect(stdout).toContain("clean architecture");
    });

    test("detects Next.js routes from app directory", async () => {
      await writeFile(join(testDir, "package.json"), JSON.stringify({ name: "nextjs-app", dependencies: { next: "^14.0.0" } }));
      await mkdir(join(testDir, "app"), { recursive: true });
      await mkdir(join(testDir, "app", "dashboard"), { recursive: true });
      await writeFile(join(testDir, "app", "page.tsx"), "export default function Home() { return <div>Home</div>; }");
      await writeFile(join(testDir, "app", "dashboard", "page.tsx"), "export default function Dashboard() { return <div>Dashboard</div>; }");

      const { stdout, exitCode } = await runBantay(["reverse", "--prompt"], testDir);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("/");
      expect(stdout).toContain("/dashboard");
    });

    test("detects Express routes", async () => {
      await writeFile(join(testDir, "package.json"), JSON.stringify({ name: "express-app", dependencies: { express: "^4.0.0" } }));
      await writeFile(
        join(testDir, "app.js"),
        `
const express = require('express');
const app = express();
app.get('/users', (req, res) => res.json([]));
app.post('/users', (req, res) => res.json({}));
app.get('/products/:id', (req, res) => res.json({}));
`
      );

      const { stdout, exitCode } = await runBantay(["reverse", "--prompt"], testDir);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("GET /users");
      expect(stdout).toContain("POST /users");
      expect(stdout).toContain("/products/:id");
    });

    test("detects React components", async () => {
      await writeFile(join(testDir, "package.json"), JSON.stringify({ name: "react-app", dependencies: { react: "^18.0.0" } }));
      await mkdir(join(testDir, "src", "components"), { recursive: true });
      await writeFile(
        join(testDir, "src", "components", "Button.tsx"),
        "export default function Button({ onClick, children }) { return <button onClick={onClick}>{children}</button>; }"
      );
      await writeFile(
        join(testDir, "src", "components", "Modal.tsx"),
        "export default function Modal({ isOpen, onClose }) { if (!isOpen) return null; return <div>Modal</div>; }"
      );

      const { stdout, exitCode } = await runBantay(["reverse", "--prompt"], testDir);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Button");
      expect(stdout).toContain("Modal");
    });

    test("detects state machine from reducer", async () => {
      await writeFile(join(testDir, "package.json"), JSON.stringify({ name: "state-app" }));
      await mkdir(join(testDir, "src"), { recursive: true });
      await writeFile(
        join(testDir, "src", "reducer.ts"),
        `
type State = 'idle' | 'loading' | 'success' | 'error';
type Action = { type: 'FETCH' } | { type: 'SUCCESS' } | { type: 'ERROR' };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'FETCH': return 'loading';
    case 'SUCCESS': return 'success';
    case 'ERROR': return 'error';
    default: return state;
  }
}
`
      );

      const { stdout, exitCode } = await runBantay(["reverse", "--prompt"], testDir);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("idle");
      expect(stdout).toContain("loading");
      expect(stdout).toContain("success");
      expect(stdout).toContain("FETCH");
    });

    test("detects event handlers", async () => {
      await writeFile(join(testDir, "package.json"), JSON.stringify({ name: "event-app" }));
      await mkdir(join(testDir, "src"), { recursive: true });
      await writeFile(
        join(testDir, "src", "App.tsx"),
        `
function App() {
  const handleSubmit = (e) => { e.preventDefault(); /* submit form */ };
  const handleClick = () => { /* do something */ };
  return (
    <form onSubmit={handleSubmit}>
      <button onClick={handleClick}>Click me</button>
    </form>
  );
}
`
      );

      const { stdout, exitCode } = await runBantay(["reverse", "--prompt"], testDir);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("handleSubmit");
      expect(stdout).toContain("handleClick");
    });

    test("outputs prompt for LLM to propose complete aide", async () => {
      await writeFile(join(testDir, "package.json"), JSON.stringify({ name: "test-app", description: "Test" }));

      const { stdout, exitCode } = await runBantay(["reverse", "--prompt"], testDir);

      expect(exitCode).toBe(0);
      // Should contain instructions for the LLM
      expect(stdout).toContain("Screens");
      expect(stdout).toContain("Components");
      expect(stdout).toContain("Transitions");
      expect(stdout).toContain("bantay aide add");
    });
  });

  describe("sc_reverse_reconcile: Reconcile code changes against existing aide", () => {
    test("includes existing aide contents in prompt when .aide file exists", async () => {
      // Given: A codebase with an existing .aide file where code has drifted
      await writeFile(join(testDir, "package.json"), JSON.stringify({ name: "existing-app" }));
      await writeFile(
        join(testDir, "test.aide"),
        `entities:
  my_app:
    display: page
  screens:
    parent: my_app
  screen_home:
    parent: screens
    props:
      name: Home Screen
relationships: []
`
      );

      // When: Developer runs bantay reverse --prompt
      const { stdout, exitCode } = await runBantay(["reverse", "--prompt"], testDir);

      // Then: Prompt includes both codebase summary and current aide contents
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Existing Aide");
      expect(stdout).toContain("screen_home");
      expect(stdout).toContain("Home Screen");
      // Should ask LLM to compare
      expect(stdout).toContain("NEW");
      expect(stdout).toContain("CHANGED");
      expect(stdout).toContain("MISSING");
    });

    test("prompt asks LLM to identify drift between code and aide", async () => {
      await writeFile(join(testDir, "package.json"), JSON.stringify({ name: "drift-app" }));
      await writeFile(join(testDir, "test.aide"), `entities:\n  app:\n    display: page\nrelationships: []`);
      await mkdir(join(testDir, "app"), { recursive: true });
      await mkdir(join(testDir, "app", "settings"), { recursive: true });
      await writeFile(join(testDir, "app", "page.tsx"), "export default function Home() {}");
      await writeFile(join(testDir, "app", "settings", "page.tsx"), "export default function Settings() {}");

      const { stdout, exitCode } = await runBantay(["reverse", "--prompt"], testDir);

      expect(exitCode).toBe(0);
      // Prompt should instruct LLM to compare
      expect(stdout).toContain("Compare code against the aide");
    });
  });

  describe("sc_reverse_focus: Focus scan on specific part of codebase", () => {
    test("--focus=frontend only scans frontend code", async () => {
      // Given: Large codebase
      await writeFile(join(testDir, "package.json"), JSON.stringify({ name: "fullstack-app" }));

      // Frontend
      await mkdir(join(testDir, "src", "components"), { recursive: true });
      await writeFile(join(testDir, "src", "components", "Button.tsx"), "export default function Button() {}");

      // Backend
      await mkdir(join(testDir, "api"), { recursive: true });
      await writeFile(join(testDir, "api", "users.ts"), "export async function getUsers() { return db.users.findMany(); }");
      await writeFile(join(testDir, "api", "auth.ts"), "export async function login() { /* auth logic */ }");

      // When: Developer runs bantay reverse --prompt --focus=frontend
      const { stdout, exitCode } = await runBantay(["reverse", "--prompt", "--focus=frontend"], testDir);

      // Then: Only frontend code scanned and included in prompt
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Button");
      expect(stdout).not.toContain("getUsers");
      expect(stdout).not.toContain("db.users");
    });

    test("--focus=backend only scans backend code", async () => {
      await writeFile(join(testDir, "package.json"), JSON.stringify({ name: "fullstack-app" }));

      // Frontend
      await mkdir(join(testDir, "src", "components"), { recursive: true });
      await writeFile(join(testDir, "src", "components", "Button.tsx"), "export default function Button() {}");

      // Backend
      await mkdir(join(testDir, "api"), { recursive: true });
      await writeFile(join(testDir, "api", "users.ts"), "export async function getUsers() { return []; }");

      const { stdout, exitCode } = await runBantay(["reverse", "--prompt", "--focus=backend"], testDir);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("getUsers");
      expect(stdout).not.toContain("Button.tsx");
    });

    test("--focus=auth only scans auth-related files", async () => {
      await writeFile(join(testDir, "package.json"), JSON.stringify({ name: "auth-app" }));

      // Auth files
      await mkdir(join(testDir, "src", "auth"), { recursive: true });
      await writeFile(join(testDir, "src", "auth", "login.ts"), "export function login(email, password) {}");
      await writeFile(join(testDir, "src", "auth", "session.ts"), "export function getSession() {}");

      // Non-auth files
      await mkdir(join(testDir, "src", "components"), { recursive: true });
      await writeFile(join(testDir, "src", "components", "Button.tsx"), "export default function Button() {}");

      const { stdout, exitCode } = await runBantay(["reverse", "--prompt", "--focus=auth"], testDir);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("login");
      expect(stdout).toContain("getSession");
      expect(stdout).not.toContain("Button.tsx");
    });
  });

  describe("size management", () => {
    test("warns when codebase is too large", async () => {
      await writeFile(join(testDir, "package.json"), JSON.stringify({ name: "large-app" }));

      // Create many files to simulate large codebase
      await mkdir(join(testDir, "src"), { recursive: true });
      for (let i = 0; i < 100; i++) {
        await writeFile(
          join(testDir, "src", `component${i}.tsx`),
          `export default function Component${i}() { return <div>${"x".repeat(1000)}</div>; }`
        );
      }

      const { stdout, stderr, exitCode } = await runBantay(["reverse", "--prompt"], testDir);

      expect(exitCode).toBe(0);
      // Should still work but warn about size
      expect(stdout + stderr).toMatch(/tokens|--focus/i);
    });

    test("truncates large docs to reasonable size", async () => {
      await writeFile(join(testDir, "package.json"), JSON.stringify({ name: "docs-app" }));

      // Create a very large README
      const largeContent = "# Docs\n\n" + "This is a line of documentation.\n".repeat(2000);
      await writeFile(join(testDir, "README.md"), largeContent);

      const { stdout, exitCode } = await runBantay(["reverse", "--prompt"], testDir);

      expect(exitCode).toBe(0);
      // Should include docs but not be excessively long
      expect(stdout.length).toBeLessThan(200000); // Reasonable limit
    });
  });

  describe("framework detection", () => {
    test("detects FastAPI routes", async () => {
      await writeFile(
        join(testDir, "pyproject.toml"),
        `[project]
name = "fastapi-app"
dependencies = ["fastapi"]
`
      );
      await writeFile(
        join(testDir, "main.py"),
        `
from fastapi import FastAPI
app = FastAPI()

@app.get("/users")
async def get_users():
    return []

@app.post("/users")
async def create_user(user: dict):
    return user

@app.get("/products/{product_id}")
async def get_product(product_id: int):
    return {"id": product_id}
`
      );

      const { stdout, exitCode } = await runBantay(["reverse", "--prompt"], testDir);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("GET /users");
      expect(stdout).toContain("POST /users");
      expect(stdout).toContain("/products/{product_id}");
    });

    test("detects SvelteKit routes", async () => {
      await writeFile(join(testDir, "package.json"), JSON.stringify({ name: "svelte-app", devDependencies: { "@sveltejs/kit": "^2.0.0" } }));
      await mkdir(join(testDir, "src", "routes"), { recursive: true });
      await mkdir(join(testDir, "src", "routes", "about"), { recursive: true });
      await writeFile(join(testDir, "src", "routes", "+page.svelte"), "<h1>Home</h1>");
      await writeFile(join(testDir, "src", "routes", "about", "+page.svelte"), "<h1>About</h1>");

      const { stdout, exitCode } = await runBantay(["reverse", "--prompt"], testDir);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("/");
      expect(stdout).toContain("/about");
    });
  });
});
