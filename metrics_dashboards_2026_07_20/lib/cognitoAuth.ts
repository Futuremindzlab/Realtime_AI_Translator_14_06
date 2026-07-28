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
