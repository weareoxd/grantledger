/**
 * Recipient name normalisation and the personal-name privacy filter.
 *
 * Both sources name recipients differently: the federal file uses mixed case ("Carleton
 * University") and sometimes inverts articles ("ROYAL WINNIPEG BALLET THE"); Alberta upper-cases
 * everything ("UNIVERSITY OF CALGARY"). `normalizeName` produces the canonical key both resolve
 * to, so the same organization funded by both governments lands on one recipient.
 *
 * The Open Government Licences do not cover personal information, and Alberta's file has no
 * recipient-type column, so `looksLikePerson` flags names that look like an individual's. Flagged
 * rows are kept (so ministry and program totals stay complete) but re-pointed at a placeholder
 * recipient with identifying fields cleared.
 */
import { unidecode } from "./unidecode";

// Placeholder recipients (recipient.is_placeholder = true)
export const WITHHELD_INDIVIDUAL = "INDIVIDUAL RECIPIENT (NAME WITHHELD)";
export const NOT_DISCLOSED = "RECIPIENT NOT DISCLOSED";
export const PLACEHOLDER_NAMES: readonly string[] = [WITHHELD_INDIVIDUAL, NOT_DISCLOSED];

// Legal-form spellings collapsed to one token so "ACME LIMITED" == "ACME LTD.".
const LEGAL_FORMS: Record<string, string> = {
  INCORPORATED: "INC",
  INCORPOREE: "INC",
  LIMITED: "LTD",
  LIMITEE: "LTEE",
  CORPORATION: "CORP",
};

// Legal forms written with spaces ("NORTHERN BIODIESEL L P").
const SPLIT_FORMS: [string[], string][] = [
  [["L", "P"], "LP"],
  [["G", "P"], "GP"],
  [["L", "L", "P"], "LLP"],
  [["U", "L", "C"], "ULC"],
];

