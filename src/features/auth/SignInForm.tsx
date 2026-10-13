"use client";

import { useState } from "react";

import { StatusPage } from "@/components/StatusPage";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth/client";

/** Google's "G", in its colours. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="size-4">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

/** What a sign-in that came back with `?error=` means, in words. */
export function describeSignInError(code: string): string {
  switch (code) {
    case "unverified_email":
      return "Google hasn't verified that account's email address, so it can't be used to sign in.";
    case "access_denied":
      return "Google sign-in was cancelled.";
    case "banned":
      return "That account has been turned off. Ask an admin.";
    default:
      return "Sign-in didn't work. Try again in a moment.";
  }
}

/** Sign in with Google, then go on to `redirect` */
export function SignInForm({
  redirect,
  error,
  configured = true,
}: {
  redirect: string;
  /** The `?error=` a refused or failed sign-in came back with. */
  error?: string;
  /** Whether Google sign-in is set up (GOOGLE_OAUTH2_CLIENT_ID and _SECRET). */
  configured?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string>();
  const message = failed ?? (error ? describeSignInError(error) : undefined);

  const signIn = async () => {
    setBusy(true);
    setFailed(undefined);
    // Google, then back here: to `redirect` when it worked, to this page with ?error= when not
    const result = await authClient.signIn
      .social({
        provider: "google",
        callbackURL: redirect,
        errorCallbackURL: `/sign-in?redirect=${encodeURIComponent(redirect)}`,
      })
      .catch(() => ({ error: { status: 0 } }));
    if (result?.error) {
      setBusy(false);
      setFailed("Sign-in isn't available right now. Try again in a moment.");
    }
  };

  return (
    <StatusPage
      title="Sign in"
      description="Canadian public grant disclosures, federal and Alberta."
    >
      <div className="mt-4 flex w-full flex-col gap-4 text-left">
        {configured ? (
          <Button type="button" variant="outline" disabled={busy} onClick={() => void signIn()}>
            {busy ? <Spinner /> : <GoogleMark />}
            Continue with Google
          </Button>
        ) : (
          <p role="alert" className="text-destructive text-sm">
            Google sign-in isn't set up: set GOOGLE_OAUTH2_CLIENT_ID and
            GOOGLE_OAUTH2_CLIENT_SECRET.
          </p>
        )}
        {message && (
          <p role="alert" className="text-destructive text-sm">
            {message}
          </p>
        )}
      </div>
    </StatusPage>
  );
}
