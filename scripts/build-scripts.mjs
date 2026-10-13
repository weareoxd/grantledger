// Bundles the worker and the CLI scripts into self-contained ESM files under dist/ so they run
// inside the production images, which ship no TypeScript and no node_modules for the worker.
import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  tsconfig: "tsconfig.json",
  outExtension: { ".js": ".mjs" },
  // pg's optional native binding is never installed.
  external: ["pg-native"],
  // Some bundled CommonJS dependencies call require(); give ESM output a working one.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  loader: { ".json": "json" },
  logLevel: "info",
};

await build({
  ...common,
  entryPoints: [
    "migrate",
    "seed-admin",
    "users",
    "import",
    "rollup",
    "stats",
    "mcp-call",
    "mcp-stdio",
  ].map((name) => `scripts/${name}.ts`),
  outdir: "dist/scripts",
});

await build({
  ...common,
  entryPoints: { index: "src/worker/index.ts" },
  outdir: "dist/worker",
});