const COOP = /\bCO[- ]OP\b/g;
const ELISION = /\b([LD])['’]/g;
const PUNCT_DROP = /[.'’`"]/g;
const PUNCT_SPACE = /[,;:()[\]/\\]/g;
const SPACES = /\s+/;
const SPACES_GLOBAL = /\s+/g;

function collapseSplitForms(tokens: string[]): string[] {
  for (const [parts, joined] of SPLIT_FORMS) {
    const n = parts.length;
    if (tokens.length > n && parts.every((part, i) => tokens[tokens.length - n + i] === part)) {
      return [...tokens.slice(0, -n), joined];
    }
  }
  return tokens;
}

/** Python's str.upper for the ASCII text unidecode leaves (and anything it passes through). */
function upper(text: string) {
  return text.toUpperCase();
}

/** Canonical matching key for a recipient name ("" when nothing usable is left). */
export function normalizeName(raw: unknown): string {
  if (raw === null || raw === undefined || raw === "") return "";
  let text = upper(unidecode(String(raw)));
  text = text.replaceAll("&", " AND ");
  text = text.replace(ELISION, "$1 "); // L'ASSOCIATION -> L ASSOCIATION, D'EDMONTON -> D EDMONTON
  text = text.replace(COOP, "COOP");
  text = text.replace(PUNCT_DROP, "");
  text = text.replace(PUNCT_SPACE, " ");
  let tokens = text
    .trim()
    .split(SPACES)
    .filter(Boolean)
    .map((token) => LEGAL_FORMS[token] ?? token);
  tokens = collapseSplitForms(tokens);
  // Leading or trailing article: "THE EXAMPLE FOUNDATION", "EXAMPLE FOUNDATION THE".
  if (tokens.length > 1 && tokens[0] === "THE") tokens = tokens.slice(1);
  if (tokens.length > 1 && tokens[tokens.length - 1] === "THE") tokens = tokens.slice(0, -1);
  return truncate(tokens.join(" "), 500);
}

/** The first `max` characters (code points, as Python slices). */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return Array.from(text).slice(0, max).join("");
}

/** Trimmed, single-spaced original spelling for display. */
export function cleanDisplay(raw: unknown): string {
  return truncate(
    String(raw ?? "")
      .replace(SPACES_GLOBAL, " ")
      .trim(),
    500,
  );
}

// Words that mark a name as an organization. Deliberately excludes particles that also occur in
// personal names (DE, LA, LE, DU, DES, VAN, VON, MAC, MC).
const ORG_CANDIDATES = new Set(
  `
    INC LTD LTEE CORP CO LLP LP LLC ULC PLC GMBH SA AG BV NV SOCIETY SOCIETE SOCIET
    ASSOCIATION ASSN ASSOC ASSOCIATES FOUNDATION FONDATION FUND FUNDS TRUST TRUSTEES
    UNIVERSITY UNIVERSITE COLLEGE COLLEGIATE POLYTECHNIC INSTITUTE INSTITUT SCHOOL SCHOOLS
    ECOLE ACADEMY ACADEMIE CITY TOWN VILLAGE HAMLET COUNTY DISTRICT MUNICIPAL MUNICIPALITY
    MD REGION REGIONAL NATION NATIONS BAND TRIBE TRIBAL METIS INUIT SETTLEMENT TREATY FIRST
    CLUB CLUBS CENTRE CENTER CENTRES CENTERS COUNCIL CONSEIL CHURCH PARISH DIOCESE CONGREGATION
    MINISTRIES MINISTRY MISSION AUTHORITY BOARD AGENCY COMMISSION COMMITTEE COOPERATIVE COOP
    FEDERATION LEAGUE UNION GUILD ALLIANCE NETWORK PARTNERSHIP PARTNERS GROUP HOLDINGS
    ENTERPRISES ENTERPRISE INDUSTRIES INTERNATIONAL SERVICES SERVICE SOLUTIONS SYSTEMS
    TECHNOLOGIES TECHNOLOGY TECH CONSULTING CONSULTANTS MANAGEMENT DEVELOPMENT RESEARCH LABS
    LABORATORY LABORATORIES HOSPITAL HOSPITALS HEALTH CLINIC MEDICAL CARE CHILDCARE DAYCARE
    DAYHOME DAYHOMES PRESCHOOL KINDERGARTEN MONTESSORI NURSERY PLAYSCHOOL KIDS CHILDREN
    CHILDRENS YOUTH FAMILY FAMILIES SENIORS HOUSING HOMES HOME LODGE MANOR VILLA SHELTER
    MUSEUM GALLERY THEATRE THEATER FESTIVAL ORCHESTRA SYMPHONY CHOIR ARTS PRODUCTIONS FILMS
    FILM MEDIA PUBLISHING PRESS RADIO TELEVISION FARM FARMS RANCH RANCHES COLONY HUTTERIAN
    BRETHREN AGRICULTURAL AGRICULTURE ENERGY POWER RESOURCES OIL GAS MINING CONSTRUCTION
    BUILDERS ENGINEERING TRANSPORT TRANSPORTATION TRANSIT AIRPORT RAILWAY PORT LIBRARY
    LIBRARIES PARK PARKS RECREATION SPORTS SPORT HOCKEY SOCCER ARENA GOLF CURLING SKATING SKI
    ROTARY LIONS KINSMEN LEGION YMCA YWCA SCOUTS GUIDES CADETS BANK CREDIT INVESTMENTS
    CAPITAL VENTURES PROJECT PROJECTS PROGRAM PROGRAMS PROGRAMME INITIATIVE CAMPAIGN OSC ECS
    FDH LEARNING EDUCATION EDUCARE EDUCATIONAL TRAINING COMMUNITY COMMUNITIES NEIGHBOURHOOD
    GOVERNMENT MINISTER DEPARTMENT PROVINCE PROVINCIAL FEDERAL CANADA CANADIAN ALBERTA
    NATIONAL OF THE AND FOR ST STE SAINT SAINTE CONSORTIUM SECRETARIAT OFFICE BUREAU
    CHAMBER COMMERCE TOURISM ECONOMIC FRIENDS VOLUNTEER VOLUNTEERS RESCUE FIRE POLICE
    AMBULANCE EMERGENCY HABITAT CONSERVATION ENVIRONMENTAL WILDLIFE WATERSHED GENOME
    CORPS ASSEMBLY PROGRAMS MOVEMENT INSTITUTION SOCIETIES SYNDICATE PROVIDERS PRODUCERS
    GROWERS MARKET MARKETS STORE STORES SHOP RESTAURANT CAFE HOTEL INN MOTEL RESORT
    DESIGN STUDIO STUDIOS ARCHITECTS INNOVATION INNOVATIONS VENTURE LAB HUB EXCHANGE
    CATHOLIC SEPARATE ROMAN PUBLIC POLICY UTILITIES UTILITY PROPANE TEAM RECOVERY CONGRESS
    WORLD PRODUCTIVITY WELFARE DISTRICTS ACCT CONFEDERACY SERIES TRIATHLON ARMY COLLECTIVE
    ACCELERATOR LENDING MICROLENDING DANCERS WARRIORS MAINTENANCE BUILDING CITIZENS
    ORGANIZATION ORGANISATION MOTHERS CAMP CAMPS SECURITY SEC SENC DRUGS DRUG PHARMACY
    EDUCENTRE FELLOWSHIP PLATFORM BROS BROTHERS BUILT RESTAURANTS PIZZA KITCHEN FOODS FOOD
    DAIRY PRODUCTS LOGISTICS FREIGHT EXPRESS TRUCKING MOTORS AUTO AVIATION AIRLINES HOTELS
    SPRINGS RESORTS CHARITY MEALS WHEELS PLAYHOUSE EVENTS TIMES FORUM FINANCE MART TREE
    DOLLAR WOOD LUMBER MEN SPIRIT VALLEY ABORIGINAL INDIGENOUS TECHNOLOGIE REGROUPEMENT
    SASKATCHEWAN ONTARIO QUEBEC MANITOBA EDMONTON CALGARY LETHBRIDGE BANFF JAPAN OECD
    HORTONS MCDONALDS KFC POPEYES SHOPPERS LOOMIS FAIRMONT PUROLATOR SAPUTO
    BY OUR MY YOUR IN ON AT TO WE OUT
    AB INNOVATES FRANCOPHONE FRANCOPHONIE JEUNESSE SISTERS SINGERS SKIERS PLAYERS AIR
    RADIOLOGY TEMPLE MARKETING BURGER MEATS FINANCIAL PLAY PLACE SUPERCENTRE LIQUIDATION
    BAND BANDE UNITED COVENANT AID LEGAL CONSERVATORY MUSIC BALLET POTATO APPRENTICESHIP
    PIPING INDUSTRY INDUSTRIAL WASTEWATER TREATMENT FLOOD PROTECTION EARTH REUSE CREATIVE
    CBDC WATER CHANTIER ECONOMIE SOCIALE SOCIAL MINISTRE FINANCES PROJET ISLAND RESERVE
    ANISHINABEK ANISHINAABEK ANISHINABEG ANISHINAABEG ANISHINAABE ANISHNAWBE NISHNAWBE
    NEHIYAWAK MOHAWK MOHAWKS CHIPPEWA CHIPPEWAS DENE DENESULINE CHIPEWYAN CREE OJIBWAY
    OJIBWAYS OJIBWE INNU INNUE MIKMAW MIKMAQ ATIKAMEKW MONTAGNAIS SECWEPEMC HWECHIN
    SAULTEAUX ALGONQUIN ALGONQUINS HURON WENDAT MALISEET WOLASTOQIYIK PASSAMAQUODDY HAIDA
    NISGAA GITXSAN SHUSWAP OKANAGAN SQUAMISH MUSQUEAM DAKELH TSILHQOTIN HEILTSUK NUXALK
    KWAKIUTL NAMGIS SIKSIKA KAINAI PIIKANI STONEY NAKODA TSUUTINA DAKOTA LAKOTA NAKOTA
    SIOUX ASSINIBOINE BLACKFOOT INUVIALUIT GWICHIN TLICHO TLINGIT TUTCHONE KASKA
    NUNATSIAVUT MUSHKEGOWUK POTAWATOMI ODAWA ONEIDA ONONDAGA SENECA CAYUGA TUSCARORA
    HAUDENOSAUNEE KAHNAWAKE AKWESASNE KANESATAKE KINAMATNEWEY
    TORONTO WINNIPEG MONTREAL VANCOUVER OTTAWA REGINA SASKATOON HALIFAX MONCTON FREDERICTON
    WHITEHORSE YELLOWKNIFE IQALUIT GATINEAU LAVAL SHERBROOKE BRITISH COLUMBIA NOVA SCOTIA
    BRUNSWICK NEWFOUNDLAND LABRADOR YUKON NUNAVUT TERRITORIES NORTHWEST
    COMPANY COMPANIES CEGEP MUNICIPALITE VILLE TOWNSHIP FERME FERMES EDITIONS ENR ENRG
    INDIAN NATIVE BROADCASTING PUBLICATIONS VOLAILLE CONSERVANCY HEALING CERCLE AMIS
    CATTLE TRIBUNAL NETWORKS FACILITY GLOBAL ORGANICS COMMUNAUTAIRE REGIE PAROISSE
    FABRIQUE CAISSE SYNDICAT COMITE FONDS GROUPE MAISON MUSEE ORCHESTRE RESEAU CISSS
    CIUSSS CPE OBNL AGRICOLE FROMAGERIE BOULANGERIE ERABLIERE VIGNOBLE BRASSERIE
    DISTILLERIE MICROBRASSERIE ACRES ORCHARD ORCHARDS VINEYARD VINEYARDS GREENHOUSE
    GREENHOUSES NURSERIES APIARIES HONEY POULTRY EGGS SEEDS GRAIN GRAINS LIVESTOCK
    FEEDLOT FEEDLOTS FEEDS FARMING AGRI AGRO
  `
    .split(/\s+/)
    .filter(Boolean),
);

// Organization words that are also surnames or given names, that join a couple's names ("SMITH
// JOHN AND MARY"), or that occur in Indigenous family names ("STANDING ON THE ROAD", "FIRST
// RIDER"). Treating them as organization markers would publish people named Wood, Park, St-Onge
// or Board, so they never count on their own. Cost: some organizations whose only marker is one
// of these get withheld.
export const NAME_COLLISIONS = new Set(
  `
    AND ST STE SAINT SAINTE CO SA AG MD BV NV HOME FAMILY FAMILIES ARENA VILLA MANOR
    LODGE PARISH GUILD BURGER MART DOLLAR WOOD BANK PRESS POWER PORT PARK PARKS ROMAN CAMP
    KITCHEN CHARITY TEMPLE ARTS LOOMIS SAPUTO CHURCH VALLEY PLACE STORE MEN TO ON MY IN AT WE
    THE OF FOR BY OUT OUR YOUR FIRST BOARD
  `
    .split(/\s+/)
    .filter(Boolean),
);

// Multi-word markers that stay reliable even though their words collide with names.
const ORG_PHRASES = /^(MD|M D) OF\b|\bFIRST NATIONS?\b|\bSCHOOL BOARD\b|\bBOARD OF\b|\bOF THE\b/;

// Collision words that do mark an organization when they END a name of three or more words
// ("... LAND AND WATER BOARD"), where a surname is unlikely: Alberta lists people surname first,
// so a trailing word there is a given name.
const TRAILING_ORG_TOKENS = new Set(
  "BOARD LODGE HOME BANK MANOR GUILD PRESS PLACE KITCHEN STORE CAMP MART PORT ARENA".split(" "),
);

export const ORG_TOKENS = new Set([...ORG_CANDIDATES].filter((word) => !NAME_COLLISIONS.has(word)));

const WORD = /[A-Z][A-Z'-]*/g;

/**
 * Heuristic: does this recipient name look like an individual's name?
 *
 * True for 2-6 purely alphabetic tokens with no organization marker and no digits. It errs
 * toward withholding: a small organization with a two-word name and no marker ("ACME WIDGETS")
 * is treated as a person. That trade-off is intentional for a public demo built on data whose
 * licence excludes personal information.
 */
export function looksLikePerson(raw: unknown): boolean {
  const key = normalizeName(raw);
  if (!key || /\d/.test(key)) return false;
  const tokens = key.match(WORD) ?? [];
  if (tokens.length < 2 || tokens.length > 6) return false;
  // Stray symbols (e.g. "#", "+") point to an organization
  if (tokens.length !== key.split(SPACES).filter(Boolean).length) return false;
  if (ORG_PHRASES.test(key)) return false;
  if (tokens.length >= 3 && TRAILING_ORG_TOKENS.has(tokens[tokens.length - 1] as string)) {
    return false;
  }
  for (const token of tokens) {
    for (const part of token.split(/[-']/)) {
      if (part && ORG_TOKENS.has(part)) return false;
    }
  }
  return true;
}
