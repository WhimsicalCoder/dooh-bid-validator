import { summarize } from "../src/format.js";
import { Report, validate, ValidateOptions } from "../src/index.js";
import { analyzeScreens, Cluster, Listing, ScreenOptions } from "../src/screens.js";
import screensSample from "../fixtures/screens/multi-ssp.jsonl";

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

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
const tabs = [$<HTMLButtonElement>("tab-check"), $<HTMLButtonElement>("tab-screens")];
function selectTab(tab: HTMLButtonElement) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute("aria-controls")!).hidden = !on;
  }
  history.replaceState(null, "", tab.id === "tab-screens" ? "#screens" : location.pathname + location.search);
}
tabs.forEach((t, i) => {
  t.addEventListener("click", () => selectTab(t));
  t.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    selectTab(next);
    next.focus();
  });
});
if (location.hash === "#screens") selectTab(tabs[1]);

// ---------------------------------------------------------------------------
// Screens across SSPs
// ---------------------------------------------------------------------------
const sInput = $<HTMLTextAreaElement>("s-input");
const sReport = $<HTMLDivElement>("s-report");
const sRadius = $<HTMLInputElement>("s-radius");
const sScore = $<HTMLInputElement>("s-score");

const fmt = (n: number | undefined, digits = 4) => (n === undefined ? "–" : n.toFixed(digits));

function pathCell(l: Listing): string {
  const p = l.paths[0];
  if (!p || p.hops === 0) return `<span class="route">no schain</span>`;
  const state = p.complete === 1 ? "complete" : `<strong style="color:var(--error)">incomplete</strong>`;
  const route = p.nodes.map((n) => `<span class="hop">${esc(n.asi)}</span>`).join(" → ");
  return `<span class="route">${route}</span><br><small>${p.hops} hop${p.hops === 1 ? "" : "s"}, ${state}</small>`;
}

function renderCluster(c: Cluster): string {
  const w = c.weakestMatch;
  const first = c.listings[0];
  const why = [`within ${Math.round(w.distanceM)} m`, `size ${w.size}`, `venue ${w.venue}`, w.publisher ? "same publisher domain" : "", w.name ? "similar name" : ""].filter(Boolean).join(" · ");
  return `
    <div class="cluster">
      <div class="cluster-head">
        <h4>${esc(first.name ?? first.screenId)}</h4>
        <span class="conf ${c.confidence}">${c.confidence} confidence · score ${w.score}</span>
        <span class="why">${esc(first.venue ?? "")}${first.venue ? " · " : ""}${esc(why)}</span>
      </div>
      <div class="scroll"><table>
        <thead><tr><th>SSP</th><th>Screen ID</th><th class="num">Multiplier</th><th class="num">Floor CPM</th><th class="num">Cost per play</th><th>Supply path</th></tr></thead>
        <tbody>${c.listings.map((l) => `
          <tr class="${l.key === c.bestListing ? "best" : ""}">
            <td>${l.key === c.bestListing ? "★ " : ""}${esc(l.ssp)}</td>
            <td>${esc(l.screenId)}</td>
            <td class="num">${l.multiplier ? esc(l.multiplier.median) : "–"}</td>
            <td class="num">${l.floor ? `${esc(l.floor.median)} ${esc(l.floor.currency)}` : "–"}</td>
            <td class="num">${fmt(l.costPerPlay)}</td>
            <td>${pathCell(l)}</td>
          </tr>`).join("")}
        </tbody>
      </table></div>
      ${c.flags.length ? `<ul class="flags">${c.flags.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
    </div>`;
}

function runScreens() {
  const { items, error } = parse(sInput.value);
  if (error) {
    sReport.innerHTML = `<div class="parse-error">${esc(error)}</div>`;
    return;
  }
  if (items.length === 0) {
    sReport.innerHTML = `<div class="empty">Nothing to analyze yet. Paste bid requests or load the sample batch.</div>`;
    return;
  }
  const opts: ScreenOptions = {};
  const radius = Number(sRadius.value);
  if (Number.isFinite(radius) && radius > 0) opts.radiusM = radius;
  const score = Number(sScore.value);
  if (Number.isFinite(score) && score > 0) opts.minScore = score;

  const r = analyzeScreens(items, opts);
  const s = r.summary;
  let html = `
    <div class="cards">
      <div class="card"><b>${s.requests}</b><span>requests</span></div>
      <div class="card"><b>${s.listings}</b><span>listings (SSP × screen ID)</span></div>
      <div class="card"><b>${s.screens}</b><span>physical screens (est.)</span></div>
      <div class="card"><b>${s.duplicateClusters}</b><span>sold by 2+ SSPs</span></div>
    </div>`;
  if (s.skipped) html += `<p class="note">Skipped ${s.skipped} record${s.skipped === 1 ? "" : "s"} that ${s.skipped === 1 ? "is" : "are"} not a DOOH bid request.</p>`;

  html += `<h3>By SSP</h3><div class="scroll"><table>
    <thead><tr><th>SSP</th><th class="num">Listings</th><th class="num">Also sold elsewhere</th><th class="num">Avg hops</th><th class="num">Incomplete chains</th></tr></thead>
    <tbody>${s.bySsp.map((b) => `<tr><td>${esc(b.ssp)}</td><td class="num">${b.listings}</td><td class="num">${b.duplicated}</td><td class="num">${b.avgHops ?? "–"}</td><td class="num">${b.incompleteChains}</td></tr>`).join("")}</tbody>
  </table></div>`;

  html += `<h3>Screens sold through more than one SSP</h3>`;
  html += r.clusters.length
    ? r.clusters.map(renderCluster).join("")
    : `<div class="all-clear">No screen appears under more than one SSP in this batch.</div>`;

  if (r.pathIssues.length) {
    html += `<h3>Supply path issues</h3><ul class="issues">` +
      r.pathIssues.map((p) => `<li class="issue warning"><div class="issue-top"><span class="rule">${esc(p.listing)}</span><span>${esc(p.issue)}</span></div></li>`).join("") +
      `</ul>`;
  }
  html += `<p class="note">★ = best path for that screen: complete supply chain first, then fewest hops, then lowest cost per play at floor. Matching is an estimate: check high-value matches before acting on them.</p>`;
  sReport.innerHTML = html;
}

$<HTMLButtonElement>("s-sample").addEventListener("click", () => {
  sInput.value = screensSample.trim();
  runScreens();
});
$<HTMLInputElement>("s-file").addEventListener("change", async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  sInput.value = await f.text();
  (e.target as HTMLInputElement).value = "";
  runScreens();
});
$<HTMLButtonElement>("s-run").addEventListener("click", runScreens);
$<HTMLButtonElement>("s-clear").addEventListener("click", () => {
  sInput.value = "";
  sReport.innerHTML = `<div class="empty">Paste bid requests from several SSPs, or load the sample batch, then press <strong>Find duplicates</strong>.</div>`;
  sInput.focus();
});
sInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    runScreens();
  }
});
for (const el of [sRadius, sScore]) el.addEventListener("change", () => sInput.value.trim() && runScreens());
