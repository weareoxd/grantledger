import { notFound } from "next/navigation";

/**
 * A page's path params, once each id is checked to be one (a positive integer): for any other
 * (`/organization/abc`), no API route would match, so the page isn't found
 */
export async function scopeParams<T extends Record<string, string>>(
  params: Promise<T>,
): Promise<T> {
  const values = await params;
  for (const value of Object.values(values)) {
    if (!/^\d+$/.test(value) || !(Number(value) > 0) || !Number.isSafeInteger(Number(value))) {
      notFound();
    }
  }
  return values;
}
