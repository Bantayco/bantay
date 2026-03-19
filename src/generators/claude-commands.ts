/**
 * Generators for Claude Code slash command files
 *
 * These files are placed in .claude/commands/ and appear as
 * slash commands in Claude Code (e.g., /bantay-interview)
 */

/**
 * Generate the bantay-interview.md command
 *
 * This command guides Claude through an interactive session to
 * build out the project's aide structure through conversation.
 */
export function generateInterviewCommand(): string {
  return `# Bantay Aide Interview

You are helping the user define their project's invariants, critical user journeys (CUJs), and scenarios using Bantay's aide system.

## Your Role

Guide the user through a structured conversation to understand their project and propose appropriate entities. You will use shell commands to mutate the aide file - never edit YAML directly.

## Interview Flow

### 1. Understand the Product

Start by asking:
- "What does your product do in one sentence?"
- "Who are the primary users?"
- "What are the most critical actions users take?"

### 2. Identify Critical User Journeys (CUJs)

Based on their answers, propose CUJs:
- "Based on what you've described, I think these are your critical user journeys..."
- List 3-5 proposed CUJs with feature descriptions
- Ask: "Does this capture the most important things users do? Should I add or modify any?"

For each confirmed CUJ, run:
\`\`\`bash
bantay aide add cuj_<name> --parent cujs --prop "feature=<description>" --prop "tier=primary" --prop "area=<area>"
\`\`\`

### 3. Define Scenarios for Each CUJ

For each CUJ, propose scenarios:
- "For the <CUJ> journey, here are the key scenarios I'd propose..."
- List scenarios with given/when/then structure
- Ask: "Do these scenarios cover the important cases?"

For each confirmed scenario, run:
\`\`\`bash
bantay aide add sc_<name> --parent cuj_<parent> --prop "name=<scenario name>" --prop "given=<given>" --prop "when=<when>" --prop "then=<then>"
\`\`\`

### 4. Extract Invariants

Ask about rules that must never be broken:
- "What security rules must always hold? (e.g., all routes require auth)"
- "What data integrity rules exist? (e.g., balances never go negative)"
- "What performance requirements exist? (e.g., pages load in under 2s)"

For each confirmed invariant, run:
\`\`\`bash
bantay aide add inv_<name> --parent invariants --prop "statement=<the rule>" --prop "category=<security|integrity|performance|etc>"
\`\`\`

### 5. Link Scenarios to Invariants

For scenarios that are protected by invariants:
\`\`\`bash
bantay aide link sc_<scenario> inv_<invariant> --type protected_by
\`\`\`

## Rules

1. **Never edit YAML directly** - Always use \`bantay aide add\`, \`bantay aide update\`, or \`bantay aide link\` commands
2. **Confirm before adding** - Always show the user what you're about to add and get their approval
3. **Validate after each section** - Run \`bantay aide validate\` after adding entities to catch errors early
4. **Use consistent naming** - IDs should be snake_case: \`cuj_user_login\`, \`sc_login_success\`, \`inv_auth_required\`

## Validation

After each major section (CUJs, scenarios, invariants), run:
\`\`\`bash
bantay aide validate
\`\`\`

If errors are found, fix them before proceeding.

## Example Session

**User**: "We're building an e-commerce platform"

**You**: "Great! Let me understand a bit more. What are the 2-3 most critical things a customer does on your platform?"

**User**: "Browse products, add to cart, and checkout"

**You**: "Based on that, I'd propose these Critical User Journeys:

1. **cuj_browse** - Customer discovers and views products
2. **cuj_cart** - Customer manages their shopping cart
3. **cuj_checkout** - Customer completes a purchase

Does this capture your core journeys? Should I add or modify any?"

**User**: "Yes, let's add those"

**You**: "Adding the CUJs now..."
\`\`\`bash
bantay aide add cuj_browse --parent cujs --prop "feature=Customer discovers and views products" --prop "tier=primary" --prop "area=shopping"
bantay aide add cuj_cart --parent cujs --prop "feature=Customer manages their shopping cart" --prop "tier=primary" --prop "area=shopping"
bantay aide add cuj_checkout --parent cujs --prop "feature=Customer completes a purchase" --prop "tier=primary" --prop "area=shopping"
bantay aide validate
\`\`\`

Continue this pattern for scenarios and invariants.
`;
}

/**
 * Generate the bantay-status.md command
 *
 * This command runs bantay status and discusses the results.
 */
export function generateStatusCommand(): string {
  return `# Bantay Status

Run \`bantay status\` and explain the results to the user.

## What to Do

1. Run the status command:
\`\`\`bash
bantay status
\`\`\`

2. Explain the output:
   - How many scenarios are covered by tests
   - Which scenarios are missing coverage
   - Overall coverage percentage

3. If coverage is low, suggest:
   - Which scenarios should be prioritized for testing
   - How to create tests that reference scenarios with \`@scenario\` tags

## Understanding the Output

The status command shows:
- **Covered**: Scenarios that have at least one test file referencing them via \`@scenario sc_<name>\`
- **Uncovered**: Scenarios that exist in bantay.aide but have no test coverage
- **Coverage %**: Ratio of covered to total scenarios

## Example Response

"Your Bantay status shows 15/20 scenarios covered (75%).

The uncovered scenarios are:
- sc_checkout_payment_failed - No test for payment failure handling
- sc_cart_item_out_of_stock - No test for inventory checks
- ...

I'd recommend prioritizing sc_checkout_payment_failed since payment handling is critical for user trust."
`;
}

/**
 * Generate the bantay-check.md command
 *
 * This command runs bantay check and helps fix any failures.
 */
export function generateCheckCommand(): string {
  return `# Bantay Check

Run \`bantay check\` to verify all invariants, explain any failures, and propose fixes.

## What to Do

1. Run the check command:
\`\`\`bash
bantay check
\`\`\`

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
- Violation: Route \`/admin/users\` has no authentication middleware
- Risk: Unauthenticated users could access admin functionality
- Fix: Add the auth middleware:

\`\`\`typescript
// Before
router.get('/admin/users', getUsers);

// After
router.get('/admin/users', requireAuth, requireAdmin, getUsers);
\`\`\`

Would you like me to apply this fix?"

## Diff Mode

For faster checks during development, suggest:
\`\`\`bash
bantay check --diff HEAD
\`\`\`

This only checks invariants affected by recent changes.
`;
}
