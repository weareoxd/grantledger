/**
 * ASCII transliteration, exactly as Python's Unidecode 1.4 (which the original importer used),
 * so recipient keys built from accented or mis-encoded names match across the two codebases.
 * unidecode-data.json is that package's table: hex section (code point >> 8) -> 256 replacements.
 */
import data from "./unidecode-data.json";

const sections = data as Record<string, string[]>;

export function unidecode(text: string): string {
  let out = "";
  for (const char of text) {
    const cp = char.codePointAt(0) as number;
    if (cp < 0x80) {
      out += char;
      continue;
    }
    out += sections[(cp >> 8).toString(16)]?.[cp & 0xff] ?? "";
  }
  return out;
}
