import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

// Table names come from SAM environment variables injected at deploy time
export const TRANSLATIONS_TABLE = process.env.TRANSLATIONS_TABLE || 'conversation_history';
export const SETTINGS_TABLE     = process.env.SETTINGS_TABLE     || 'user_settings';

// Singleton DynamoDB DocumentClient — reused across warm Lambda invocations
const raw = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
export const db = DynamoDBDocumentClient.from(raw, {
  marshallOptions:   { removeUndefinedValues: true },
  unmarshallOptions: { wrapNumbers: false },
});
