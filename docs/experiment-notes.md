# GrantLedger experiment notes

Lab notebook for the OXD Labs post on read-only MCP servers. GrantLedger stands in for a
client system that can't be named: the same pattern, rebuilt on public data so the post can
show real screens, real numbers and real code. Everything below was checked on 6 October 2026.

## 1. The "before" interfaces

Both governments publish a search page over the same data GrantLedger loads.

| | Government of Alberta: grant payments table | Government of Canada: grants and contributions search |
|---|---|---|
| Finding rows | Ministry drop-down, a filter on every column, sortable | Keyword search; facets for department, calendar year, agreement type, value range, amendments |
| Page size | 10 rows | 10 rows |
| Volume | 2,037,802 payments | 1,195,248 records |
| Totals or grouping | None | None |
| Export | None from the table (yearly CSV files on open.alberta.ca) | Download search results as CSV |
| Fiscal years | Fiscal-year column | Calendar years only, though both governments budget April to March |
| Across governments | No | No |

Both pages are good at finding a payment. Neither can answer "how much", "which grew",
"who gets money from both" or "what share". Those questions start with an export and end in
Excel. That gap is what the experiment tests.

## 2. What we built

- **Stack.** Django and PostgreSQL in Docker Compose, the MCP Python SDK (FastMCP) over
  Streamable HTTP, and a stdio transport for local clients. It is a port of the client system's
  MCP server with the domain swapped.
- **Model.** Both disclosures load into one shape: organization, ministry, program, award,
  recipient, fiscal year. Federal rows are agreements. Alberta rows are payments.
- **Tools.** There are 17 in four groups. Discovery has one schema tool that also explains the
  data's conventions. Records has list and get for each model. Curated aggregates cover totals
  by any dimension, one recipient across both governments, one ministry, and recipients both
  governments fund. One constrained query tool handles everything else.
- **Safety.** It is read-only by construction. An allowlist covers six models and their
  fields, and there is no SQL path. Rows are capped at 500 per call. OAuth 2.1 with dynamic
  client registration federates sign-in to Google; a static key covers local clients. One
  JSON audit line is written per call.
- **Size.**

| Part | Lines of Python |
|---|---|
| MCP server, including OAuth | ~2,100 |
| Importers and models | ~1,300 |
| Tests (62) | ~780 |

## 3. What the data taught us

### Alberta

| Measure | Value |
|---|---|
| Payments loaded | 2,037,730 across FY2014-15 to FY2026-27 (to date) |
| Dollars | $493.8B |
| Official table count | 2,037,802, so the import reconciles within 72 rows |
| Rows with no recipient | 3,346 rows worth $125.0B, a quarter of all dollars |
| Negative payments | 50,952 reversals and recoveries |
| Ministry names over 13 years | 66, because each payment keeps the ministry of the day |

- **A quarter of the money has no recipient.** Alberta publishes physician fee-for-service,
  income support and drug benefits as unnamed annual totals with no payment date. Ask an
  assistant for "Alberta's biggest grant recipients" and, without a convention in the server,
  the top answer is "nobody". GrantLedger files these under one placeholder, gives them an
  estimated date, and excludes them from recipient rankings by default.
- **Six years of files were broken.** The original 2014-15 to 2019-20 CSVs have 10,673 rows
  with unquoted commas in ministry and program names, which shift every later column. The
  first import put program names in the amount column without any error. Alberta publishes
  "(standardized)" versions of those years; the download script uses them, and the importer
  now refuses any row whose field count doesn't match the header.
- **Encodings and layouts vary.** Two years are Windows-1252. The live current-year export
  has its own header, US-style timestamps and a trailing empty column.
- **Fiscal years are consistent.** For every payment, the fiscal year derived from the payment
  date equals the fiscal year of the file it came from.
- **Individuals are named.** About 36% of Alberta rows, $2.6B, carry names that look like
  people's: scholarship students, day-home operators and others. Alberta has no recipient-type
  column to tell people from organizations. The importers currently withhold these names
  under a placeholder and keep the dollars in the totals.

### Government of Canada

To be completed after the federal import.

## 4. Question bank

To be completed after the federal import.

## 5. Candidate takeaways

1. **Expose the data model, not the screens.** Each portal encodes the questions its designers
   expected. The database can answer questions nobody designed a screen for.
2. **Safety comes from the shape of the API, not from the prompt.** An allowlist and a query
   builder make "read-only" a property of the server rather than a request to the model.
3. **Put the conventions in the server.** Fiscal years, amendments, undisclosed aggregates and
   agreements versus payments are where wrong answers come from. A model gets them right when
   the schema tool states them and the defaults enforce them.
4. **The query is the audit trail.** Every answer maps to a logged, replayable tool call, which
   a chat over pasted CSVs can't offer.
5. **Most of the work was the data, not the protocol.** The MCP layer ported in hours. Making two
   public datasets agree took most of the effort.
