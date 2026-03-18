# Bantay

Write down the rules your system must never break. We enforce them on every PR.

## Quickstart

```bash
bunx @bantay/cli init        # Detect stack, generate invariants.md
bantay check                  # Verify all invariants
bantay export claude          # Export to CLAUDE.md for agent context
bantay ci --github-actions    # Generate CI workflow
```

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

## The .aide spec

Bantay uses a `.aide` file as its source of truth. `invariants.md`, `CLAUDE.md`, and `.cursorrules` are generated exports.

See [bantay.aide](./bantay.aide) for the living spec.

## Commands

```
bantay init                   Initialize in current project
bantay check                  Check all invariants
bantay check --diff HEAD~1    Check only affected invariants
bantay check --id inv_auth    Check single invariant
bantay export invariants      Generate invariants.md from .aide
bantay export claude          Export to CLAUDE.md
bantay export cursor          Export to .cursorrules
bantay export all             Export all targets
bantay ci --github-actions    Generate GitHub Actions workflow
bantay aide show              View the .aide entity tree
bantay aide validate          Validate .aide syntax
```

## License

MIT
