import { adminClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** Browser-side auth client; talks to /api/auth on the same origin. */
export const authClient = createAuthClient({
  plugins: [adminClient()],
});
