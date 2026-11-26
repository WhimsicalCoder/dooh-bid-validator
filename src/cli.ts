#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { formatReport, formatSummary, summarize } from "./format.js";
import { Report, validate, ValidateOptions } from "./index.js";

const HELP = `dooh-validate - check DOOH OpenRTB 2.6 bid requests from a buyer's point of view

Usage:
  dooh-validate <file> [<file> ...] [options]
  cat requests.jsonl | dooh-validate - [options]

Files can hold one bid request (.json), an array of requests (.json),
one request per line (.jsonl), or a Prebid Server test file (mockBidRequest).

Options:
  --summary            Print one summary for all requests instead of a report per request
  --json               Print machine-readable JSON
  --now <time>         Reference time for lead-time checks on imp.dt: "live" (current time),
                       an ISO date, or ms since epoch. Off by default (safe for old logs).
  --max-lead <min>     Warn when imp.dt is more than this many minutes ahead (default 120)
  --max-multiplier <n> Warn when qty.multiplier is above n (default 10000)
  --disable <ids>      Comma-separated rule IDs to skip, e.g. LOC-005,AUD-007
  --quiet              Hide info-level issues in text output
  -h, --help           Show this help

Exit code is 1 when any request has errors, so it can be used in CI.`;

function parseNow(v: string): number {
  if (v === "live") return Date.now();
  if (/^\d+$/.test(v)) return Number(v);
  const t = Date.parse(v);
  if (Number.isNaN(t)) throw new Error(`--now: cannot read "${v}" as a time`);
  return t;
}

function load(path: string): Array<{ label: string; data: unknown }> {
  const text = readFileSync(path === "-" ? 0 : path, "utf8").trim();
  const name = path === "-" ? "stdin" : path;
  if (text === "") return [];
  try {
    const data = JSON.parse(text);
    if (Array.isArray(data)) return data.map((d, i) => ({ label: `${name}[${i}]`, data: d }));
    return [{ label: name, data }];
  } catch {
    // Not one JSON document: treat as JSON Lines.
    return text.split(/\r?\n/).flatMap((line, i) => {
      if (line.trim() === "") return [];
      try {
        return [{ label: `${name}:${i + 1}`, data: JSON.parse(line) }];
      } catch {
        return [{ label: `${name}:${i + 1}`, data: undefined }];
      }
    });
  }
}

function main(): number {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      summary: { type: "boolean" },
      json: { type: "boolean" },
      now: { type: "string" },
      "max-lead": { type: "string" },
      "max-multiplier": { type: "string" },
      disable: { type: "string" },
      quiet: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help || positionals.length === 0) {
    console.log(HELP);
    return values.help ? 0 : 2;
  }

  const opts: ValidateOptions = {};
  if (values.now) opts.now = parseNow(values.now);
  if (values["max-lead"]) opts.maxLeadTimeMs = Number(values["max-lead"]) * 60000;
  if (values["max-multiplier"]) opts.maxMultiplier = Number(values["max-multiplier"]);
  if (values.disable) opts.disable = values.disable.split(",").map((s) => s.trim());

  const results: Array<{ label: string; report: Report }> = [];
  for (const path of positionals) {
    for (const { label, data } of load(path)) results.push({ label, report: validate(data, opts) });
  }

  const reports = results.map((r) => r.report);
  if (values.summary) {
    const s = summarize(reports);
    console.log(values.json ? JSON.stringify(s, null, 2) : formatSummary(s));
  } else if (values.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const { label, report } of results) {
      const shown = values.quiet
        ? { ...report, issues: report.issues.filter((i) => i.severity !== "info") }
        : report;
      console.log(formatReport(shown, label) + "\n");
    }
  }
  return reports.some((r) => !r.valid) ? 1 : 0;
}

try {
  process.exitCode = main();
} catch (e) {
  console.error(`dooh-validate: ${(e as Error).message}`);
  process.exitCode = 2;
}
