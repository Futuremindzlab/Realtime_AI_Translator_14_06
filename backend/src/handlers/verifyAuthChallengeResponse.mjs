/**
 * Cognito "Verify Auth Challenge Response" trigger for the phone + OTP custom auth flow.
 *
 * Compares the code the user submitted against the code CreateAuthChallenge
 * stashed in privateChallengeParameters. No AWS calls needed.
 *
 * The comparison is constant-time so the time taken to reject a wrong code
 * reveals nothing about how many leading digits were correct.
 */
import crypto from 'node:crypto';

function codesMatch(expected, submitted) {
  if (typeof expected !== 'string' || typeof submitted !== 'string') return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(submitted, 'utf8');
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function handler(event) {
  const expected = event.request.privateChallengeParameters?.code;
  const submitted = event.request.challengeAnswer;

  event.response.answerCorrect = codesMatch(expected, submitted);

  return event;
}
