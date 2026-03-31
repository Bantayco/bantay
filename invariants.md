# Invariants

Rules this project must never break. Generated from bantay.aide.

## Auditability

- [ ] **inv_stable_ids**: Each invariant in invariants.md has a unique stable ID that persists across edits
  - Threat: Invariant ID changes when text is edited, breaking audit trail continuity
- [ ] **inv_ci_output_parseable**: CI check output includes machine-parseable JSON with timestamp, commit SHA, and per-invariant results
  - Threat: CI output is human-readable only, no structured data for dashboard ingestion

## Correctness

- [ ] **inv_no_false_negatives**: bantay check never reports PASS for a violated invariant
  - Threat: Violated invariant merged to main without detection
- [ ] **inv_exit_code**: bantay check exits non-zero when any invariant is violated
  - Threat: CI pipeline passes despite invariant violation
- [ ] **inv_diff_subset**: bantay check --diff results are a strict subset of bantay check full results
  - Threat: Diff check misses violation that full check catches
- [ ] **inv_checker_interface_uniform**: All checkers — built-in, community, and project — implement the same interface and return the same result shape
  - Threat: Community or project checker returns unexpected shape causing runtime error in bantay check
- [ ] **inv_export_all_success**: bantay export all generates every output file without error
  - Threat: Export silently skips a file, stale exports persist

## Design Integrity

- [ ] **inv_wireframe_per_component**: Every component entity in the aide must have a corresponding wireframe file at wireframes/<comp_id>.html
  - Threat: Component added to aide without wireframe file, visualizer falls back to text description instead of rendering actual wireframe
- [ ] **inv_wireframe_variant_fallback**: If a scenario references a component variant that has no wireframe file, the engine falls back to the default wireframe without error
  - Threat: Missing variant file causes blank component or render error

## Integrity

- [ ] **inv_export_idempotent**: Running bantay export twice produces identical output
  - Threat: Spurious git diffs after export
- [ ] **inv_no_clobber**: bantay export never modifies content outside its delimited section
  - Threat: User content in CLAUDE.md altered after export
- [ ] **inv_visualize_aide_agnostic**: The visualizer engine must render any valid aide, not just spout or bantay
  - Threat: Hardcoded screen names, CUJ IDs, or product-specific content in the engine

## Orchestration

- [ ] **inv_plan_validated**: No plan is committed without passing all 5 validation checks: aide coverage, file references, interface contracts, dependency check, invariant coverage
  - Threat: Lead hallucinates file paths or API signatures in plan, teammate builds against nonexistent code, entire CUJ wasted

## Performance

- [ ] **inv_check_speed**: bantay check --diff completes in under 5 seconds for diffs under 500 lines with 50 invariants
  - Threat: Developers skip bantay check because it's slower than their linter

## Portability

- [ ] **inv_visualize_self_contained**: Generated visualizer HTML must be a single file with zero external dependencies
  - Threat: External CSS, JS, or font imports that fail offline

## Prerequisites

- [x] **inv_bun_available**: Bantay verifies Bun runtime is available before any operation
  - Threat: Command fails with cryptic error instead of clear install instructions
- [ ] **inv_cli_invocable**: bantay command resolves to the CLI entry point via bin field in package.json
  - Threat: User must type bun run src/cli.ts instead of bantay

## Security

- [ ] **inv_no_code_execution**: bantay core never imports, requires, or evals project code. Built-in checkers use static analysis only.
  - Threat: Arbitrary code execution triggered by scanning a project
- [ ] **inv_checker_sandboxed**: Project and community checkers run in a sandboxed subprocess with no access to bantay internals or the ability to modify files
  - Threat: Malicious project checker escapes sandbox and modifies codebase or exfiltrates data
- [ ] **inv_no_inline_shell**: invariants.md never contains executable shell commands. Enforcement is through checker modules only.
  - Threat: User adds check: rm -rf / to invariants.md and bantay executes it
- [ ] **inv_no_network**: Bantay CLI makes zero network requests during init, check, ci, or export
  - Threat: DNS or HTTP request observed during offline operation
- [ ] **inv_no_source_modification**: Bantay never modifies project source files
  - Threat: Project source file changed after bantay check

## Trust

- [ ] **inv_init_no_overwrite**: bantay init never overwrites an existing invariants.md
  - Threat: User's hand-edited invariants destroyed by re-running init

## Visualize

- [ ] **inv_m3_component_types**: Visual components (comp_*) must declare a type from the M3 component vocabulary
  - Threat: Components with missing type, unknown type, or custom type without description
