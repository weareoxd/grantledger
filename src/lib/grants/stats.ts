/** The dataset statistics the experiment write-up quotes, as a Markdown table. */
import { getPool } from "@/lib/db";
import { NOT_DISCLOSED, WITHHELD_INDIVIDUAL } from "@/lib/grants/normalize";

const money = (value: string | null) =>
  `$${(Number(value ?? 0) / 1e9).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}B`;
const count = (value: number | string) => Number(value).toLocaleString("en-US");

export async function datasetStats(): Promise<string> {
  const pool = getPool();
  const orgs = await pool.query<{ id: number; name: string }>(
    "SELECT id, name FROM organization ORDER BY name",
  );
  const lines: string[] = [];
  const header = [
    "Organization",
    "Rows",
    "Current rows",
    "Current value",
    "Start dates",
    "Ministries",
    "Programs",
    "Named recipients",
    "Withheld individuals",
    "Not disclosed",
    "Negative rows",
  ];
  lines.push(`| ${header.join(" | ")} |`, `|${"---|".repeat(header.length)}`);
  for (const org of orgs.rows) {
    const { rows } = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM award a JOIN ministry m ON m.id = a.ministry_id WHERE m.organization_id = $1) AS rows,
         COUNT(*) AS n, SUM(a.value) AS total_v, MIN(a.start_date) AS first, MAX(a.start_date) AS last,
         COUNT(*) FILTER (WHERE r.name = $2) AS withheld_n, SUM(a.value) FILTER (WHERE r.name = $2) AS withheld_v,
         COUNT(*) FILTER (WHERE r.name = $3) AS undisclosed_n, SUM(a.value) FILTER (WHERE r.name = $3) AS undisclosed_v,
         COUNT(*) FILTER (WHERE a.value < 0) AS negative_n,
         COUNT(DISTINCT a.recipient_id) FILTER (WHERE NOT r.is_placeholder) AS recipients,
         (SELECT COUNT(*) FROM ministry WHERE organization_id = $1) AS ministries,
         (SELECT COUNT(*) FROM program p JOIN ministry m ON m.id = p.ministry_id WHERE m.organization_id = $1) AS programs
       FROM award a JOIN ministry m ON m.id = a.ministry_id JOIN recipient r ON r.id = a.recipient_id
       WHERE m.organization_id = $1 AND a.is_current`,
      [org.id, WITHHELD_INDIVIDUAL, NOT_DISCLOSED],
    );
    const t = rows[0];
    const share = t.n ? ((Number(t.withheld_n) / Number(t.n)) * 100).toFixed(1) : "0.0";
    lines.push(
      `| ${[
        org.name,
        count(t.rows),
        count(t.n),
        money(t.total_v),
        `${t.first ?? "None"} to ${t.last ?? "None"}`,
        count(t.ministries),
        count(t.programs),
        count(t.recipients),
        `${count(t.withheld_n)} (${share}%), ${money(t.withheld_v)}`,
        `${count(t.undisclosed_n)}, ${money(t.undisclosed_v)}`,
        count(t.negative_n),
      ].join(" | ")} |`,
    );
  }
  const shared = await pool.query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM (
       SELECT a.recipient_id FROM award a JOIN ministry m ON m.id = a.ministry_id
         JOIN recipient r ON r.id = a.recipient_id
        WHERE a.is_current AND NOT r.is_placeholder
        GROUP BY a.recipient_id HAVING COUNT(DISTINCT m.organization_id) >= 2) s`,
  );
  const named = await pool.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM recipient WHERE NOT is_placeholder",
  );
  lines.push(
    "",
    `Recipients funded by both governments (exact normalised name, all years): ${count(shared.rows[0]?.n ?? 0)}`,
    `Recipients in total (named): ${count(named.rows[0]?.n ?? 0)}`,
  );
  return lines.join("\n");
}
