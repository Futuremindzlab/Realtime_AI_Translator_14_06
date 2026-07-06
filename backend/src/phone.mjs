/**
 * E.164 phone number validation/normalization.
 *
 * The mobile client composes E.164 client-side from a country-code dropdown
 * (UX convenience only) — this is the authoritative, server-side check.
 * Never trust the client-supplied format.
 */

// E.164: '+' followed by 1-15 digits, first digit non-zero.
const E164_PATTERN = /^\+[1-9]\d{1,14}$/;

/**
 * Normalizes a phone number to E.164 and validates it.
 * Strips spaces, hyphens, and parentheses before validating.
 * Throws if the result isn't a valid E.164 number.
 */
export function toE164(rawPhone) {
  if (!rawPhone || typeof rawPhone !== 'string') {
    const err = new Error('Phone number is required');
    err.statusCode = 400;
    throw err;
  }

  const cleaned = rawPhone.trim().replace(/[\s\-()]/g, '');

  if (!E164_PATTERN.test(cleaned)) {
    const err = new Error('Phone number must be in E.164 format (e.g. +919876543210)');
    err.statusCode = 400;
    throw err;
  }

  return cleaned;
}

/**
 * Deterministically derives a Cognito Username for a phone-based account.
 *
 * This pool has UsernameAttributes=['email'] (immutable, set at pool creation)
 * and no phone_number alias (AliasAttributes is also immutable post-creation),
 * so Cognito can only look up a user by an email-shaped Username — never by
 * raw phone number. This placeholder is never sent anywhere or verified; it
 * only exists to satisfy that format constraint and the required `email`
 * schema attribute, and to give phone sign-ins a stable identifier to look up.
 */
export function derivePhoneUsername(e164Phone) {
  return `phone-${e164Phone.replace(/\D/g, '')}@phone-user.realtimeaitranslator.internal`;
}
