/**
 * DynamoService — API Gateway HTTP implementation.
 *
 * All DynamoDB access now goes through the Lambda backend via API Gateway.
 * The Cognito idToken (already obtained for auth) is reused as the Bearer token —
 * no second auth system is needed.
 *
 * The public interface is IDENTICAL to the previous DynamoDB-SDK implementation,
 * so AuthContext, history.tsx, and settings.tsx require zero changes.
 *
 * Environment variable required:
 *   EXPO_PUBLIC_API_BASE_URL=https://<api-id>.execute-api.<region>.amazonaws.com/prod
 */

import { UserSettings, ConversationHistory, TrialStatus, TrialConsumeResult } from '@/types';
import { NetworkError, isNetworkError } from '@/lib/errors';
import { logger } from '@/lib/logger';

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL || '').replace(/\/$/, '');

// Request body for creating a history entry — audio travels as base64 (matching
// this backend's existing TTS/transcribe proxy pattern) and is uploaded to S3
// server-side; only the resulting S3 key comes back in the stored record, so
// the *_key fields never belong in this input shape.
type PutConversationHistoryInput = Omit<ConversationHistory, 'id' | 'source_audio_key' | 'translated_audio_key'> & {
  source_audio_base64?: string;
  source_audio_content_type?: string;
  translated_audio_base64?: string;
  translated_audio_content_type?: string;
};

class DynamoService {
  private idToken: string | null = null;
  // Registered by AuthContext on mount — lets any backend call transparently
  // refresh an expired Cognito session instead of failing outright. Cognito ID
  // tokens are valid for 1 hour with nothing elsewhere in the app refreshing
  // them, so any request made after that window would otherwise keep failing
  // silently for the rest of the session (most visible in conversation mode,
  // whose auto-retry loop hides the failure behind the next "Listening…" state
  // before a user can read it).
  private sessionRefreshHandler: (() => Promise<boolean>) | null = null;

  initialize(idToken: string) {
    this.idToken = idToken;
    console.log('✅ DynamoService initialized (API Gateway mode)');
  }

  isInitialized(): boolean {
    return this.idToken !== null;
  }

  /** Current Cognito idToken, reused as the Bearer token for the AI proxy routes. */
  getIdToken(): string | null {
    return this.idToken;
  }

  setSessionRefreshHandler(handler: (() => Promise<boolean>) | null) {
    this.sessionRefreshHandler = handler;
  }

  /** Attempt to refresh the Cognito session via the handler AuthContext registered.
   *  Returns false (never throws) if there's no handler, no refresh token, or the
   *  refresh itself fails — callers should treat false as "still unauthenticated." */
  async refreshSessionIfPossible(): Promise<boolean> {
    if (!this.sessionRefreshHandler) return false;
    try {
      return await this.sessionRefreshHandler();
    } catch {
      return false;
    }
  }

  // ── Internal HTTP helper ────────────────────────────────────────────────────

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    if (!this.idToken) throw new Error('DynamoService not initialized — call initialize(idToken) first');
    if (!API_BASE)    throw new Error('EXPO_PUBLIC_API_BASE_URL is not set in .env');

