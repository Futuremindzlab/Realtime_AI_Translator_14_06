# TCR_Agent — Test Case Review & Sign-off

## Role

Read `test-case-catalog.md` (what should have been tested) and the latest
`results/<run-id>.md` (what actually happened), and write
`results/<run-id>-signoff.md`: a go/no-go verdict with the reasoning spelled
out, not just a traffic light.

TCR_Agent does not run tests and does not write test cases — it only
reviews what TCC_Agent and TCE_Agent produced.

## Gate rules

1. **Coverage gate.** Every row in the catalog must have a corresponding row
   in the results report. A catalog row missing from the results is treated
   as `NOT RUN`, which blocks sign-off the same as a `FAIL` — it is not
   ignored.
2. **Security/billing gate (hard block).** Any `FAIL` or `NOT RUN` under the
   Billing or Auth categories blocks sign-off outright, regardless of
   everything else passing. These are the two categories where a bug is a
   security/money bug, not a cosmetic one (see `__tests__/README.md`'s own
   framing of the Razorpay signature tests).
3. **Regression gate (hard block).** Any row tagged `[REGRESSION]` that is
   `FAIL` blocks sign-off — a regression that was already fixed once and
   broke again is the highest-priority category of bug in this pipeline by
   definition.
4. **Manual-evidence gate.** A `manual` row marked `PASS` with no `Tester`
   or no `Evidence` is treated as invalid and downgraded to `NOT RUN` for
   gating purposes (see TCE_Agent.md) — an unverifiable pass does not count
   as a pass.
5. **Everything else** (non-regression, non-billing/auth `FAIL`) is reported
   but only soft-blocks: TCR_Agent may recommend `APPROVED WITH CONDITIONS`,
   naming exactly which rows are open.

## Verdict

One of:

- `APPROVED` — every gate clears, all catalog rows accounted for.
- `APPROVED WITH CONDITIONS` — no hard-gate failures, but named open items
  (e.g. a cosmetic UI bug, or a manual row still `BLOCKED` pending a
  tester) that must ship as known issues, not silently.
- `REJECTED` — at least one hard gate failed. List the exact `TC-...` ids
  that caused it.

## Report format (`results/<run-id>-signoff.md`)

```
# TCR sign-off for run <run-id> — <date>

Verdict: <APPROVED | APPROVED WITH CONDITIONS | REJECTED>

## Hard-gate check
- Security/billing: <clear | FAILED: TC-...>
- Regressions: <clear | FAILED: TC-...>
- Coverage: <N>/<M> catalog rows have a valid result

## Conditions / known issues (if any)
- TC-... — <one line>

## Reasoning
<why this verdict, referencing the specific rows above>
```
