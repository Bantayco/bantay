# CLAUDE.md — Bantay CLI

## What This Is

Bantay is a CLI that enforces project-specific invariants on every PR. One file the user writes (invariants.md), everything else generated.

Four commands: `bantay init`, `bantay check`, `bantay ci`, `bantay export`.

## Stack

- Bun runtime, TypeScript
- Published to npm as `@bantay/cli`
- Zero external runtime dependencies — use Bun built-ins for file I/O, glob, testing
- AST parsing: ts-morph for TypeScript/JavaScript projects
- YAML parsing: built-in or js-yaml for bantay.config.yml
- CLI framework: keep it minimal — Bun.argv or commander at most

## Architectural Constraints

- **Static analysis only.** bantay check uses AST parsing, glob, regex, schema inspection. Never import, require, or eval project code. A malicious project must not be able to execute code through bantay.
- **invariants.md is the single source of truth.** No invariant is enforced that isn't defined in this file. No hidden rules. No defaults that aren't in the generated file.
- **Agent context exports use section markers.** `<!-- bantay:start -->` and `<!-- bantay:end -->` delimit the Bantay section. Content outside markers is never touched.
- **CI output: JSON to stdout, human summary to stderr.** Never mix them. JSON includes timestamp, commit SHA, invariant IDs, pass/fail per invariant.
- **Checker registry pattern.** Each invariant category (auth, schema, logging, etc.) maps to a registered checker module. No magic discovery. Adding a checker is explicit.
- **Stack detection plugin pattern.** Each framework/ORM/auth detector is a separate module with detect() and generate() functions. New stack support = new detector, registered explicitly.
- **No network requests.** The CLI is fully offline. No telemetry, no install-time downloads, no API calls.
- **Never modify project source files.** Bantay reads project files and writes only its own outputs (invariants.md, config, CI workflow, agent context sections).

## Build Order

1. **Init** — stack detection plugins, invariants.md generation, config generation
2. **Check** — invariant parser, checker registry, checker modules, diff-aware mode
3. **CI** — GitHub Actions generator, GitLab generator, JSON audit output
4. **Export** — section marker logic, CLAUDE.md/cursorrules/AGENTS.md formatters

## Testing

Use bun:test. Every invariant from bantay.aide becomes a test:
- bantay check never reports PASS for a violated invariant
- bantay check exits non-zero on violation
- bantay check --diff is strict subset of full check
- Export is idempotent (run twice, byte-identical)
- Export never modifies content outside markers
- No project code execution during check
- Init never overwrites existing invariants.md

## What NOT To Build

- No MCP server (month 2)
- No property-based test generation (month 2)
- No invariants.lock / diff engine (month 3)
- No dashboard (month 4+)
- No .aide parser (the MVP reads invariants.md directly, not .aide files)

<!-- bantay:start -->

## Bantay Project Rules

*Auto-generated from bantay.aide. Do not edit manually.*

### Design Principles

- One file the user writes. Everything else generated.
- Enforcement is deterministic. Same code, same invariants, same result. Every time.
- Bantay is a compiler error, not a code review comment. You can't ignore it.
- invariants.md grows as understanding grows. Every bug is a missing invariant. The system gets smarter.
- The CLI works without network access. Your code never leaves your machine.
- Bantay checks itself. If we don't trust it on our own code, nobody should.
- A checker is a checker is a checker. Built-in, community, or project — same interface, same result shape, same trust model.

### Architectural Constraints

#### Architecture

