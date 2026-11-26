// Generates fixtures/screens/multi-ssp.jsonl: made-up DOOH bid requests from three SSPs,
// built to exercise screen deduplication. Run: node scripts/make-screens-fixture.mjs
import { mkdirSync, writeFileSync } from "node:fs";

const DT = Date.UTC(2026, 11, 1, 15, 0, 0);
let n = 0;

function req({ ssp, id, name, lat, lon, w = 1080, h = 1920, venue, pub = "example-outdoor.com", mult, floor, path, complete = 1 }) {
  n++;
  const nodes = path.map(([asi, sid]) => ({ asi, sid, hp: 1 }));
  const r = {
    id: `req-${String(n).padStart(4, "0")}`,
    imp: [{ id: "1", bidfloor: floor, bidfloorcur: "USD", banner: { w, h }, dt: DT, qty: { multiplier: mult, sourcetype: 1, vendor: "measurement.example" } }],
    dooh: { id, name, venuetype: [venue], venuetypetax: 1, publisher: { id: pub, domain: pub } },
    device: { devicetype: 8, w, h, geo: { lat, lon, type: 3 } },
  };
  if (nodes.length) r.source = { schain: { complete, ver: "1.0", nodes } };
  return r;
}

const rows = [];

// S1: one roadside billboard face sold by all three SSPs under different IDs.
for (const m of [12, 12.5, 13]) {
  rows.push(req({ ssp: "a", id: "A-4471", name: "Woodward Ave Northbound Digital", lat: 42.48721, lon: -83.03312, venue: "outdoor.billboards.roadside", mult: m, floor: 6, path: [["ssp-a.example", "pub-88"]] }));
}
rows.push(req({ id: "B-99812", name: "Woodward Northbound Digital", lat: 42.48725, lon: -83.03312, venue: "30101", mult: 18, floor: 6.5, path: [["reseller.example", "r-1"], ["ssp-b.example", "rs-77"]] }));
rows.push(req({ id: "C-0042", name: "Woodward Ave N Digital", lat: 42.48721, lon: -83.0332, venue: "outdoor.billboards.roadside", mult: 12.5, floor: 5, path: [["ssp-c.example", "c-pub-3"]], complete: 0 }));

// S2: the other face of the same billboard (landscape). Must not merge with S1.
rows.push(req({ id: "A-4472", name: "Woodward Ave Southbound Digital", lat: 42.48721, lon: -83.03312, w: 1920, h: 1080, venue: "outdoor.billboards.roadside", mult: 9, floor: 6, path: [["ssp-a.example", "pub-88"]] }));
rows.push(req({ id: "B-99813", name: "Woodward Southbound Digital", lat: 42.48723, lon: -83.03313, w: 1920, h: 1080, venue: "outdoor.billboards.roadside", mult: 9, floor: 6, path: [["reseller.example", "r-1"], ["ssp-b.example", "rs-77"]] }));

// S3: same spot, same size, but different venue families (airport vs mall). Must not merge.
rows.push(req({ id: "A-9001", name: "DTW McNamara Gate A36", lat: 42.21242, lon: -83.35341, venue: "transit.airports.gates", pub: "metro-screens.example", mult: 4, floor: 9, path: [["ssp-a.example", "pub-12"]] }));
rows.push(req({ id: "B-5550", name: "Concourse Shops Display", lat: 42.21258, lon: -83.35338, venue: "retail.malls.concourse", pub: "metro-screens.example", mult: 4, floor: 9, path: [["ssp-b.example", "b-pub-9"]] }));

// S4: two neighbouring mall screens on SSP A; SSP B sells one of them. The name decides which.
rows.push(req({ id: "A-MALL-1", name: "Somerset Mall Concourse North", lat: 42.56241, lon: -83.18402, venue: "retail.malls.concourse", pub: "metro-screens.example", mult: 6, floor: 7, path: [["ssp-a.example", "pub-12"]] }));
rows.push(req({ id: "A-MALL-2", name: "Somerset Mall Concourse South", lat: 42.56241, lon: -83.18402, venue: "retail.malls.concourse", pub: "metro-screens.example", mult: 6, floor: 7, path: [["ssp-a.example", "pub-12"]] }));
rows.push({ ssp: "ssp-b.example", request: req({ id: "B-MALL-X", name: "Somerset Mall Concourse North", lat: 42.56243, lon: -83.18401, venue: "20501", pub: "metro-screens.example", mult: 6, floor: 7.5, path: [] }) });

// S5: a screen only SSP C sells, with no supply chain at all.
rows.push({ ssp: "ssp-c.example", request: req({ id: "C-7781", name: "Royal Oak Gym Lobby", lat: 42.48946, lon: -83.14462, venue: "health_beauty.gyms.lobby", pub: "fit-screens.example", mult: 2, floor: 10, path: [] }) });

// S6: same name as S1 but in another city. Must not merge.
rows.push(req({ id: "B-12000", name: "Woodward Ave Northbound Digital", lat: 42.33143, lon: -83.04575, venue: "outdoor.billboards.roadside", mult: 12, floor: 6, path: [["ssp-b.example", "b-pub-1"]] }));

// Not DOOH (site request): skipped.
rows.push({ id: "web-1", site: { page: "https://example.com" }, imp: [{ id: "1", banner: { w: 300, h: 250 } }] });

mkdirSync("fixtures/screens", { recursive: true });
writeFileSync("fixtures/screens/multi-ssp.jsonl", rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(`Wrote ${rows.length} records to fixtures/screens/multi-ssp.jsonl`);
