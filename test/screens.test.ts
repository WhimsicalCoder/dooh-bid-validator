import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { analyzeScreens, haversineM, Listing, matchScore, nameSimilarity } from "../src/screens.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const FIXTURE = join(ROOT, "fixtures/screens/multi-ssp.jsonl");
const records = () => readFileSync(FIXTURE, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const keys = (ls: Listing[]) => ls.map((l) => l.key).sort();

test("fixture: listings, screens and clusters", () => {
  const r = analyzeScreens(records());
  assert.equal(r.summary.requests, 15);
  assert.equal(r.summary.skipped, 1); // the site request
  assert.equal(r.summary.listings, 12);
  assert.equal(r.summary.duplicateClusters, 3);
  assert.equal(r.summary.screens, 8);
});

test("the billboard sold by three SSPs becomes one screen, with the right best path", () => {
  const r = analyzeScreens(records());
  const c = r.clusters.find((c) => c.listings.some((l) => l.screenId === "A-4471"))!;
  assert.deepEqual(keys(c.listings), ["ssp-a.example|A-4471", "ssp-b.example|B-99812", "ssp-c.example|C-0042"]);
  assert.equal(c.confidence, "high");
  assert.equal(c.bestListing, "ssp-a.example|A-4471"); // complete chain, 1 hop
  assert.ok(c.flags.some((f) => f.includes("multiplier differs by 44%")));
  assert.ok(c.flags.some((f) => f.includes("extra hop")));
  const a = c.listings.find((l) => l.screenId === "A-4471")!;
  assert.equal(a.requests, 3);
  assert.deepEqual(a.multiplier, { min: 12, median: 12.5, max: 13 });
  assert.equal(a.costPerPlay, (6 / 1000) * 12.5);
});

test("the other face of the billboard (different shape) stays a separate screen", () => {
  const r = analyzeScreens(records());
  const back = r.clusters.find((c) => c.listings.some((l) => l.screenId === "A-4472"))!;
  assert.deepEqual(keys(back.listings), ["ssp-a.example|A-4472", "ssp-b.example|B-99813"]);
});

test("different venue families at the same spot are not merged", () => {
  const r = analyzeScreens(records());
  const singles = keys(r.singles);
  assert.ok(singles.includes("ssp-a.example|A-9001"));
  assert.ok(singles.includes("ssp-b.example|B-5550"));
});

test("neighbouring screens on one SSP: the matching name wins, and one SSP never appears twice in a screen", () => {
  const r = analyzeScreens(records());
  const mall = r.clusters.find((c) => c.listings.some((l) => l.screenId === "B-MALL-X"))!;
  assert.deepEqual(keys(mall.listings), ["ssp-a.example|A-MALL-1", "ssp-b.example|B-MALL-X"]);
  for (const c of r.clusters) {
    const ssps = c.listings.map((l) => l.ssp);
    assert.equal(new Set(ssps).size, ssps.length);
  }
});

test("same name in another city is not merged", () => {
  const r = analyzeScreens(records());
  assert.ok(keys(r.singles).includes("ssp-b.example|B-12000"));
});

test("SSP comes from the wrapper, then --ssp-path, then the last schain node", () => {
  const r = analyzeScreens(records());
  assert.ok(r.singles.some((l) => l.key === "ssp-c.example|C-7781")); // wrapper, no schain
  const req = { id: "x", ext: { exchange: "Custom-SSP" }, dooh: { id: "S1" }, imp: [{ id: "1" }], device: { geo: { lat: 1.5, lon: 2.5 } } };
  assert.equal(analyzeScreens([req], { sspPath: "ext.exchange" }).singles[0].ssp, "custom-ssp");
  assert.equal(analyzeScreens([req]).singles[0].ssp, "unknown");
});

test("supply path issues: incomplete and missing chains", () => {
  const r = analyzeScreens(records());
  const issues = Object.fromEntries(r.pathIssues.map((p) => [p.listing, p.issue]));
  assert.match(issues["ssp-c.example|C-0042"], /incomplete/);
  assert.match(issues["ssp-b.example|B-MALL-X"], /No supply chain/);
});

test("radius option controls how far apart listings may be", () => {
  // A-4471 and C-0042 are about 6.5 m apart; with a 5 m radius C drops out of the cluster.
  const r = analyzeScreens(records(), { radiusM: 5 });
  const c = r.clusters.find((c) => c.listings.some((l) => l.screenId === "A-4471"))!;
  assert.deepEqual(keys(c.listings), ["ssp-a.example|A-4471", "ssp-b.example|B-99812"]);
});

test("helpers: distance and name similarity", () => {
  // 0.001 degrees of latitude is about 111 m.
  assert.ok(Math.abs(haversineM(42, -83, 42.001, -83) - 111.2) < 0.5);
  assert.equal(nameSimilarity("Somerset Mall North", "somerset mall north"), 1);
  assert.equal(nameSimilarity(undefined, "x"), 0);
  const base: Listing = { key: "a|1", ssp: "a", screenId: "1", lat: 42, lon: -83, w: 1080, h: 1920, requests: 1, paths: [] };
  assert.equal(matchScore(base, { ...base, key: "b|1", ssp: "b", w: 1920, h: 1080 }), undefined); // different shape
  assert.equal(matchScore(base, { ...base, key: "b|1", ssp: "b", lat: 42.001 }), undefined); // 111 m away
  assert.equal(matchScore(base, { ...base, key: "b|1", ssp: "b", w: 540, h: 960 })?.size, "same-shape");
});

test("CLI prints a report and JSON", () => {
  const cli = join(ROOT, "dist/src/screens-cli.js");
  const text = execFileSync("node", [cli, FIXTURE], { encoding: "utf8" });
  assert.match(text, /about 8 physical screens/);
  assert.match(text, /Screen 1: Woodward Ave Northbound Digital/);
  const json = JSON.parse(execFileSync("node", [cli, FIXTURE, "--json"], { encoding: "utf8" }));
  assert.equal(json.summary.duplicateClusters, 3);
});
