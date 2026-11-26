#!/usr/bin/env node
import { parseArgs } from "node:util";
import { load } from "./io.js";
import { analyzeScreens, ScreenOptions } from "./screens.js";
import { formatScreenReport } from "./screens-format.js";

const HELP = `dooh-screens - find the same DOOH screen sold through several SSPs, and compare supply paths

Usage:
  dooh-screens <file> [<file> ...] [options]
  cat bids.jsonl | dooh-screens - [options]

Input: DOOH bid requests from one or more SSPs (JSON array or JSON Lines). Each record can be a
plain bid request or a wrapper {"ssp": "...", "request": {...}}. Without a wrapper, the SSP is
the last node of source.schain, or the field given with --ssp-path.

Options:
  --radius <m>        Max distance in metres between listings of the same screen (default 50)
  --min-score <n>     Minimum match score 0-100 to merge listings (default 60)
  --ssp-path <path>   Dotted path in the request that names the SSP, e.g. ext.exchange
  --json              Print machine-readable JSON
  -h, --help          Show this help`;

function main(): number {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      radius: { type: "string" },
      "min-score": { type: "string" },
      "ssp-path": { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help || positionals.length === 0) {
    console.log(HELP);
    return values.help ? 0 : 2;
  }
  const opts: ScreenOptions = {};
  if (values.radius) opts.radiusM = Number(values.radius);
  if (values["min-score"]) opts.minScore = Number(values["min-score"]);
  if (values["ssp-path"]) opts.sspPath = values["ssp-path"];

  const records = positionals.flatMap((p) => load(p).map((r) => r.data));
  const report = analyzeScreens(records, opts);
  console.log(values.json ? JSON.stringify(report, null, 2) : formatScreenReport(report));
  return 0;
}

try {
  process.exitCode = main();
} catch (e) {
  console.error(`dooh-screens: ${(e as Error).message}`);
  process.exitCode = 2;
}
