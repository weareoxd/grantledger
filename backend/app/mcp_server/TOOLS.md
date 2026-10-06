# GrantLedger MCP – Tool Reference

Read-only access to Canadian public grant disclosures: **Government of Canada** grants and
contributions (agreements) and **Government of Alberta** grant payments, modelled as
**organizations → ministries → programs → awards**, plus **recipients** and **fiscal years**.
User accounts and OAuth tables are not exposed.

- **Server name:** `grantledger`
- **Transports:** remote Streamable-HTTP at `/mcp` (OAuth or static bearer) and local stdio
  (`python manage.py mcp_stdio`).
- **Schema resource:** `schema://grants` (same content as `describe_schema`).

## Conventions

- **Fiscal year** runs **April–March** for both governments: FY2024 = Apr 1 2024 → Mar 31 2025.
  An award's `fiscal_year` comes from its `start_date`. A `fiscal_year` filter is translated to
  a `start_date` range.
- **Record kinds.** Federal rows are `agreement`s, whose `value` is the total committed over the
  agreement's life. Alberta rows are `payment`s, whose `value` is cash paid on `start_date`.
  Aggregate tools report `agreement_value`, `payment_value` and `total_value` side by side.
  `total_value` is an arithmetic sum, not a like-for-like measure.
- **Amendments.** Each federal amendment restates the full value. Award tools and `query` default
  to `current_only=true`, which keeps only the latest amendment of each agreement.
- **Placeholders.** `INDIVIDUAL RECIPIENT (NAME WITHHELD)` holds rows for individuals.
  `RECIPIENT NOT DISCLOSED` holds rows published without a recipient; for Alberta these are large
  annual aggregates. Both count in totals. They are excluded from recipient rankings by default.
- **Estimated dates.** `start_date_estimated=true` means the source gave no date, and
  `start_date` is the first day of the fiscal year.
- **Names.** `recipient.name` is a normalised, upper-cased matching key. `display_name` keeps the
  first spelling seen. One organization can still appear under several legal names.
- **Money** is CAD. Alberta has negative payments (reversals) that net out in sums.
- **Row caps.** Each call returns at most `MCP_MAX_ROWS` rows (default 500). List tools return
  `count`, the true total, alongside the capped `data`.

### Structured filters

Most tools accept `filters`, a list of `{ "field", "op", "value" }` objects combined with
`combine` (`"and"` default, or `"or"`).

| op | meaning | `value` |
|----|---------|---------|
| `eq` / `ne` | equals / not equals | scalar |
| `contains` / `startswith` / `endswith` | case-insensitive substring | string |
| `gt` / `gte` / `lt` / `lte` | comparisons | scalar or date |
| `in` | membership | list |
| `between` | inclusive range | `[low, high]` |
| `isnull` | null check | `true` / `false` |

Fields are validated against a per-model allowlist and unknown fields are rejected. For `award`
they include `organization`, `ministry`, `program`, `recipient`, `recipient_is_placeholder`,
`record_kind`, `agreement_type` (`G`/`C`/`O`), `recipient_type`
(`F`/`N`/`S`/`A`/`G`/`I`/`P`/`O`), `recipient_province`, `recipient_city`, `value`,
`fiscal_year`, `start_date`, `end_date`, `lottery_fund` and `is_current`, plus `*_id` variants.
Call `describe_schema` for the full list.

---

## Discovery

### `describe_schema`
Models, fields and types, relationships, the conventions above, the agreement and recipient type
code tables, and the filter operators and aggregation functions. Call it first.

### `list_organizations` / `get_organization`
The two publishing governments. Each one carries its `record_kind`, source dataset, licence and
attribution line.

### `list_fiscal_years`
Fiscal years covered, with start and end dates.

## Records

Every `list_*` tool accepts `filters`, `combine`, `fields` (a subset of keys), `sort` (field
names, `-` prefix for descending), `limit` and `offset`. Each returns
`{ count, limit, offset, data }`.

| Tool | Extra parameters | Notes |
|---|---|---|
| `list_ministries` / `get_ministry` | `organization_id`, `search` | Alberta ministries and federal departments. |
| `list_programs` / `get_program` | `ministry_id`, `organization_id`, `search` | Funding programs. |
| `list_recipients` / `get_recipient` | `search`, `include_placeholders` | `search` is normalised, so accents, case and `&` don't matter. |
| `list_awards` | `current_only` | Newest first. Descriptions are trimmed to 300 characters. |
| `get_award` | | Full text. Federal agreements include an `amendments` history. |

## Aggregates

All aggregate tools are cached under the data version, so a repeated call is answered from cache
until the next import.

### `award_totals`
Count and value grouped by one dimension, highest total first.
`group_by` ∈ `organization`, `ministry`, `program`, `recipient`, `record_kind`, `agreement_type`,
`recipient_type`, `recipient_province`, `fiscal_year`. It also takes `filters`, `current_only`
(default true), `include_placeholders` (default: excluded only when grouping by recipient) and
`limit`.

### `recipient_funding`
One recipient across both governments. Identify it by `recipient_id` or `recipient_name`
(normalised exact match; an unknown name returns close matches). It takes optional
`fiscal_year_from` / `fiscal_year_to` and returns `by_organization`, `by_fiscal_year`,
`top_programs`, and `possible_variants`: other recipient names containing this one, which are
not included in the totals.

### `ministry_funding`
One ministry or department: `totals`, `by_fiscal_year`, `top_programs`, `top_recipients`
(placeholders excluded) and `placeholder_totals` (shown separately).

### `shared_recipients`
Recipients funded by more than one government in a period, with each government's amount side by
side. It takes `fiscal_year_from` / `fiscal_year_to`, `search` (name contains), `min_value_each`,
`order_by` (`"combined"` or an organization name) and `limit`. It matches exact normalised names
only.

## Flexible query

### `query`
A constrained, read-only ORM query builder over one allowed model: `organization`, `ministry`,
`program`, `recipient`, `award` or `fiscal_year`. There is no raw SQL. Every field, operator and
aggregation is validated against the allowlist.

**Parameters:** `model` (required), `filters`, `combine`, `group_by` (list of fields),
`aggregations` (`[{"func","field","alias?"}]`, func ∈ `count`/`sum`/`avg`/`min`/`max`; `sum` and
`avg` need numeric fields), `order_by` (group fields or aggregation aliases when grouping),
`fields` (columns for plain rows), `current_only` (award only, default true) and `limit`.

- **Aggregations without `group_by`** return a single totals object.
- **With `group_by`** it returns one row per group with the aggregations (default `count`).
- **With neither** it returns plain rows. Award rows omit `description` unless it is listed in
  `fields`.

## Errors

Invalid input raises a tool error with a message the model can act on, never partial data:

- An unknown or disallowed model lists the allowed models.
- A non-allowlisted field or relation path lists the allowed fields.
- A bad operator, or `sum`/`avg` on a non-numeric field, is rejected.
- An alias that is not an identifier, or that shadows a field, is rejected.
- Ordering a grouped result by a column that isn't a group key or alias is rejected.
- An unknown `recipient_name` returns the names that contain it.
