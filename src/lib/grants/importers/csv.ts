/**
 * Tolerant CSV reading for the source files, matching Python's `csv.DictReader` (excel dialect,
 * non-strict) that the original importer used, so row numbering (Alberta references are built
 * from it) and malformed-row detection come out the same.
 *
 * Decoding is per line: UTF-8, falling back to Windows-1252. Alberta's files switched encoding
 * between years (2023-24 and 2024-25 are Windows-1252), and decoding per line keeps one bad byte
 * from failing a file.
 */
import { createReadStream } from "node:fs";

const NEWLINE = 0x0a;
const utf8 = new TextDecoder("utf-8", { fatal: true });
const cp1252 = new TextDecoder("windows-1252");
// Bytes Windows-1252 leaves undefined: Python's decode(errors="replace") gives U+FFFD for them.
const CP1252_UNDEFINED = /[\u0081\u008d\u008f\u0090\u009d]/g;

function decodeLine(bytes: Uint8Array): string {
  try {
    return utf8.decode(bytes);
  } catch {
    return cp1252.decode(bytes).replace(CP1252_UNDEFINED, "�");
  }
}

/**
 * The file's lines, each with its trailing "\n" as Python's binary readline keeps it, decoded
 * one at a time. `onBytes` reports how far into the file the reader is.
 */
export async function* decodedLines(
  path: string,
  onBytes?: (bytesRead: number) => void,
): AsyncGenerator<string> {
  let carry: Uint8Array = new Uint8Array(0);
  let first = true;
  let bytesRead = 0;
  const stream = createReadStream(path, { highWaterMark: 1 << 20 });

  const emit = function* (block: Uint8Array): Generator<string> {
    // Most blocks are valid UTF-8 throughout: decode them at once, then split.
    let text: string | null = null;
    try {
      text = utf8.decode(block);
    } catch {
      text = null;
    }
    if (text !== null) {
      let start = 0;
      while (start < text.length) {
        const end = text.indexOf("\n", start);
        const stop = end === -1 ? text.length : end + 1;
        let line = text.slice(start, stop);
        if (first) {
          line = line.replace(/^\ufeff+/, "");
          first = false;
        }
        yield line;
        start = stop;
      }
      return;
    }
    let start = 0;
    while (start < block.length) {
      const end = block.indexOf(NEWLINE, start);
      const stop = end === -1 ? block.length : end + 1;
      let line = decodeLine(block.subarray(start, stop));
      if (first) {
        line = line.replace(/^\ufeff+/, "");
        first = false;
      }
      yield line;
      start = stop;
    }
  };

  for await (const chunk of stream as AsyncIterable<Buffer>) {
    bytesRead += chunk.length;
    const buffer = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    const last = buffer.lastIndexOf(NEWLINE);
    if (last === -1) {
      carry = buffer;
      continue;
    }
    carry = buffer.subarray(last + 1);
    yield* emit(buffer.subarray(0, last + 1));
    onBytes?.(bytesRead);
  }
  if (carry.length) yield* emit(carry);
  onBytes?.(bytesRead);
}

export class CsvError extends Error {}

enum State {
  StartRecord,
  StartField,
  InField,
  InQuotedField,
  QuoteInQuotedField,
  EatCrnl,
}

/**
 * Python's csv reader state machine (excel dialect: ',' delimiter, '"' quotes, doubled quotes,
 * strict=False), fed one line at a time. Yields each record's fields; empty lines yield [].
 */
export class CsvRecordReader {
  private state = State.StartRecord;
  private fields: string[] = [];
  private field = "";

  /** Process one line; returns the completed record, or null if the record continues. */
  feed(line: string): string[] | null {
    // Fast path: a whole record on one line with no quotes and no stray carriage returns.
    if (this.state === State.StartRecord && line.indexOf('"') === -1) {
      let body = line;
      if (body.endsWith("\n")) body = body.slice(0, -1);
      if (body.endsWith("\r")) body = body.slice(0, -1);
      if (body.indexOf("\r") === -1 && body.indexOf("\n") === -1) {
        return body === "" ? [] : body.split(",");
      }
    }
    for (let i = 0; i < line.length; i++) this.process(line[i] as string);
    return this.process(null);
  }

