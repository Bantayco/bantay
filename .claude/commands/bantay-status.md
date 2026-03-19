# Bantay Status

Run `bantay status` and explain the results to the user.

## What to Do

1. Run the status command:
```bash
bantay status
```

2. Explain the output:
   - How many scenarios are covered by tests
   - Which scenarios are missing coverage
   - Overall coverage percentage

3. If coverage is low, suggest:
   - Which scenarios should be prioritized for testing
   - How to create tests that reference scenarios with `@scenario` tags

## Understanding the Output

The status command auto-discovers the .aide file in the current directory.

The output shows:
- **Covered**: Scenarios that have at least one test file referencing them via `@scenario sc_<name>`
- **Uncovered**: Scenarios that exist in the .aide file but have no test coverage
- **Coverage %**: Ratio of covered to total scenarios

## Example Response

"Your Bantay status shows 15/20 scenarios covered (75%).

The uncovered scenarios are:
- sc_checkout_payment_failed - No test for payment failure handling
- sc_cart_item_out_of_stock - No test for inventory checks
- ...

I'd recommend prioritizing sc_checkout_payment_failed since payment handling is critical for user trust."
