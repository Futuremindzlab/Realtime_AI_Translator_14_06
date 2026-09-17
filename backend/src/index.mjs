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
 *   GET    /v1/translations/{timestamp}/audio-url     getTranslationAudioUrl
 *   DELETE /v1/translations                           clearAllTranslations
 *   DELETE /v1/translations/old                       deleteOldTranslations
 *   DELETE /v1/translations/{timestamp}               deleteTranslation
 *   PATCH  /v1/translations/{timestamp}/favorite      toggleFavorite
 *
 * Account
 *   DELETE /v1/account                                 deleteAccount
 *
 * Settings
 *   GET    /v1/settings                               getSettings
 *   PUT    /v1/settings                               putSettings
 *   PATCH  /v1/settings                               patchSettings
 *   DELETE /v1/settings                               resetSettings
 *
 * Trial usage (7-day free trial for 'basic'-plan users — see trialLimits.mjs)
 *   GET    /v1/usage/trial                            getTrialStatus (read-only)
 *   POST   /v1/usage/trial/consume                    consumeTrial
 *
 * Health
 *   GET    /v1/health                                 health check
 *
 * AI provider proxy (holds OpenAI/ElevenLabs/Azure keys server-side)
 *   POST   /v1/proxy/openai/chat                       proxyOpenAIChat
 *   POST   /v1/proxy/openai/tts                        proxyOpenAITts
 *   POST   /v1/proxy/openai/transcribe                 proxyOpenAITranscribe
 *   POST   /v1/proxy/elevenlabs/tts                     proxyElevenLabsTts
 *   POST   /v1/proxy/elevenlabs/voice-clone             proxyElevenLabsVoiceClone
 *   POST   /v1/proxy/azure/tts                          proxyAzureTts
 *
 * Admin (OWNER role required)
 *   GET    /v1/admin/user-analytics                    getUserAnalytics
 *   GET    /v1/admin/dashboard-metrics                  getDashboardMetrics
 *   GET    /v1/admin/infra-metrics                      getInfraMetrics
 *   GET    /v1/admin/payments                           getPaymentsOverview
 *   GET    /v1/admin/subscriptions                       getSubscriptionsOverview
 *   PATCH  /v1/admin/set-plan                           adminSetPlan (no billing yet — dev/testing only)
 *
 * Auth (unauthenticated — no token exists yet)
 *   POST   /v1/auth/phone/request-otp                 requestPhoneOtp
 *
 * Billing / Razorpay recurring subscriptions
 *   POST   /v1/billing/razorpay/create-subscription    createSubscription
 *   POST   /v1/billing/razorpay/verify                 verifySubscriptionPayment
 *   POST   /v1/billing/razorpay/cancel                 cancelSubscription
 *   POST   /v1/billing/razorpay/webhook                 handleWebhook (unauthenticated — Razorpay calls this directly)
 *   GET    /v1/billing/history                          getMyBillingHistory (caller's own payments only)
 */

import {
  createTranslation,
  listTranslations,
  countTranslations,
  getStats,
  searchTranslations,
  getFavorites,
  getTranslation,
  getTranslationAudioUrl,
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
  adminSetPlan,
} from './handlers/settings.mjs';

import { requestPhoneOtp } from './handlers/phoneAuth.mjs';
import { deleteAccount } from './handlers/account.mjs';
import { getTrialStatus, consumeTrial } from './handlers/trial.mjs';

import {
  createSubscription,
  verifySubscriptionPayment,
  cancelSubscription,
  getMyBillingHistory,
  handleWebhook as handleRazorpayWebhook,
} from './handlers/billing.mjs';

import { getUserAnalytics } from './handlers/adminAnalytics.mjs';
import { getDashboardMetrics } from './handlers/dashboardMetrics.mjs';
import { getInfraMetrics } from './handlers/infraMetrics.mjs';
import { getPaymentsOverview } from './handlers/adminPayments.mjs';
import { getSubscriptionsOverview } from './handlers/adminSubscriptions.mjs';
import { recordRouteRequest } from './lib/routeMetrics.mjs';

import {
  proxyOpenAIChat,
  proxyOpenAITts,
  proxyOpenAITranscribe,
  proxyElevenLabsTts,
  proxyElevenLabsVoiceClone,
  proxyAzureTts,
} from './handlers/aiProxy.mjs';

import { sendSuccess, sendError } from './response.mjs';

export const handler = async (event) => {
  const method   = event.httpMethod;
  const rawPath  = event.path || '';
  // Strip stage prefix if present (e.g. /prod/v1/... → /v1/...)
  const path = rawPath.replace(/^\/(prod|dev|staging)/, '');

  // Per-route request counts for the infra dashboard's rate-limit section —
  // see routeMetrics.mjs for why this exists instead of relying on API Gateway
  // metrics. Only these four routes are tracked, to keep dimension cardinality low.
  const TRACKED_ROUTES = new Set([
    'POST /v1/proxy/openai/chat',
    'POST /v1/proxy/openai/transcribe',
    'POST /v1/proxy/elevenlabs/tts',
    'POST /v1/translations',
  ]);
  const routeKey = `${method} ${path}`;
  if (TRACKED_ROUTES.has(routeKey)) recordRouteRequest(routeKey);

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

  // ── Phone auth (unauthenticated) ───────────────────────
  if (method === 'POST' && path === '/v1/auth/phone/request-otp') {
    return requestPhoneOtp(event);
  }

  // ── Razorpay webhook (unauthenticated — Razorpay's servers call this
  // directly, there's no Cognito token; see template.yaml's explicit
  // Auth: NONE override for this exact path, same pattern as phone-otp above) ──
  if (method === 'POST' && path === '/v1/billing/razorpay/webhook') {
    return handleRazorpayWebhook(event);
  }

  // ── Billing / Razorpay (authenticated) ─────────────────
  if (method === 'POST' && path === '/v1/billing/razorpay/create-subscription') return createSubscription(event);
  if (method === 'POST' && path === '/v1/billing/razorpay/verify')              return verifySubscriptionPayment(event);
  if (method === 'POST' && path === '/v1/billing/razorpay/cancel')              return cancelSubscription(event);
  if (method === 'GET'  && path === '/v1/billing/history')                      return getMyBillingHistory(event);

  // ── AI provider proxy ───────────────────────────────────
  if (method === 'POST' && path === '/v1/proxy/openai/chat')           return proxyOpenAIChat(event);
  if (method === 'POST' && path === '/v1/proxy/openai/tts')            return proxyOpenAITts(event);
  if (method === 'POST' && path === '/v1/proxy/openai/transcribe')     return proxyOpenAITranscribe(event);
  if (method === 'POST' && path === '/v1/proxy/elevenlabs/tts')        return proxyElevenLabsTts(event);
  if (method === 'POST' && path === '/v1/proxy/elevenlabs/voice-clone') return proxyElevenLabsVoiceClone(event);
  if (method === 'POST' && path === '/v1/proxy/azure/tts')             return proxyAzureTts(event);

  // ── Admin (OWNER role enforced inside the handler) ─────
  if (method === 'GET' && path === '/v1/admin/user-analytics')    return getUserAnalytics(event);
  if (method === 'GET' && path === '/v1/admin/dashboard-metrics') return getDashboardMetrics(event);
  if (method === 'GET' && path === '/v1/admin/infra-metrics')     return getInfraMetrics(event);
  if (method === 'GET' && path === '/v1/admin/payments')          return getPaymentsOverview(event);
  if (method === 'GET' && path === '/v1/admin/subscriptions')     return getSubscriptionsOverview(event);
  if (method === 'PATCH' && path === '/v1/admin/set-plan')        return adminSetPlan(event);

  // ── Account (required by app-store review policy for account deletion) ──
  if (method === 'DELETE' && path === '/v1/account') return deleteAccount(event);

  // ── Trial usage (7-day free trial gate) ────────────────
  if (method === 'GET'  && path === '/v1/usage/trial')         return getTrialStatus(event);
  if (method === 'POST' && path === '/v1/usage/trial/consume') return consumeTrial(event);

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

  // ── Translations — audio presigned URL  /v1/translations/{ts}/audio-url ──
  const audioUrlMatch = path.match(/^\/v1\/translations\/([^/]+)\/audio-url$/);
  if (audioUrlMatch && method === 'GET') {
    event.pathParameters = { timestamp: decodeURIComponent(audioUrlMatch[1]) };
    return getTranslationAudioUrl(event);
  }

  return sendError(404, `Route not found: ${method} ${path}`);
};
