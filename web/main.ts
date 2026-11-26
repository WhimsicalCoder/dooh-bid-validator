import { summarize } from "../src/format.js";
import { Report, validate, ValidateOptions } from "../src/index.js";

import validBanner from "../fixtures/valid/banner-roadside.json";
import validVideo from "../fixtures/valid/video-venue-id.json";
import legacyFields from "../fixtures/invalid/legacy-field-names.json";
import nullIsland from "../fixtures/invalid/null-island.json";
import iabVideo from "../fixtures/upstream/iab-ortb26-example-video.json";
import iabBanner from "../fixtures/upstream/iab-ortb26-example-banner.json";
import prebidDooh from "../fixtures/upstream/prebid-server-dooh.json";

const SAMPLES: Array<{ label: string; data: unknown }> = [
  { label: "Complete banner request (passes)", data: validBanner },
  { label: "Complete video request (passes)", data: validVideo },
  { label: "IAB OpenRTB 2.6 example: video", data: iabVideo },
  { label: "IAB OpenRTB 2.6 example: banner", data: iabBanner },
  { label: "Prebid Server test request", data: (prebidDooh as any).mockBidRequest },
  { label: "Old field names (venuetax, geo.long)", data: legacyFields },
  { label: "Placeholder location (0,0)", data: nullIsland },
];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLTextAreaElement>("input");
const report = $<HTMLDivElement>("report");
const sample = $<HTMLSelectElement>("sample");
const optNow = $<HTMLInputElement>("opt-now");
const optMult = $<HTMLInputElement>("opt-mult");

SAMPLES.forEach((s, i) => {
  const o = document.createElement("option");
  o.value = String(i);
  o.textContent = s.label;
  sample.append(o);
});

const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Parse one JSON document, or fall back to JSON Lines. */
function parse(text: string): { items: unknown[]; error?: string } {
  const t = text.trim();
  if (!t) return { items: [] };
  try {
    const d = JSON.parse(t);
    return { items: Array.isArray(d) && d.length > 0 && typeof d[0] === "object" ? d : [d] };
  } catch (e) {
    const lines = t.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (lines.length > 1) {
      const items: unknown[] = [];
      for (let i = 0; i < lines.length; i++) {
        try {
          items.push(JSON.parse(lines[i]));
        } catch {
          return { items: [], error: `Line ${i + 1} is not valid JSON.\n\n${(e as Error).message}` };
        }
      }
      return { items };
    }
    return { items: [], error: `This is not valid JSON.\n\n${(e as Error).message}` };
  }
}

function scoreClass(score: number) {
  return score >= 80 ? "good" : score >= 50 ? "mid" : "bad";
}

function renderOne(r: Report): string {
  const { error, warning, info } = r.counts;
  let html = `
    <div class="summary">
      <div class="score ${scoreClass(r.score)}" role="img" aria-label="Score ${r.score} out of 100"><div>${r.score}<small>/100</small></div></div>
      <div>
        <div class="verdict ${r.valid ? "valid" : "invalid"}">${r.valid ? "Valid" : "Invalid"}</div>
        <div class="counts">
          <span class="pill error">${error} error${error === 1 ? "" : "s"}</span>
          <span class="pill warning">${warning} warning${warning === 1 ? "" : "s"}</span>
          <span class="pill info">${info} info</span>
        </div>
      </div>
    </div>`;

  if (r.issues.length === 0) {
    html += `<div class="all-clear">No issues found. A buyer has everything needed to price this screen.</div>`;
  } else {
    html += `<ul class="issues">` + r.issues.map((i) => `
      <li class="issue ${i.severity}">
        <div class="issue-top"><span class="rule">${esc(i.ruleId)}</span><span>${esc(i.message)}</span></div>
        <div class="meta"><span>at <code>${esc(i.path)}</code></span><span>${esc(i.ref)}</span></div>
      </li>`).join("") + `</ul>`;
  }

  const priced = r.metrics.imps.filter((m) => m.costPerPlayAtFloor !== undefined);
  if (priced.length > 0) {
    html += `<h3>Cost per play at floor</h3>
      <table><thead><tr><th>Imp</th><th class="num">Floor CPM</th><th class="num">Multiplier</th><th class="num">Cost per play</th></tr></thead><tbody>` +
      priced.map((m) => `<tr><td>${esc(m.impId ?? "?")}</td><td class="num">${esc(m.bidfloor)} ${esc(m.bidfloorcur)}</td><td class="num">${esc(m.multiplier)}</td><td class="num">${m.costPerPlayAtFloor!.toFixed(5)} ${esc(m.bidfloorcur)}</td></tr>`).join("") +
      `</tbody></table>`;
  }
  return html;
}

function renderMany(reports: Report[]): string {
  const s = summarize(reports);
  let html = `
    <div class="summary">
      <div class="score ${scoreClass(s.averageScore)}" role="img" aria-label="Average score ${s.averageScore}"><div>${Math.round(s.averageScore)}<small>avg</small></div></div>
      <div>
        <div class="verdict ${s.valid === s.requests ? "valid" : "invalid"}">${s.valid} of ${s.requests} requests valid</div>
        <div class="counts"><span class="pill info">${s.byRule.length} different rules triggered</span></div>
      </div>
    </div>`;
  if (s.byRule.length > 0) {
    html += `<h3>How often each problem appears</h3>
      <table><thead><tr><th>Rule</th><th>Severity</th><th class="num">Requests</th><th class="num">Share</th></tr></thead><tbody>` +
      s.byRule.map((r) => `<tr><td><span class="tag">${esc(r.ruleId)}</span></td><td><span class="pill ${r.severity}">${r.severity}</span></td><td class="num">${r.requests}</td><td class="num">${r.percent}%</td></tr>`).join("") +
      `</tbody></table>`;
  }
  html += `<h3>Each request</h3>` + reports.map((r, i) => `
    <details class="req">
      <summary><span class="tag ${r.valid ? "valid" : "invalid"}">${r.valid ? "VALID" : "INVALID"}</span> Request ${i + 1} · score ${r.score}</summary>
      <div>${renderOne(r)}</div>
    </details>`).join("");
  return html;
}

function run() {
  const { items, error } = parse(input.value);
  if (error) {
    report.innerHTML = `<div class="parse-error">${esc(error)}</div>`;
    return;
  }
  if (items.length === 0) {
    report.innerHTML = `<div class="empty">Nothing to check yet. Paste a bid request or load a sample.</div>`;
    return;
  }
  const opts: ValidateOptions = {};
  if (optNow.checked) opts.now = Date.now();
  const mult = Number(optMult.value);
  if (Number.isFinite(mult) && mult > 0) opts.maxMultiplier = mult;

  const reports = items.map((it) => validate(it, opts));
  report.innerHTML = reports.length === 1 ? renderOne(reports[0]) : renderMany(reports);
}

sample.addEventListener("change", () => {
  const s = SAMPLES[Number(sample.value)];
  if (!s) return;
  input.value = JSON.stringify(s.data, null, 2);
  sample.value = "";
  run();
});

$<HTMLInputElement>("file").addEventListener("change", async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  input.value = await f.text();
  (e.target as HTMLInputElement).value = "";
  run();
});

$<HTMLButtonElement>("run").addEventListener("click", run);
$<HTMLButtonElement>("clear").addEventListener("click", () => {
  input.value = "";
  report.innerHTML = `<div class="empty">Paste a bid request or load a sample, then press <strong>Validate</strong>.</div>`;
  input.focus();
});
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    run();
  }
});
optNow.addEventListener("change", () => input.value.trim() && run());
optMult.addEventListener("change", () => input.value.trim() && run());
