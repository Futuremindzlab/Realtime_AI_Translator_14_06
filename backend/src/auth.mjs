/**
 * Auth helpers — extract the Cognito sub (userId) from the JWT claims
 * that API Gateway injects after the Cognito Authorizer validates the token.
 *
 * The mobile app sends:  Authorization: Bearer <idToken>
 * API Gateway validates the token and passes the claims as:
 *   event.requestContext.authorizer.claims
 */

/**
 * Returns the authenticated Cognito userId (sub) from the event.
 * Throws a structured 401 error if claims are missing.
 */
export function getUserId(event) {
  const claims = event?.requestContext?.authorizer?.claims;
  const sub = claims?.sub;

  if (!sub) {
    const err = new Error('Unauthorized: missing Cognito claims');
    err.statusCode = 401;
    throw err;
  }

  return sub;
}

/**
 * Returns the role of the authenticated user based on Cognito Group membership.
 * API Gateway flattens the cognito:groups JWT array into a comma-separated string.
 * Returns 'OWNER' if the 'owner' group is present, otherwise 'USER'.
 */
export function getRole(event) {
  const claims = event?.requestContext?.authorizer?.claims;
  const groups = claims?.['cognito:groups'] ?? '';
  // API Gateway stringifies the JWT array as a comma-separated string
  const groupArray = typeof groups === 'string'
    ? groups.split(',').map(g => g.trim()).filter(Boolean)
    : [];
  return groupArray.includes('owner') ? 'OWNER' : 'USER';
}

/**
 * Validates that the userId in the request path/body matches the
 * authenticated user. Throws 403 if there is a mismatch.
 */
export function validateUserAccess(event, requestedUserId) {
  const authenticatedUserId = getUserId(event);

  if (requestedUserId && requestedUserId !== authenticatedUserId) {
    const err = new Error('Forbidden: cannot access another user\'s data');
    err.statusCode = 403;
    throw err;
  }

  return authenticatedUserId;
}
