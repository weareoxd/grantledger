// Run after the Better Auth CLI (`npm run auth:generate`): it writes `pgTable(...)`, which would
// put its tables in `public`. Rewrites src/lib/db/auth-schema.ts to declare them on the app's own
// schema (src/lib/db/schema-name.ts), as the rest of the tables are.
import { readFileSync, writeFileSync } from "node:fs";

const file = "src/lib/db/auth-schema.ts";
let source = readFileSync(file, "utf8");
if (!source.includes("dbSchema.table(")) {
  source = source
    .replace(/import \{([^}]*)\} from "drizzle-orm\/pg-core";/, (_, names) => {
      const kept = names
        .split(",")
        .map((name) => name.trim())
        .filter((name) => name && name !== "pgTable");
      return `import { ${kept.join(", ")} } from "drizzle-orm/pg-core";\nimport { dbSchema } from "./schema-name";`;
    })
    .replaceAll("pgTable(", "dbSchema.table(");
  writeFileSync(file, source);
}
if (source.includes("pgTable(")) throw new Error(`${file} still declares tables with pgTable`);
