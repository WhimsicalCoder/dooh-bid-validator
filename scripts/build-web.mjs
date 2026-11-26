// Builds the browser page into docs/ (index.html + main.js), which GitHub Pages serves.
import { build } from "esbuild";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";

rmSync("docs", { recursive: true, force: true });
mkdirSync("docs");

await build({
  entryPoints: ["web/main.ts"],
  bundle: true,
  minify: false,
  legalComments: "none",
  format: "esm",
  target: "es2020",
  outfile: "docs/main.js",
  loader: { ".jsonl": "text" },
});
copyFileSync("web/index.html", "docs/index.html");
console.log("Built docs/index.html and docs/main.js");
