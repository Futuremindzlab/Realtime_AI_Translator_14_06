import { PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { db, SETTINGS_TABLE } from '../db.mjs';
import { getUserId, getRole } from '../auth.mjs';
import { sendSuccess, sendNoContent, sendError, handleError } from '../response.mjs';
import { PLANS } from '../lib/entitlement.mjs';

// An existing settings row with no onboarding_completed attribute predates
// onboarding entirely (this account signed up before the feature existed) —
// default it to true so the flow never appears retroactively. Only a
// genuinely brand-new row (no existingItem at all) defaults to false. Shared
// by putSettings/resetSettings so both agree with getSettings's own backfill
// — otherwise an existing user hitting "Save" or "Reset" in Settings would
// silently persist onboarding_completed:false and trigger onboarding next launch.
function backfillOnboardingCompleted(existingItem) {
  return existingItem?.onboarding_completed ?? !!existingItem;
}

// ─────────────────────────────────────────────────────────
// GET /v1/settings
// ─────────────────────────────────────────────────────────
export async function getSettings(event) {
  try {
    const userId = getUserId(event);

    const result = await db.send(new GetCommand({
      TableName: SETTINGS_TABLE,
      Key: { user_id: userId },
    }));

    if (!result.Item) {
      // Return sensible defaults if no record exists yet
      return sendSuccess({
        user_id:                  userId,
        default_source_language:  'auto',
        default_target_language:  'en',
        tts_provider:             'openai',
        voice_gender:             'female',
        conversation_mode_default: false,
        custom_voice_id:          null,
        plan:                     'basic',
        onboarding_completed:     false,
        use_case:                 null,
        updated_at:               new Date().toISOString(),
      });
    }

    // Backfill for pre-billing records that predate the `plan` attribute —
    // avoids a one-off data migration for existing users. `onboarding_completed`
    // gets the OPPOSITE backfill treatment deliberately: an existing row that
    // predates that attribute means this account signed up before onboarding
    // existed, so it defaults to true (never show the flow retroactively) —
    // only a genuinely brand-new row (the !result.Item branch above) defaults
    // it to false. See backfillOnboardingCompleted().
    return sendSuccess({
      plan: 'basic', use_case: null, ...result.Item,
      onboarding_completed: backfillOnboardingCompleted(result.Item),
    });
  } catch (err) {
    return handleError(err);
  }
}

// ─────────────────────────────────────────────────────────
// PUT /v1/settings
// Full replace — body must contain all required fields
// ─────────────────────────────────────────────────────────
export async function putSettings(event) {
  try {
    const userId = getUserId(event);
    const body   = JSON.parse(event.body || '{}');

    const VALID_PROVIDERS = ['openai', 'elevenlabs', 'device', 'azure'];
    const VALID_GENDERS   = ['male', 'female'];

    if (body.tts_provider && !VALID_PROVIDERS.includes(body.tts_provider)) {
      return sendError(400, `tts_provider must be one of: ${VALID_PROVIDERS.join(', ')}`);
    }
    if (body.voice_gender && !VALID_GENDERS.includes(body.voice_gender)) {
      return sendError(400, `voice_gender must be one of: ${VALID_GENDERS.join(', ')}`);
    }

    // `plan` — and the Razorpay subscription bookkeeping alongside it — are
    // billing-controlled, never accepted from the client (this is a full
    // "replace all preferences" endpoint the client already calls freely —
    // reading them from the body here would let any user grant themselves
    // Plus/Live for free, or unlink their subscription). Preserve whatever's
    // already on record, defaulting to 'basic'/undefined for a brand-new
    // user, regardless of what the request body contains.
    const existing = await db.send(new GetCommand({ TableName: SETTINGS_TABLE, Key: { user_id: userId } }));
    const plan = existing.Item?.plan || 'basic';
    const razorpaySubscriptionId     = existing.Item?.razorpay_subscription_id;
    const razorpaySubscriptionStatus = existing.Item?.razorpay_subscription_status;
    // Onboarding state and trial-usage counters are written by their own
    // dedicated endpoints (PATCH /v1/settings for onboarding_completed/
    // use_case; POST /v1/usage/trial/consume for the trial_* counters), never
    // by this full-replace PUT — the client's UserSettings shape doesn't even
    // carry them (see types/index.ts). Same "preserve, don't trust the body"
    // treatment as `plan` above: without this, any ordinary preferences save
    // from the Settings screen would silently wipe onboarding completion and
    // reset the trial clock/counters back to unset.
    const onboardingCompleted = backfillOnboardingCompleted(existing.Item);
    const useCase             = existing.Item?.use_case ?? null;
    const trialStartDate         = existing.Item?.trial_start_date;
    const trialTranslationsUsed  = existing.Item?.trial_translations_used;
    const trialConversationsUsed = existing.Item?.trial_conversations_used;

    const item = {
      user_id:                  userId,
      default_source_language:  body.default_source_language  || 'auto',
      default_target_language:  body.default_target_language  || 'en',
      tts_provider:             body.tts_provider             || 'openai',
      voice_gender:             body.voice_gender             || 'female',
      conversation_mode_default: body.conversation_mode_default ?? false,
      custom_voice_id:          body.custom_voice_id          || null,
      plan,
      onboarding_completed:     onboardingCompleted,
      use_case:                 useCase,
      ...(razorpaySubscriptionId     ? { razorpay_subscription_id: razorpaySubscriptionId }         : {}),
      ...(razorpaySubscriptionStatus ? { razorpay_subscription_status: razorpaySubscriptionStatus }  : {}),
      ...(trialStartDate         !== undefined ? { trial_start_date: trialStartDate }                 : {}),
      ...(trialTranslationsUsed  !== undefined ? { trial_translations_used: trialTranslationsUsed }   : {}),
      ...(trialConversationsUsed !== undefined ? { trial_conversations_used: trialConversationsUsed } : {}),
      updated_at:               new Date().toISOString(),
    };

    await db.send(new PutCommand({ TableName: SETTINGS_TABLE, Item: item }));
    return sendSuccess(item);
  } catch (err) {
    return handleError(err);
  }
}

// ─────────────────────────────────────────────────────────
// PATCH /v1/settings
// Partial update — only provided fields are changed
// ─────────────────────────────────────────────────────────
export async function patchSettings(event) {
  try {
    const userId = getUserId(event);
    const body   = JSON.parse(event.body || '{}');

    const VALID_PROVIDERS = ['openai', 'elevenlabs', 'device', 'azure'];
    const VALID_GENDERS   = ['male', 'female'];

    if (body.tts_provider && !VALID_PROVIDERS.includes(body.tts_provider)) {
      return sendError(400, `tts_provider must be one of: ${VALID_PROVIDERS.join(', ')}`);
    }
    if (body.voice_gender && !VALID_GENDERS.includes(body.voice_gender)) {
      return sendError(400, `voice_gender must be one of: ${VALID_GENDERS.join(', ')}`);
    }
    if ('onboarding_completed' in body && typeof body.onboarding_completed !== 'boolean') {
      return sendError(400, 'onboarding_completed must be a boolean');
    }
    if ('use_case' in body && body.use_case !== null && typeof body.use_case !== 'string') {
      return sendError(400, 'use_case must be a string or null');
    }
    if (typeof body.use_case === 'string' && body.use_case.length > 100) {
      return sendError(400, 'use_case must be under 100 characters');
    }

    const allowed = [
      'default_source_language', 'default_target_language',
      'tts_provider', 'voice_gender', 'conversation_mode_default', 'custom_voice_id',
      // Written once by the onboarding flow on completion. Deliberately NOT
      // including trial_start_date/trial_translations_used/trial_conversations_used
      // here — those are server-incremented counters, only ever written by
      // POST /v1/usage/trial/consume, never accepted from an arbitrary client PATCH.
      'onboarding_completed', 'use_case',
    ];

    const expressionParts  = [];
    const expressionValues = { ':upd': new Date().toISOString() };
    const expressionNames  = { '#upd': 'updated_at' };

    let i = 0;
    for (const key of allowed) {
      if (key in body) {
        expressionParts.push(`#k${i} = :v${i}`);
        expressionNames[`#k${i}`] = key;
        expressionValues[`:v${i}`] = body[key];
        i++;
      }
    }

    if (expressionParts.length === 0) {
      return sendError(400, 'No valid fields to update');
    }

    expressionParts.push('#upd = :upd');

    const result = await db.send(new UpdateCommand({
      TableName:                 SETTINGS_TABLE,
      Key:                       { user_id: userId },
      UpdateExpression:          `SET ${expressionParts.join(', ')}`,
      ExpressionAttributeNames:  expressionNames,
      ExpressionAttributeValues: expressionValues,
      ReturnValues:              'ALL_NEW',
    }));

    return sendSuccess(result.Attributes);
  } catch (err) {
    return handleError(err);
  }
}

// ─────────────────────────────────────────────────────────
// There's no billing integration yet beyond Razorpay's own dashboard — this is
// the stand-in that lets an OWNER-role account flip its own (or, for future
// support-desk use, another user's) plan for testing. Deliberately NOT
// reachable by a plain USER: unlike PUT/PATCH /v1/settings which silently
// ignore any `plan` in the body, this route writes it, so it must never be
// exposed to non-owners.
// ─────────────────────────────────────────────────────────
export async function adminSetPlan(event) {
  try {
    const callerId = getUserId(event);
    if (getRole(event) !== 'OWNER') return sendError(403, 'OWNER role required');

    const body = JSON.parse(event.body || '{}');
    const { plan } = body;
    // user_id defaults to self — an OWNER testing their own account is the
    // expected common case; targeting another user's is opt-in via the body.
    const targetUserId = body.user_id || callerId;

    if (!PLANS.includes(plan)) {
      return sendError(400, `plan must be one of: ${PLANS.join(', ')}`);
    }

    const result = await db.send(new UpdateCommand({
      TableName:                 SETTINGS_TABLE,
      Key:                       { user_id: targetUserId },
      // 'plan' is a DynamoDB reserved keyword — see the identical fix and
      // full explanation on applySubscriptionState in billing.mjs, which
      // hit the exact same "Invalid UpdateExpression: Attribute name is a
      // reserved word" failure this endpoint would otherwise have too,
      // including as the manual-recovery path for that bug.
      UpdateExpression:          'SET #plan = :p, updated_at = :u',
      ExpressionAttributeNames:  { '#plan': 'plan' },
      ExpressionAttributeValues: { ':p': plan, ':u': new Date().toISOString() },
      ReturnValues:              'ALL_NEW',
    }));

    return sendSuccess(result.Attributes);
  } catch (err) {
    return handleError(err);
  }
}

// ─────────────────────────────────────────────────────────
// DELETE /v1/settings  (reset to defaults)
// ─────────────────────────────────────────────────────────
export async function resetSettings(event) {
  try {
    const userId = getUserId(event);

    // Preserve plan + Razorpay subscription linkage, onboarding completion,
    // and trial usage across a preferences reset — this endpoint resets UI
    // preferences (language, voice, etc.), not billing/trial status. Without
    // this, DELETE /v1/settings would double as a way to re-trigger
    // onboarding and wipe the trial counters back to unset — i.e. a free way
    // to farm a fresh 10-translation/5-conversation trial repeatedly.
    const existing = await db.send(new GetCommand({ TableName: SETTINGS_TABLE, Key: { user_id: userId } }));
    const plan = existing.Item?.plan || 'basic';
    const razorpaySubscriptionId     = existing.Item?.razorpay_subscription_id;
    const razorpaySubscriptionStatus = existing.Item?.razorpay_subscription_status;
    const onboardingCompleted = backfillOnboardingCompleted(existing.Item);
    const useCase             = existing.Item?.use_case ?? null;
    const trialStartDate         = existing.Item?.trial_start_date;
    const trialTranslationsUsed  = existing.Item?.trial_translations_used;
    const trialConversationsUsed = existing.Item?.trial_conversations_used;

    const defaults = {
      user_id:                  userId,
      default_source_language:  'auto',
      default_target_language:  'en',
      tts_provider:             'openai',
      voice_gender:             'female',
      conversation_mode_default: false,
      custom_voice_id:          null,
      plan,
      onboarding_completed:     onboardingCompleted,
      use_case:                 useCase,
      ...(razorpaySubscriptionId     ? { razorpay_subscription_id: razorpaySubscriptionId }         : {}),
      ...(razorpaySubscriptionStatus ? { razorpay_subscription_status: razorpaySubscriptionStatus }  : {}),
      ...(trialStartDate         !== undefined ? { trial_start_date: trialStartDate }                 : {}),
      ...(trialTranslationsUsed  !== undefined ? { trial_translations_used: trialTranslationsUsed }   : {}),
      ...(trialConversationsUsed !== undefined ? { trial_conversations_used: trialConversationsUsed } : {}),
      updated_at:               new Date().toISOString(),
    };

    await db.send(new PutCommand({ TableName: SETTINGS_TABLE, Item: defaults }));
    return sendSuccess(defaults);
  } catch (err) {
    return handleError(err);
  }
}
