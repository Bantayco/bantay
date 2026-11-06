# bantay — seed

The organizer's answers, so AUTHOR.md does not have to ask. An agent running
AUTHOR.md with this file present interviews only where this is silent or
contradicts itself. Everything here is `[stated]` by the organizer unless
marked *open*.

## Intent

Bantay is a control plane for software built by agents: you declare what the
product must do and must never do in an `.aide`, and Bantay continuously
reconciles the code against it — every PR, every agent session, every change.

Kubernetes, not Terraform: declared end state, a loop that keeps converging,
an actuator (the agent) that is never trusted.

## Jobs (root CUJs)

Grouped by what the organizer hires the tool for. Each is a subcommand and
gets a child aide, `bantay.<command>.aide`.

**Start.**
- `init` — detect the stack, generate the first invariants and the agent
  prompts (`CLAUDE.md`, slash commands). *primary*
- `aide` — add / update / remove / link entities in the aide; validate; lock.
  The only way the aide is mutated by tooling. *primary*
- `reverse` — propose an aide from an existing codebase (prompt for an agent).
  *secondary*

**Govern.**
- `check` — verify every invariant against the code: static checkers for the
  mechanical ones, the decision oracle for the rest; diff-scoped. *primary*
- `gate` — classify a proposed change against the aide's closed transition
  vocabulary and invariants; allow / escalate / reject. *primary*
- `diff` — classify every entity change since the lock, with a corrective
  action per type. *primary*
- `status` — which scenarios are implemented (a test references the id) and
  which are missing. *primary*
- `ci` — emit the CI workflow that runs check on every PR. *secondary*

**Build.**
- `tasks` — turn the diff into an ordered task list per CUJ. *primary*
- `orchestrate` — the build lead: plan per CUJ, validate the plan, ≤2
  teammates in worktrees, gate every state change, check after every merge,
  restartable from files. *primary*
- `export` — project the aide into what agents read: `invariants.md`,
  `CLAUDE.md`, `.cursorrules`, `AGENTS.md`, CSS tokens. Deterministic. *primary*

**Understand.**
- `visualize` — screen map, state graph, scenario walkthrough as HTML.
  *secondary*
- `derive-graph` — derive states and transitions from scenario text.
  *secondary*
- `journeys` — cluster the graph and propose CUJ boundaries. *tertiary*
- `formalize` — export Alloy / TLA+ / Lean skeletons from the aide; check
  proofs compile. *tertiary*

Dependency order: `init` → `aide` → {`check`, `export`, `diff`} → `tasks` →
`orchestrate`; `derive-graph` → `journeys` → `visualize`; `gate`, `reverse`,
`formalize` depend only on `aide`; `ci` depends on `check`.

## Foundations

- One file the user writes. Everything else is generated.
- The aide is the product. The code is a disposable rendering of it.
- Enforcement is deterministic where it can be, calibrated where it can't:
  same code, same invariants, same result — and when a model judges, it
  reports a probability, and code decides.
- Bantay is a compiler error, not a review comment. It can't be ignored.
- Bantay governs; it does not host. Git and CI are the integration surface.
- The CLI works without network access, except for the decision oracle,
  which is optional. Your code never leaves your machine otherwise.
- Bantay checks itself. If we don't trust it on our own code, nobody should.
- Nothing the build lead knows exists only in its context window.

## Constraints (with rationale)

- **Bun + TypeScript, published to npm, run via `bunx`/`npx`.** On-distribution
  stack: agents produce their best code in the stack they've seen most.
- **`invariants.md` never contains executable code.** All enforcement goes
  through checker modules. Rationale: a spec that can run shell commands is
  an attack surface and a trust problem; checkers have one interface and one
  result shape whether built-in, community, or project.
- **Built-in checkers registered in one registry module; project checkers
  discovered from `.bantay/checkers/`; resolution project > community >
  built-in.** Rationale: one lookup path, overridable locally.
- **Stack detection is plugin-based: one module per framework/ORM/auth with
  `detect()` and `generate()`.** Rationale: adding a stack must not touch
  init.
