# OneLingo testing pipeline — TCC / TCE / TCR agents

This is a lightweight, repo-native "testing agent" pipeline: three role-scoped
prompts (not a new framework or service) that a Claude session runs in
sequence. Each one reads/writes plain files in this repo, so the pipeline
works the same whether a human or an agent drives it, and every artifact is
reviewable in a PR diff.

```
TCC_Agent  →  test-case-catalog.md        (what to test, and how)
TCE_Agent  →  results/<run-id>.md + .json (what happened when we tested it)
TCR_Agent  →  results/<run-id>-signoff.md (go / no-go, with reasons)
```

## Feasibility — what's realistic for this app

OneLingo is a React Native/Expo app whose core flow (record → Whisper
transcribe → translate → ElevenLabs/OpenAI TTS → playback) depends on a real
microphone, real network calls to paid APIs, and native Android behavior
(AppState, audio focus, OEM quirks). That caps how much of "all possible
scenarios" can be *executed* by an agent rather than just *specified*:

- **Fully automatable today:** pure-logic unit tests (`__tests__/`,
  `backend/__tests__/`), typecheck, lint, and static checks (e.g. "does
  `lib/plans.ts` match `backend/src/lib/razorpay.mjs`"). An agent can run
  these and parse pass/fail with zero ambiguity.
- **Automatable with more setup, not done yet:** component-level tests via
  `@testing-library/react-native` for screens like `AuthGate`/`PaywallView`
  (see `__tests__/README.md` — explicitly deferred). Worth adding, still runs
  in CI without a device.
- **Not automatable by an agent, ever, without a device farm:** anything
  needing a real mic, real audio playback, a real Android build, or a real
  Razorpay/UPI charge — i.e. most of `docs/E2E_TESTING_CHECKLIST.md` and the
  exact Person A/Tamil bug class reported on 2026-11-01. These scenarios can
  be **fully specified** by TCC_Agent (steps, expected result, pass/fail
  criteria) but must be **executed by a human** on a real device; TCE_Agent's
  job there is to produce the checklist run and record the human's results
  in the same structured format as the automated runs, not to fake execution.

So: treat TCC_Agent as reliable for both automated and manual scenarios, treat
TCE_Agent as "auto-executes the automatable third, hands the rest to a human
with a ready-to-run checklist," and treat TCR_Agent's sign-off as only as
strong as the weakest input — it must visibly flag which scenarios were agent-
executed vs. human-reported, not blend them into one pass rate.

## Running the pipeline

1. `TCC_Agent` (see `TCC_Agent.md`) — regenerate or extend
   `test-case-catalog.md` from the current code + `docs/E2E_TESTING_CHECKLIST.md`
   + any new bug report.
2. `TCE_Agent` (see `TCE_Agent.md`) — run `scripts/tce-run.sh`, then fill in
   the manual sections of the generated report for scenarios that need a
   device.
3. `TCR_Agent` (see `TCR_Agent.md`) — read the catalog + the execution report,
   apply the gate rules, write the sign-off.
