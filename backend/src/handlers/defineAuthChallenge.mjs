/**
 * Cognito "Define Auth Challenge" trigger for the phone + OTP custom auth flow.
 *
 * Pure state machine — no AWS calls. Cognito invokes this after each
 * challenge response to decide: issue tokens, present another challenge,
 * or fail authentication. `event.request.session` is the array of prior
 * challenge attempts in this sign-in session.
 */

const MAX_ATTEMPTS = 3;

export async function handler(event) {
  const session = event.request.session || [];

  if (session.length === 0) {
    // First attempt — present the CUSTOM_CHALLENGE (OTP) as the only challenge type.
    event.response.issueTokens = false;
    event.response.failAuthentication = false;
    event.response.challengeName = 'CUSTOM_CHALLENGE';
    return event;
  }

  const last = session[session.length - 1];

  if (last.challengeName === 'CUSTOM_CHALLENGE' && last.challengeResult === true) {
    // Correct code — issue tokens.
    event.response.issueTokens = true;
    event.response.failAuthentication = false;
    return event;
  }

  if (session.length >= MAX_ATTEMPTS) {
    // Too many wrong attempts — fail out.
    event.response.issueTokens = false;
    event.response.failAuthentication = true;
    return event;
  }

  // Wrong code, attempts remain — re-issue the same challenge.
  event.response.issueTokens = false;
  event.response.failAuthentication = false;
  event.response.challengeName = 'CUSTOM_CHALLENGE';
  return event;
}