- **con_three_tier_checkers**: Checkers exist at three tiers: built-in (ship with @bantay/cli), community (npm packages like @bantay/checker-stripe), and project (.bantay/checkers/*.ts in the repo). All three tiers implement the same interface. Resolution order: project > community > built-in.
  - *Rationale*: Built-in checkers make bantay init useful on day one. Community checkers create a network effect and ecosystem moat. Project checkers let any team enforce rules specific to their codebase without publishing a package. Same interface across all three means bantay check doesn't care where a checker comes from.
- **con_checker_interface**: Every checker exports { name: string, description: string, check(config: CheckerConfig) → CheckResult }. CheckResult is { pass: boolean, violations: Array<{file: string, line: number, message: string}> }. No exceptions. No extensions to the interface without a version bump.
  - *Rationale*: A uniform interface means bantay check can load any checker without special-casing. It means community authors know exactly what to implement. It means the CI audit output has a consistent shape. The interface is the contract between bantay and the checker ecosystem.
- **con_invariants_md_is_truth**: invariants.md is the single source of truth for all enforcement. No invariant is enforced that isn't in this file.
  - *Rationale*: One file, one place to look, one thing to edit. If enforcement could come from config, from hidden defaults, or from the checker itself, trust breaks. The user must be able to read invariants.md and know exactly what's being enforced.
- **con_checker_registry**: Built-in checkers are registered explicitly in a registry module. Community checkers are discovered by package name from invariants.md. Project checkers are discovered from .bantay/checkers/ directory. No magic discovery beyond these three paths.
  - *Rationale*: Three discovery mechanisms, each explicit: a code registry for built-ins, npm require for community, filesystem glob for project. If a checker isn't in one of these three places, it doesn't exist. No classpath scanning, no environment variables, no hidden config.
- **con_stack_detection_plugins**: Stack detection in bantay init uses a plugin pattern. Each framework/ORM/auth detector is a separate module with a detect() and generate() function.
  - *Rationale*: New framework support should not require modifying core init logic. A contributor adds a detector for Django, registers it, done. This is also how the community extends Bantay to stacks beyond the initial supported set.
- **con_prompts_as_files**: Slash command prompts are stored as markdown files in src/templates/commands/, not as template literals in TypeScript.
  - *Rationale*: Prompts embedded in TypeScript are hard to read, hard to edit, and hard for agents to update without breaking string escaping. Separate files are readable, diffable, and editable as standalone documents.

#### Ci

- **con_json_audit_output**: CI check emits structured JSON to stdout. Human-readable summary to stderr. Never mixed.
  - *Rationale*: CI systems parse stdout. Humans read stderr. Mixing them breaks piping, breaks parsers, and makes the audit trail unreliable. JSON on stdout is the seed of the compliance evidence trail that the Dashboard will ingest.

#### Export

- **con_section_markers**: Agent context exports use unambiguous start/end markers that regex can find. Format: <!-- bantay:start --> and <!-- bantay:end -->.
  - *Rationale*: The export must be able to find and replace its own section without parsing the full markdown document. HTML comments are invisible in rendered markdown and won't collide with user content.

#### Security

- **con_no_inline_shell**: invariants.md never contains executable code. No check: fields with shell commands. All enforcement goes through checker modules (built-in, community, or project).
  - *Rationale*: Inline shell commands in invariants.md would mean Bantay executes arbitrary user code during bantay check. This violates inv_no_code_execution. A malicious invariants.md could run destructive commands. Checker modules in .bantay/checkers/ are sandboxed and explicit. Shell strings in markdown are neither.
- **con_static_analysis_only**: Built-in checkers use static analysis only — AST parsing, glob, regex, schema inspection. No project code execution.
  - *Rationale*: Built-in checkers run in the bantay process, not sandboxed. They must be safe by construction. Static analysis means they read files but never execute them. Project and community checkers CAN execute code, but only in a sandboxed subprocess — different trust boundary.

#### Stack

- **con_bun_runtime**: Built with Bun. Published to npm. Consumable via bunx or npx.
  - *Rationale*: Claude Code ships as a Bun executable. Anthropic acquired Bun. The primary user already has Bun on their machine. bun init generates CLAUDE.md. The toolchain is pre-wired. npm distribution ensures Node users aren't excluded.
- **con_bin_field**: package.json bin field maps 'bantay' to src/cli.ts. Bun runs TypeScript directly — no build step.
  - *Rationale*: A CLI that can't be invoked by its name isn't a CLI. The bin field is what makes bunx @bantay/cli init, bun link, and npm global install work. Without it the user types bun run src/cli.ts which is not a product.

#### Visualize

- **con_visualize_mode_toggle**: Visualizer has two modes toggled via a bar at the top: Map and Walkthrough. Map is the default view.

### Invariants (Rules You Must Follow)

#### Auditability

- **inv_stable_ids**: Each invariant in invariants.md has a unique stable ID that persists across edits
- **inv_ci_output_parseable**: CI check output includes machine-parseable JSON with timestamp, commit SHA, and per-invariant results

#### Correctness

- **inv_no_false_negatives**: bantay check never reports PASS for a violated invariant
- **inv_exit_code**: bantay check exits non-zero when any invariant is violated
- **inv_diff_subset**: bantay check --diff results are a strict subset of bantay check full results
- **inv_checker_interface_uniform**: All checkers — built-in, community, and project — implement the same interface and return the same result shape
- **inv_export_all_success**: bantay export all generates every output file without error

#### Integrity

- **inv_export_idempotent**: Running bantay export twice produces identical output
- **inv_no_clobber**: bantay export never modifies content outside its delimited section
- **inv_visualize_aide_agnostic**: The visualizer engine must render any valid aide, not just spout or bantay

#### Orchestration

- **inv_plan_validated**: No plan is committed without passing all 5 validation checks: aide coverage, file references, interface contracts, dependency check, invariant coverage

#### Performance

- **inv_check_speed**: bantay check --diff completes in under 5 seconds for diffs under 500 lines with 50 invariants

#### Portability

- **inv_visualize_self_contained**: Generated visualizer HTML must be a single file with zero external dependencies

#### Prerequisites

- **inv_bun_available**: Bantay verifies Bun runtime is available before any operation
- **inv_cli_invocable**: bantay command resolves to the CLI entry point via bin field in package.json

#### Security

- **inv_no_code_execution**: bantay core never imports, requires, or evals project code. Built-in checkers use static analysis only.
- **inv_checker_sandboxed**: Project and community checkers run in a sandboxed subprocess with no access to bantay internals or the ability to modify files
- **inv_no_inline_shell**: invariants.md never contains executable shell commands. Enforcement is through checker modules only.
- **inv_no_network**: Bantay CLI makes zero network requests during init, check, ci, or export
- **inv_no_source_modification**: Bantay never modifies project source files

#### Trust

- **inv_init_no_overwrite**: bantay init never overwrites an existing invariants.md

<!-- bantay:end -->