  /** At the end of the file: whatever record was left open (Python returns it when non-strict). */
  finish(): string[] | null {
    if (
      this.state !== State.StartRecord &&
      this.state !== State.EatCrnl &&
      (this.field.length !== 0 || this.state === State.InQuotedField)
    ) {
      this.saveField();
      return this.take();
    }
    return null;
  }

  private saveField() {
    this.fields.push(this.field);
    this.field = "";
  }

  private take(): string[] {
    const fields = this.fields;
    this.fields = [];
    this.state = State.StartRecord;
    return fields;
  }

  private process(c: string | null): string[] | null {
    switch (this.state) {
      case State.StartRecord:
        if (c === null) return this.take(); // the end of an empty line
        if (c === "\n" || c === "\r") {
          this.state = State.EatCrnl;
          return null;
        }
        this.state = State.StartField;
        return this.process(c);
      case State.StartField:
        if (c === "\n" || c === "\r" || c === null) {
          this.saveField();
          if (c === null) return this.take();
          this.state = State.EatCrnl;
          return null;
        }
        if (c === '"') {
          this.state = State.InQuotedField;
          return null;
        }
        if (c === ",") {
          this.saveField();
          return null;
        }
        this.field += c;
        this.state = State.InField;
        return null;
      case State.InField:
        if (c === "\n" || c === "\r" || c === null) {
          this.saveField();
          if (c === null) return this.take();
          this.state = State.EatCrnl;
          return null;
        }
        if (c === ",") {
          this.saveField();
          this.state = State.StartField;
          return null;
        }
        this.field += c;
        return null;
      case State.InQuotedField:
        if (c === null) return null; // the field goes on to the next line
        if (c === '"') {
          this.state = State.QuoteInQuotedField;
          return null;
        }
        this.field += c;
        return null;
      case State.QuoteInQuotedField:
        if (c === '"') {
          this.field += '"';
          this.state = State.InQuotedField;
          return null;
        }
        if (c === ",") {
          this.saveField();
          this.state = State.StartField;
          return null;
        }
        if (c === "\n" || c === "\r" || c === null) {
          this.saveField();
          if (c === null) return this.take();
          this.state = State.EatCrnl;
          return null;
        }
        // Not strict: a character after a closing quote joins the field
        this.field += c;
        this.state = State.InField;
        return null;
      case State.EatCrnl:
        if (c === "\n" || c === "\r") return null;
        if (c === null) return this.take();
        throw new CsvError("new-line character seen in unquoted field");
    }
  }
}

export const MALFORMED = Symbol("malformed");

export type CsvRow = Record<string, string | null> & { [MALFORMED]?: true };

/**
 * DictReader over a source file; a blank trailing header column is dropped.
 *
 * Rows whose field count does not match the header (an unquoted comma inside a name shifts every
 * later column) are flagged with MALFORMED instead of being parsed: a shifted row would put a
 * program name in the amount column.
 */
export async function* readRows(lines: AsyncIterable<string>): AsyncGenerator<CsvRow> {
  const reader = new CsvRecordReader();
  let header: string[] | null = null;

  const toRow = (record: string[]): CsvRow | null => {
    if (record.length === 0) return null; // DictReader skips empty rows
    if (header === null) {
      header = record;
      return null;
    }
    const row: CsvRow = {};
    const names = header;
    for (let i = 0; i < names.length; i++) {
      row[names[i] as string] = i < record.length ? (record[i] as string) : null;
    }
    const extra = record.slice(names.length);
    delete row[""];
    if (extra.some((value) => value) || Object.values(row).some((value) => value === null)) {
      row[MALFORMED] = true;
    }
    return row;
  };

  for await (const line of lines) {
    const record = reader.feed(line);
    if (record === null) continue;
    const row = toRow(record);
    if (row) yield row;
  }
  const rest = reader.finish();
  if (rest) {
    const row = toRow(rest);
    if (row) yield row;
  }
}
