import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignInForm } from "@/features/auth/SignInForm";
import { safeRedirect } from "@/features/auth/session";
import { googleConfigured } from "@/lib/auth/auth";
import { getSessionUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Sign in" };

export const dynamic = "force-dynamic";

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Sign in with Google, then go back to the page that sent you here (`?redirect=`) */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string | string[]; error?: string | string[] }>;
}) {
  const params = await searchParams;
  const target = safeRedirect(first(params.redirect));
  // Signed in already
  if (await getSessionUser()) redirect(target);
  return (
    <SignInForm redirect={target} error={first(params.error)} configured={googleConfigured()} />
  );
}