    // Wrap so a transport-level failure (offline, DNS, CORS) surfaces as a typed
    // NetworkError instead of a bare, unclassified `TypeError: Failed to fetch`.
    const doFetch = async () => {
      try {
        return await fetch(`${API_BASE}${path}`, {
          ...options,
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${this.idToken}`,
            ...(options.headers || {}),
          },
        });
      } catch (err) {
        logger.error('DynamoService request failed', err, { path });
        if (isNetworkError(err)) {
          throw new NetworkError('Unable to reach the server — check your internet connection.', err);
        }
        throw err;
      }
    };

    let response = await doFetch();

    // Transparent one-shot refresh-and-retry on an expired token.
    if (response.status === 401) {
      const refreshed = await this.refreshSessionIfPossible();
      if (refreshed) response = await doFetch();
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`API ${response.status}: ${body.substring(0, 200)}`);
    }

    // 204 No Content — return void
    if (response.status === 204) return undefined as unknown as T;

    return response.json() as Promise<T>;
  }

  // ── USER SETTINGS ───────────────────────────────────────────────────────────

  async getUserSettings(userId: string): Promise<UserSettings | null> {
    try {
      return await this.request<UserSettings>('/v1/settings');
    } catch (error) {
      console.error('❌ getUserSettings error:', error);
      return null;
    }
  }

  async putUserSettings(settings: UserSettings): Promise<void> {
    await this.request('/v1/settings', {
      method: 'PUT',
      body:   JSON.stringify(settings),
    });
  }

  async updateUserSettings(
    userId: string,
    updates: Partial<UserSettings>,
  ): Promise<UserSettings | null> {
    try {
      return await this.request<UserSettings>('/v1/settings', {
        method: 'PATCH',
        body:   JSON.stringify(updates),
      });
    } catch (error) {
      console.error('❌ updateUserSettings error:', error);
      return null;
    }
  }

  // OWNER-only testing tool — see backend/src/handlers/settings.mjs's
  // adminSetPlan(). No streaming/live pipeline gates currently read `plan` in
  // this codebase, so this only exercises the billing UI/state without a real
  // purchase — useful for QA without spending real money via Razorpay.
  async adminSetPlan(plan: 'basic' | 'plus' | 'live', targetUserId?: string): Promise<UserSettings | null> {
    try {
      return await this.request<UserSettings>('/v1/admin/set-plan', {
        method: 'PATCH',
        body:   JSON.stringify({ plan, ...(targetUserId ? { user_id: targetUserId } : {}) }),
      });
    } catch (error) {
      console.error('❌ adminSetPlan error:', error);
      return null;
    }
  }

  // ── BILLING / RAZORPAY ──────────────────────────────────────────────────────
  // Real purchase flow for 'plus'/'live' — see services/billingService.ts for
  // the RazorpayCheckout wrapper that ties these two calls together with the
  // native SDK. Errors are rethrown (not swallowed to null like most methods
  // above) so billingService can distinguish "network/server error" from
  // "user cancelled the checkout" and surface each correctly.

  /** Creates a Razorpay subscription for the given plan and returns what
   *  Checkout needs to open (subscription_id + the public key_id). */
  async createRazorpaySubscription(plan: 'plus' | 'live'): Promise<{ subscription_id: string; key_id: string; plan: string }> {
    return this.request('/v1/billing/razorpay/create-subscription', {
      method: 'POST',
      body:   JSON.stringify({ plan }),
    });
  }

  /** Verifies a just-completed Checkout payment and applies the plan server-side.
   *  This is a fast in-app confirmation only — the Razorpay webhook (handled
   *  entirely server-side) is the durable source of truth for renewals and
   *  cancellations, which this call is never involved in. */
  async verifyRazorpayPayment(payload: {
    razorpay_payment_id: string;
    razorpay_subscription_id: string;
    razorpay_signature: string;
  }): Promise<UserSettings> {
    return this.request('/v1/billing/razorpay/verify', {
      method: 'POST',
      body:   JSON.stringify(payload),
    });
  }

  /** Cancels at the end of the current billing cycle — access continues
   *  through what's already been paid for; the actual downgrade happens when
   *  the webhook's subscription.cancelled event lands at cycle end. */
  async cancelRazorpaySubscription(): Promise<UserSettings> {
    return this.request('/v1/billing/razorpay/cancel', { method: 'POST' });
  }

  // ── TRIAL USAGE (7-day free trial — see backend/src/lib/trialLimits.mjs) ──

  /** Read-only trial status (used/remaining/days left) for the "N/10
   *  translations · N days left" banner — never starts the trial clock. */
  async getTrialStatus(): Promise<TrialStatus | null> {
    try {
      return await this.request<TrialStatus>('/v1/usage/trial');
    } catch (error) {
      console.error('❌ getTrialStatus error:', error);
      return null;
    }
  }

  /** Call right before actually starting a single translation or a
   *  conversation session — not after — so a denial can stop the action
   *  before it starts. Throws on network/server error (caller decides how to
   *  treat that; a fail-open default is used in index.tsx so a transient
   *  network blip never blocks a translation the trial would have allowed). */
  async consumeTrialUsage(kind: 'translation' | 'conversation'): Promise<TrialConsumeResult> {
    return this.request('/v1/usage/trial/consume', {
      method: 'POST',
      body:   JSON.stringify({ kind }),
    });
  }

  // ── ACCOUNT ──────────────────────────────────────────────────────────────

  /** Permanently deletes the signed-in user's account: cancels any live
   *  Razorpay subscription, purges conversation history + audio, deletes
   *  settings, then deletes the Cognito user itself. Irreversible — the
   *  caller (AuthContext.deleteAccount) signs the local session out
   *  immediately after this resolves, since the account no longer exists. */
  async deleteAccount(): Promise<void> {
    await this.request('/v1/account', { method: 'DELETE' });
  }

  // ── CONVERSATION HISTORY ────────────────────────────────────────────────────

  async getConversationHistory(userId: string, limit?: number): Promise<ConversationHistory[]> {
    try {
      const pageSize = limit ?? 200;
      const allItems: ConversationHistory[] = [];
      let nextKey: string | null = null;

      do {
        const qs: string = nextKey
          ? `?limit=${pageSize}&lastKey=${encodeURIComponent(nextKey)}`
          : `?limit=${pageSize}`;

        type PageResult = { items: ConversationHistory[]; nextKey: string | null };
        const data: PageResult = await this.request<PageResult>(`/v1/translations${qs}`);

        allItems.push(...(data.items || []));
        nextKey = data.nextKey;

        // If a hard limit was requested, stop after the first page
        if (limit !== undefined) break;
      } while (nextKey);

      return allItems;
    } catch (error) {
      console.error('❌ getConversationHistory error:', error);
      return [];
    }
  }

  async putConversationHistory(item: PutConversationHistoryInput): Promise<void> {
    try {
      await this.request('/v1/translations', {
        method: 'POST',
        body:   JSON.stringify(item),
      });
    } catch (error) {
      console.error('❌ putConversationHistory error:', error);
    }
  }

  /**
   * Mint a fresh short-lived presigned S3 URL for a history item's stored
   * audio. Returns null if no audio was stored for that item (device-TTS
   * turns never persist audio) or the request otherwise fails — callers
   * should treat null as "fall back to on-the-fly synthesis", not an error.
   */
  async getAudioUrl(timestamp: string, type: 'source' | 'translated' = 'translated'): Promise<string | null> {
    try {
      const data = await this.request<{ url: string; expiresIn: number }>(
        `/v1/translations/${encodeURIComponent(timestamp)}/audio-url?type=${type}`,
      );
      return data.url;
    } catch (error) {
      console.error('❌ getAudioUrl error:', error);
      return null;
    }
  }

  async deleteConversationHistoryItem(userId: string, timestamp: string): Promise<void> {
    await this.request(
      `/v1/translations/${encodeURIComponent(timestamp)}`,
      { method: 'DELETE' },
    );
  }

  async clearConversationHistory(userId: string): Promise<void> {
    await this.request('/v1/translations', { method: 'DELETE' });
  }

  // ── EXTRA ENDPOINTS (new capabilities not in old SDK version) ───────────────

  /** Search history by keyword, source language, or target language */
  async searchHistory(params: {
    q?: string;
    source_language?: string;
    target_language?: string;
  }): Promise<ConversationHistory[]> {
    try {
      const qs = new URLSearchParams();
      if (params.q)               qs.set('q', params.q);
      if (params.source_language) qs.set('source_language', params.source_language);
      if (params.target_language) qs.set('target_language', params.target_language);

      const data = await this.request<{ items: ConversationHistory[] }>(
        `/v1/translations/search?${qs}`,
      );
      return data.items || [];
    } catch (error) {
      console.error('❌ searchHistory error:', error);
      return [];
    }
  }

  /** Return translation count + per-language-pair breakdown */
  async getStats(): Promise<{ total: number; pairs: Record<string, number> }> {
    try {
      return await this.request('/v1/translations/stats');
    } catch (error) {
      console.error('❌ getStats error:', error);
      return { total: 0, pairs: {} };
    }
  }

  /** Toggle favorite on a translation */
  async toggleFavorite(timestamp: string, favorite: boolean): Promise<void> {
    await this.request(
      `/v1/translations/${encodeURIComponent(timestamp)}/favorite`,
      { method: 'PATCH', body: JSON.stringify({ favorite }) },
    );
  }

  /** Return only favorited translations */
  async getFavorites(): Promise<ConversationHistory[]> {
    try {
      const data = await this.request<{ items: ConversationHistory[] }>(
        '/v1/translations/favorites',
      );
      return data.items || [];
    } catch (error) {
      console.error('❌ getFavorites error:', error);
      return [];
    }
  }

  /** Delete all items older than a given ISO timestamp */
  async deleteOldHistory(before: string): Promise<number> {
    try {
      const data = await this.request<{ deleted: number }>(
        `/v1/translations/old?before=${encodeURIComponent(before)}`,
        { method: 'DELETE' },
      );
      return data.deleted || 0;
    } catch (error) {
      console.error('❌ deleteOldHistory error:', error);
      return 0;
    }
  }
}

export const dynamoService = new DynamoService();
