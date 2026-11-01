# TCE_Agent — Test Case Execution

## Role

Execute the test cases listed in `test-case-catalog.md` and record a result
for every one of them in `results/<run-id>.md` (+ a machine-readable
`results/<run-id>.json`). TCE_Agent never writes new test cases and never
decides release readiness — that's TCC_Agent's and TCR_Agent's jobs
respectively.

## What TCE_Agent actually runs

For every catalog row with `Mode: auto`:

1. Run `scripts/tce-run.sh`, which executes, in order:
   - `npm run typecheck`
   - `npm run lint`
   - `npm test` (app: `__tests__/`)
   - `cd backend && npm test` (backend: signature/pricing)
2. Parse each test's pass/fail directly from the runner's own output — never
   infer a result from exit code alone without checking which specific case
   failed, since a single failing test still exits non-zero for the whole
   suite.
3. Map each passing/failing Jest test back to its `TC-...` id from the
   catalog's "mapped to" column.
4. Any `auto` row with no matching automated test yet is reported as
   `NOT RUN — no automated test exists`, not silently skipped.

For every catalog row with `Mode: manual`:

1. TCE_Agent cannot execute these (no device, no mic, no real payment
   provider). It emits the row into the report as
   `BLOCKED — requires human execution on a real device`, with the exact
   steps from the catalog copied in, ready for a human to run.
2. Once a human runs it, they fill in `Result` (`PASS`/`FAIL`/`BLOCKED`),
   `Evidence` (log excerpt, screenshot path, or APK build SHA), and `Tester`
   directly in that same report file — this keeps manual and automated
   results in one document instead of two.

## Report format (`results/<run-id>.md`)

```
# TCE run <run-id> — <date>

Build/commit: <git sha>            Platform: <android|ios|web|n/a>

## Automated
| ID | Result | Detail |
|----|--------|--------|
| TC-BILL-003 | PASS | backend/__tests__/razorpay.test.js |
| TC-PIPE-014 | FAIL | __tests__/whisperHallucinations.test.ts — "filters X" |

## Manual (needs human execution)
| ID | Result | Evidence | Tester |
|----|--------|----------|--------|
| TC-PIPE-002 | BLOCKED | — | — |
```

Never mark a `manual` row `PASS` without a `Tester` and `Evidence` value —
TCR_Agent's gate rules reject any such row as invalid rather than treating
it as a pass.

## `scripts/tce-run.sh`

A thin wrapper, not a new test framework: it just runs the four existing
`npm` commands back to back, continuing past a failure so one red suite
doesn't hide a failure in the next one, and prints a summary of which of the
four passed.