- **Slash-command prompts are markdown files in `src/templates/commands/`,
  not template literals.** Rationale: prompts are read and edited by humans
  far more than code is; diffs must be readable.
- **Every model judgment goes through the `DecisionModel` interface (noul /
  choice / score with probabilities and confidence). No command calls a
  model API directly.** Rationale: vibez.pub failed on generative-LLM
  orchestration — token cost, fragile loops. A typed decision oracle (Jev,
  TypeSafe System One) is one cheap call per proposed transition with a
  confidence number; the interface stays provider-neutral so an open-weight
  model or a generative fallback is a config change.
- **Decisions below the confidence threshold escalate to the organizer;
  they never default to allow or reject.** Rationale: the calibrated
  probability is the whole value of a decision model; collapsing the
  uncertain band throws it away.
- **Architect and builder agents stay separate.** The architect writes
  constraints with rationale into the aide; the builder executes against
  them; Bantay gates the gap. Rationale: an agent that can rewrite the
  constraint it is violating is not governed.
- **Stack decisions are sticky constraints**, recorded with rationale,
  overridable only by a formal argument addressing that rationale.
- **The aide is the trust anchor for formal verification.** Alloy/TLA+/Lean
  exports are derived artifacts, never the source of truth.
- **Diff is entity-level, not line-level**, against `.aide.lock`. Rationale:
  the corrective action depends on *what kind* of thing changed.
- **The transition set (`tr_*`) is closed.** An agent may propose a change,
  never a new transition; adding one is a spec change for the organizer.

## Invariants — what scares the organizer

- A decision-oracle error or missing answer yields *skipped* or *escalate*,
  never *pass* or *allow*. (Oracle outage must not green-light anything.)
- The gate only ever allows a change that maps to exactly one declared
  transition.
- A scenario is marked implemented only when a test references its id or
  name. (No fuzzy "looks done.")
- Every entity or relationship change since the lock appears in the diff
  exactly once, with a type and a corrective action.
- `bantay export` is idempotent: byte-identical output when the aide hasn't
  changed.
- `init` never overwrites a file the user wrote; `--force` is explicit.
- Checkers are sandboxed: no network, no `eval`, no writes outside the
  project, exit code is the only result channel.
- Stable ids: no command renames an entity id.
- Status completes in seconds on a 10k-file repo. (Fast enough to run on
  every commit or it won't be run.)
- `check` on an unchanged repo with an unchanged aide produces the same
  result every time.

## Wisdom

- LLM stochasticity *validates* the product: the same bootstrap run twice
  gives different code. That is the argument for a loop, not a one-shot.
- Loop 2 (enforce) is cheaper and converges more reliably than loop 1
  (distill). Ship the enforcer first; credibility comes from the CLI, not
  the visual editor.
- Context compaction is lossy. Anything the agent must never forget goes in
  `CLAUDE.md` or a file, not in conversation.
- Every production bug is a missing invariant. Add it the day it happens.
- Multi-file agent edits are the highest-risk operation; plans are validated
  against the real filesystem before anyone writes code, because the plan is
  where hallucination is cheapest to catch.
- Black boxes (models, estimators, third parties) get their own aide; Bantay
  governs the deterministic journey around them, never the box.
- The `enforced_by` → `protected_by` rename happened because the docs and the
  code drifted. The linter caught it. That is the product working.

## Split plan

Root `bantay.aide`: intent, foundations, wisdom, the constraints above, the
cross-cutting invariants, and one `cuj_bantay_<command>` per job, each
`delegates_to bantay.<command>`. No scenarios in the root.

One child per subcommand, holding its CUJs, scenarios, and any invariant or
constraint that applies only to it. Children reference root invariants by
id.

## Open

- Secrets management for third-party APIs (the oracle key today) — not
  designed.
- Per-aide locks: `aide lock` / `diff` snapshot the root only; a child edit is
  invisible to `diff`.
- Runtime gate: the same `gate` inside the built app, so a user's agent
  mutating app state goes through the same transition vocabulary. Not built.
- Dashboard / threat-signal monitoring from the requirements doc: deferred;
  not part of the CLI.
