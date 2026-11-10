import { QueryClient } from "@tanstack/react-query";

import { isApiError } from "./api/errors";

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Lists can be expensive; don't refetch every time the tab regains focus
        refetchOnWindowFocus: false,
        // A 4xx won't succeed on retry
        retry: (failureCount, error) =>
          !(isApiError(error) && error.status < 500) && failureCount < 2,
      },
    },
  });
}
