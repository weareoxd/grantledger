/**
 * Where to go after signing in: a path in this app, or its home page. Never
 * another site's (`//elsewhere.example`, or `/\elsewhere.example`, which
 * browsers read the same), whatever the link said
 */
export function safeRedirect(redirect: string | string[] | undefined) {
  return typeof redirect === "string" && /^\/(?![/\\])/.test(redirect) ? redirect : "/";
}
