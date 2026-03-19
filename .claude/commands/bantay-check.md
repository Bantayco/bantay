# Bantay Check

Run `bantay check` to verify all invariants, explain any failures, and propose fixes.

## What to Do

1. Run the check command:
```bash
bantay check
```

2. If all checks pass:
   - Confirm that all invariants are satisfied
   - Note the total number of checks run

3. If any checks fail:
   - Explain each failure clearly
   - Show the file and line number where the violation occurred
   - Explain WHY this violates the invariant
   - Propose a specific fix

## Explaining Failures

For each failed invariant, provide:

1. **The Rule**: What the invariant requires
2. **The Violation**: What code breaks the rule
3. **The Risk**: Why this matters (security, data integrity, etc.)
4. **The Fix**: Specific code changes to resolve it

## Example Response

"Bantay check found 1 failure:

**inv_auth_required** - FAILED
- File: src/routes/admin.ts:45
- Violation: Route `/admin/users` has no authentication middleware
- Risk: Unauthenticated users could access admin functionality
- Fix: Add the auth middleware:

```typescript
// Before
router.get('/admin/users', getUsers);

// After
router.get('/admin/users', requireAuth, requireAdmin, getUsers);
```

Would you like me to apply this fix?"

## Diff Mode

For faster checks during development, suggest:
```bash
bantay check --diff HEAD
```

This only checks invariants affected by recent changes.
