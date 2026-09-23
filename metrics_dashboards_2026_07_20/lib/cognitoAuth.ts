"use client";

import { CognitoUser, AuthenticationDetails, CognitoUserPool } from "amazon-cognito-identity-js";

const USER_POOL_ID = process.env.NEXT_PUBLIC_AWS_USER_POOL_ID || "";
const CLIENT_ID = process.env.NEXT_PUBLIC_AWS_USER_POOL_CLIENT_ID || "";

let pool: CognitoUserPool | null = null;
function getPool(): CognitoUserPool {
  if (!pool) pool = new CognitoUserPool({ UserPoolId: USER_POOL_ID, ClientId: CLIENT_ID });
  return pool;
}

export interface Session {
  idToken: string;
  role: "OWNER" | "USER";
  email: string;
}

function extractRole(payload: Record<string, unknown>): "OWNER" | "USER" {
  const groups = payload["cognito:groups"];
  const list = Array.isArray(groups)
    ? (groups as string[])
    : typeof groups === "string"
    ? groups.split(",").map((g) => g.trim())
    : [];
  return list.includes("owner") ? "OWNER" : "USER";
}

export function signIn(email: string, password: string): Promise<Session> {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: getPool() });
    const details = new AuthenticationDetails({ Username: email, Password: password });

    user.authenticateUser(details, {
      onSuccess: (session) => {
        const idToken = session.getIdToken().getJwtToken();
        const payload = session.getIdToken().payload;
        resolve({ idToken, role: extractRole(payload), email: (payload["email"] as string) || email });
      },
      onFailure: (err) => reject(err),
      newPasswordRequired: () => reject(new Error("Account requires a new password — sign in from the app first.")),
    });
  });
}

// Step 1 of Cognito's standard forgot-password flow: triggers the pool to
// email (or SMS, depending on pool config) a verification code to the
// account. Cognito intentionally reports success here even for an unknown
// email when "prevent user existence errors" is on for the app client —
// that's expected, not a bug, and this UI treats it the same either way.
export function requestPasswordReset(email: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: getPool() });
    user.forgotPassword({
      onSuccess: () => resolve(),
      onFailure: (err) => reject(err),
    });
  });
}

// Step 2: the code from that email plus a new password.
export function confirmPasswordReset(email: string, code: string, newPassword: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: getPool() });
    user.confirmPassword(code, newPassword, {
      onSuccess: () => resolve(),
      onFailure: (err) => reject(err),
    });
  });
}
