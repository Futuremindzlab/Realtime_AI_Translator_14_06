import { PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { db, SETTINGS_TABLE } from '../db.mjs';
import { getUserId } from '../auth.mjs';
import { sendSuccess, sendNoContent, sendError, handleError } from '../response.mjs';

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
        updated_at:               new Date().toISOString(),
      });
    }

    return sendSuccess(result.Item);
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

    const item = {
      user_id:                  userId,
      default_source_language:  body.default_source_language  || 'auto',
      default_target_language:  body.default_target_language  || 'en',
      tts_provider:             body.tts_provider             || 'openai',
      voice_gender:             body.voice_gender             || 'female',
      conversation_mode_default: body.conversation_mode_default ?? false,
      custom_voice_id:          body.custom_voice_id          || null,
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

    const allowed = [
      'default_source_language', 'default_target_language',
      'tts_provider', 'voice_gender', 'conversation_mode_default', 'custom_voice_id',
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
// DELETE /v1/settings  (reset to defaults)
// ─────────────────────────────────────────────────────────
export async function resetSettings(event) {
  try {
    const userId = getUserId(event);

    const defaults = {
      user_id:                  userId,
      default_source_language:  'auto',
      default_target_language:  'en',
      tts_provider:             'openai',
      voice_gender:             'female',
      conversation_mode_default: false,
      custom_voice_id:          null,
      updated_at:               new Date().toISOString(),
    };

    await db.send(new PutCommand({ TableName: SETTINGS_TABLE, Item: defaults }));
    return sendSuccess(defaults);
  } catch (err) {
    return handleError(err);
  }
}
