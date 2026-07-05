/**
 * Cognito "Verify Auth Challenge Response" trigger for the phone + OTP custom auth flow.
 *
 * Compares the code the user submitted against the code CreateAuthChallenge
 * stashed in privateChallengeParameters. No AWS calls needed.
 */
export async function handler(event) {
  const expected = event.request.privateChallengeParameters.code;
  const submitted = event.request.challengeAnswer;

  event.response.answerCorrect = !!expected && submitted === expected;

  return event;
}
