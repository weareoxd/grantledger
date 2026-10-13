// Name normalisation and the personal-name privacy filter (fictional names only).
import { describe, expect, it } from "vitest";
import { looksLikePerson, normalizeName } from "@/lib/grants/normalize";

describe("normalizeName", () => {
  it("gives federal and Alberta spellings one key", () => {
    expect(normalizeName("University of Calgary")).toBe("UNIVERSITY OF CALGARY");
    expect(normalizeName("UNIVERSITY OF CALGARY")).toBe("UNIVERSITY OF CALGARY");
  });

  it("drops accents and punctuation and unifies legal forms", () => {
    expect(normalizeName("Société Example Ltée.")).toBe("SOCIETE EXAMPLE LTEE");
    expect(normalizeName("Acme Widgets Limited")).toBe(normalizeName("ACME WIDGETS LTD."));
    expect(normalizeName("Acme & Sons, Incorporated")).toBe("ACME AND SONS INC");
    expect(normalizeName("The Example Foundation")).toBe("EXAMPLE FOUNDATION");
  });

  it("joins split legal forms and co-ops", () => {
    expect(normalizeName("Northern Biofuel L P")).toBe("NORTHERN BIOFUEL LP");
    expect(normalizeName("Prairie Co-op")).toBe(normalizeName("PRAIRIE CO OP"));
  });

  it("separates French elisions", () => {
    expect(normalizeName("L'Association d'Exemple")).toBe("L ASSOCIATION D EXEMPLE");
    expect(normalizeName("L’Association d’Exemple")).toBe("L ASSOCIATION D EXEMPLE");
  });

  it("is empty for blanks", () => {
    expect(normalizeName("")).toBe("");
    expect(normalizeName(null)).toBe("");
  });
});

describe("looksLikePerson", () => {
  it.each([
    "DOE JANE",
    "DOE JANE MARIE",
    "ROE RICHARD A",
    "DOE JOHN AND MARY", // couples: AND is not an organization marker
    "ST-PIERRE ANNE", // ST is a surname particle
    "WOOD ALEX", // surname that is also an organization word
    "PARK MINJI",
    "STANDING ON THE ROAD ALEX", // Indigenous family name containing ON THE
    "FIRST RIDER SAM",
    "GARCIA LOPEZ MARIA DEL CARMEN", // long personal names
    "BOARD ALEX", // a surname, listed surname first
    "LODGE SAM RIVER",
  ])("flags %s", (name) => {
    expect(looksLikePerson(name)).toBe(true);
  });

  it.each([
    "ACME WIDGETS LTD",
    "1234567 ALBERTA LTD",
    "EXAMPLE COMMUNITY ASSOCIATION",
    "UNIVERSITY OF EXAMPLE",
    "MD OF EXAMPLE NO 1",
    "EXAMPLE FIRST NATION",
    "EXAMPLE SCHOOL BOARD",
    "CALGARY EXAMPLE CO-OP",
    "EXAMPLECORP", // single token
    "JANE DOE PROFESSIONAL CORP", // a business entity, not an individual
    "EXAMPLE CHILDCARE SOCIETY",
    "ALPHA BETA GAMMA DELTA EPSILON ZETA ETA", // 7+ tokens
    "EXAMPLE LAKE BAND", // First Nations bands
    "MOHAWKS OF THE BAY OF EXAMPLE",
    "EXAMPLE WINNIPEG BALLET THE", // federal inverted article
    "EXAMPLE VALLEY LAND AND WATER BOARD", // trailing BOARD on a 3+ word name
    "EXAMPLE ANISHINABEK",
  ])("keeps %s", (name) => {
    expect(looksLikePerson(name)).toBe(false);
  });

  it("does not flag blanks", () => {
    expect(looksLikePerson("")).toBe(false);
    expect(looksLikePerson(null)).toBe(false);
  });
});
