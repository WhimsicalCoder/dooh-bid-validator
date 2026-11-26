# dooh-bid-validator

Check programmatic DOOH (digital out-of-home) bid requests from a **buyer's point of view**.

Most validators answer "does this parse?". This one answers "can a buyer actually trust and price this screen?": is the location there, is the venue type real, where does the impression multiplier come from, when will the ad play, and what will one play cost.

It follows OpenRTB 2.6, the IAB Tech Lab DOOH implementation guidance (§7.9), AdCOM 1.0 lists and the OpenOOH venue taxonomy. Every issue says which document it comes from, and rules that are buyer best practice rather than spec are labelled that way.

```
$ dooh-validate fixtures/upstream/iab-ortb26-example-video.json

INVALID  score 18/100  (2 errors, 4 warnings, 1 info)
  ✖ LOC-001  device.geo.lon missing. lat/lon is required for DOOH transactions.
  ✖ TIM-002  imp.dt is 1647010095, which is not a plausible Unix timestamp in milliseconds.
             It looks like seconds; OpenRTB uses milliseconds.
  ▲ LEG-001  dooh.venuetax is not an OpenRTB 2.6 field. The field is called venuetypetax.
  ▲ LEG-002  dooh.venuetypeid is not an OpenRTB 2.6 field. ...
  ▲ LEG-003  device.geo.long is not an OpenRTB field. Longitude goes in device.geo.lon.
  ...
  $ imp 123456: floor 4.8 GBP CPM × multiplier 14.2 = 0.06816 GBP per play
```

Yes, that is the IAB's own example request. Field-name mistakes like these are easy to make, and a buyer's parser silently ignores them, so the data is effectively missing.

## Install and run

Requires Node.js 18.3 or later.

```bash
npm install
npm run build
node dist/src/cli.js path/to/request.json
```

Input can be:

- one bid request (`.json`)
- an array of bid requests (`.json`)
- one request per line (`.jsonl`), e.g. a bid log
- a Prebid Server test file (the request inside `mockBidRequest` is used)
- `-` to read from stdin

### Options

| Option | What it does |
| --- | --- |
| `--summary` | One summary for all requests: how often each rule fired |
| `--json` | Machine-readable output |
| `--now <time>` | Turn on lead-time checks for `imp.dt`: `live`, an ISO date, or ms since epoch. Off by default so old logs don't fail |
| `--max-lead <min>` | Lead-time warning threshold in minutes (default 120) |
| `--max-multiplier <n>` | Multiplier warning threshold (default 10000) |
| `--disable <ids>` | Skip rules, e.g. `--disable LOC-005,AUD-007` |
| `--quiet` | Hide info-level issues |

The exit code is `1` when any request has an error, so it works in CI.

### Batch example

```bash
node dist/src/cli.js bids.jsonl --summary

3 requests, 1 valid (33%), average score 83.3/100

Rule      Severity  Requests  Share
AUD-001   error            1   33.3%
LOC-001   error            1   33.3%
```

## Use as a library

```ts
import { validate } from "dooh-bid-validator";

const report = validate(bidRequest, { now: Date.now() });
report.valid;     // false if any error
report.score;     // 0-100
report.issues;    // [{ ruleId, severity, message, path, ref }]
report.metrics;   // per-imp multiplier, floor and cost per play
```

## Scoring

Start at 100. Each error costs 25 points, each warning 8. Info costs nothing. Minimum 0. A request is **valid** when it has no errors.

## Rules

