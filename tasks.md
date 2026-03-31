# Tasks

## Relationship Changes

### cuj_reverse:cuj_aide

- [ ] verify connection

## Phase 2

### cuj_reverse: Bantay extracts or reconciles an aide from existing code

- [ ] Implement Bantay extracts or reconciles an aide from existing code

**Acceptance Criteria:**

- [ ] sc_reverse_fresh: Extract aide from code with no existing aide
  - Given: A codebase with no .aide file
  - When: Developer runs bantay reverse --prompt
  - Then: Structured prompt output with codebase summary for the LLM to propose a complete aide
- [ ] sc_reverse_reconcile: Reconcile code changes against existing aide
  - Given: A codebase with an existing .aide file where code has drifted
  - When: Developer runs bantay reverse --prompt
  - Then: Prompt includes both codebase summary and current aide contents. LLM proposes aide updates for new, changed, and missing entities.
- [ ] sc_reverse_apply: Apply reverse proposals from JSON
  - Given: Developer has proposals from LLM output
  - When: Developer runs bantay reverse --apply proposals.json --confirm
  - Then: Diffs proposals against existing aide. Applies new, updated, and removes orphaned entities.
- [ ] sc_reverse_focus: Focus scan on specific part of codebase
  - Given: Large codebase
  - When: Developer runs bantay reverse --prompt --focus=frontend
  - Then: Only frontend code scanned and included in prompt
