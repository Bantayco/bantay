# Bantay

Write down the rules your system must never break. We enforce them on every PR.

## Quickstart

```bash
bunx @bantay/cli init        # Detect stack, generate invariants.md
bantay check                  # Verify all invariants
bantay export claude          # Export to CLAUDE.md for agent context
bantay ci --github-actions    # Generate CI workflow
```

## Decision oracle (Jev) and the transition gate

Bantay never asks a model for prose. It asks typed questions — *is this
invariant violated? which declared transition is this?* — and a **decision
model** answers with calibrated probabilities. Plain code decides. The default
provider is [Jev](https://typesafe.ai) (TypeSafe's System One model); the
provider is swappable in config.

```yaml
# bantay.config.yml
decision:
  provider: jev          # jev | systemone | ollama | anthropic | mock | none
  model: jev-latest
  threshold: 0.8         # confidence below this escalates to a human
# env: TYPESAFE_API_KEY. Override anything with BANTAY_DECISION_PROVIDER /
# BANTAY_DECISION_MODEL / BANTAY_DECISION_BASE_URL / BANTAY_DECISION_THRESHOLD.
```

| provider | what it is |
|---|---|
| `jev` | TypeSafe Jev, direct (`api.typesafe.ai/v1/systemone`) |
| `systemone` | Any endpoint speaking the System One wire format — a gateway, or a self-hosted open-weight decision model (`baseUrl`) |
| `ollama` / `anthropic` | A generative LLM coerced into the same interface (slower, less calibrated; fine for local dev) |
| `mock` | Scripted answers for tests |

Two call sites:

```bash
bantay check --diff HEAD~1      # unenforced invariants are judged against the diff
                                #   P(violated) ≥ threshold → FAIL, ≤ 1-threshold → PASS, else REVIEW
bantay gate "Tap Save on the editor" --from st_editor_dirty --json
                                # classify a proposal against the aide's tr_* transitions
                                #   exit 0 allow · 1 reject (out of vocabulary / invariant) · 2 escalate
```

The `tr_*` entities in the aide are the **closed transition vocabulary**: an
agent may only move the app through transitions the spec declares. The
orchestrate command gates every state change this way.

## Extract aide from existing code

```bash
bantay reverse --prompt       # Generate prompt for LLM to propose aide
bantay reverse --prompt --focus=frontend  # Focus on frontend only
```

Paste the output into Claude. It will analyze your codebase and generate `bantay aide add` commands.

## Visualize your app

```bash
bantay visualize              # Generate interactive HTML screen map
bantay visualize --output docs/map.html
```

Opens a draggable, zoomable map of screens with transition arrows and walkthrough mode.

## What invariants.md looks like

```markdown
## Auth
- [inv_auth_on_routes] auth | All API routes check authentication before processing

## Schema
- [inv_timestamps] schema | All tables have createdAt and updatedAt columns

## Logging
- [inv_no_pii_logs] logging | No PII (email, phone, SSN) appears in log output
```

Each invariant has a stable ID, category, and statement. `bantay check` evaluates them against your codebase using static analysis.

## Three-tier checkers

| Tier | Location | Example |
|------|----------|---------|
| **Built-in** | Ships with `@bantay/cli` | `auth-on-routes`, `timestamps-on-tables` |
| **Community** | npm packages | `@bantay/checker-stripe`, `@bantay/checker-posthog` |
| **Project** | `.bantay/checkers/*.ts` | Custom rules for your codebase |

All tiers implement the same interface. Resolution order: project > community > built-in.

## Sub-aides

A product bigger than a toy splits into a root aide plus one child aide per
subsystem — this repo is `bantay.aide` plus `bantay.<command>.aide` for every
subcommand. A root CUJ `delegates_to` the child (`cuj_bantay_visualize →
bantay.visualize`); the child specifies the journey. Children inherit the
root's invariants and constraints and may reference them by id.

```bash
bantay aide validate                           # lints the whole project (root + children)
bantay aide validate --aide bantay.gate.aide   # one child, ancestors' ids visible
bantay export invariants                       # merged view: every aide's invariants
```

`check`, `status`, `tasks`, `gate` and the exports read the merged project;
`aide add/link/lock/diff` edit one document. Format rules: SPEC §8 in
`@bantay/aide`.

## The .aide spec

Bantay uses a `.aide` file as its source of truth. `invariants.md`, `CLAUDE.md`, and `.cursorrules` are generated exports.

See [bantay.aide](./bantay.aide) for the living spec.

## Commands

### Core
```
bantay init                   Initialize in current project
bantay check                  Check all invariants
bantay check --diff HEAD~1    Check only affected invariants
bantay ci --github-actions    Generate GitHub Actions workflow
```

### Aide Management
```
bantay aide show              View the .aide entity tree
bantay aide add <id>          Add entity to aide
bantay aide link <a> <b>      Create relationship between entities
bantay aide validate          Validate .aide syntax
bantay aide lock              Create/update lock file
bantay aide diff              Show changes since last lock
```

### Export
```
bantay export all             Export all targets
bantay export invariants      Generate invariants.md from .aide
bantay export claude          Export to CLAUDE.md
bantay export cursor          Export to .cursorrules
bantay export css             Export design tokens to CSS
```

### Visualization & Analysis
```
bantay visualize              Generate interactive HTML screen map
bantay status                 Show scenario implementation status
bantay tasks                  Generate task list from aide CUJs
bantay diff                   Show classified aide changes
```

### Reverse Engineering
```
bantay reverse --prompt       Extract aide structure from codebase
bantay derive-graph           Derive screen states from actions
bantay journeys               Cluster graph and propose CUJ boundaries
bantay journeys --prompt      Generate prompt for LLM journey analysis
```

## License

MIT