| ID | Severity | Checks | Source |
| --- | --- | --- | --- |
| STR-000 | error | Input is a JSON object | OpenRTB §3.2.1 |
| STR-001 | error | Request has an `id` | OpenRTB §3.2.1 |
| STR-002 | error | `dooh` object is present | OpenRTB §3.2.32 |
| STR-003 | error | No `site` or `app` alongside `dooh` | OpenRTB §3.2.32 |
| STR-004 | error | `imp` is a non-empty array and every imp has an `id` | OpenRTB §3.2.1, §3.2.4 |
| STR-005 | warning | `dooh.id` is present (recommended) | OpenRTB §3.2.32 |
| STR-006 | warning | `dooh.publisher.id` is present, for sellers.json matching | Buyer best practice |
| STR-007 | warning | `device.devicetype` is 8 (OOH device) | Impl. §7.9.2.5, AdCOM |
| LOC-001 | error | `device.geo.lat` and `lon` are present | Impl. §7.9.2.5 |
| LOC-002 | error | lat/lon are numbers in range | OpenRTB §3.2.19 |
| LOC-003 | warning | Coordinates are not 0,0 (a placeholder) | Buyer best practice |
| LOC-004 | warning | Coordinates have at least 3 decimals (~100 m) | Buyer best practice |
| LOC-005 | info | `device.geo.type` is present (recommended with lat/lon) | OpenRTB §3.2.19 |
| VEN-001 | warning | `dooh.venuetype` is present | OpenRTB §3.2.32 |
| VEN-002 | error | `dooh.venuetype` is a non-empty array of strings | OpenRTB §3.2.32 |
| VEN-003 | error | Each venue ID or name exists in the taxonomy | OpenOOH 1.0 / 1.1 |
| VEN-004 | warning | More than a parent-level venue type is given | OpenOOH |
| VEN-005 | info | Taxonomy is one this tool can check (OpenOOH 1.0 = 1, 1.1 = 5) | AdCOM |
| VEN-006 | error | `dooh.venuetypetax` is a known value (0-5) | AdCOM |
| LEG-001 | warning | `dooh.venuetax` used instead of `venuetypetax` | OpenRTB §3.2.32 |
| LEG-002 | warning | `dooh.venuetypeid` used instead of `venuetype` | OpenRTB §3.2.32 |
| LEG-003 | warning | `device.geo.long` used instead of `lon` | OpenRTB §3.2.19 |
| LEG-004 | info | Venue sent in the OpenRTB 2.5-era `device.ext.dooh` extension | OpenRTB §3.2.32 |
| AUD-001 | error | Each imp has a `qty` object | Impl. §7.9.1 |
| AUD-002 | error | `qty.multiplier` is a number > 0 | OpenRTB §3.2.31 |
| AUD-003 | warning | `qty.multiplier` is below the limit (default 10000) | Buyer best practice |
| AUD-004 | warning | `qty.sourcetype` is present (recommended) | OpenRTB §3.2.31 |
| AUD-005 | error | `qty.sourcetype` is 0-3 | AdCOM |
| AUD-006 | error | `qty.vendor` is present when `sourcetype` is 1 | OpenRTB §3.2.31 |
| AUD-007 | info | Audience is not from an independent measurement vendor | Buyer best practice |
| TIM-001 | warning | Each imp has `dt` (expected play time) | OpenRTB §3.2.4 |
| TIM-002 | error | `dt` is a plausible ms timestamp (catches seconds) | OpenRTB §3.2.4 |
| TIM-003 | warning | `dt` is not in the past (needs `--now`) | Impl. §7.9.2.3 |
| TIM-004 | warning | `dt` is within the lead-time limit (needs `--now`) | Impl. §7.9.2.3 |
| CRE-001 | error | Each imp has a `banner` or `video` | OpenRTB §3.2.4 |
| CRE-002 | warning | Banner has a size | OpenRTB §3.2.6 |
| CRE-003 | error | Video has `mimes` (required) | OpenRTB §3.2.7 |
| CRE-004 | warning | Video has `w` and `h` | OpenRTB §3.2.7 |
| CRE-005 | info | Creative size has the same shape as the screen | Buyer best practice |
| CRE-006 | warning | Video has `maxduration` or `rqddurs` | OpenRTB §3.2.7 |

## Test files

- `fixtures/valid/`: complete requests that score 100.
- `fixtures/invalid/`: one problem per file. `expected.json` lists the rules each file must trigger.
- `fixtures/upstream/`: real sample requests from Prebid Server's test suite and the IAB OpenRTB 2.6 guide. The Prebid files are minimal test requests built to exercise Prebid Server, not production traffic, so low scores there are expected.

All requests in `fixtures/valid` and `fixtures/invalid` are made up. Never add real bid logs to this repo.

```bash
npm test
```

## Roadmap

- Web page: paste a request and see the report, with all checks running in the browser
- Per-SSP batch summaries (group by `source.schain` or a custom field)
- Supply-path checks: match `dooh.publisher` and `source.schain` against sellers.json
- Screen deduplication: find the same physical screen sold under different IDs across SSPs
- Multiplier consistency over time for each screen

## License

Apache 2.0, © 2026 WhimsicalCoder. See `LICENSE` and `NOTICE`.
