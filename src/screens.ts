/**
 * Screen deduplication and supply-path analysis.
 *
 * The same physical DOOH screen is often sold through several SSPs, each with its own
 * screen ID. This module groups bid requests into listings (one per SSP per screen ID),
 * matches listings across SSPs that describe the same physical screen, and compares the
 * supply paths, audience multipliers and floors each SSP offers for it.
 */
import { OPENOOH_1_1 } from "./data/venues.js";
import { imps, isNonEmptyStr, isNum, isObj, unwrap } from "./util.js";

export interface ScreenOptions {
  /** Max distance in metres for two listings to count as the same screen. Default 50. */
  radiusM?: number;
  /** Minimum match score (0-100) to merge two listings. Default 60. */
  minScore?: number;
  /** Dotted path in the bid request to read the SSP name from, e.g. "ext.exchange". */
  sspPath?: string;
}

export interface Hop {
  asi: string;
  sid: string;
  hp?: number;
}

export interface PathInfo {
  /** e.g. "ssp-b.example → reseller.example" */
  route: string;
  nodes: Hop[];
  hops: number;
  /** schain.complete: 1 = full chain back to the publisher, 0 = partial, undefined = missing. */
  complete: number | undefined;
  requests: number;
}

export interface Listing {
  key: string;
  ssp: string;
  screenId: string;
  name?: string;
  publisherId?: string;
  publisherDomain?: string;
  lat?: number;
  lon?: number;
  w?: number;
  h?: number;
  /** OpenOOH venue name when it can be resolved, otherwise the raw value. */
  venue?: string;
  requests: number;
  multiplier?: { min: number; median: number; max: number };
  floor?: { median: number; currency: string };
  /** Median floor CPM / 1000 × median multiplier. */
  costPerPlay?: number;
  /** Paths seen for this listing, most common first. */
  paths: PathInfo[];
}

export interface MatchReason {
  distanceM: number;
  size: "same" | "same-shape" | "unknown";
  venue: "same" | "same-parent" | "unknown";
  publisher: boolean;
  name: boolean;
}

export interface Cluster {
  id: number;
  /** "high" or "medium" confidence that these listings are one physical screen. */
  confidence: "high" | "medium";
  listings: Listing[];
  /** Pairwise evidence for the weakest link that joined the cluster. */
  weakestMatch: MatchReason & { score: number };
  /** Key of the listing with the best supply path (complete chain, fewest hops, cheapest play). */
  bestListing: string;
  flags: string[];
}

export interface ScreenReport {
  summary: {
    requests: number;
    skipped: number;
    listings: number;
    /** Estimated distinct physical screens after merging duplicates. */
    screens: number;
    duplicateClusters: number;
    /** Share of listings that belong to a duplicate cluster. */
    duplicateShare: number;
    bySsp: Array<{ ssp: string; listings: number; duplicated: number; avgHops: number | null; incompleteChains: number }>;
  };
  clusters: Cluster[];
  /** Listings that are not part of any duplicate cluster. */
  singles: Listing[];
  /** Supply-path problems on any listing (incomplete or missing chain, long paths). */
  pathIssues: Array<{ listing: string; issue: string }>;
}

const VENUE_BY_ID = new Map(OPENOOH_1_1.map((v) => [String(v.id), v.name]));

const get = (obj: any, path: string): any =>
  path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Great-circle distance in metres. */
export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const tokens = (s: string) =>
  new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1));

/** Jaccard similarity of word tokens, 0-1. */
export function nameSimilarity(a?: string, b?: string): number {
  if (!a || !b) return 0;
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

const normDomain = (d?: string) => (d ? d.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "") : undefined);

function venueOf(dooh: any): string | undefined {
  const v = Array.isArray(dooh?.venuetype) ? dooh.venuetype[0] : dooh?.venuetypeid ?? dooh?.venuetype;
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return VENUE_BY_ID.get(s) ?? s.toLowerCase();
}

