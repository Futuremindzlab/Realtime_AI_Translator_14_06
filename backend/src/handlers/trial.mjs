import { getUserId } from '../auth.mjs';
import { sendSuccess, sendError, handleError } from '../response.mjs';
import { getTrialStatus as readTrialStatus, consumeTrialUsage } from '../lib/trialLimits.mjs';

// ─────────────────────────────────────────────────────────
// GET /v1/usage/trial
// Read-only — does not start the trial clock or consume any usage.
// ─────────────────────────────────────────────────────────
export async function getTrialStatus(event) {
  try {
    const userId = getUserId(event);
    return sendSuccess(await readTrialStatus(userId));
  } catch (err) {
    return handleError(err);
  }
}

// ─────────────────────────────────────────────────────────
// POST /v1/usage/trial/consume
// Body: { kind: 'translation' | 'conversation' }
// Call this right before actually starting a single translation or a
// conversation session — not after, so a denial can stop the recording
// before it starts rather than discarding it after the fact.
// ─────────────────────────────────────────────────────────
export async function consumeTrial(event) {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');
    const { kind } = body;
    if (kind !== 'translation' && kind !== 'conversation') {
      return sendError(400, "kind must be 'translation' or 'conversation'");
    }
    return sendSuccess(await consumeTrialUsage(userId, kind));
  } catch (err) {
    return handleError(err);
  }
}
