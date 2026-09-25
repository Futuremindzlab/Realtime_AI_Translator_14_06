"use client";

import { useState } from "react";
import { SectionCard } from "@/components/SectionCard";
import {
  signIn,
  requestPasswordReset,
  confirmPasswordReset,
  type Session,
} from "@/lib/cognitoAuth";
import { storeSession } from "@/lib/session";

type Mode = "signin" | "forgot-request" | "forgot-confirm";

// Shared by every gated page (payments, subscriptions, user_analytics,
// infra_security, my-history) — was duplicated verbatim in each page before
// this file existed, each missing any way to recover a forgotten password.
export function SignInForm({
  description,
  onSignedIn,
}: {
  description: string;
  onSignedIn: (s: Session) => void;
}) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const session = await signIn(email, password);
      storeSession(session);
      onSignedIn(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setLoading(false);
    }
  };

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await requestPasswordReset(email);
      setMode("forgot-confirm");
      setInfo(`If an account exists for ${email}, a verification code has been sent to it.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send reset code");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmNewPassword) {
      setError("Passwords don't match");
      return;
    }
    setLoading(true);
    try {
      await confirmPasswordReset(email, code, newPassword);
      setMode("signin");
      setPassword("");
      setCode("");
      setNewPassword("");
      setConfirmNewPassword("");
      setInfo("Password updated — sign in with your new password.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset password");
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setInfo(null);
  };

  return (
    <div className="max-w-sm mx-auto mt-16">
      <SectionCard
        title={mode === "signin" ? "Sign in" : mode === "forgot-request" ? "Reset password" : "Enter new password"}
        description={
          mode === "signin"
            ? description
            : mode === "forgot-request"
            ? "Enter your account email and we'll send a verification code."
            : `Enter the code sent to ${email} and choose a new password.`
        }
      >
        {info && <p className="mb-3 text-sm text-emerald-600 dark:text-emerald-400">{info}</p>}

        {mode === "signin" && (
          <form onSubmit={handleSignIn} className="space-y-3">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-field"
              required
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field"
              required
            />
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? "Signing in…" : "Sign in"}
            </button>
            <button
              type="button"
              onClick={() => switchMode("forgot-request")}
              className="w-full text-center text-xs font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
            >
              Forgot password?
            </button>
          </form>
        )}

        {mode === "forgot-request" && (
          <form onSubmit={handleRequestReset} className="space-y-3">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-field"
              required
            />
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? "Sending…" : "Send verification code"}
            </button>
            <button
              type="button"
              onClick={() => switchMode("signin")}
              className="w-full text-center text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              Back to sign in
            </button>
          </form>
        )}

        {mode === "forgot-confirm" && (
          <form onSubmit={handleConfirmReset} className="space-y-3">
            <input
              type="text"
              inputMode="numeric"
              placeholder="Verification code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="input-field"
              required
            />
            <input
              type="password"
              placeholder="New password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="input-field"
              minLength={8}
              required
            />
            <input
              type="password"
              placeholder="Confirm new password"
              value={confirmNewPassword}
              onChange={(e) => setConfirmNewPassword(e.target.value)}
              className="input-field"
              minLength={8}
              required
            />
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? "Resetting…" : "Reset password"}
            </button>
            <div className="flex justify-between text-xs font-medium">
              <button
                type="button"
                onClick={() => switchMode("forgot-request")}
                className="text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                Resend code
              </button>
              <button
                type="button"
                onClick={() => switchMode("signin")}
                className="text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                Back to sign in
              </button>
            </div>
          </form>
        )}
      </SectionCard>
    </div>
  );
}