/** Accepts a bid request, a Prebid test file, or a wrapper like { ssp, request }. */
function readRecord(input: any, sspPath?: string): { req: any; ssp: string } | undefined {
  let req = input;
  let ssp: string | undefined;
  if (isObj(input) && (isObj(input.request) || isObj(input.bidRequest))) {
    req = input.request ?? input.bidRequest;
    if (isNonEmptyStr(input.ssp)) ssp = input.ssp;
    else if (isNonEmptyStr(input.exchange)) ssp = input.exchange;
  }
  req = unwrap(req);
  if (!isObj(req) || !isObj(req.dooh)) return undefined;
  if (!ssp && sspPath) {
    const v = get(req, sspPath);
    if (isNonEmptyStr(v)) ssp = v;
  }
  if (!ssp) {
    const nodes = req.source?.schain?.nodes ?? req.source?.ext?.schain?.nodes;
    const last = Array.isArray(nodes) ? nodes[nodes.length - 1] : undefined;
    if (isNonEmptyStr(last?.asi)) ssp = last.asi;
  }
  return { req, ssp: (ssp ?? "unknown").toLowerCase() };
}

interface Acc {
  listing: Omit<Listing, "multiplier" | "floor" | "costPerPlay" | "paths">;
  multipliers: number[];
  floors: number[];
  currency?: string;
  paths: Map<string, PathInfo>;
}

function buildListings(records: unknown[], opts: ScreenOptions): { listings: Listing[]; skipped: number } {
  const accs = new Map<string, Acc>();
  let skipped = 0;

  for (const rec of records) {
    const r = readRecord(rec, opts.sspPath);
    if (!r) {
      skipped++;
      continue;
    }
    const { req, ssp } = r;
    const dooh = req.dooh;
    const geo = req.device?.geo ?? {};
    const lat = isNum(geo.lat) ? geo.lat : undefined;
    const lon = isNum(geo.lon) ? geo.lon : isNum(geo.long) ? geo.long : undefined;
    const w = isNum(req.device?.w) ? req.device.w : undefined;
    const h = isNum(req.device?.h) ? req.device.h : undefined;
    const screenId: string =
      (isNonEmptyStr(dooh.id) && dooh.id) ||
      (isNonEmptyStr(req.device?.ifa) && req.device.ifa) ||
      (isNonEmptyStr(dooh.name) && dooh.name) ||
      (lat !== undefined && lon !== undefined ? `${lat.toFixed(5)},${lon.toFixed(5)},${w ?? "?"}x${h ?? "?"}` : "");
    if (!screenId) {
      skipped++;
      continue;
    }

    const key = `${ssp}|${screenId}`;
    let acc = accs.get(key);
    if (!acc) {
      acc = {
        listing: {
          key,
          ssp,
          screenId,
          name: isNonEmptyStr(dooh.name) ? dooh.name : undefined,
          publisherId: isNonEmptyStr(dooh.publisher?.id) ? dooh.publisher.id : undefined,
          publisherDomain: normDomain(dooh.publisher?.domain ?? dooh.domain),
          lat,
          lon,
          w,
          h,
          venue: venueOf(dooh),
          requests: 0,
        },
        multipliers: [],
        floors: [],
        paths: new Map(),
      };
      accs.set(key, acc);
    }
    acc.listing.requests++;

    for (const imp of imps(req)) {
      if (!isObj(imp)) continue;
      if (isNum(imp.qty?.multiplier) && imp.qty.multiplier > 0) acc.multipliers.push(imp.qty.multiplier);
      if (isNum(imp.bidfloor)) {
        acc.floors.push(imp.bidfloor);
        acc.currency ??= isNonEmptyStr(imp.bidfloorcur) ? imp.bidfloorcur : "USD";
      }
    }

    const schain = req.source?.schain ?? req.source?.ext?.schain;
    const nodes: Hop[] = Array.isArray(schain?.nodes)
      ? schain.nodes.filter(isObj).map((n: any) => ({ asi: String(n.asi ?? "?"), sid: String(n.sid ?? "?"), hp: isNum(n.hp) ? n.hp : undefined }))
      : [];
    const route = nodes.length ? nodes.map((n) => n.asi).join(" → ") : "(no schain)";
    const complete = isNum(schain?.complete) ? schain.complete : undefined;
    const pk = `${route}|${complete}`;
    const p = acc.paths.get(pk) ?? { route, nodes, hops: nodes.length, complete, requests: 0 };
    p.requests++;
    acc.paths.set(pk, p);
  }

  const listings: Listing[] = [...accs.values()].map((a) => {
    const multiplier = a.multipliers.length
      ? { min: Math.min(...a.multipliers), median: median(a.multipliers), max: Math.max(...a.multipliers) }
      : undefined;
    const floor = a.floors.length ? { median: median(a.floors), currency: a.currency ?? "USD" } : undefined;
    return {
      ...a.listing,
      multiplier,
      floor,
      costPerPlay: multiplier && floor ? (floor.median / 1000) * multiplier.median : undefined,
      paths: [...a.paths.values()].sort((x, y) => y.requests - x.requests),
    };
  });
  return { listings, skipped };
}

