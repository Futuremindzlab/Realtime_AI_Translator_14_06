import { CognitoIdentityProviderClient, AdminDeleteUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { DeleteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { db, SETTINGS_TABLE } from '../db.mjs';
import { getUserId } from '../auth.mjs';
import { sendSuccess, handleError } from '../response.mjs';
import { clearAllTranslations } from './translations.mjs';
import { razorpay } from '../lib/razorpay.mjs';

const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION || 'us-east-1' });

// ─────────────────────────────────────────────────────────
// DELETE /v1/account
//
// Required in-app by both app stores' review policies whenever an app
// supports account creation (Apple explicitly since 2022; Google Play's
// Account Deletion policy similarly). Order matters — Cognito user deletion
// is LAST: if anything earlier fails, the user still has a working account
// to retry with, instead of losing auth entirely mid-deletion.
//
//   1. Best-effort cancel any live Razorpay subscription (so deleting the
//      account can't leave someone being billed with no account left to
//      manage or cancel it from) — logged, not fatal, since Razorpay being
//      briefly unreachable shouldn't block someone's deletion request; the
//      settings/history wipe below still proceeds either way.
//   2. Best-effort delete the user's cloned voice (Live plan) from the
//      voice provider — the voice sample/model lives there, not in our own
//      tables, so wiping settings alone would leave it behind while the
//      Privacy Policy promises account deletion removes everything. Logged,
//      not fatal, for the same reason as the subscription cancel above.
//   3. Purge conversation history + S3 audio (reuses clearAllTranslations'
//      exact logic — same query→batch-delete→S3-cleanup this app already
//      exposes at DELETE /v1/translations). Fatal if it fails: better to
//      abort and let the user retry than delete their Cognito login while
//      their data silently survives.
//   4. Delete the settings record.
//   5. AdminDeleteUser — last.
// ─────────────────────────────────────────────────────────
async function deleteClonedVoice(voiceId) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error(`⚠️ Cannot delete cloned voice ${voiceId} during account deletion: voice provider key not configured (continuing)`);
    return;
  }
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(voiceId)}`, {
      method: 'DELETE',
      headers: { 'xi-api-key': apiKey },
    });
    // 404 means it's already gone — the outcome we want anyway.
    if (!res.ok && res.status !== 404) {
      console.error(`⚠️ Failed to delete cloned voice ${voiceId} during account deletion: HTTP ${res.status} (continuing)`);
    }
  } catch (err) {
    console.error(`⚠️ Failed to delete cloned voice ${voiceId} during account deletion (continuing):`, err);
  }
}

export async function deleteAccount(event) {
  try {
    const userId = getUserId(event);
    // This pool's UsernameAttributes=['email'] makes the `email` JWT claim
    // equal to the Cognito Username (true for phone-based accounts too —
    // see backend/src/phone.mjs's derivePhoneUsername, which sets `email`
    // to that same synthetic placeholder at creation) — AdminDeleteUser
    // needs Username, which isn't `sub`.
    const claims = event?.requestContext?.authorizer?.claims;
    const username = claims?.email;
    if (!username) {
      const err = new Error('Unable to resolve account username from token claims');
      err.statusCode = 400;
      throw err;
    }

    const existing = await db.send(new GetCommand({ TableName: SETTINGS_TABLE, Key: { user_id: userId } }));
    const subscriptionId = existing.Item?.razorpay_subscription_id;
    if (subscriptionId) {
      try {
        await razorpay.subscriptions.cancel(subscriptionId, { cancel_at_cycle_end: false });
      } catch (err) {
        console.error(`⚠️ Failed to cancel Razorpay subscription ${subscriptionId} during account deletion (continuing):`, err);
      }
    }

    const customVoiceId = existing.Item?.custom_voice_id;
    if (customVoiceId) {
      await deleteClonedVoice(customVoiceId);
    }

    const clearResult = await clearAllTranslations(event);
    if (clearResult.statusCode >= 400) {
      console.error('❌ Account deletion aborted — failed to purge conversation history:', clearResult.body);
      return clearResult;
    }

    await db.send(new DeleteCommand({ TableName: SETTINGS_TABLE, Key: { user_id: userId } }));

    await cognito.send(new AdminDeleteUserCommand({
      UserPoolId: process.env.USER_POOL_ID,
      Username: username,
    }));

    console.log(`✅ Account deleted: ${username} (${userId})`);
    return sendSuccess({ deleted: true });
  } catch (err) {
    return handleError(err);
  }
}
