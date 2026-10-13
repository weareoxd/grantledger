/**
 * What the admin forms send, checked the same way in the browser (TanStack Form) and on the
 * server (the actions). Form values are strings and booleans; the schemas turn them into what the
 * database stores. Lengths match the columns (src/lib/db/schema.ts).
 */
import { z } from "zod";
import { AGREEMENT_TYPE_CODES, RECIPIENT_TYPE_CODES, RECORD_KINDS, USER_ROLES } from "@/lib/domain";

const text = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be at most ${max} characters`);

/** An optional text column: "" becomes null. */
const optionalText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .transform((value) => value || null);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validIsoDate(value: string) {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const isoDate = (label: string) =>
  z.string().trim().refine(validIsoDate, `${label} must be a date (YYYY-MM-DD)`);

const optionalDate = (label: string) =>
  z
    .string()
    .trim()
    .refine((value) => value === "" || validIsoDate(value), `${label} must be a date (YYYY-MM-DD)`)
    .transform((value) => value || null);

/** A positive id from a select (form values are strings). */
const id = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `Choose a ${label}`)
    .transform(Number)
    .pipe(z.number().int().positive(`Choose a ${label}`));

const optionalId = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : Number(value)))
  .pipe(z.number().int().positive().nullable());

/** A whole number typed into a text field. */
const wholeNumber = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .regex(/^-?\d+$/, `${label} must be a whole number`)
    .transform(Number)
    .pipe(
      z
        .number()
        .int()
        .min(min, `${label} must be at least ${min}`)
        .max(max, `${label} must be at most ${max}`),
    );

/** numeric(18, 2): up to 16 digits before the point and 2 after. */
const money = z
  .string()
  .trim()
  .transform((value) => value.replaceAll(",", "").replace(/^\$/, ""))
  .refine(
    (value) => value === "" || /^-?\d{1,16}(\.\d{1,2})?$/.test(value),
    "Enter an amount such as 1500.00",
  )
  .transform((value) => value || null);

export const idInput = z.object({ id: z.coerce.number().int().positive() });

export const organizationInput = z.object({
  name: text("Name", 255),
  key: z
    .string()
    .trim()
    .min(1, "Key is required")
    .max(32, "Key must be at most 32 characters")
    .regex(
      /^[a-z0-9_-]+$/,
      "Key is lowercase letters, digits, - and _ (the importers use federal and alberta)",
    ),
});

export const ministryInput = z.object({
  organizationId: id("government"),
  name: text("Name", 255),
});

export const programInput = z.object({
  ministryId: id("ministry"),
  name: text("Name", 500),
});

export const recipientInput = z.object({
  name: text("Matching key", 500),
  displayName: text("Display name", 500),
  isPlaceholder: z.boolean(),
});

export const awardInput = z
  .object({
    ministryId: id("ministry"),
    programId: optionalId,
    recipientId: id("recipient"),
    recordKind: z.enum(RECORD_KINDS),
    reference: text("Reference", 255),
    agreementNumber: optionalText("Agreement number", 128),
    amendmentNumber: wholeNumber("Amendment", 0, 1_000_000),
    amendmentDate: optionalDate("Amendment date"),
    isCurrent: z.boolean(),
    agreementType: z
      .union([z.literal(""), z.enum(AGREEMENT_TYPE_CODES)])
      .transform((value) => value || null),
    recipientType: z
      .union([z.literal(""), z.enum(RECIPIENT_TYPE_CODES)])
      .transform((value) => value || null),
    recipientProvince: optionalText("Province", 64),
    recipientCity: optionalText("City", 255),
    value: money,
    startDate: isoDate("Start date"),
    startDateEstimated: z.boolean(),
    endDate: optionalDate("End date"),
    title: optionalText("Title", 1000),
    description: optionalText("Description", 100_000),
    naics: optionalText("NAICS code", 16),
    businessUnit: optionalText("Business unit", 255),
    lotteryFund: z
      .union([z.literal(""), z.literal("yes"), z.literal("no")])
      .transform((value) => (value === "" ? null : value === "yes")),
  })
  .refine((award) => !award.endDate || award.endDate >= award.startDate, {
    message: "The end date is before the start date",
    path: ["endDate"],
  });

export const fiscalYearInput = z
  .object({
    year: wholeNumber("Year", 1900, 2100),
    startDate: isoDate("Start date"),
    endDate: isoDate("End date"),
  })
  .refine((year) => year.endDate > year.startDate, {
    message: "The end date must be after the start date",
    path: ["endDate"],
  });

export const createUserInput = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter the person's Google email address")),
  role: z.enum(USER_ROLES),
});

export const setRoleInput = z.object({ userId: z.string().min(1), role: z.enum(USER_ROLES) });

export type OrganizationForm = z.input<typeof organizationInput>;
export type MinistryForm = z.input<typeof ministryInput>;
export type ProgramForm = z.input<typeof programInput>;
export type RecipientForm = z.input<typeof recipientInput>;
export type AwardForm = z.input<typeof awardInput>;
export type FiscalYearForm = z.input<typeof fiscalYearInput>;
