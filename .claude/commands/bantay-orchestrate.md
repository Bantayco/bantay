You are the team lead for a Bantay-orchestrated build.

Read CLAUDE.md and the .aide file before doing anything.

## Check build state

1. Check if `.bantay/builds/current.md` exists.
   - **Exists with in_progress:** Resume from where it left off. Read the file, run `bantay status`, check worktrees with `git log`. Respawn any teammates that were mid-work.
   - **Does not exist:** This is a fresh build or nothing to build. Run `bantay tasks` (diff mode). If no tasks, run `bantay tasks --all`. If still no tasks, report "nothing to build" and stop.

## Constraints

- Maximum 2 teammates at any time
- You do Phase 0 (foundation) directly — no teammates
- Every CUJ gets a written plan before a teammate is spawned
- No teammate is spawned without a validated and committed `.bantay/plans/<cuj_id>.md`
- Teammates work in separate git worktrees
- Run `bantay check` after merging each branch
- Commit and `git push` after every checkpoint update

## Phase 0 — Foundation (you do this directly)

1. Read the full aide — all CUJs, scenarios, invariants, constraints
2. Build the shared foundation: data model, types, database schema, API interfaces
3. Commit to main: `feat: foundation — data model, types, interfaces`
4. Run `bantay check`
5. Write `.bantay/builds/current.md` with Phase 0 complete
6. Commit and `git push`
7. `/compact` — shed Phase 0 context before planning Phase 1

## For each subsequent phase

### Plan (before spawning)

For each CUJ in this phase (max 2):

1. Read the CUJ scenarios from the aide
2. Read the existing codebase to understand what's built
3. Decompose into ordered implementation steps:
   - Database schema / migrations needed
   - API routes / server actions
   - Core business logic
   - UI components
   - Integration between layers
   - Tests mapped to each scenario
4. Write the plan to `.bantay/plans/<cuj_id>.md`

### Validate plan (before committing)

Do not commit or spawn until every check passes.

1. **Aide coverage** — Run `bantay aide show <cuj_id>`. Compare every
   scenario's given/when/then against the plan. If a scenario is missing
   or its acceptance criteria don't match, the plan is incomplete.

2. **File references** — For every file, table, route, type, or function
   the plan references, verify it exists: `ls`, `grep`, or `cat` the
   actual path. If it doesn't exist and the plan doesn't say "create new",
   the plan is hallucinated. Fix it.

3. **Interface contracts** — For every function signature, API endpoint,
   or type definition the plan depends on, read the actual source file
   and confirm the signature matches. Don't trust your memory of Phase 0.
   `cat` the file.

4. **Dependency check** — Cross-reference the plan against `bantay tasks`.
   If the plan assumes something built in a later phase or an unmerged
   worktree, the plan has a forward dependency. Remove it or reorder.

5. **Invariant coverage** — For every invariant linked to this CUJ's
   scenarios (via `protected_by`), confirm the plan includes a step that
   enforces or tests it. Missing invariant coverage = missing step.

If any check fails, fix the plan and re-validate. Only after all 5 pass:
commit the plan.

### Spawn teammates (max 2)

For each CUJ, spawn a teammate with this prompt:

```
You are building [CUJ feature] in worktree feat/[cuj-name].

YOUR PLAN: Read .bantay/plans/[cuj_id].md — execute the steps in order.

FIRST: Run bantay status to see what's already done. If scenarios
are already covered, skip to the first uncovered one.

BUILD RULES:
- Use red/green TDD. Write the test, confirm it fails, implement.
- Commit after each passing scenario.
  Message: feat([cuj_name]): implement sc_[scenario_name]
- Run bantay check after each commit.
- Do not modify files outside your scope.

CONTEXT MANAGEMENT:
- After each scenario, check your context usage.
- If over 50%, /compact before continuing.
- If over 80%, commit everything and message the lead:
  "Context full, requesting restart. Progress committed."

If you hit a rate limit, wait and retry — don't abandon work.
If something fails, commit what you have and message the lead.
```

### Monitor

- Check teammate progress periodically
- If a teammate goes silent for 10+ minutes, check its worktree:
  ```
  cd .worktrees/<teammate>
  git log --oneline -5
  bantay status
  ```
- If a teammate dies:
  1. The plan survives in `.bantay/plans/<cuj_id>.md`
  2. Committed work survives in the worktree
  3. `bantay status` shows exactly what's done
  4. Spawn a replacement with the same prompt — it reads the plan and status, picks up from the first incomplete step

### Merge gate

After both teammates complete:

1. Merge both worktrees to main
2. Run `bantay check` on main
3. Run `bantay status`
4. If checks fail, fix on main before proceeding
5. Update `.bantay/builds/current.md`:
   ```
   phase: N
   started: <timestamp>
   completed_cujs:
     - cuj_onboarding
     - cuj_manage_artifact
   in_progress: []
   status: X/Y scenarios covered
   ```
6. Commit and `git push`
7. `/compact` — shed this phase's context before the next one

If remaining CUJs in this phase, plan and spawn the next 2.
When phase complete, move to next phase.

## If you (the lead) need to restart

1. Read `.bantay/builds/current.md` — where we are
2. Read `.bantay/plans/` — what was intended for each CUJ
3. Run `bantay status` — what's actually built
4. Check each active worktree with `git log`
5. Resume orchestration from current state
6. Respawn any teammates that were mid-work

Nothing you know should exist only in your context window.
If you die, a new lead reading these files is indistinguishable from you.

## After all phases

1. Run `bantay status` — should show all scenarios covered
2. Run `bantay check` — should show all invariants passing
3. Delete `.bantay/builds/current.md` — clean state
4. Run `bantay aide lock` — snapshot the aide
5. Commit and `git push`
6. Report: phases completed, scenarios covered, invariants passing
