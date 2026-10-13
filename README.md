# GrantLedger

A read-only [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server and web UI
over two Canadian public grant disclosures, built for an OXD Labs experiment: can a secure MCP
server answer the questions a fixed web interface can't?

GrantLedger has both sides of that comparison on the same data. A web UI offers preset screens,
drill-down links, filters, a column chooser and CSV export. The MCP server lets Claude, ChatGPT
or Claude in Excel query the same data in plain language. Findings are in
[docs/experiment-notes.md](docs/experiment-notes.md).

It is one Next.js app: the web UI, its JSON API, the MCP server and an admin section, plus a
background worker that downloads and imports the governments' files on a schedule.

| Organization | Source | What one row is | Coverage |
|---|---|---|---|
| Government of Canada | [Proactive Disclosure – Grants and Contributions](https://open.canada.ca/data/en/dataset/432527ab-7aac-45b5-81d6-7597107a7013) (Treasury Board Secretariat) | An agreement amendment; each restates the agreement's total value | Mostly 2005 onward, updated quarterly |
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
- **The name check** (`src/lib/grants/normalize.ts`) treats 2–6 alphabetic words with no
  organization marker as a person. Words that are also surnames, given names or parts of
  Indigenous family names (Wood, Park, St-, Roman, "On The", First) never count as markers.
  It errs toward withholding.
- **Withheld rows are kept.** Their amounts count toward ministry and program totals under a
  placeholder recipient, `INDIVIDUAL RECIPIENT (NAME WITHHELD)`. Their title, description and
  city are dropped too.
- **Orphans are pruned.** After every import, recipients with no awards are deleted, so a
  name a stricter rule now withholds can't linger in search.

Set `IMPORT_INCLUDE_INDIVIDUALS=true` (or pass `--include-individuals` to `npm run import`)
only on a private copy.

## Data quirks the server handles

- **Amendments.** Each federal amendment restates the full value. Several departments file
  amendments under new reference numbers, so versions are grouped by department, agreement
  number, recipient and start date. `is_current` marks the latest version of each agreement,
  and every award list and tool defaults to current rows only. Counting every reference
  instead would overstate federal totals by about $300B (a third).
- **Different measures.** Federal values are committed agreement totals. Alberta values are
  cash paid. Every aggregate reports `agreement_value`, `payment_value` and `total_value`
  separately, and the schema tells clients not to present a combined figure as like-for-like.
- **Undisclosed aggregates.** Alberta publishes large annual rows with no recipient, such as
  physician fee-for-service and income support. They become `RECIPIENT NOT DISCLOSED` and
  usually have no payment date, so `start_date` is the first day of the fiscal year and
  `start_date_estimated` is true.
- **Broken older Alberta files.** The original 2014-15 to 2019-20 files contain thousands of
  rows with unquoted commas that shift every later column. The worker downloads the
  publisher's "(standardized)" versions of those years. The importer also rejects any row
  whose field count doesn't match the header, so a shifted row is never imported.
- **Encodings and layouts.** Alberta's 2023-24 and 2024-25 files are Windows-1252. The live
  current-year export uses another header, US-style timestamps and a trailing empty column.
- **Federal quirks.** Recipient names published as "English|French" pairs keep the English
  half. Spreadsheet "zero dates" (1899-12-30) count as missing.
- **Name matching.** Recipient names are normalised: accents removed, upper-cased, `&` → `AND`,
  `LIMITED` → `LTD`. That way "University of Calgary" (federal) and "UNIVERSITY OF CALGARY"
  (Alberta) are one recipient. Different legal names for the same body still split;
  `recipient_funding` lists possible variants.

## Security model

- **Read-only by construction.** Tools are queries over an allowlist of six models
  (`src/lib/mcp/schema.ts`). There is no raw SQL path, and every field, operator, sort and
  aggregation is validated. User accounts and OAuth tables are not reachable, and tests assert it.
- **Bounded responses.** Each call returns at most `MCP_MAX_ROWS` rows (default 500). Long
  descriptions are trimmed in list results.
- **Authentication.** With `MCP_PUBLIC_URL` set, the server is an OAuth 2.1 authorization server
  with dynamic client registration that federates sign-in to Google. Access tokens last an
  hour and refresh tokens 30 days, rotated, with revocation, plus an optional
  email-domain allowlist. Without it, the HTTP endpoint requires a static bearer key. The stdio
  transport is local and trusted. The web UI has its own sign-in, with Google (see
  [Web UI sign-in](#web-ui-sign-in)), whose sessions the MCP server doesn't accept.
- **Audit log.** Every tool call logs one JSON line (scope `mcp_audit`) with the tool,
  arguments, caller, duration and row count. That is enough to replay any answer.
- **Roles.** Signed-in users read. Admins also edit data, manage users and start imports; every
  admin action checks the role on the server.

## Quick start

Requires Docker (for Postgres) and Node 24. `make` lists every target.

```bash
make setup              # .env with generated secrets, npm ci; then set ADMIN_EMAIL and GOOGLE_OAUTH2_*
make start              # Postgres in the background, then the web app and the worker (Ctrl-C stops them)
```

Sign in at http://localhost:3000 with the Google account named by `ADMIN_EMAIL`. The Google
OAuth client must list `http://localhost:3000/api/auth/callback/google` as a redirect URI. The database
starts empty: on the **Worker** page, run **Alberta (yearly archives)** and **Alberta (current
year)**. The worker downloads each file, imports it, removes names nothing points to any more
and rebuilds the totals behind the lists, in about a minute. The federal file (about 2.3 GB,
about two minutes) is off by default: set `FEDERAL_IMPORTS_ENABLED=true` in `.env` to run
**Government of Canada** there too, or import a copy on disk with `make import-federal`.

| Service | URL |
|---|---|
| Web UI | http://localhost:3000 |
| JSON API | http://localhost:3000/api/… (once signed in) |
| MCP endpoint | http://localhost:3000/api/mcp |
| Worker | http://localhost:3000/worker (admins only) |
| Admin | http://localhost:3000/admin (admins only) |
| PostgreSQL | localhost:5434 (set `POSTGRES_HOST_PORT` to change it) |

Day to day: `make stop` and `make restart`, `make db-shell`, `make migrate`, `make user
EMAIL=alice@example.org [ROLE=admin]`, `make rollup` (rebuild and check the rollup), `make stats` (the
figures the experiment notes quote), `make backup` and `make restore FILE=…`, and `make clean`
(containers and build output; the database stays) or `make clean-db` (the database too, after
asking). Files already on disk can be imported without the worker:
`make import-alberta FILES="data/alberta/*.csv"` and `make import-federal`.

Tests and checks:

```bash
make test               # every test: unit, UI (jsdom) and database (DATABASE_URL_TEST)
make test-unit          # only the ones that need no database
make check              # lint (Biome), types and tests
make build              # the production build (.next/standalone and dist/)
```

The database tests empty `DATABASE_URL_TEST` (its name must contain "test"); it's created on
first use.

Call a tool from the command line:

```bash
make mcp-call ARGS="call award_totals '{\"group_by\": \"organization\"}'"
```

## Connecting a client

**Claude Code** over HTTP with the bearer key:

```bash
claude mcp add --transport http grantledger http://localhost:3000/api/mcp --header "Authorization: Bearer <MCP_API_KEY>"
```

**Claude Desktop** over stdio (add to `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "grantledger": {
      "command": "npm",
      "args": ["run", "--silent", "--prefix", "/path/to/grantledger", "mcp-stdio"]
    }
  }
}
```

**claude.ai, ChatGPT and Claude in Excel** connect as remote connectors, which need the server on
a public HTTPS origin with OAuth. Set `MCP_PUBLIC_URL` and `MCP_JWT_SECRET`, create a Google
OAuth web client whose redirect URI is `<MCP_PUBLIC_URL>/api/mcp-oauth/google/callback`, and set
the `GOOGLE_OAUTH2_*` variables. Then add `<MCP_PUBLIC_URL>/api/mcp` as a custom connector in
the client.

## Web UI

Next.js 16 (App Router), React 19, TanStack Query and Table, Tailwind 4 and shadcn/ui, in
`src/`. A sidebar shell with breadcrumbs leads from each organization to its departments or
ministries, programs and recipients, and each of their awards. Every one has an overview page
as well as its lists.

```
/ Organizations
└─ /organization/:org                      overview (funding over time, what's new, movers)
   ├─ …/award · …/ministry · …/recipient   lists
   ├─ …/ministry/:min                      overview
   │   ├─ …/award · …/program · …/recipient
   │   ├─ …/recipient/:rec                 that recipient's awards from the ministry
   │   └─ …/program/:prog                  overview
   │       └─ …/award · …/recipient · …/recipient/:rec
   └─ …/recipient/:rec                     overview
       └─ …/awards · …/ministries
/worker                                    the import worker: live status, schedule, history (admins)
/admin                                     editing the data and users (admins)
```

- **Overviews:** cards for each list, then this fiscal year to date against the same point
  last year, value by fiscal year (federal agreements spread over their terms or counted in
  the year they started), what's new, the biggest and newest recipients, and the share of
  grants and contributions. Alberta's yearly totals published without a date are left out
  of the year-to-date comparisons, and the page says how much.
- **Lists:** server-side paging and sorting, footer totals over the full filtered set,
  frozen and resizable columns, a per-column filter editor (Match all/any) with removable
  chips, a column picker, a fiscal-year select on aggregated lists, and toggles to hide
  placeholder recipients or include superseded federal amendments.
- **State:** all of it lives in the URL (`?sort=-value&f=recipient:contains:calgary&fy=2024`),
  so every view is a shareable link.
- **CSV export:** streamed by the server with the visible columns, up to Excel's
  1,048,576-row limit, with a warning first.
- **Kinds of record:** columns, headers and wording follow the organization's records
  (agreements or payments), not hard-coded names.
- Light and dark themes, and the data's licence attribution on every page.

### Web UI sign-in

The web UI and its API are for signed-in users, who sign in with Google through
[Better Auth](https://www.better-auth.com) running inside the app (`src/lib/auth/`). There are
no passwords.

- **Who can sign in.** Anyone with a Google account. Their first sign-in makes them an
  account with the `user` role, if Google has verified their email. The admin named by
  `ADMIN_EMAIL` gets an admin account on startup. Admins promote people in **Admin → Users**, or
  add someone by email ahead of their first sign-in to give them a role, also possible with
  `make user EMAIL=alice@example.org ROLE=admin`.
- **Setup.** One Google OAuth web client (`GOOGLE_OAUTH2_CLIENT_ID` and `_SECRET`, shared with
  the MCP connectors), with `<BETTER_AUTH_URL>/api/auth/callback/google` as a redirect URI.
- **Roles.** `user` reads; `admin` also edits data, manages users and starts imports. The Admin
  link only shows for admins, and every admin page and action checks the role on the server.
- **Sessions.** Signing in sets an HttpOnly, SameSite=Lax cookie (Secure on https) for 7
  days, extended while it's used. Without a valid session the API answers 401 and the UI goes
  to its sign-in page, then back. Removing someone signs them out.
- **The MCP server is separate.** It takes its bearer key (or OAuth), and a web UI session
  doesn't work there.

### JSON API

The API (`src/lib/rest/`, routes under `src/app/api/organization/`) is read-only, for
signed-in users. Lists take `page`, `page_size`, `sort` and `sort_order`, flat `fiscal_year`,
`hide_placeholders` and `include_superseded`, and one bracketed group of params per filtered
column. Columns and filters are validated against the same allowlist as the MCP server's:

```
/api/organization/1/recipient?fiscal_year=2024&sort=award_value&sort_order=desc
    &name[0][value]=calgary&name[0][matchMode]=contains&name[operator]=and
```

A CSV export posts the columns to the same URL. From the command line, sign in in a browser
first and send its session cookie (`better-auth.session_token`):

```bash
curl -b 'better-auth.session_token=...' -X POST 'http://localhost:3000/api/organization/1/ministry?sort=award_value&sort_order=desc' \
  -H 'Content-Type: application/json' \
  -d '{"columns": [{"id": "name", "header": "Ministry"}, {"id": "award_value", "header": "Amount paid"}]}'
```

Aggregated lists read the `award_rollup` table, rebuilt after every import and admin edit.
Responses are cached under a data version that imports and edits bump, so repeat requests take
a few milliseconds. Each list query runs under a 15-second statement timeout, and an overview's
summary under 60 seconds, cached for the day.

## Worker

A separate Node process (`src/worker/`, `npm run worker`) runs the imports from a
[pg-boss](https://github.com/timgit/pg-boss) queue in the same database, one at a time.

| Source | When | What |
|---|---|---|
| Alberta (current year) | `ALBERTA_LIVE_CRON`, daily at 06:00 | The live export of the current fiscal year, saved as that year's file |
| Government of Canada | `FEDERAL_CRON`, Mondays at 03:00, only with `FEDERAL_IMPORTS_ENABLED=true` (off by default) | `grants.csv`, about 2.3 GB |
| Alberta (yearly archives) | When an admin runs it | The twelve official yearly files, 2014-15 on |

Each run downloads with a conditional request (ETag and Last-Modified), and a file whose
contents haven't changed is skipped. A changed file is imported in one transaction that replaces
its earlier rows; then names nothing points to are pruned, the rollup is rebuilt and checked, and
the data version is bumped.

The **Worker** page, for admins only, shows it live: online or not (a 15-second heartbeat), the
step and a progress bar (bytes downloaded, rows read), the queue, each source's schedule and last
run, and a history of every file with its row counts and any error. From it an admin can run a
source now (or force it when unchanged), cancel a queued run and pause the schedules. A header
indicator on every page shows admins the same status.

## Admin

**Admin** (for admins) edits the data the importers loaded: awards, recipients, programs,
ministries, governments and fiscal years, each with search, filters, sorting and paging on the
server, and an edit dialog. Saving an award rebuilds its ministry's totals at once, so lists
and overviews show the change; other edits bump the data version. **Users** adds people, sets
their role, and removes them.

Edits last until the next import of the file a record came from, which replaces that file's
rows with the file's own.

## Production

The Dockerfile builds one image: the Next.js standalone server and the import worker, which
`scripts/start-container.sh` runs side by side, restarting either if it exits. `make image`
builds it as `grantledger:local`, and `make prod-up` runs it with Postgres through Docker Compose
on http://localhost:3000. On start, the settings are checked, migrations run and the admin is
created; `/api/health` answers 503 until then, and 200 once the database answers.

### Deploying to AWS

Pushes to `main` deploy to ECS through `.github/workflows/deploy.yml`, which calls the shared
workflow in `weareoxd/aws-ecs-devops`. It builds the Dockerfile's last stage for `linux/arm64`
and runs it as the task's only container. The app was provisioned as `grantledger`:

| Setting | Value |
|---|---|
| Port | 80, passed in as `PORT` (the image's default too) |
| Memory | 512 MiB for the task; the worker's heap is capped at 192 MiB (`WORKER_MAX_OLD_SPACE_MB` in the task definition) so the federal import fits |
| Health check | `/api/health` on the target group |
| Database | schema `grantledger` on the shared Dev database, as `grantledger_user` |

Every table lives in the `grantledger` schema (`src/lib/db/schema-name.ts`): the app's own,
Better Auth's, the Drizzle migrations journal and pg-boss's job tables. The app's database user
can't create anything in `public`, which only lends the shared `pg_trgm` extension, and
connections search `grantledger` and then `public`. The platform passes `DATABASE_URL` and
`DATABASE_PGSSLCA_BASE64`, and with the latter the connection uses TLS checked against the RDS
CA.

The rest of the settings are in the app's secret (`grantledger` in Secrets Manager), each mapped
to an environment variable of the same name in the task definition. Deploys copy the latest
task definition revision, so the mappings carry over; a CloudFormation update of the
`app-grantledger` stack that touches the task definition registers a revision without them, so
add them back and redeploy after one.

| Key | Value |
|---|---|
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | The app's https origin. The Google OAuth client must list `<BETTER_AUTH_URL>/api/auth/callback/google` |
| `GOOGLE_OAUTH2_CLIENT_ID`, `GOOGLE_OAUTH2_CLIENT_SECRET` | The Google OAuth web client |
| `ADMIN_EMAIL` | The first admin's Google email |
| `MCP_API_KEY`, `MCP_JWT_SECRET` | For the MCP server (see `.env.example`) |
| `MCP_PUBLIC_URL` | The app's https origin, for MCP connectors that sign in with Google |
| `TRUSTED_PROXIES` | The load balancer's addresses (the VPC's CIDR), for rate limiting by client IP |

### Copying local data to production

Rather than have production download and import everything again (the federal file alone is
2.3 GB), copy the data from a local database:

```bash
make data-export                                   # data/exports/grantledger-data-<time>.dump
make data-status-prod                              # production ready? (read-only)
make data-import-prod FILE=data/exports/grantledger-data-<time>.dump
```

The export holds the grants data, the totals behind the lists, the import history and each
source's last download (so the worker skips files that haven't changed). Users, sessions, MCP
clients and the job queue stay as they are on each side. The import reaches the private
database through an SSM tunnel via the ECS host, as the app's own database user (from the
`grantledger` secret, with TLS checked against the RDS CA). It refuses unless production's
migrations match the export's (deploy the same version first) and its worker is idle, then
replaces the data in one transaction: the site keeps serving the old data until it commits. It
needs Docker, the AWS CLI signed in to the account, and the Session Manager plugin.

Downloads go to `/app/data` inside the container and don't outlive it; the worker downloads a
file again when it needs it. Behind a reverse proxy, don't buffer `/api` responses, so CSV
exports stream.

## Tools

See [docs/TOOLS.md](docs/TOOLS.md) for parameters and example output.

| Tool | Answers |
|---|---|
| `describe_schema` | Models, fields, code tables and the conventions above. Clients call it first. |
| `list_*` / `get_*` | Organizations, ministries, programs, recipients, awards and fiscal years, with structured filters. |
| `award_totals` | Count and value grouped by organization, ministry, program, recipient, type or fiscal year. |
| `recipient_funding` | One recipient across both governments: by organization, by year, top programs, name variants. |
| `ministry_funding` | One ministry or department: by year, top programs, top recipients, placeholders apart. |
| `shared_recipients` | Recipients funded by both governments, amounts side by side. |
| `query` | Constrained ad-hoc filter, group and aggregate over any allowed model. |
