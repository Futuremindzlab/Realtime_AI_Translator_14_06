/**
 * Main Lambda handler — routes API Gateway events to the correct handler.
 *
 * Route table (all under /v1):
 *
 * Translations
 *   POST   /v1/translations                           createTranslation
 *   GET    /v1/translations                           listTranslations
 *   GET    /v1/translations/count                     countTranslations
 *   GET    /v1/translations/stats                     getStats
 *   GET    /v1/translations/search                    searchTranslations
 *   GET    /v1/translations/favorites                 getFavorites
 *   GET    /v1/translations/{timestamp}               getTranslation
 *   DELETE /v1/translations                           clearAllTranslations
 *   DELETE /v1/translations/old                       deleteOldTranslations
 *   DELETE /v1/translations/{timestamp}               deleteTranslation
 *   PATCH  /v1/translations/{timestamp}/favorite      toggleFavorite
 *
 * Settings
 *   GET    /v1/settings                               getSettings
 *   PUT    /v1/settings                               putSettings
 *   PATCH  /v1/settings                               patchSettings
 *   DELETE /v1/settings                               resetSettings
 *
 * Health
 *   GET    /v1/health                                 health check
 */

import {
  createTranslation,
  listTranslations,
  countTranslations,
  getStats,
  searchTranslations,
  getFavorites,
  getTranslation,
  deleteTranslation,
  clearAllTranslations,
  deleteOldTranslations,
  toggleFavorite,
} from './handlers/translations.mjs';

import {
  getSettings,
  putSettings,
  patchSettings,
  resetSettings,
} from './handlers/settings.mjs';

import { sendSuccess, sendError } from './response.mjs';

export const handler = async (event) => {
  const method   = event.httpMethod;
  const rawPath  = event.path || '';
  // Strip stage prefix if present (e.g. /prod/v1/... → /v1/...)
  const path = rawPath.replace(/^\/(prod|dev|staging)/, '');

  // CORS preflight
  if (method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      },
      body: '',
    };
  }

  // ── Health check ──────────────────────────────────────
  if (method === 'GET' && path === '/v1/health') {
    return sendSuccess({ status: 'ok', ts: new Date().toISOString() });
  }

  // ── Settings ──────────────────────────────────────────
  if (path === '/v1/settings') {
    if (method === 'GET')    return getSettings(event);
    if (method === 'PUT')    return putSettings(event);
    if (method === 'PATCH')  return patchSettings(event);
    if (method === 'DELETE') return resetSettings(event);
  }

  // ── Translations — fixed sub-paths (must come before /{timestamp}) ──
  if (method === 'GET'    && path === '/v1/translations/count')     return countTranslations(event);
  if (method === 'GET'    && path === '/v1/translations/stats')      return getStats(event);
  if (method === 'GET'    && path === '/v1/translations/search')     return searchTranslations(event);
  if (method === 'GET'    && path === '/v1/translations/favorites')  return getFavorites(event);
  if (method === 'DELETE' && path === '/v1/translations/old')        return deleteOldTranslations(event);

  // ── Translations — collection ──────────────────────────
  if (path === '/v1/translations') {
    if (method === 'POST')   return createTranslation(event);
    if (method === 'GET')    return listTranslations(event);
    if (method === 'DELETE') return clearAllTranslations(event);
  }

  // ── Translations — single item  /v1/translations/{ts} ──
  const translationMatch = path.match(/^\/v1\/translations\/([^/]+)$/);
  if (translationMatch) {
    event.pathParameters = { timestamp: decodeURIComponent(translationMatch[1]) };
    if (method === 'GET')    return getTranslation(event);
    if (method === 'DELETE') return deleteTranslation(event);
  }

  // ── Translations — favorite toggle  /v1/translations/{ts}/favorite ──
  const favoriteMatch = path.match(/^\/v1\/translations\/([^/]+)\/favorite$/);
  if (favoriteMatch && method === 'PATCH') {
    event.pathParameters = { timestamp: decodeURIComponent(favoriteMatch[1]) };
    return toggleFavorite(event);
  }

  return sendError(404, `Route not found: ${method} ${path}`);
};
