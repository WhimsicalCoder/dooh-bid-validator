import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { summarize } from "../src/format.js";
import { validate } from "../src/index.js";

// Compiled tests run from dist/test, so the project root is two levels up.
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const FIX = join(ROOT, "fixtures");
const load = (p: string) => JSON.parse(readFileSync(join(FIX, p), "utf8"));
const ruleIds = (r: ReturnType<typeof validate>, includeInfo = false) =>
  [...new Set(r.issues.filter((i) => includeInfo || i.severity !== "info").map((i) => i.ruleId))].sort();

const base = () => load("valid/banner-roadside.json");

test("valid fixtures pass with a perfect score", () => {
  for (const f of readdirSync(join(FIX, "valid"))) {
    const r = validate(load(`valid/${f}`));
    assert.equal(r.valid, true, f);
    assert.equal(r.score, 100, f);
    assert.deepEqual(r.issues, [], f);
  }
});

test("each invalid fixture triggers exactly the expected rules", () => {
  const expected: Record<string, string[]> = load("invalid/expected.json");
  const files = readdirSync(join(FIX, "invalid")).filter((f) => f !== "expected.json");
  assert.equal(files.length, Object.keys(expected).length, "every invalid fixture needs an entry in expected.json");
  for (const [name, rules] of Object.entries(expected)) {
    const r = validate(load(`invalid/${name}.json`));
    assert.deepEqual(ruleIds(r), [...rules].sort(), name);
  }
});

test("catches the problems in the IAB's own DOOH example requests", () => {
  const banner = validate(load("upstream/iab-ortb26-example-banner.json"));
  assert.ok(ruleIds(banner).includes("LEG-001")); // venuetax
  assert.ok(ruleIds(banner).includes("LEG-002")); // venuetypeid
  assert.ok(ruleIds(banner).includes("LEG-003")); // geo.long
  assert.ok(ruleIds(banner).includes("TIM-002")); // dt 12345670

  const video = validate(load("upstream/iab-ortb26-example-video.json"));
  const dt = video.issues.find((i) => i.ruleId === "TIM-002");
  assert.ok(dt, "dt in seconds should be caught");
  assert.match(dt!.message, /looks like seconds/);
});

test("reads Prebid Server test files (mockBidRequest wrapper)", () => {
  const r = validate(load("upstream/prebid-server-site-dooh-both.json"));
  assert.ok(ruleIds(r).includes("STR-003"));
});

test("non-object input is rejected cleanly", () => {
  for (const input of [null, 42, "x", [1, 2]]) {
    const r = validate(input);
    assert.equal(r.valid, false);
    assert.equal(r.issues[0].ruleId, "STR-000");
  }
});

test("cost per play at floor follows OpenRTB §7.9.4", () => {
  const r = validate(base());
  assert.equal(r.metrics.imps[0].costPerPlayAtFloor, (6 / 1000) * 12.5);
});

test("score: -25 per error, -8 per warning, floor at 0", () => {
  const req = base();
  delete req.device.geo; // 1 error
  delete req.imp[0].dt; // 1 warning
  assert.equal(validate(req).score, 100 - 25 - 8);
});

test("lead-time rules only run when 'now' is given", () => {
  const req = base();
  const dt = req.imp[0].dt;
  assert.ok(!ruleIds(validate(req)).some((id) => id.startsWith("TIM")));
  assert.deepEqual(ruleIds(validate(req, { now: dt - 3 * 3600_000 })), ["TIM-004"]); // 3 h ahead
  assert.deepEqual(ruleIds(validate(req, { now: dt + 3600_000 })), ["TIM-003"]); // 1 h in the past
  assert.deepEqual(ruleIds(validate(req, { now: dt - 3600_000 })), []); // 1 h ahead is fine
  assert.deepEqual(ruleIds(validate(req, { now: dt - 3 * 3600_000, maxLeadTimeMs: 4 * 3600_000 })), []);
});

test("venue: IDs, names, case and taxonomy versions", () => {
  const withVenue = (venuetype: unknown, venuetypetax?: number) => {
    const req = base();
    req.dooh.venuetype = venuetype;
    if (venuetypetax === undefined) delete req.dooh.venuetypetax;
    else req.dooh.venuetypetax = venuetypetax;
    return ruleIds(validate(req), true);
  };
  assert.deepEqual(withVenue(["101"]), []); // ID as string, default taxonomy 1
  assert.deepEqual(withVenue(["Transit.Airports"]), []); // names are case-insensitive
  assert.deepEqual(withVenue(["transit.ferry"], 1), ["VEN-003"]); // added in OpenOOH 1.1
  assert.deepEqual(withVenue(["transit.ferry"], 5), []);
  assert.deepEqual(withVenue([30101]), ["VEN-002"]); // must be strings
  assert.deepEqual(withVenue("transit.airports"), ["VEN-002"]); // must be an array
  assert.deepEqual(withVenue(["anything"], 3), ["VEN-005"]); // DMI taxonomy: not checked
  assert.deepEqual(withVenue(["101"], 9), ["VEN-006"]);
});

test("audience: sourcetype rules", () => {
  const withQty = (qty: unknown) => {
    const req = base();
    req.imp[0].qty = qty;
    return ruleIds(validate(req), true);
  };
  assert.deepEqual(withQty({ multiplier: 3 }), ["AUD-004"]);
  assert.deepEqual(withQty({ multiplier: 3, sourcetype: 2 }), ["AUD-007"]);
  assert.deepEqual(withQty({ multiplier: 3, sourcetype: 7 }), ["AUD-005"]);
  assert.deepEqual(withQty({ multiplier: "3", sourcetype: 2 }), ["AUD-002", "AUD-007"]);
  assert.deepEqual(withQty({ multiplier: 0.32, sourcetype: 1, vendor: "m.example" }), []); // fractions are normal
});

test("location: out of range and missing type", () => {
  const req = base();
  req.device.geo.lat = 123.45678;
  assert.deepEqual(ruleIds(validate(req)), ["LOC-002"]);
  const req2 = base();
  delete req2.device.geo.type;
  assert.deepEqual(ruleIds(validate(req2), true), ["LOC-005"]);
});

test("disable option skips rules", () => {
  const req = base();
  delete req.device.geo;
  assert.deepEqual(ruleIds(validate(req, { disable: ["LOC-001"] })), []);
});

test("summary counts each rule once per request", () => {
  const a = base();
  a.imp.push({ ...a.imp[0], id: "2" });
  delete a.imp[0].dt;
  delete a.imp[1].dt; // TIM-001 twice in one request
  const s = summarize([validate(a), validate(base())]);
  assert.equal(s.requests, 2);
  const tim = s.byRule.find((r) => r.ruleId === "TIM-001");
  assert.equal(tim?.requests, 1);
  assert.equal(tim?.percent, 50);
});

test("CLI: JSON Lines batch, summary and exit codes", () => {
  const cli = join(ROOT, "dist/src/cli.js");
  const good = JSON.stringify(base());
  const bad = JSON.stringify({ ...base(), device: {} });
  const run = (input: string, args: string[]) => {
    try {
      return { code: 0, out: execFileSync("node", [cli, "-", ...args], { input, encoding: "utf8" }) };
    } catch (e: any) {
      return { code: e.status as number, out: e.stdout as string };
    }
  };
  assert.equal(run(good + "\n" + good + "\n", []).code, 0);
  const r = run(good + "\n" + bad + "\n", ["--summary", "--json"]);
  assert.equal(r.code, 1);
  const s = JSON.parse(r.out);
  assert.equal(s.requests, 2);
  assert.equal(s.valid, 1);
});
