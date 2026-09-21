import { CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';

// Shared by every admin-dashboard route that needs a full user roster
// (adminAnalytics.mjs, dashboardMetrics.mjs, adminPayments.mjs) — pulled out
// here rather than duplicated a third time.
const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION || 'us-east-1' });

export async function listAllCognitoUsers(userPoolId) {
  const users = [];
  let paginationToken;
  do {
    const result = await cognito.send(new ListUsersCommand({
      UserPoolId: userPoolId,
      PaginationToken: paginationToken,
    }));
    users.push(...(result.Users || []));
    paginationToken = result.PaginationToken;
  } while (paginationToken);
  return users;
}

export function attr(user, name) {
  const found = (user.Attributes || []).find((a) => a.Name === name);
  return found ? found.Value : null;
}

/** Convenience: sub → best human-readable identifier (email, then phone, then Username). */
export function buildIdentifierMap(cognitoUsers) {
  return new Map(
    cognitoUsers.map((u) => [attr(u, 'sub'), attr(u, 'email') || attr(u, 'phone_number') || u.Username])
  );
}
