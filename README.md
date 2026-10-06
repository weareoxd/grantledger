# GrantLedger

A read-only [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server over two
Canadian public grant disclosures, built for an OXD Labs experiment: can a secure MCP server
answer the questions a fixed web interface can't?

| Organization | Source | What one row is | Coverage |
|---|---|---|---|
| Government of Canada | [Proactive Disclosure – Grants and Contributions](https://open.canada.ca/data/en/dataset/432527ab-7aac-45b5-81d6-7597107a7013) (Treasury Board Secretariat) | An agreement amendment; each restates the agreement's total value | 2012 onward, updated quarterly |
| Government of Alberta | [Grant Payments Disclosure](https://open.alberta.ca/dataset/grant-disclosure) | A cash payment on a date | FY2014-15 onward, updated quarterly |

Both are loaded into one model (organization → ministry → program → award, plus recipients) so a
single question can span both governments.

## Licences and attribution

Contains information licensed under the Open Government Licence – Canada.
Contains information licensed under the Open Government Licence – Alberta.

This is an unofficial tool. Neither government endorses it. The data is provided "as is" by its
publishers. The MCP server returns the attribution line for each organization from
`list_organizations` and `describe_schema`, and its instructions ask clients to cite it.

## Privacy

The Open Government Licences do not cover personal information, and both files name individuals:
federal recipients of type `P`, and Alberta payees such as scholarship students and day-home
operators. The importers never store those names.

- **Federal rows** of recipient type `P` are always withheld. Types `G` (government) and `S`
  (academia) are trusted. Every other type, including blank legacy rows, is checked by name,
  because personal names also appear under for-profit, not-for-profit and Indigenous types.
- **Alberta rows** have no recipient type, so every name is checked.
- **The name check** (`app/grants/normalize.py`) treats 2–6 alphabetic words with no
  organization marker as a person. Words that are also surnames, given names or parts of
  Indigenous family names (Wood, Park, St-, Roman, "On The", First) never count as markers.
  It errs toward withholding.
- **Withheld rows are kept.** Their amounts count toward ministry and program totals under a
  placeholder recipient, `INDIVIDUAL RECIPIENT (NAME WITHHELD)`. Their title, description and
  city are dropped too.
- **Orphans are pruned.** After every import, recipients with no awards are deleted, so a
  name a stricter rule now withholds can't linger in search.

Run the importers with `--include-individuals` only on a private copy.

## Data quirks the server handles

- **Amendments.** Each federal amendment restates the full value. `is_current` marks the latest
  amendment of each agreement, and every award tool defaults to `current_only=true`.
- **Different measures.** Federal values are committed agreement totals. Alberta values are
  cash paid. Every aggregate reports `agreement_value`, `payment_value` and `total_value`
  separately, and the schema tells clients not to present a combined figure as like-for-like.
- **Undisclosed aggregates.** Alberta publishes large annual rows with no recipient, such as
  physician fee-for-service and income support. They become `RECIPIENT NOT DISCLOSED` and
  usually have no payment date, so `start_date` is the first day of the fiscal year and
  `start_date_estimated` is true.
- **Broken older Alberta files.** The original 2014-15 to 2019-20 files contain thousands of
  rows with unquoted commas that shift every later column. The download script uses the
  publisher's "(standardized)" versions of those years. The importer also rejects any row
  whose field count doesn't match the header, so a shifted row is never imported.
- **Encodings and layouts.** Alberta's 2023-24 and 2024-25 files are Windows-1252. The live
  current-year export uses another header, US-style timestamps and a trailing empty column.
- **Name matching.** Recipient names are normalised: accents removed, upper-cased, `&` → `AND`,
  `LIMITED` → `LTD`. That way "University of Calgary" (federal) and "UNIVERSITY OF CALGARY"
  (Alberta) are one recipient. Different legal names for the same body still split;
  `recipient_funding` lists possible variants.

## Security model

- **Read-only by construction.** Tools are ORM queries over an allowlist of six models
  (`app/mcp_server/schema.py`). There is no raw SQL path, and every field, operator, sort and
  aggregation is validated. User accounts and OAuth tables are not reachable, and tests assert it.
- **Bounded responses.** Each call returns at most `MCP_MAX_ROWS` rows (default 500). Long
  descriptions are trimmed in list results.
- **Authentication.** With `MCP_PUBLIC_URL` set, the server is an OAuth 2.1 authorization server
  with dynamic client registration that federates sign-in to Google. Access tokens last an
  hour and refresh tokens 30 days, rotated, with revocation, plus an optional
  email-domain allowlist. Without it, the HTTP endpoint requires a static bearer key. The stdio
  transport is local and trusted.
- **Audit log.** Every tool call logs one JSON line (logger `mcp_audit`) with the tool,
  arguments, caller, duration and row count. That is enough to replay any answer.

## Quick start

Requires Docker.

```bash
cp .env.example .env            # then set SECRET_KEY and MCP_API_KEY
backend/scripts/download_data.sh  # ~2.6 GB: Alberta yearly files + the federal grants.csv
docker compose up -d postgres django mcp
docker compose exec django sh -c 'python manage.py import_alberta data/alberta/tbf-grants-disclosure-*.csv'
docker compose exec django python manage.py import_federal data/federal/grants.csv
```

Re-running an import replaces the rows previously loaded from the same file name. The Django
admin is at http://localhost:8000/admin and the MCP endpoint at http://localhost:8082/mcp.

Run the tests (sqlite, no data needed):

```bash
docker compose run --rm --no-deps -e DJANGO_CONFIGURATION=Test django python manage.py test app
```

Call a tool from the command line:

```bash
docker compose exec django python scripts/mcp_call.py call award_totals '{"group_by": "organization"}'
```

## Connecting a client

**Claude Code** over HTTP with the bearer key:

```bash
claude mcp add --transport http grantledger http://localhost:8082/mcp --header "Authorization: Bearer <MCP_API_KEY>"
```

**Claude Desktop** over stdio (add to `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "grantledger": {
      "command": "docker",
      "args": ["exec", "-i", "grantledger-django", "python", "manage.py", "mcp_stdio"]
    }
  }
}
```

**claude.ai, ChatGPT and Claude in Excel** connect as remote connectors, which need the server on
a public HTTPS origin with OAuth. Set `MCP_PUBLIC_URL`, create a Google OAuth web client whose
redirect URI is `<MCP_PUBLIC_URL>/mcp-oauth/google/callback`, and set the `GOOGLE_OAUTH2_*`
variables. Then add `<MCP_PUBLIC_URL>/mcp` as a custom connector in the client.

## Tools

See [backend/app/mcp_server/TOOLS.md](backend/app/mcp_server/TOOLS.md) for parameters and
example output.

| Tool | Answers |
|---|---|
| `describe_schema` | Models, fields, code tables and the conventions above. Clients call it first. |
| `list_*` / `get_*` | Organizations, ministries, programs, recipients, awards and fiscal years, with structured filters. |
| `award_totals` | Count and value grouped by organization, ministry, program, recipient, type or fiscal year. |
| `recipient_funding` | One recipient across both governments: by organization, by year, top programs, name variants. |
| `ministry_funding` | One ministry or department: by year, top programs, top recipients, placeholders apart. |
| `shared_recipients` | Recipients funded by both governments, amounts side by side. |
| `query` | Constrained ad-hoc filter, group and aggregate over any allowed model. |
