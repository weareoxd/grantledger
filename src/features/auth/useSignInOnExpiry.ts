"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { isApiError } from "@/lib/api/errors";

/**
 * When the API says the session has ended (a 401: it expired, or was signed
 * out elsewhere), go to the sign-in page, and back here after
 */
export function useSignInOnExpiry() {
  const queryClient = useQueryClient();
  const router = useRouter();
  // Once: the page's other requests are refused too
  const leaving = useRef(false);

  useEffect(
    () =>
      queryClient.getQueryCache().subscribe((event) => {
        if (
          event.type === "updated" &&
          event.action.type === "error" &&
          isApiError(event.action.error, 401) &&
          !leaving.current
        ) {
          leaving.current = true;
          const { pathname, search } = window.location;
          router.replace(`/sign-in?redirect=${encodeURIComponent(pathname + search)}`);
        }
      }),
    [queryClient, router],
  );
}