/** How strongly two listings look like the same physical screen. undefined = ruled out. */
export function matchScore(a: Listing, b: Listing, radiusM = 50): (MatchReason & { score: number }) | undefined {
  if (a.lat === undefined || a.lon === undefined || b.lat === undefined || b.lon === undefined) return undefined;
  const distanceM = haversineM(a.lat, a.lon, b.lat, b.lon);
  if (distanceM > radiusM) return undefined;

  let score = distanceM <= 10 ? 40 : distanceM <= 25 ? 30 : 20;

  let size: MatchReason["size"] = "unknown";
  if (a.w && a.h && b.w && b.h) {
    if (a.w === b.w && a.h === b.h) size = "same";
    else if (Math.abs(a.w / a.h - b.w / b.h) / (b.w / b.h) <= 0.02) size = "same-shape";
    else return undefined; // different shape: another face or another screen
  }
  score += size === "same" ? 30 : size === "same-shape" ? 15 : 5;

  let venue: MatchReason["venue"] = "unknown";
  if (a.venue && b.venue) {
    if (a.venue === b.venue) venue = "same";
    else if (a.venue.split(".")[0] === b.venue.split(".")[0]) venue = "same-parent";
    else return undefined; // an airport screen is not a gym screen
  }
  score += venue === "same" ? 10 : venue === "same-parent" ? 5 : 0;

  const publisher = !!a.publisherDomain && a.publisherDomain === b.publisherDomain;
  if (publisher) score += 15;

  const sim = nameSimilarity(a.name, b.name);
  const name = sim >= 0.5;
  if (sim >= 0.3) score += Math.round(sim * 10); // also breaks ties between neighbouring screens

  return { distanceM, size, venue, publisher, name, score: Math.min(100, score) };
}

/** Rank listings by supply path quality: complete chain, fewer hops, cheaper play. */
function pathRank(l: Listing): [number, number, number] {
  const p = l.paths[0];
  return [p?.complete === 1 ? 0 : 1, p ? (p.hops || 99) : 99, l.costPerPlay ?? Number.POSITIVE_INFINITY];
}

const cmpRank = (a: Listing, b: Listing) => {
  const ra = pathRank(a);
  const rb = pathRank(b);
  return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2];
};

