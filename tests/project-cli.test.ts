/**
 * Composition (SPEC §8) at the CLI level: a root aide plus child aides.
 * - discovery picks the root, never a child
 * - `aide validate` lints the whole project
 * - exports read the merged view (child invariants included)
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { spawn } from "bun";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

const ROOT = `spec: "1.0"
entities:
  shop:
    display: page
    props: { title: Shop }
  cujs: { parent: shop }
  cuj_shop_checkout:
    parent: cujs
    props: { feature: Customer checks out, tier: primary, area: checkout }
  invariants: { parent: shop }
  inv_no_double_charge:
    parent: invariants
    props: { statement: A cart is charged at most once, category: money_integrity, threat_signal: Two charges for one cart }
relationships:
  - { from: cuj_shop_checkout, to: shop.checkout, type: delegates_to, cardinality: many_to_one }
`;

const CHILD = `spec: "1.0"
entities:
  checkout:
    display: page
    props: { title: shop checkout }
  cujs: { parent: checkout }
  cuj_pay_card:
    parent: cujs
    props: { feature: Customer pays by card, tier: primary, area: checkout }
  sc_pay_card_ok:
    parent: cuj_pay_card
    props: { name: Card accepted, given: Valid card, when: Customer submits, then: [Order confirmed] }
  invariants: { parent: checkout }
  inv_card_never_logged:
    parent: invariants
    props: { statement: Card numbers never appear in logs, category: privacy, threat_signal: PAN in a log line }
relationships:
  - { from: sc_pay_card_ok, to: inv_no_double_charge, type: protected_by, cardinality: many_to_many }
  - { from: sc_pay_card_ok, to: inv_card_never_logged, type: protected_by, cardinality: many_to_many }
`;

async function run(cwd: string, ...args: string[]) {
  const p = spawn({ cmd: [process.execPath, "run", CLI, ...args], cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { stdout, stderr, code };
}

describe("aide project (root + child aides)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bantay-project-"));
    await writeFile(join(dir, "shop.aide"), ROOT);
    await writeFile(join(dir, "shop.checkout.aide"), CHILD);
  });
  afterEach(async () => rm(dir, { recursive: true, force: true }));

  test("aide validate lints the whole project and picks the root automatically", async () => {
    const { stdout, code } = await run(dir, "aide", "validate");
    expect(code).toBe(0);
    expect(stdout).toContain("Aide project is valid (2 aides)");
    expect(stdout).toContain("shop.checkout");
  });

  test("a child referencing an inherited root invariant is not an orphan (COMP-12)", async () => {
    const { stdout, stderr, code } = await run(dir, "aide", "validate");
    expect(code).toBe(0);
    expect(stdout + stderr).not.toContain("W4");
  });

  test("unresolved child is a warning, not an error (COMP-5 / S8)", async () => {
    await rm(join(dir, "shop.checkout.aide"));
    const { stdout, code } = await run(dir, "aide", "validate");
    expect(code).toBe(0);
    expect(stdout).toContain("S8");
  });

  test("duplicate non-section id across aides is W11", async () => {
    await writeFile(join(dir, "shop.checkout.aide"), CHILD.replace("inv_card_never_logged", "inv_no_double_charge"));
    const { stderr, code } = await run(dir, "aide", "validate");
    expect(code).toBe(1);
    expect(stderr).toContain("W11");
  });

  test("export invariants reads the merged view", async () => {
    const { code } = await run(dir, "export", "invariants");
    expect(code).toBe(0);
    const md = await readFile(join(dir, "invariants.md"), "utf-8");
    expect(md).toContain("inv_no_double_charge");
    expect(md).toContain("inv_card_never_logged");
  });

  test("--aide on a child operates on that aide alone (COMP-8)", async () => {
    const { stdout, code } = await run(dir, "aide", "validate", "--aide", "shop.checkout.aide");
    expect(code).toBe(0);
    expect(stdout).toContain("Aide file is valid.");
  });
});
