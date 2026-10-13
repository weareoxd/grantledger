/** Code tables and source metadata shared by the importers, the API and the MCP schema. */
import type { RecordKind } from "@/lib/domain";

export const AGREEMENT_TYPES: Record<string, string> = {
  G: "Grant",
  C: "Contribution",
  O: "Other transfer payment",
};

export const RECIPIENT_TYPES: Record<string, string> = {
  F: "For-profit organization",
  N: "Not-for-profit organization or charity",
  S: "Academia",
  A: "Indigenous recipient",
  G: "Government",
  I: "International (non-government)",
  P: "Individual or sole proprietorship",
  O: "Other",
};

export const RECORD_KINDS: Record<RecordKind, string> = {
  agreement:
    "A funding agreement as disclosed by the Government of Canada. ``value`` is the total agreement value, restated on each amendment; only ``is_current`` rows carry the latest value.",
  payment:
    "A cash grant payment as disclosed by the Government of Alberta. ``value`` is the amount paid on ``start_date``.",
};

export type OrganizationKey = "federal" | "alberta";

export interface OrganizationMeta {
  name: string;
  record_kind: RecordKind;
  ministry_noun: string;
  source: string;
  source_url: string;
  licence: string;
  licence_url: string;
  attribution: string;
}

/** Organization key -> metadata. Keys are what the importers use; names are what users see. */
export const ORGANIZATIONS: Record<OrganizationKey, OrganizationMeta> = {
  federal: {
    name: "Government of Canada",
    record_kind: "agreement",
    ministry_noun: "Department",
    source:
      "Proactive Disclosure - Grants and Contributions (Treasury Board of Canada Secretariat)",
    source_url: "https://open.canada.ca/data/en/dataset/432527ab-7aac-45b5-81d6-7597107a7013",
    licence: "Open Government Licence - Canada",
    licence_url: "https://open.canada.ca/en/open-government-licence-canada",
    attribution: "Contains information licensed under the Open Government Licence – Canada.",
  },
  alberta: {
    name: "Government of Alberta",
    record_kind: "payment",
    ministry_noun: "Ministry",
    source: "Grant Payments Disclosure (Government of Alberta)",
    source_url: "https://open.alberta.ca/dataset/grant-disclosure",
    licence: "Open Government Licence - Alberta",
    licence_url: "https://open.alberta.ca/licence",
    attribution: "Contains information licensed under the Open Government Licence – Alberta.",
  },
};

export const ATTRIBUTION_LINES = Object.values(ORGANIZATIONS).map((meta) => meta.attribution);

/** The metadata for an organization's key, if it is one the importers know. */
export function organizationMeta(key: string | null | undefined): OrganizationMeta | undefined {
  return key && key in ORGANIZATIONS ? ORGANIZATIONS[key as OrganizationKey] : undefined;
}