export function analyzeScreens(records: unknown[], opts: ScreenOptions = {}): ScreenReport {
  const radiusM = opts.radiusM ?? 50;
  const minScore = opts.minScore ?? 60;
  const { listings, skipped } = buildListings(records, opts);

  // Candidate pairs across different SSPs, strongest first.
  const pairs: Array<{ i: number; j: number; m: MatchReason & { score: number } }> = [];
  for (let i = 0; i < listings.length; i++) {
    for (let j = i + 1; j < listings.length; j++) {
      if (listings[i].ssp === listings[j].ssp) continue; // an SSP is assumed to know its own screens
      const m = matchScore(listings[i], listings[j], radiusM);
      if (m && m.score >= minScore) pairs.push({ i, j, m });
    }
  }
  pairs.sort((a, b) => b.m.score - a.m.score || a.m.distanceM - b.m.distanceM);

  // Greedy union-find; a cluster may hold at most one listing per SSP.
  const parent = listings.map((_, i) => i);
  const ssps = listings.map((l) => new Set([l.ssp]));
  const weakest = new Map<number, MatchReason & { score: number }>();
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (const { i, j, m } of pairs) {
    const ri = find(i);
    const rj = find(j);
    if (ri === rj) continue;
    if ([...ssps[ri]].some((s) => ssps[rj].has(s))) continue;
    parent[rj] = ri;
    for (const s of ssps[rj]) ssps[ri].add(s);
    const w = [weakest.get(ri), weakest.get(rj), m].filter(Boolean) as Array<MatchReason & { score: number }>;
    weakest.set(ri, w.reduce((a, b) => (b.score < a.score ? b : a)));
  }

  const groups = new Map<number, Listing[]>();
  listings.forEach((l, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), l]);
  });

  const clusters: Cluster[] = [];
  const singles: Listing[] = [];
  for (const [root, ls] of groups) {
    if (ls.length < 2) {
      singles.push(ls[0]);
      continue;
    }
    ls.sort(cmpRank);
    const best = ls[0];
    const w = weakest.get(root)!;
    const flags: string[] = [];

    const mults = ls.map((l) => l.multiplier?.median).filter(isNum);
    if (mults.length >= 2 && Math.min(...mults) > 0) {
      const ratio = Math.max(...mults) / Math.min(...mults);
      if (ratio > 1.2) {
        flags.push(`Audience multiplier differs by ${Math.round((ratio - 1) * 100)}% between SSPs (${Math.min(...mults)} to ${Math.max(...mults)}) for what looks like the same screen.`);
      }
    }
    const floors = ls.map((l) => l.floor?.median).filter(isNum);
    if (floors.length >= 2 && Math.min(...floors) > 0) {
      const ratio = Math.max(...floors) / Math.min(...floors);
      if (ratio > 1.2) flags.push(`Floor CPM differs by ${Math.round((ratio - 1) * 100)}% between SSPs (${Math.min(...floors)} to ${Math.max(...floors)}).`);
    }
    const costs = ls.map((l) => l.costPerPlay).filter(isNum);
    if (costs.length >= 2 && Math.min(...costs) > 0) {
      const ratio = Math.max(...costs) / Math.min(...costs);
      if (ratio > 1.2) flags.push(`Cost per play at floor differs by ${Math.round((ratio - 1) * 100)}% depending on which SSP you buy through.`);
    }
    const bestHops = best.paths[0]?.hops ?? 0;
    for (const l of ls.slice(1)) {
      const h = l.paths[0]?.hops ?? 0;
      if (h > bestHops && bestHops > 0) flags.push(`${l.ssp} adds ${h - bestHops} extra hop${h - bestHops === 1 ? "" : "s"} compared with ${best.ssp}.`);
    }

    clusters.push({
      id: 0,
      confidence: w.score >= 85 ? "high" : "medium",
      listings: ls,
      weakestMatch: w,
      bestListing: best.key,
      flags,
    });
  }
  clusters.sort((a, b) => b.listings.length - a.listings.length || (a.confidence === b.confidence ? 0 : a.confidence === "high" ? -1 : 1));
  clusters.forEach((c, i) => (c.id = i + 1));

  const pathIssues: ScreenReport["pathIssues"] = [];
  for (const l of listings) {
    const p = l.paths[0];
    if (!p || p.hops === 0) pathIssues.push({ listing: l.key, issue: "No supply chain (source.schain) in the request, so the path to the media owner can't be checked." });
    else {
      if (p.complete !== 1) pathIssues.push({ listing: l.key, issue: `Supply chain is incomplete (schain.complete = ${p.complete ?? "missing"}). Some sellers in the path are not listed.` });
      if (p.hops >= 3) pathIssues.push({ listing: l.key, issue: `Long path: ${p.hops} hops (${p.route}).` });
    }
  }

  const inCluster = new Set(clusters.flatMap((c) => c.listings.map((l) => l.key)));
  const sspNames = [...new Set(listings.map((l) => l.ssp))].sort();
  const bySsp = sspNames.map((ssp) => {
    const ls = listings.filter((l) => l.ssp === ssp);
    const hops = ls.map((l) => l.paths[0]?.hops).filter((h): h is number => isNum(h) && h > 0);
    return {
      ssp,
      listings: ls.length,
      duplicated: ls.filter((l) => inCluster.has(l.key)).length,
      avgHops: hops.length ? Math.round((hops.reduce((a, b) => a + b, 0) / hops.length) * 10) / 10 : null,
      incompleteChains: ls.filter((l) => l.paths[0] && l.paths[0].hops > 0 && l.paths[0].complete !== 1).length,
    };
  });

  return {
    summary: {
      requests: records.length,
      skipped,
      listings: listings.length,
      screens: singles.length + clusters.length,
      duplicateClusters: clusters.length,
      duplicateShare: listings.length ? Math.round((inCluster.size / listings.length) * 1000) / 10 : 0,
      bySsp,
    },
    clusters,
    singles,
    pathIssues,
  };
}
