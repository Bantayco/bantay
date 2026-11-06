/**
 * bantay check + decision oracle: unenforced invariants are judged against the
 * diff by the configured decision model, in one batched call.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { runCheck, runOracle, formatCheckResultsJson } from "../src/commands/check";
import { MockDecisionModel } from "../src/decision";

const INVARIANTS_MD = `# Invariants

## Auth
- [ ] **inv_route_auth**: Every route checks authentication

## Money Integrity
- [ ] **inv_no_double_charge**: A PaymentIntent is charged at most once
- [ ] **inv_idempotent**: Retried charges are idempotent

## Privacy
- [ ] **inv_no_pii_logs**: No PII appears in log output
`;

async function git(cwd: string, ...args: string[]) {
  const p = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  await p.exited;
}

describe("check with decision oracle", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bantay-oracle-"));
    await writeFile(join(dir, "invariants.md"), INVARIANTS_MD);
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "charge.ts"), "export const charge = () => 1;\n");
    await git(dir, "init", "-q");
    await git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "add", "-A");
    await git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init");
    // A change the static checkers know nothing about
    await writeFile(join(dir, "src", "charge.ts"), "export const charge = () => { pay(); pay(); return 2; };\n");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("without an oracle, uncategorized invariants are skipped", async () => {
    const summary = await runCheck(dir, { diff: "HEAD", noOracle: true });
    expect(summary.results.every((r) => r.status === "skipped" || r.status === "pass")).toBe(true);
    expect(summary.review).toBe(0);
  });

  test("with an oracle: one batched call, verdicts by probability band", async () => {
    const oracle = new MockDecisionModel({
      inv_no_double_charge: { type: "noul", probability: 0.93 }, // fail
      inv_no_pii_logs: { type: "noul", probability: 0.05 },      // pass
      inv_idempotent: { type: "noul", probability: 0.5 },        // review
    });
    const summary = await runCheck(dir, { diff: "HEAD", decisionModel: oracle });

    expect(oracle.requests).toHaveLength(1);
    const req = oracle.requests[0];
    expect((req.state as { diff: string }).diff).toContain("pay(); pay();");
    // inv_route_auth has a static (auth) checker, so it never reaches the oracle
    expect(Object.keys(req.questions).sort()).toEqual(["inv_idempotent", "inv_no_double_charge", "inv_no_pii_logs"]);
    expect(req.questions.inv_no_double_charge.type).toBe("noul");

    const byId = Object.fromEntries(summary.results.map((r) => [r.invariant.id, r]));
    expect(byId.inv_no_double_charge.status).toBe("fail");
    expect(byId.inv_no_double_charge.oracle?.violationProbability).toBe(0.93);
    expect(byId.inv_no_pii_logs.status).toBe("pass");
    expect(byId.inv_idempotent.status).toBe("review");
    expect(byId.inv_route_auth.oracle).toBeUndefined();
    expect(summary.review).toBe(1);
    expect(summary.failed).toBe(1);

    const json = await formatCheckResultsJson(summary, dir);
    expect(json.summary.review).toBe(1);
    expect(json.results.find((r: { id: string }) => r.id === "inv_no_double_charge").oracle.provider).toBe("mock");
  });

  test("oracle failure degrades to skipped, never to pass", async () => {
    const broken = { name: "broken", decide: async () => { throw new Error("boom"); } };
    const results = await runOracle(broken, 0.8, "diff", [{ id: "inv_x", category: "c", statement: "s" }]);
    expect(results[0].status).toBe("skipped");
    expect(results[0].message).toContain("boom");
  });
});
