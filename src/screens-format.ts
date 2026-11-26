import { Listing, ScreenReport } from "./screens.js";

const money = (n: number | undefined, cur = "USD") => (n === undefined ? "-" : `${n.toFixed(4)} ${cur}`);
const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n - 1) + "…" : s.padEnd(n));

function listingLine(l: Listing, best: boolean): string {
  const p = l.paths[0];
  const route = p ? `${p.route}${p.hops ? ` (${p.hops} hop${p.hops === 1 ? "" : "s"}${p.complete === 1 ? ", complete" : ", INCOMPLETE"})` : ""}` : "-";
  const mult = l.multiplier ? String(l.multiplier.median) : "-";
  const floor = l.floor ? `${l.floor.median} ${l.floor.currency}` : "-";
  return `  ${best ? "★" : " "} ${pad(l.ssp, 18)}${pad(l.screenId, 14)}${pad(mult, 8)}${pad(floor, 12)}${pad(money(l.costPerPlay, l.floor?.currency), 16)}${route}`;
}

export function formatScreenReport(r: ScreenReport): string {
  const s = r.summary;
  const out: string[] = [];
  out.push(`${s.requests} requests → ${s.listings} listings → about ${s.screens} physical screens`);
  out.push(`${s.duplicateClusters} screens are sold through more than one SSP (${s.duplicateShare}% of listings are duplicates).${s.skipped ? ` Skipped ${s.skipped} non-DOOH or unreadable record${s.skipped === 1 ? "" : "s"}.` : ""}`);
  out.push("");
  out.push("SSP                 Listings  Duplicated  Avg hops  Incomplete chains");
  for (const b of s.bySsp) {
    out.push(`${pad(b.ssp, 20)}${String(b.listings).padStart(8)}${String(b.duplicated).padStart(12)}${String(b.avgHops ?? "-").padStart(10)}${String(b.incompleteChains).padStart(19)}`);
  }

  for (const c of r.clusters) {
    const w = c.weakestMatch;
    const first = c.listings[0];
    out.push("");
    out.push(`Screen ${c.id}: ${first.name ?? first.screenId}  [${c.confidence} confidence, score ${w.score}]`);
    out.push(`  Match: within ${Math.round(w.distanceM)} m, size ${w.size}, venue ${w.venue}${w.publisher ? ", same publisher domain" : ""}${w.name ? ", similar name" : ""}`);
    out.push(`    ${pad("SSP", 18)}${pad("Screen ID", 14)}${pad("Mult.", 8)}${pad("Floor", 12)}${pad("Cost/play", 16)}Path`);
    for (const l of c.listings) out.push(listingLine(l, l.key === c.bestListing));
    for (const f of c.flags) out.push(`  ▲ ${f}`);
  }

  if (r.pathIssues.length) {
    out.push("");
    out.push("Supply path issues");
    for (const p of r.pathIssues) out.push(`  ▲ ${p.listing}: ${p.issue}`);
  }
  out.push("");
  out.push("★ = best path for that screen: complete supply chain first, then fewest hops, then lowest cost per play.");
  return out.join("\n");
}
