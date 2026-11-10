import { z } from "zod";

/**
 * Filter match modes. One vocabulary for every column kind; the filter UI
 * labels them per kind (e.g. `lt` is "before" for dates). The API accepts
 * all of these names.
 */
export const MATCH_MODES = [
  "equals",
  "notEquals",
  "contains",
  "notContains",
  "startsWith",
  "endsWith",
  "lt",
  "lte",
  "gt",
  "gte",
  "between",
  "in",
] as const;
export type MatchMode = (typeof MATCH_MODES)[number];

export const OPERATORS = ["and", "or"] as const;
export type Operator = (typeof OPERATORS)[number];

export const PAGE_SIZES = [10, 25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 25;

/** Conditions per field (the API takes as many) */
export const MAX_CONSTRAINTS = 30;

/**
 * Column and field ids: snake_case, as in the API. Not the names objects
 * already have (`?f=constructor:…` read `{}.constructor`, a function, as a
 * filter and the app failed to load; `__proto__` reached every object)
 */
export const FIELD_PATTERN = /^(?!(?:__proto__|constructor)$)[a-z0-9_]+$/;

export const constraintSchema = z.object({
  matchMode: z.enum(MATCH_MODES),
  value: z.string().min(1),
});
export type Constraint = z.infer<typeof constraintSchema>;

export const fieldFilterSchema = z.object({
  operator: z.enum(OPERATORS),
  constraints: z.array(constraintSchema).min(1).max(MAX_CONSTRAINTS),
});
export type FieldFilter = z.infer<typeof fieldFilterSchema>;

export type Filters = Record<string, FieldFilter>;

/**
 * Table state kept in the URL. Every key is optional and omitted when it
 * has its default, so a fresh page has a clean URL; invalid values (from a
 * hand-edited or stale link) fall back to the default instead of failing.
 */
export const tableSearchSchema = z.object({
  page: z.number().int().min(2).optional().catch(undefined),
  size: z
    .union(PAGE_SIZES.map((size) => z.literal(size)))
    .optional()
    .catch(undefined),
  sort: z
    .string()
    .regex(/^-?[a-z0-9_]+$/)
    .optional()
    .catch(undefined),
  // Each column and filter on its own: a bad one (a hand-edited link's, say)
  // doesn't take the others with it
  cols: z
    .array(z.string())
    .transform((cols) => cols.filter((col) => FIELD_PATTERN.test(col)))
    .pipe(z.array(z.string()).min(1))
    .optional()
    .catch(undefined),
  filters: z
    .record(z.string(), fieldFilterSchema.nullable().catch(null))
    .transform((filters) => {
      const valid = Object.fromEntries(
        Object.entries(filters).filter(
          (entry): entry is [string, FieldFilter] =>
            FIELD_PATTERN.test(entry[0]) && entry[1] !== null,
        ),
      );
      return Object.keys(valid).length > 0 ? valid : undefined;
    })
    .optional()
    .catch(undefined),
  // The fiscal year an aggregated list totals (all years without)
  fy: z.number().int().min(1900).max(2100).optional().catch(undefined),
  // On, or absent
  hide_placeholders: z.literal(1).optional().catch(undefined),
  include_superseded: z.literal(1).optional().catch(undefined),
});
export type TableSearch = z.infer<typeof tableSearchSchema>;
