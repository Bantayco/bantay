# Bootstrap prompt

This is the prompt for building the Bantay CLI from its aide alone, with no
Bantay installed. It is the one ungoverned build. Everything after it is
governed by the CLI it produces (see "Handoff" at the end).

Give an agent an empty directory containing only `bantay.aide`, the
`bantay.<command>.aide` children, and `SPEC.md` from `@bantay/aide`, then
paste the prompt below.

---

You are building a command-line tool from its specification. The
specification is complete; the code does not exist yet.

## Inputs

- `bantay.aide` — the root specification.
- `bantay.<command>.aide` — one child specification per subcommand. The root
  declares each command as a CUJ that `delegates_to` its child; the child
  defines it.
- `SPEC.md` — the format these files are written in. Read §4–§8 first: ids
  carry their kind as a prefix (`cuj_`, `sc_`, `inv_`, `con_`, `found_`,
  `wis_`, `screen_`, `comp_`, `st_`, `tr_`); children inherit the root's
  invariants, constraints and foundations.

Read all of it before writing anything. The root is short; the children are
where the behavior lives.

## What the parts mean to you

- **Foundations** (`found_*`) are the design principles. When two ways of
  building something are both acceptable, pick the one that fits them.
- **Constraints** (`con_*`) are decisions already made. Follow them. If one
  seems wrong, say so and stop; do not "improve" it. Each carries a
  `rationale` explaining what went wrong the other way.
- **Invariants** (`inv_*`) must be true of the finished code on every path.
  Each becomes at least one test. An invariant with a `checker`, `test` or
  `enforced` prop tells you where its enforcement lives; put it there.
- **CUJs and scenarios** (`cuj_*`, `sc_*`) are the behavior. Every scenario is
  a Given/When/Then; every scenario becomes a test whose name or body
  contains the scenario id. A CUJ's `tier` tells you how much failure-case
  coverage it needs: `primary` exhaustive, `secondary` happy path plus
  critical failures, `tertiary` smoke.
- **Wisdom** (`wis_*`) is advice from previous attempts. Read it; it is not
  decorative.
- **Relationships** tell you what protects what. `depends_on` edges between
  CUJs give you the build order. `protected_by` tells you which invariant a
  scenario relies on; `implements` tells you which constraint satisfies which
  invariant.

## Build order

1. **Foundation.** Read every child. Identify the shared data model, the
   types, the module boundaries and the interfaces the commands need from each
   other. Build those first, with no command behavior. Commit.
2. **Commands, in dependency order.** Topologically sort the root's CUJs by
   `depends_on`. For each CUJ, open its child aide and implement every
   scenario, tests first. One commit per CUJ. Do not start a CUJ whose
   dependencies are not complete.
3. **Invariants.** After each CUJ, re-run every test for every invariant.
   Nothing you did for the new CUJ may break an existing one.

## Rules

- Do not add behavior the aide does not describe. If something seems missing,
  write it down as a question for the organizer and build what *is*
  described. Guessing is the failure mode this process exists to prevent.
- Do not weaken a constraint or skip an invariant because it is inconvenient.
  Write down why it is inconvenient and stop at that point.
- Do not rename or reinterpret an id. Ids are stable; tests, tasks and the
  lock file are keyed on them.
- Every scenario id appears in the test that covers it. Every invariant id
  appears in the test or checker that enforces it. This is how the finished
  tool will later audit the code you are writing now.
- Prefer boring code. The aide says what; the foundations say in what style;
  nothing says clever.

## Done means

- Every `sc_*` in every child has a passing test that references its id.
- Every `inv_*` has a passing test, checker or `enforced` location that
  references its id.
- The tool runs from a clean checkout with the commands the root lists.
- You have written a short file, `BOOTSTRAP-NOTES.md`, listing: questions you
  could not answer from the aide, places where two parts of the aide seemed to
  disagree, and anything you built that you are not sure the aide asked for.

## Handoff

The last thing you build is the tool that will govern you. When the commands
`check`, `status`, `diff` and `gate` work, run them on this repository:

```
bantay export claude      # aide → CLAUDE.md
bantay aide lock          # snapshot the aide you built from
bantay check              # every invariant, against your own code
bantay status             # every scenario, against your own tests
```

From that point, no change to this codebase is made without `bantay gate`
approving it and `bantay check` passing afterward — including changes you
make to finish this job. Anything `check` reports as failing or `status`
reports as missing is your remaining work, in that order.

---

## Notes for whoever runs this (not part of the prompt)

- The agent needs `SPEC.md` because it has no Bantay to validate the aide
  with. It also doesn't need `how-to-create-an-aide.md`; that is for authors.
- Expect the agent to produce `BOOTSTRAP-NOTES.md` with real gaps. Those are
  aide edits to make before the second attempt, not code to fix.
- Run the bootstrap twice from the same aide. The diff between the two
  outputs is the measure of how much the aide leaves to chance; invariants
  that held in one run and not the other are the ones that need checkers.
- Once `bantay check` passes on the bootstrapped output, delete the output and
  keep the aide. If you cannot bring yourself to do that, the aide is not
  finished.
