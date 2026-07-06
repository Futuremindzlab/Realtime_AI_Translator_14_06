import crypto from 'node:crypto';
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { toE164, derivePhoneUsername } from '../phone.mjs';
import { sendSuccess, handleError } from '../response.mjs';

const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION || 'us-east-1' });

/**
 * POST /v1/auth/phone/request-otp  (unauthenticated — the whole point is the
 * user has no token yet)
 *
 * Ensures a Cognito user exists for this phone number *before* the client
 * calls initiateAuth(CUSTOM_AUTH). This is the documented-safe pattern for
 * passwordless auto-provisioning: creating the user via a CreateAuthChallenge
 * trigger mid-session (relying on request.userNotFound) is not guaranteed to
 * issue real tokens for that same session, since Cognito's user-existence
 * suppression treats the whole session as a decoy once userNotFound is true.
 * Ensuring the user exists first means userNotFound is always false by the
 * time initiateAuth runs, side-stepping that ambiguity entirely.
 *
 * Returns the deterministic Cognito Username the client must pass to
 * initiateAuth — never the raw phone number, since this pool can't look users
 * up by phone (no alias, UsernameAttributes=['email'], both immutable).
 */
export async function requestPhoneOtp(event) {
  try {
    const body = JSON.parse(event.body || '{}');
    const phone = toE164(body.phone);
    const username = derivePhoneUsername(phone);

    let userExists = true;
    try {
      await cognito.send(new AdminGetUserCommand({
        UserPoolId: process.env.USER_POOL_ID,
        Username: username,
      }));
    } catch (err) {
      if (err.name !== 'UserNotFoundException') throw err;
      userExists = false;
    }

    if (!userExists) {
      await cognito.send(new AdminCreateUserCommand({
        UserPoolId: process.env.USER_POOL_ID,
        Username: username,
        UserAttributes: [
          { Name: 'email', Value: username },
          { Name: 'phone_number', Value: phone },
          { Name: 'phone_number_verified', Value: 'true' },
        ],
        MessageAction: 'SUPPRESS',
      }));

      // AdminCreateUser always leaves the user in FORCE_CHANGE_PASSWORD status,
      // which makes InitiateAuth return a NEW_PASSWORD_REQUIRED challenge BEFORE
      // the custom OTP challenge — blocking passwordless sign-in entirely. This
      // user only ever authenticates via the OTP custom challenge, never a
      // password, so set one permanent, random, never-shared password purely to
      // move the account to CONFIRMED status.
      const randomPassword = `${crypto.randomBytes(24).toString('base64')}aA1!`;
      await cognito.send(new AdminSetUserPasswordCommand({
        UserPoolId: process.env.USER_POOL_ID,
        Username: username,
        Password: randomPassword,
        Permanent: true,
      }));
    }

    return sendSuccess({ username });
  } catch (err) {
    return handleError(err);
  }
}
