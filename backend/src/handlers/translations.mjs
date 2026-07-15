import {
  PutCommand,
  GetCommand,
  QueryCommand,
  DeleteCommand,
  BatchWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { db, TRANSLATIONS_TABLE } from '../db.mjs';
import { getUserId, getRole } from '../auth.mjs';
import { sendSuccess, sendCreated, sendNoContent, sendError, handleError } from '../response.mjs';

// ─────────────────────────────────────────────────────────
// POST /v1/translations
// Body: { timestamp, source_language, target_language,
//         source_text, translated_text, conversation_mode }
// ─────────────────────────────────────────────────────────
export async function createTranslation(event) {
  try {
    const userId = getUserId(event);
    const body = JSON.parse(event.body || '{}');

    if (!body.source_text || !body.translated_text) {
      return sendError(400, 'source_text and translated_text are required');
    }
    const MAX_TEXT_LENGTH = 20000; // keep well under DynamoDB's 400KB item limit
    if (body.source_text.length > MAX_TEXT_LENGTH || body.translated_text.length > MAX_TEXT_LENGTH) {
      return sendError(400, `source_text and translated_text must be under ${MAX_TEXT_LENGTH} characters`);
    }

    const timestamp = body.timestamp || new Date().toISOString();
    const item = {
      user_id:          userId,
      timestamp,
      source_language:  body.source_language  || 'auto',
      target_language:  body.target_language  || 'en',
      source_text:      body.source_text,
      translated_text:  body.translated_text,
      conversation_mode: body.conversation_mode ?? false,
      created_at:       new Date().toISOString(),
      id: `${userId}_${Date.now()}_${Math.random().toString(36).substring(7)}`,
    };

    await db.send(new PutCommand({ TableName: TRANSLATIONS_TABLE, Item: item }));
    return sendCreated(item);
  } catch (err) {
    return handleError(err);
  }
}

// ─────────────────────────────────────────────────────────
// GET /v1/translations
// Query params: limit (default 50), lastKey (pagination cursor)
// ─────────────────────────────────────────────────────────
export async function listTranslations(event) {
  try {
    const userId = getUserId(event);
    const role = getRole(event);
    const qs = event.queryStringParameters || {};
    // OWNER: max 200 items per page; USER: hard-capped at 5 regardless of requested limit
    const parsedLimit = parseInt(qs.limit || '50', 10);
    const requestedLimit = Math.min(Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 50, 200);
    const limit = role === 'USER' ? Math.min(requestedLimit, 5) : requestedLimit;
    const lastKey = qs.lastKey
      ? JSON.parse(Buffer.from(qs.lastKey, 'base64').toString('utf8'))
      : undefined;

    const result = await db.send(new QueryCommand({
      TableName:                 TRANSLATIONS_TABLE,
      KeyConditionExpression:    'user_id = :uid',
      ExpressionAttributeValues: { ':uid': userId },
      ScanIndexForward:          false, // newest first
      Limit:                     limit,
      ExclusiveStartKey:         lastKey,
    }));

    const nextKey = result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
      : null;

    return sendSuccess({
      items:   result.Items || [],
      count:   result.Count || 0,
      nextKey,
    });
  } catch (err) {
    return handleError(err);
  }
}

// ─────────────────────────────────────────────────────────
// GET /v1/translations/count
// ─────────────────────────────────────────────────────────
export async function countTranslations(event) {
  try {
    const userId = getUserId(event);

    const result = await db.send(new QueryCommand({
      TableName:                 TRANSLATIONS_TABLE,
      KeyConditionExpression:    'user_id = :uid',
      ExpressionAttributeValues: { ':uid': userId },
      Select:                    'COUNT',
    }));

    return sendSuccess({ count: result.Count || 0 });
  } catch (err) {
    return handleError(err);
  }
}

// ─────────────────────────────────────────────────────────
// GET /v1/translations/stats
// Returns per-language pair counts + total
// ─────────────────────────────────────────────────────────
export async function getStats(event) {
  try {
    const userId = getUserId(event);

    const result = await db.send(new QueryCommand({
      TableName:                 TRANSLATIONS_TABLE,
      KeyConditionExpression:    'user_id = :uid',
      ExpressionAttributeValues: { ':uid': userId },
      ProjectionExpression:      'source_language, target_language',
    }));

    const items = result.Items || [];
    const pairs = {};
    for (const item of items) {
      const key = `${item.source_language}→${item.target_language}`;
      pairs[key] = (pairs[key] || 0) + 1;
    }

    return sendSuccess({ total: items.length, pairs });
  } catch (err) {
    return handleError(err);
  }
}

// ─────────────────────────────────────────────────────────
// GET /v1/translations/search
// Query params: q (text), source_language, target_language
// ─────────────────────────────────────────────────────────
export async function searchTranslations(event) {
  try {
    const userId = getUserId(event);
    const qs = event.queryStringParameters || {};
    const q = (qs.q || '').toLowerCase();
    const srcFilter = qs.source_language;
    const tgtFilter = qs.target_language;

    if (!q && !srcFilter && !tgtFilter) {
      return sendError(400, 'At least one of: q, source_language, target_language required');
    }

    // Fetch all for this user then filter in Lambda
    // (Suitable for personal history — not multi-tenant scale)
    const result = await db.send(new QueryCommand({
      TableName:                 TRANSLATIONS_TABLE,
      KeyConditionExpression:    'user_id = :uid',
      ExpressionAttributeValues: { ':uid': userId },
      ScanIndexForward:          false,
    }));

    let items = result.Items || [];

    if (q) {
      items = items.filter(i =>
        i.source_text?.toLowerCase().includes(q) ||
        i.translated_text?.toLowerCase().includes(q)
      );
    }
    if (srcFilter) items = items.filter(i => i.source_language === srcFilter);
    if (tgtFilter) items = items.filter(i => i.target_language === tgtFilter);

    return sendSuccess({ items, count: items.length });
  } catch (err) {
    return handleError(err);
  }
}

// ─────────────────────────────────────────────────────────
// GET /v1/translations/{timestamp}
// ─────────────────────────────────────────────────────────
export async function getTranslation(event) {
  try {
    const userId    = getUserId(event);
    const timestamp = decodeURIComponent(event.pathParameters?.timestamp || '');

    if (!timestamp) return sendError(400, 'timestamp path parameter required');

    const result = await db.send(new GetCommand({
      TableName: TRANSLATIONS_TABLE,
      Key: { user_id: userId, timestamp },
    }));

    if (!result.Item) return sendError(404, 'Translation not found');
    return sendSuccess(result.Item);
  } catch (err) {
    return handleError(err);
  }
}

// ─────────────────────────────────────────────────────────
// DELETE /v1/translations/{timestamp}
// ─────────────────────────────────────────────────────────
export async function deleteTranslation(event) {
  try {
    const userId    = getUserId(event);
    const timestamp = decodeURIComponent(event.pathParameters?.timestamp || '');

    if (!timestamp) return sendError(400, 'timestamp path parameter required');

    await db.send(new DeleteCommand({
      TableName: TRANSLATIONS_TABLE,
      Key: { user_id: userId, timestamp },
    }));

    return sendNoContent();
  } catch (err) {
    return handleError(err);
  }
}

// ─────────────────────────────────────────────────────────
// DELETE /v1/translations
// Deletes ALL history for the authenticated user
// ─────────────────────────────────────────────────────────
export async function clearAllTranslations(event) {
  try {
    const userId = getUserId(event);

    // Fetch all timestamps for this user
    const result = await db.send(new QueryCommand({
      TableName:                 TRANSLATIONS_TABLE,
      KeyConditionExpression:    'user_id = :uid',
      ExpressionAttributeValues: { ':uid': userId },
      ProjectionExpression:      'user_id, #ts',
      ExpressionAttributeNames:  { '#ts': 'timestamp' },
    }));

    const items = result.Items || [];
    if (items.length === 0) return sendNoContent();

    // BatchWrite in chunks of 25 (DynamoDB limit)
    const chunks = [];
    for (let i = 0; i < items.length; i += 25) {
      chunks.push(items.slice(i, i + 25));
    }

    for (const chunk of chunks) {
      await db.send(new BatchWriteCommand({
        RequestItems: {
          [TRANSLATIONS_TABLE]: chunk.map(item => ({
            DeleteRequest: { Key: { user_id: item.user_id, timestamp: item.timestamp } },
          })),
        },
      }));
    }

    return sendNoContent();
  } catch (err) {
    return handleError(err);
  }
}

// ─────────────────────────────────────────────────────────
// DELETE /v1/translations/old
// Query param: before (ISO timestamp) — deletes items older than date
// ─────────────────────────────────────────────────────────
export async function deleteOldTranslations(event) {
  try {
    const userId = getUserId(event);
    const qs = event.queryStringParameters || {};
    const before = qs.before;

    if (!before) return sendError(400, 'before query parameter (ISO timestamp) required');

    const result = await db.send(new QueryCommand({
      TableName:                 TRANSLATIONS_TABLE,
      KeyConditionExpression:    'user_id = :uid AND #ts < :before',
      ExpressionAttributeNames:  { '#ts': 'timestamp' },
      ExpressionAttributeValues: { ':uid': userId, ':before': before },
      ProjectionExpression:      'user_id, #ts',
    }));

    const items = result.Items || [];
    if (items.length === 0) return sendSuccess({ deleted: 0 });

    const chunks = [];
    for (let i = 0; i < items.length; i += 25) {
      chunks.push(items.slice(i, i + 25));
    }

    for (const chunk of chunks) {
      await db.send(new BatchWriteCommand({
        RequestItems: {
          [TRANSLATIONS_TABLE]: chunk.map(item => ({
            DeleteRequest: { Key: { user_id: item.user_id, timestamp: item.timestamp } },
          })),
        },
      }));
    }

    return sendSuccess({ deleted: items.length });
  } catch (err) {
    return handleError(err);
  }
}

// ─────────────────────────────────────────────────────────
// PATCH /v1/translations/{timestamp}/favorite
// Body: { favorite: true|false }
// ─────────────────────────────────────────────────────────
export async function toggleFavorite(event) {
  try {
    const userId    = getUserId(event);
    const timestamp = decodeURIComponent(event.pathParameters?.timestamp || '');
    const body      = JSON.parse(event.body || '{}');

    if (!timestamp) return sendError(400, 'timestamp path parameter required');
    if (typeof body.favorite !== 'boolean') return sendError(400, 'favorite (boolean) required');

    const result = await db.send(new UpdateCommand({
      TableName:                 TRANSLATIONS_TABLE,
      Key:                       { user_id: userId, timestamp },
      UpdateExpression:          'SET favorite = :fav, updated_at = :upd',
      ExpressionAttributeValues: { ':fav': body.favorite, ':upd': new Date().toISOString() },
      ReturnValues:              'ALL_NEW',
    }));

    return sendSuccess(result.Attributes);
  } catch (err) {
    return handleError(err);
  }
}

// ─────────────────────────────────────────────────────────
// GET /v1/translations/favorites
// ─────────────────────────────────────────────────────────
export async function getFavorites(event) {
  try {
    const userId = getUserId(event);

    const result = await db.send(new QueryCommand({
      TableName:                 TRANSLATIONS_TABLE,
      KeyConditionExpression:    'user_id = :uid',
      FilterExpression:          'favorite = :t',
      ExpressionAttributeValues: { ':uid': userId, ':t': true },
      ScanIndexForward:          false,
    }));

    return sendSuccess({ items: result.Items || [], count: result.Count || 0 });
  } catch (err) {
    return handleError(err);
  }
}
