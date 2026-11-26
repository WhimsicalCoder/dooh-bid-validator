// src/format.ts
function summarize(reports) {
  const byRule = /* @__PURE__ */ new Map();
  for (const r of reports) {
    const seen = /* @__PURE__ */ new Set();
    for (const i of r.issues) {
      if (seen.has(i.ruleId)) continue;
      seen.add(i.ruleId);
      const e = byRule.get(i.ruleId) ?? { severity: i.severity, requests: 0 };
      e.requests++;
      byRule.set(i.ruleId, e);
    }
  }
  const n = reports.length;
  return {
    requests: n,
    valid: reports.filter((r) => r.valid).length,
    averageScore: n ? Math.round(reports.reduce((s, r) => s + r.score, 0) / n * 10) / 10 : 0,
    byRule: [...byRule.entries()].map(([ruleId, e]) => ({ ruleId, ...e, percent: n ? Math.round(e.requests / n * 1e3) / 10 : 0 })).sort((a, b) => b.requests - a.requests || a.ruleId.localeCompare(b.ruleId))
  };
}

// src/refs.ts
var REF = {
  ortbRequest: "OpenRTB 2.6 \xA73.2.1 (BidRequest)",
  ortbImp: "OpenRTB 2.6 \xA73.2.4 (Imp)",
  ortbBanner: "OpenRTB 2.6 \xA73.2.6 (Banner)",
  ortbVideo: "OpenRTB 2.6 \xA73.2.7 (Video)",
  ortbDevice: "OpenRTB 2.6 \xA73.2.18 (Device)",
  ortbGeo: "OpenRTB 2.6 \xA73.2.19 (Geo)",
  ortbQty: "OpenRTB 2.6 \xA73.2.31 (Qty)",
  ortbDooh: "OpenRTB 2.6 \xA73.2.32 (DOOH)",
  implDevice: "OpenRTB 2.6 Implementation \xA77.9.2.5 (DOOH device attributes)",
  implLeadTime: "OpenRTB 2.6 Implementation \xA77.9.2.3 (lead time up to 1-2 hours)",
  implMultiplier: "OpenRTB 2.6 Implementation \xA77.9.1 (multiple/variable impressions)",
  adcomSourceTypes: "AdCOM 1.0 List: DOOH Multiplier Measurement Source Types",
  adcomVenueTax: "AdCOM 1.0 List: DOOH Venue Taxonomies",
  adcomDeviceTypes: "AdCOM 1.0 List: Device Types (8 = OOH device)",
  openooh: "OpenOOH Venue Taxonomy (github.com/openooh/venue-taxonomy)",
  openoohTiers: "OpenOOH Venue Taxonomy: screens should not be assigned only a parent venue type",
  buyer: "Buyer best practice (not a spec requirement)"
};

// src/util.ts
var isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var isNum = (v) => typeof v === "number" && Number.isFinite(v);
var isNonEmptyStr = (v) => typeof v === "string" && v.trim() !== "";
var imps = (req) => Array.isArray(req?.imp) ? req.imp : [];
var decimals = (n) => {
  const s = String(n);
  if (s.includes("e-")) return Number(s.split("e-")[1]);
  const i = s.indexOf(".");
  return i === -1 ? 0 : s.length - i - 1;
};
function unwrap(input2) {
  if (isObj(input2) && isObj(input2.mockBidRequest)) return input2.mockBidRequest;
  return input2;
}

// src/rules/audience.ts
var SOURCE_TYPES = {
  0: "unknown",
  1: "measurement vendor",
  2: "publisher",
  3: "exchange"
};
function audience({ req, add, options }) {
  imps(req).forEach((imp, i) => {
    if (!isObj(imp)) return;
    const p = `$.imp[${i}].qty`;
    const qty = imp.qty;
    if (!isObj(qty)) {
      add({
        ruleId: "AUD-001",
        severity: "error",
        path: p,
        ref: REF.implMultiplier,
        message: `Impression ${i} has no qty object, so there is no impression multiplier. Buyers cannot tell how many impressions one play is worth.`
      });
      return;
    }
    const m = qty.multiplier;
    if (!isNum(m) || m <= 0) {
      add({
        ruleId: "AUD-002",
        severity: "error",
        path: `${p}.multiplier`,
        ref: REF.ortbQty,
        message: `qty.multiplier must be a number greater than 0 (required), got ${JSON.stringify(m)}.`
      });
    } else if (m > options.maxMultiplier) {
      add({
        ruleId: "AUD-003",
        severity: "warning",
        path: `${p}.multiplier`,
        ref: REF.buyer,
        message: `qty.multiplier is ${m}, above the ${options.maxMultiplier} limit. Check how this audience estimate was made before buying.`
      });
    }
    const st = qty.sourcetype;
    if (st === void 0) {
      add({
        ruleId: "AUD-004",
        severity: "warning",
        path: `${p}.sourcetype`,
        ref: REF.ortbQty,
        message: "qty.sourcetype is missing (recommended). Buyers cannot tell who measured the audience."
      });
    } else if (!Number.isInteger(st) || !(st in SOURCE_TYPES)) {
      add({
        ruleId: "AUD-005",
        severity: "error",
        path: `${p}.sourcetype`,
        ref: REF.adcomSourceTypes,
        message: `qty.sourcetype is ${JSON.stringify(st)}. Allowed values: 0 unknown, 1 measurement vendor, 2 publisher, 3 exchange.`
      });
    } else if (st === 1 && !isNonEmptyStr(qty.vendor)) {
      add({
        ruleId: "AUD-006",
        severity: "error",
        path: `${p}.vendor`,
        ref: REF.ortbQty,
        message: "qty.sourcetype is 1 (measurement vendor) but qty.vendor is missing. The vendor's domain is required in this case."
      });
    } else if (st !== 1) {
      add({
        ruleId: "AUD-007",
        severity: "info",
        path: `${p}.sourcetype`,
        ref: REF.buyer,
        message: `Audience source is "${SOURCE_TYPES[st]}", not an independent measurement vendor.`
      });
    }
  });
}

// src/rules/creative.ts
var sizesOf = (banner) => {
  const out = [];
  if (isNum(banner.w) && isNum(banner.h)) out.push({ w: banner.w, h: banner.h });
  if (Array.isArray(banner.format)) {
    for (const f of banner.format) if (isObj(f) && isNum(f.w) && isNum(f.h)) out.push({ w: f.w, h: f.h });
  }
  return out;
};
var ratioClose = (a, b) => a.h > 0 && b.h > 0 && Math.abs(a.w / a.h - b.w / b.h) / (b.w / b.h) <= 0.02;
function creative({ req, add }) {
  const dev = req.device;
  const screen = isNum(dev?.w) && isNum(dev?.h) && dev.w > 0 && dev.h > 0 ? { w: dev.w, h: dev.h } : void 0;
  imps(req).forEach((imp, i) => {
    if (!isObj(imp)) return;
    const p = `$.imp[${i}]`;
    if (!isObj(imp.banner) && !isObj(imp.video)) {
      const other = ["native", "audio"].filter((k) => isObj(imp[k]));
      add({
        ruleId: "CRE-001",
        severity: other.length ? "info" : "error",
        path: p,
        ref: REF.ortbImp,
        message: other.length ? `Impression ${i} offers only ${other.join("/")}, which is rare for DOOH screens.` : `Impression ${i} has no banner or video object, so there is nothing to bid on.`
      });
    }
    if (isObj(imp.banner)) {
      const sizes = sizesOf(imp.banner);
      if (sizes.length === 0) {
        add({
          ruleId: "CRE-002",
          severity: "warning",
          path: `${p}.banner`,
          ref: REF.ortbBanner,
          message: "Banner has no size (no w/h and no format). DOOH creatives are pre-approved for exact sizes."
        });
      } else if (screen && !sizes.some((s) => ratioClose(s, screen))) {
        add({
          ruleId: "CRE-005",
          severity: "info",
          path: `${p}.banner`,
          ref: REF.buyer,
          message: `No banner size has the same shape as the screen (${screen.w}x${screen.h}). Fine if the slot is a zone of the screen; otherwise check the sizes.`
        });
      }
    }
    if (isObj(imp.video)) {
      const v = imp.video;
      if (!Array.isArray(v.mimes) || v.mimes.length === 0) {
        add({
          ruleId: "CRE-003",
          severity: "error",
          path: `${p}.video.mimes`,
          ref: REF.ortbVideo,
          message: "video.mimes is missing (required)."
        });
      }
      if (!isNum(v.w) || !isNum(v.h)) {
        add({
          ruleId: "CRE-004",
          severity: "warning",
          path: `${p}.video`,
          ref: REF.ortbVideo,
          message: "Video has no w/h. On a screen, buyers need the exact size."
        });
      } else if (screen && !ratioClose({ w: v.w, h: v.h }, screen)) {
        add({
          ruleId: "CRE-005",
          severity: "info",
          path: `${p}.video`,
          ref: REF.buyer,
          message: `Video size ${v.w}x${v.h} has a different shape from the screen (${screen.w}x${screen.h}).`
        });
      }
      if (v.maxduration === void 0 && !Array.isArray(v.rqddurs)) {
        add({
          ruleId: "CRE-006",
          severity: "warning",
          path: `${p}.video.maxduration`,
          ref: REF.ortbVideo,
          message: "Video has no maxduration or rqddurs. DOOH spots have a fixed length, so buyers need to know it."
        });
      }
    }
  });
}

// src/rules/legacy.ts
function legacy({ req, add }) {
  const dooh = req.dooh;
  if (isObj(dooh)) {
    if (dooh.venuetax !== void 0) {
      add({
        ruleId: "LEG-001",
        severity: "warning",
        path: "$.dooh.venuetax",
        ref: REF.ortbDooh,
        message: "dooh.venuetax is not an OpenRTB 2.6 field. The field is called venuetypetax."
      });
    }
    if (dooh.venuetypeid !== void 0) {
      add({
        ruleId: "LEG-002",
        severity: "warning",
        path: "$.dooh.venuetypeid",
        ref: REF.ortbDooh,
        message: 'dooh.venuetypeid is not an OpenRTB 2.6 field. Send the venue in dooh.venuetype as an array of strings, e.g. ["30101"] or ["outdoor.billboards.roadside"].'
      });
    }
  }
  const geo = req.device?.geo;
  if (isObj(geo) && geo.long !== void 0) {
    add({
      ruleId: "LEG-003",
      severity: "warning",
      path: "$.device.geo.long",
      ref: REF.ortbGeo,
      message: "device.geo.long is not an OpenRTB field. Longitude goes in device.geo.lon."
    });
  }
  const ext = req.device?.ext?.dooh;
  if (isObj(ext)) {
    const keys = ["venuetypelist", "venuetypeid", "venuetypestring"].filter((k) => ext[k] !== void 0);
    if (keys.length > 0) {
      add({
        ruleId: "LEG-004",
        severity: "info",
        path: "$.device.ext.dooh",
        ref: REF.ortbDooh,
        message: `Venue sent in the OpenRTB 2.5-era extension (device.ext.dooh.${keys.join(", ")}). OpenRTB 2.6 buyers look in dooh.venuetype.`
      });
    }
  }
}

// src/rules/location.ts
function location2({ req, add }) {
  const geo = req.device?.geo;
  if (!isObj(geo)) {
    add({
      ruleId: "LOC-001",
      severity: "error",
      path: "$.device.geo",
      ref: REF.implDevice,
      message: "device.geo is missing. lat/lon is required for DOOH because IP-based location does not work for screens."
    });
    return;
  }
  const { lat, lon } = geo;
  if (lat === void 0 || lon === void 0) {
    const missing = [lat === void 0 && "lat", lon === void 0 && "lon"].filter(Boolean).join(" and ");
    add({
      ruleId: "LOC-001",
      severity: "error",
      path: "$.device.geo",
      ref: REF.implDevice,
      message: `device.geo.${missing} missing. lat/lon is required for DOOH transactions.`
    });
    return;
  }
  if (!isNum(lat) || lat < -90 || lat > 90 || !isNum(lon) || lon < -180 || lon > 180) {
    add({
      ruleId: "LOC-002",
      severity: "error",
      path: "$.device.geo",
      ref: REF.ortbGeo,
      message: `Invalid coordinates (lat ${JSON.stringify(lat)}, lon ${JSON.stringify(lon)}). lat must be a number from -90 to 90 and lon from -180 to 180.`
    });
    return;
  }
  if (Math.abs(lat) < 1e-3 && Math.abs(lon) < 1e-3) {
    add({
      ruleId: "LOC-003",
      severity: "warning",
      path: "$.device.geo",
      ref: REF.buyer,
      message: `Coordinates are at or next to 0,0 ("Null Island" in the Atlantic). This is almost always a placeholder, not a real screen.`
    });
  } else if (decimals(lat) < 3 || decimals(lon) < 3) {
    add({
      ruleId: "LOC-004",
      severity: "warning",
      path: "$.device.geo",
      ref: REF.buyer,
      message: `Coordinates have fewer than 3 decimal places (lat ${lat}, lon ${lon}), so the screen's position is only known to within about 100 m or worse.`
    });
  }
  if (geo.type === void 0) {
    add({
      ruleId: "LOC-005",
      severity: "info",
      path: "$.device.geo.type",
      ref: REF.ortbGeo,
      message: "device.geo.type is missing (recommended when passing lat/lon). It tells buyers where the location came from."
    });
  }
}

// src/rules/structure.ts
function structure({ req, add }) {
  if (!isNonEmptyStr(req.id)) {
    add({
      ruleId: "STR-001",
      severity: "error",
      path: "$.id",
      ref: REF.ortbRequest,
      message: "Bid request has no id."
    });
  }
  if (!isObj(req.dooh)) {
    add({
      ruleId: "STR-002",
      severity: "error",
      path: "$.dooh",
      ref: REF.ortbDooh,
      message: "No dooh object. Without it, buyers cannot tell this is DOOH inventory."
    });
  }
  const others = ["site", "app"].filter((k) => req[k] !== void 0);
  if (req.dooh !== void 0 && others.length > 0) {
    add({
      ruleId: "STR-003",
      severity: "error",
      path: `$.${others[0]}`,
      ref: REF.ortbDooh,
      message: `Request has both dooh and ${others.join(" and ")}. A DOOH request must not contain a site or app object.`
    });
  }
  if (!Array.isArray(req.imp) || req.imp.length === 0) {
    add({
      ruleId: "STR-004",
      severity: "error",
      path: "$.imp",
      ref: REF.ortbRequest,
      message: "Bid request has no impressions (imp array missing or empty)."
    });
  }
  imps(req).forEach((imp, i) => {
    if (!isObj(imp) || !isNonEmptyStr(imp.id)) {
      add({
        ruleId: "STR-004",
        severity: "error",
        path: `$.imp[${i}].id`,
        ref: REF.ortbImp,
        message: `Impression ${i} has no id.`
      });
    }
  });
  if (isObj(req.dooh)) {
    if (!isNonEmptyStr(req.dooh.id)) {
      add({
        ruleId: "STR-005",
        severity: "warning",
        path: "$.dooh.id",
        ref: REF.ortbDooh,
        message: "dooh.id is missing (recommended). Without a placement ID, buyers cannot track or deduplicate screens."
      });
    }
    if (!isObj(req.dooh.publisher) || !isNonEmptyStr(req.dooh.publisher.id)) {
      add({
        ruleId: "STR-006",
        severity: "warning",
        path: "$.dooh.publisher.id",
        ref: REF.buyer,
        message: "dooh.publisher.id is missing. Buyers need it to match the media owner against sellers.json for supply path checks."
      });
    }
  }
  const dt = req.device?.devicetype;
  if (dt === void 0) {
    add({
      ruleId: "STR-007",
      severity: "warning",
      path: "$.device.devicetype",
      ref: REF.implDevice,
      message: "device.devicetype is missing. DOOH screens should be identified as type 8 (OOH device)."
    });
  } else if (dt !== 8) {
    add({
      ruleId: "STR-007",
      severity: "warning",
      path: "$.device.devicetype",
      ref: REF.adcomDeviceTypes,
      message: `device.devicetype is ${JSON.stringify(dt)}. DOOH screens should be identified as type 8 (OOH device).`
    });
  }
}

// src/rules/timing.ts
var MIN_MS = Date.UTC(2015, 0, 1);
var MAX_MS = Date.UTC(2100, 0, 1);
var fmtDuration = (ms) => {
  const min = Math.round(Math.abs(ms) / 6e4);
  return min < 120 ? `${min} min` : `${(min / 60).toFixed(1)} h`;
};
function timing({ req, add, options }) {
  imps(req).forEach((imp, i) => {
    if (!isObj(imp)) return;
    const p = `$.imp[${i}].dt`;
    const dt = imp.dt;
    if (dt === void 0) {
      add({
        ruleId: "TIM-001",
        severity: "warning",
        path: p,
        ref: REF.ortbImp,
        message: `Impression ${i} has no dt, so buyers don't know when the ad will play (matters for dayparting and pacing).`
      });
      return;
    }
    if (!isNum(dt) || dt < MIN_MS || dt > MAX_MS) {
      let hint = "";
      if (isNum(dt) && dt * 1e3 >= MIN_MS && dt * 1e3 <= MAX_MS) hint = " It looks like seconds; OpenRTB uses milliseconds.";
      add({
        ruleId: "TIM-002",
        severity: "error",
        path: p,
        ref: REF.ortbImp,
        message: `imp.dt is ${JSON.stringify(dt)}, which is not a plausible Unix timestamp in milliseconds.${hint}`
      });
      return;
    }
    if (options.now === void 0) return;
    const lead = dt - options.now;
    if (lead < -options.pastToleranceMs) {
      add({
        ruleId: "TIM-003",
        severity: "warning",
        path: p,
        ref: REF.implLeadTime,
        message: `imp.dt is ${fmtDuration(lead)} in the past. The play time has already gone by.`
      });
    } else if (lead > options.maxLeadTimeMs) {
      add({
        ruleId: "TIM-004",
        severity: "warning",
        path: p,
        ref: REF.implLeadTime,
        message: `imp.dt is ${fmtDuration(lead)} ahead, longer than the ${fmtDuration(options.maxLeadTimeMs)} lead time limit. The accepted lead time is up to 1-2 hours.`
      });
    }
  });
}

// src/data/venues.ts
var OPENOOH_1_0 = [
  { id: 1, name: "transit" },
  { id: 2, name: "retail" },
  { id: 3, name: "outdoor" },
  { id: 4, name: "health_beauty" },
  { id: 5, name: "point_care" },
  { id: 6, name: "education" },
  { id: 7, name: "office_buildings" },
  { id: 8, name: "entertainment" },
  { id: 9, name: "government" },
  { id: 10, name: "financial" },
  { id: 11, name: "residential" },
  { id: 101, name: "transit.airports" },
  { id: 102, name: "transit.buses" },
  { id: 103, name: "transit.taxi_rideshare_tv" },
  { id: 104, name: "transit.taxi_rideshare_top" },
  { id: 105, name: "transit.subway" },
  { id: 106, name: "transit.train_stations" },
  { id: 201, name: "retail.gas_stations" },
  { id: 202, name: "retail.convenience_store" },
  { id: 203, name: "retail.grocery" },
  { id: 204, name: "retail.liquor_stores" },
  { id: 205, name: "retail.malls" },
  { id: 206, name: "retail.dispensaries" },
  { id: 207, name: "retail.pharmacies" },
  { id: 208, name: "retail.parking_garages" },
  { id: 301, name: "outdoor.billboards" },
  { id: 302, name: "outdoor.urban_panels" },
  { id: 303, name: "outdoor.bus_shelters" },
  { id: 401, name: "health_beauty.gyms" },
  { id: 402, name: "health_beauty.salons" },
  { id: 403, name: "health_beauty.spas" },
  { id: 501, name: "point_care.doctor_offices" },
  { id: 502, name: "point_care.veterinary_offices" },
  { id: 601, name: "education.schools" },
  { id: 602, name: "education.colleges" },
  { id: 701, name: "office_buildings.office_buildings" },
  { id: 801, name: "entertainment.recreational" },
  { id: 802, name: "entertainment.movie_theaters" },
  { id: 803, name: "entertainment.sports" },
  { id: 804, name: "entertainment.bars" },
  { id: 805, name: "entertainment.casual_dining" },
  { id: 806, name: "entertainment.qsr" },
  { id: 807, name: "entertainment.hotels" },
  { id: 808, name: "entertainment.golf_cart" },
  { id: 901, name: "government.dmv" },
  { id: 902, name: "government.military_bases" },
  { id: 1001, name: "financial.banks" },
  { id: 1101, name: "residential.apartment" },
  { id: 10101, name: "transit.airports.arrivals_hall" },
  { id: 10102, name: "transit.airports.baggage_claim" },
  { id: 10103, name: "transit.airports.departures_hall" },
  { id: 10104, name: "transit.airports.food_court" },
  { id: 10105, name: "transit.airports.gates" },
  { id: 10106, name: "transit.airports.lounges" },
  { id: 10107, name: "transit.airports.shopping_area" },
  { id: 10201, name: "transit.buses.bus" },
  { id: 10202, name: "transit.buses.terminal" },
  { id: 10501, name: "transit.subway.train" },
  { id: 10502, name: "transit.subway.platform" },
  { id: 10601, name: "transit.train_stations.train" },
  { id: 10602, name: "transit.train_stations.platform" },
  { id: 20101, name: "retail.gas_stations.pump" },
  { id: 20102, name: "retail.gas_stations.shop" },
  { id: 20301, name: "retail.grocery.shop_entrance" },
  { id: 20302, name: "retail.grocery.check_out" },
  { id: 20501, name: "retail.malls.concourse" },
  { id: 20502, name: "retail.malls.food_court" },
  { id: 20503, name: "retail.malls.spectacular" },
  { id: 30101, name: "outdoor.billboards.roadside" },
  { id: 30102, name: "outdoor.billboards.highway" },
  { id: 30103, name: "outdoor.billboards.spectacular" },
  { id: 40101, name: "health_beauty.gyms.lobby" },
  { id: 40102, name: "health_beauty.gyms.equipment" },
  { id: 70101, name: "office_buildings.office_buildings.elevator" },
  { id: 70102, name: "office_buildings.office_buildings.lobby" },
  { id: 80101, name: "entertainment.recreational.theme_parks" },
  { id: 80102, name: "entertainment.recreational.museums_galleries" },
  { id: 80103, name: "entertainment.recreational.concer_venues" },
  { id: 80201, name: "entertainment.movie_theaters.lobby" },
  { id: 80202, name: "entertainment.movie_theaters.food_court" },
  { id: 80301, name: "entertainment.sports.arena" },
  { id: 80302, name: "entertainment.sports.club_house" },
  { id: 80701, name: "entertainment.hotels.lobby" },
  { id: 80702, name: "entertainment.hotels.elevator" },
  { id: 110101, name: "residential.apartment_buildings.lobby" },
  { id: 110102, name: "residential.apartment_buildings.elevator" }
];
var OPENOOH_1_1 = [
  { id: 1, name: "transit" },
  { id: 2, name: "retail" },
  { id: 3, name: "outdoor" },
  { id: 4, name: "health_beauty" },
  { id: 5, name: "point_care" },
  { id: 6, name: "education" },
  { id: 7, name: "office_buildings" },
  { id: 8, name: "entertainment" },
  { id: 9, name: "government" },
  { id: 10, name: "financial" },
  { id: 11, name: "residential" },
  { id: 101, name: "transit.airports" },
  { id: 102, name: "transit.buses" },
  { id: 103, name: "transit.taxi_rideshare_tv" },
  { id: 104, name: "transit.taxi_rideshare_top" },
  { id: 105, name: "transit.subway" },
  { id: 106, name: "transit.train_stations" },
  { id: 107, name: "transit.ferry" },
  { id: 201, name: "retail.gas_stations" },
  { id: 202, name: "retail.convenience_store" },
  { id: 203, name: "retail.grocery" },
  { id: 204, name: "retail.liquor_stores" },
  { id: 205, name: "retail.malls" },
  { id: 206, name: "retail.dispensaries" },
  { id: 207, name: "retail.pharmacies" },
  { id: 208, name: "retail.parking_garages" },
  { id: 301, name: "outdoor.billboards" },
  { id: 302, name: "outdoor.urban_panels" },
  { id: 303, name: "outdoor.bus_shelters" },
  { id: 401, name: "health_beauty.gyms" },
  { id: 402, name: "health_beauty.salons" },
  { id: 403, name: "health_beauty.spas" },
  { id: 501, name: "point_care.doctor_offices" },
  { id: 502, name: "point_care.veterinary_offices" },
  { id: 601, name: "education.schools" },
  { id: 602, name: "education.colleges" },
  { id: 701, name: "office_buildings.office_buildings" },
  { id: 801, name: "entertainment.recreational" },
  { id: 802, name: "entertainment.movie_theaters" },
  { id: 803, name: "entertainment.sports" },
  { id: 804, name: "entertainment.bars" },
  { id: 805, name: "entertainment.casual_dining" },
  { id: 806, name: "entertainment.qsr" },
  { id: 807, name: "entertainment.hotels" },
  { id: 808, name: "entertainment.golf_cart" },
  { id: 809, name: "entertainment.night_club" },
  { id: 810, name: "entertainment.high_end_dining" },
  { id: 901, name: "government.dmv" },
  { id: 902, name: "government.military_bases" },
  { id: 903, name: "government.postal" },
  { id: 1001, name: "financial.banks" },
  { id: 1101, name: "residential.apartment" },
  { id: 10101, name: "transit.airports.arrivals_hall" },
  { id: 10102, name: "transit.airports.baggage_claim" },
  { id: 10103, name: "transit.airports.departures_hall" },
  { id: 10104, name: "transit.airports.food_court" },
  { id: 10105, name: "transit.airports.gates" },
  { id: 10106, name: "transit.airports.lounges" },
  { id: 10107, name: "transit.airports.shopping_area" },
  { id: 10201, name: "transit.buses.bus" },
  { id: 10202, name: "transit.buses.terminal" },
  { id: 10203, name: "transit.buses.bus_outside" },
  { id: 10501, name: "transit.subway.train" },
  { id: 10502, name: "transit.subway.platform" },
  { id: 10601, name: "transit.train_stations.train" },
  { id: 10602, name: "transit.train_stations.platform" },
  { id: 20101, name: "retail.gas_stations.pump" },
  { id: 20102, name: "retail.gas_stations.shop" },
  { id: 20301, name: "retail.grocery.shop_entrance" },
  { id: 20302, name: "retail.grocery.check_out" },
  { id: 20303, name: "retail.grocery.aisles" },
  { id: 20501, name: "retail.malls.concourse" },
  { id: 20502, name: "retail.malls.food_court" },
  { id: 20503, name: "retail.malls.spectacular" },
  { id: 30101, name: "outdoor.billboards.roadside" },
  { id: 30102, name: "outdoor.billboards.highway" },
  { id: 30103, name: "outdoor.billboards.spectacular" },
  { id: 40101, name: "health_beauty.gyms.lobby" },
  { id: 40102, name: "health_beauty.gyms.equipment" },
  { id: 40201, name: "health_beauty.salons.unisex" },
  { id: 40202, name: "health_beauty.salons.mens" },
  { id: 40203, name: "health_beauty.salons.womens" },
  { id: 60201, name: "education.colleges.residences" },
  { id: 60202, name: "education.colleges.common" },
  { id: 60203, name: "education.colleges.athletics" },
  { id: 70101, name: "office_buildings.office_buildings.elevator" },
  { id: 70102, name: "office_buildings.office_buildings.lobby" },
  { id: 80101, name: "entertainment.recreational.theme_parks" },
  { id: 80102, name: "entertainment.recreational.museums_galleries" },
  { id: 80103, name: "entertainment.recreational.concert_venues" },
  { id: 80201, name: "entertainment.movie_theaters.lobby" },
  { id: 80202, name: "entertainment.movie_theaters.food_court" },
  { id: 80301, name: "entertainment.sports.arena" },
  { id: 80302, name: "entertainment.sports.club_house" },
  { id: 80701, name: "entertainment.hotels.lobby" },
  { id: 80702, name: "entertainment.hotels.elevator" },
  { id: 80703, name: "entertainment.hotels.room" },
  { id: 110101, name: "residential.apartment_buildings.lobby" },
  { id: 110102, name: "residential.apartment_buildings.elevator" }
];

// src/rules/venue.ts
var index = (list) => {
  const byId = /* @__PURE__ */ new Map();
  const byName = /* @__PURE__ */ new Map();
  for (const v of list) {
    byId.set(v.id, v);
    byName.set(v.name, v);
  }
  return { byId, byName };
};
var TAXONOMIES = {
  1: { label: "OpenOOH 1.0", ...index(OPENOOH_1_0) },
  5: { label: "OpenOOH 1.1", ...index(OPENOOH_1_1) }
};
var KNOWN_TAX = [0, 1, 2, 3, 4, 5];
function venue({ req, add }) {
  const dooh = req.dooh;
  if (!isObj(dooh)) return;
  let tax = 1;
  if (dooh.venuetypetax !== void 0) {
    if (!Number.isInteger(dooh.venuetypetax) || !KNOWN_TAX.includes(dooh.venuetypetax)) {
      add({
        ruleId: "VEN-006",
        severity: "error",
        path: "$.dooh.venuetypetax",
        ref: REF.adcomVenueTax,
        message: `dooh.venuetypetax is ${JSON.stringify(dooh.venuetypetax)}, which is not a value in the AdCOM DOOH Venue Taxonomies list (0-5).`
      });
      return;
    }
    tax = dooh.venuetypetax;
  }
  const vt = dooh.venuetype;
  if (vt === void 0) {
    add({
      ruleId: "VEN-001",
      severity: "warning",
      path: "$.dooh.venuetype",
      ref: REF.ortbDooh,
      message: "dooh.venuetype is missing. Buyers cannot target by environment (airport, gym, roadside...) without it."
    });
    return;
  }
  if (!Array.isArray(vt) || vt.length === 0 || !vt.every((v) => typeof v === "string")) {
    add({
      ruleId: "VEN-002",
      severity: "error",
      path: "$.dooh.venuetype",
      ref: REF.ortbDooh,
      message: `dooh.venuetype must be a non-empty array of strings, got ${JSON.stringify(vt)}.`
    });
    return;
  }
  const taxonomy = TAXONOMIES[tax];
  if (!taxonomy) {
    add({
      ruleId: "VEN-005",
      severity: "info",
      path: "$.dooh.venuetypetax",
      ref: REF.adcomVenueTax,
      message: `Venue taxonomy ${tax} is not checked by this tool yet (only OpenOOH 1.0 and 1.1 are). Venue values were not validated.`
    });
    return;
  }
  const found = [];
  vt.forEach((raw, i) => {
    const s = raw.trim();
    const v = /^\d+$/.test(s) ? taxonomy.byId.get(Number(s)) : taxonomy.byName.get(s.toLowerCase());
    if (!v) {
      add({
        ruleId: "VEN-003",
        severity: "error",
        path: `$.dooh.venuetype[${i}]`,
        ref: REF.openooh,
        message: `"${raw}" is not a venue type in ${taxonomy.label}.`
      });
    } else {
      found.push(v);
    }
  });
  if (found.length > 0 && found.every((v) => v.id < 100)) {
    add({
      ruleId: "VEN-004",
      severity: "warning",
      path: "$.dooh.venuetype",
      ref: REF.openoohTiers,
      message: `Only a parent venue type is given (${found.map((v) => v.name).join(", ")}). Parent types are too broad to target; send at least a child type such as "transit.airports".`
    });
  }
}

// src/screens.ts
var VENUE_BY_ID = new Map(OPENOOH_1_1.map((v) => [String(v.id), v.name]));
var get = (obj, path) => path.split(".").reduce((o, k) => o == null ? void 0 : o[k], obj);
var median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
function haversineM(lat1, lon1, lat2, lon2) {
  const R = 63710088e-1;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
var tokens = (s) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1));
function nameSimilarity(a, b) {
  if (!a || !b) return 0;
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}
var normDomain = (d) => d ? d.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "") : void 0;
function venueOf(dooh) {
  const v = Array.isArray(dooh?.venuetype) ? dooh.venuetype[0] : dooh?.venuetypeid ?? dooh?.venuetype;
  if (v === void 0 || v === null) return void 0;
  const s = String(v).trim();
  return VENUE_BY_ID.get(s) ?? s.toLowerCase();
}
function readRecord(input2, sspPath) {
  let req = input2;
  let ssp;
  if (isObj(input2) && (isObj(input2.request) || isObj(input2.bidRequest))) {
    req = input2.request ?? input2.bidRequest;
    if (isNonEmptyStr(input2.ssp)) ssp = input2.ssp;
    else if (isNonEmptyStr(input2.exchange)) ssp = input2.exchange;
  }
  req = unwrap(req);
  if (!isObj(req) || !isObj(req.dooh)) return void 0;
  if (!ssp && sspPath) {
    const v = get(req, sspPath);
    if (isNonEmptyStr(v)) ssp = v;
  }
  if (!ssp) {
    const nodes = req.source?.schain?.nodes ?? req.source?.ext?.schain?.nodes;
    const last = Array.isArray(nodes) ? nodes[nodes.length - 1] : void 0;
    if (isNonEmptyStr(last?.asi)) ssp = last.asi;
  }
  return { req, ssp: (ssp ?? "unknown").toLowerCase() };
}
function buildListings(records, opts) {
  const accs = /* @__PURE__ */ new Map();
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
    const lat = isNum(geo.lat) ? geo.lat : void 0;
    const lon = isNum(geo.lon) ? geo.lon : isNum(geo.long) ? geo.long : void 0;
    const w = isNum(req.device?.w) ? req.device.w : void 0;
    const h = isNum(req.device?.h) ? req.device.h : void 0;
    const screenId = isNonEmptyStr(dooh.id) && dooh.id || isNonEmptyStr(req.device?.ifa) && req.device.ifa || isNonEmptyStr(dooh.name) && dooh.name || (lat !== void 0 && lon !== void 0 ? `${lat.toFixed(5)},${lon.toFixed(5)},${w ?? "?"}x${h ?? "?"}` : "");
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
          name: isNonEmptyStr(dooh.name) ? dooh.name : void 0,
          publisherId: isNonEmptyStr(dooh.publisher?.id) ? dooh.publisher.id : void 0,
          publisherDomain: normDomain(dooh.publisher?.domain ?? dooh.domain),
          lat,
          lon,
          w,
          h,
          venue: venueOf(dooh),
          requests: 0
        },
        multipliers: [],
        floors: [],
        paths: /* @__PURE__ */ new Map()
      };
      accs.set(key, acc);
    }
    acc.listing.requests++;
    for (const imp of imps(req)) {
      if (!isObj(imp)) continue;
      if (isNum(imp.qty?.multiplier) && imp.qty.multiplier > 0) acc.multipliers.push(imp.qty.multiplier);
      if (isNum(imp.bidfloor)) {
        acc.floors.push(imp.bidfloor);
        acc.currency ?? (acc.currency = isNonEmptyStr(imp.bidfloorcur) ? imp.bidfloorcur : "USD");
      }
    }
    const schain = req.source?.schain ?? req.source?.ext?.schain;
    const nodes = Array.isArray(schain?.nodes) ? schain.nodes.filter(isObj).map((n) => ({ asi: String(n.asi ?? "?"), sid: String(n.sid ?? "?"), hp: isNum(n.hp) ? n.hp : void 0 })) : [];
    const route = nodes.length ? nodes.map((n) => n.asi).join(" → ") : "(no schain)";
    const complete = isNum(schain?.complete) ? schain.complete : void 0;
    const pk = `${route}|${complete}`;
    const p = acc.paths.get(pk) ?? { route, nodes, hops: nodes.length, complete, requests: 0 };
    p.requests++;
    acc.paths.set(pk, p);
  }
  const listings = [...accs.values()].map((a) => {
    const multiplier = a.multipliers.length ? { min: Math.min(...a.multipliers), median: median(a.multipliers), max: Math.max(...a.multipliers) } : void 0;
    const floor = a.floors.length ? { median: median(a.floors), currency: a.currency ?? "USD" } : void 0;
    return {
      ...a.listing,
      multiplier,
      floor,
      costPerPlay: multiplier && floor ? floor.median / 1e3 * multiplier.median : void 0,
      paths: [...a.paths.values()].sort((x, y) => y.requests - x.requests)
    };
  });
  return { listings, skipped };
}
function matchScore(a, b, radiusM = 50) {
  if (a.lat === void 0 || a.lon === void 0 || b.lat === void 0 || b.lon === void 0) return void 0;
  const distanceM = haversineM(a.lat, a.lon, b.lat, b.lon);
  if (distanceM > radiusM) return void 0;
  let score = distanceM <= 10 ? 40 : distanceM <= 25 ? 30 : 20;
  let size = "unknown";
  if (a.w && a.h && b.w && b.h) {
    if (a.w === b.w && a.h === b.h) size = "same";
    else if (Math.abs(a.w / a.h - b.w / b.h) / (b.w / b.h) <= 0.02) size = "same-shape";
    else return void 0;
  }
  score += size === "same" ? 30 : size === "same-shape" ? 15 : 5;
  let venue2 = "unknown";
  if (a.venue && b.venue) {
    if (a.venue === b.venue) venue2 = "same";
    else if (a.venue.split(".")[0] === b.venue.split(".")[0]) venue2 = "same-parent";
    else return void 0;
  }
  score += venue2 === "same" ? 10 : venue2 === "same-parent" ? 5 : 0;
  const publisher = !!a.publisherDomain && a.publisherDomain === b.publisherDomain;
  if (publisher) score += 15;
  const sim = nameSimilarity(a.name, b.name);
  const name = sim >= 0.5;
  if (sim >= 0.3) score += Math.round(sim * 10);
  return { distanceM, size, venue: venue2, publisher, name, score: Math.min(100, score) };
}
function pathRank(l) {
  const p = l.paths[0];
  return [p?.complete === 1 ? 0 : 1, p ? p.hops || 99 : 99, l.costPerPlay ?? Number.POSITIVE_INFINITY];
}
var cmpRank = (a, b) => {
  const ra = pathRank(a);
  const rb = pathRank(b);
  return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2];
};
function analyzeScreens(records, opts = {}) {
  const radiusM = opts.radiusM ?? 50;
  const minScore = opts.minScore ?? 60;
  const { listings, skipped } = buildListings(records, opts);
  const pairs = [];
  for (let i = 0; i < listings.length; i++) {
    for (let j = i + 1; j < listings.length; j++) {
      if (listings[i].ssp === listings[j].ssp) continue;
      const m = matchScore(listings[i], listings[j], radiusM);
      if (m && m.score >= minScore) pairs.push({ i, j, m });
    }
  }
  pairs.sort((a, b) => b.m.score - a.m.score || a.m.distanceM - b.m.distanceM);
  const parent = listings.map((_, i) => i);
  const ssps = listings.map((l) => /* @__PURE__ */ new Set([l.ssp]));
  const weakest = /* @__PURE__ */ new Map();
  const find = (x) => parent[x] === x ? x : parent[x] = find(parent[x]);
  for (const { i, j, m } of pairs) {
    const ri = find(i);
    const rj = find(j);
    if (ri === rj) continue;
    if ([...ssps[ri]].some((s) => ssps[rj].has(s))) continue;
    parent[rj] = ri;
    for (const s of ssps[rj]) ssps[ri].add(s);
    const w = [weakest.get(ri), weakest.get(rj), m].filter(Boolean);
    weakest.set(ri, w.reduce((a, b) => b.score < a.score ? b : a));
  }
  const groups = /* @__PURE__ */ new Map();
  listings.forEach((l, i) => {
    const r = find(i);
    groups.set(r, [...groups.get(r) ?? [], l]);
  });
  const clusters = [];
  const singles = [];
  for (const [root, ls] of groups) {
    if (ls.length < 2) {
      singles.push(ls[0]);
      continue;
    }
    ls.sort(cmpRank);
    const best = ls[0];
    const w = weakest.get(root);
    const flags = [];
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
      flags
    });
  }
  clusters.sort((a, b) => b.listings.length - a.listings.length || (a.confidence === b.confidence ? 0 : a.confidence === "high" ? -1 : 1));
  clusters.forEach((c, i) => c.id = i + 1);
  const pathIssues = [];
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
    const hops = ls.map((l) => l.paths[0]?.hops).filter((h) => isNum(h) && h > 0);
    return {
      ssp,
      listings: ls.length,
      duplicated: ls.filter((l) => inCluster.has(l.key)).length,
      avgHops: hops.length ? Math.round(hops.reduce((a, b) => a + b, 0) / hops.length * 10) / 10 : null,
      incompleteChains: ls.filter((l) => l.paths[0] && l.paths[0].hops > 0 && l.paths[0].complete !== 1).length
    };
  });
  return {
    summary: {
      requests: records.length,
      skipped,
      listings: listings.length,
      screens: singles.length + clusters.length,
      duplicateClusters: clusters.length,
      duplicateShare: listings.length ? Math.round(inCluster.size / listings.length * 1e3) / 10 : 0,
      bySsp
    },
    clusters,
    singles,
    pathIssues
  };
}

// src/index.ts
var RULES = { structure, location: location2, venue, legacy, audience, timing, creative };
var DEFAULTS = {
  maxLeadTimeMs: 2 * 60 * 60 * 1e3,
  pastToleranceMs: 5 * 60 * 1e3,
  maxMultiplier: 1e4
};
var SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };
function validate(input2, opts = {}) {
  const req = unwrap(input2);
  const issues = [];
  if (!isObj(req)) {
    issues.push({
      ruleId: "STR-000",
      severity: "error",
      path: "$",
      ref: "OpenRTB 2.6 \xA73.2.1 (BidRequest)",
      message: "Input is not a JSON object, so it cannot be an OpenRTB bid request."
    });
    return finish(issues, []);
  }
  const disabled = new Set(opts.disable ?? []);
  const ctx = {
    req,
    options: {
      maxLeadTimeMs: opts.maxLeadTimeMs ?? DEFAULTS.maxLeadTimeMs,
      pastToleranceMs: opts.pastToleranceMs ?? DEFAULTS.pastToleranceMs,
      maxMultiplier: opts.maxMultiplier ?? DEFAULTS.maxMultiplier,
      now: opts.now
    },
    add: (issue) => {
      if (!disabled.has(issue.ruleId)) issues.push(issue);
    }
  };
  for (const rule of Object.values(RULES)) rule(ctx);
  return finish(issues, metrics(req));
}
function metrics(req) {
  return imps(req).filter(isObj).map((imp) => {
    const multiplier = isNum(imp.qty?.multiplier) && imp.qty.multiplier > 0 ? imp.qty.multiplier : void 0;
    const bidfloor = isNum(imp.bidfloor) ? imp.bidfloor : void 0;
    return {
      impId: typeof imp.id === "string" ? imp.id : void 0,
      multiplier,
      bidfloor,
      bidfloorcur: typeof imp.bidfloorcur === "string" ? imp.bidfloorcur : bidfloor !== void 0 ? "USD" : void 0,
      // OpenRTB 2.6 Implementation §7.9.4: cost = (price / 1000) * multiplier
      costPerPlayAtFloor: multiplier !== void 0 && bidfloor !== void 0 ? bidfloor / 1e3 * multiplier : void 0
    };
  });
}
function finish(issues, imps2) {
  issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.ruleId.localeCompare(b.ruleId));
  const counts = { error: 0, warning: 0, info: 0 };
  for (const i of issues) counts[i.severity]++;
  const score = Math.max(0, 100 - 25 * counts.error - 8 * counts.warning);
  return { valid: counts.error === 0, score, counts, issues, metrics: { imps: imps2 } };
}

// fixtures/screens/multi-ssp.jsonl
var multi_ssp_default = '{"id":"req-0001","imp":[{"id":"1","bidfloor":6,"bidfloorcur":"USD","banner":{"w":1080,"h":1920},"dt":1796137200000,"qty":{"multiplier":12,"sourcetype":1,"vendor":"measurement.example"}}],"dooh":{"id":"A-4471","name":"Woodward Ave Northbound Digital","venuetype":["outdoor.billboards.roadside"],"venuetypetax":1,"publisher":{"id":"example-outdoor.com","domain":"example-outdoor.com"}},"device":{"devicetype":8,"w":1080,"h":1920,"geo":{"lat":42.48721,"lon":-83.03312,"type":3}},"source":{"schain":{"complete":1,"ver":"1.0","nodes":[{"asi":"ssp-a.example","sid":"pub-88","hp":1}]}}}\n{"id":"req-0002","imp":[{"id":"1","bidfloor":6,"bidfloorcur":"USD","banner":{"w":1080,"h":1920},"dt":1796137200000,"qty":{"multiplier":12.5,"sourcetype":1,"vendor":"measurement.example"}}],"dooh":{"id":"A-4471","name":"Woodward Ave Northbound Digital","venuetype":["outdoor.billboards.roadside"],"venuetypetax":1,"publisher":{"id":"example-outdoor.com","domain":"example-outdoor.com"}},"device":{"devicetype":8,"w":1080,"h":1920,"geo":{"lat":42.48721,"lon":-83.03312,"type":3}},"source":{"schain":{"complete":1,"ver":"1.0","nodes":[{"asi":"ssp-a.example","sid":"pub-88","hp":1}]}}}\n{"id":"req-0003","imp":[{"id":"1","bidfloor":6,"bidfloorcur":"USD","banner":{"w":1080,"h":1920},"dt":1796137200000,"qty":{"multiplier":13,"sourcetype":1,"vendor":"measurement.example"}}],"dooh":{"id":"A-4471","name":"Woodward Ave Northbound Digital","venuetype":["outdoor.billboards.roadside"],"venuetypetax":1,"publisher":{"id":"example-outdoor.com","domain":"example-outdoor.com"}},"device":{"devicetype":8,"w":1080,"h":1920,"geo":{"lat":42.48721,"lon":-83.03312,"type":3}},"source":{"schain":{"complete":1,"ver":"1.0","nodes":[{"asi":"ssp-a.example","sid":"pub-88","hp":1}]}}}\n{"id":"req-0004","imp":[{"id":"1","bidfloor":6.5,"bidfloorcur":"USD","banner":{"w":1080,"h":1920},"dt":1796137200000,"qty":{"multiplier":18,"sourcetype":1,"vendor":"measurement.example"}}],"dooh":{"id":"B-99812","name":"Woodward Northbound Digital","venuetype":["30101"],"venuetypetax":1,"publisher":{"id":"example-outdoor.com","domain":"example-outdoor.com"}},"device":{"devicetype":8,"w":1080,"h":1920,"geo":{"lat":42.48725,"lon":-83.03312,"type":3}},"source":{"schain":{"complete":1,"ver":"1.0","nodes":[{"asi":"reseller.example","sid":"r-1","hp":1},{"asi":"ssp-b.example","sid":"rs-77","hp":1}]}}}\n{"id":"req-0005","imp":[{"id":"1","bidfloor":5,"bidfloorcur":"USD","banner":{"w":1080,"h":1920},"dt":1796137200000,"qty":{"multiplier":12.5,"sourcetype":1,"vendor":"measurement.example"}}],"dooh":{"id":"C-0042","name":"Woodward Ave N Digital","venuetype":["outdoor.billboards.roadside"],"venuetypetax":1,"publisher":{"id":"example-outdoor.com","domain":"example-outdoor.com"}},"device":{"devicetype":8,"w":1080,"h":1920,"geo":{"lat":42.48721,"lon":-83.0332,"type":3}},"source":{"schain":{"complete":0,"ver":"1.0","nodes":[{"asi":"ssp-c.example","sid":"c-pub-3","hp":1}]}}}\n{"id":"req-0006","imp":[{"id":"1","bidfloor":6,"bidfloorcur":"USD","banner":{"w":1920,"h":1080},"dt":1796137200000,"qty":{"multiplier":9,"sourcetype":1,"vendor":"measurement.example"}}],"dooh":{"id":"A-4472","name":"Woodward Ave Southbound Digital","venuetype":["outdoor.billboards.roadside"],"venuetypetax":1,"publisher":{"id":"example-outdoor.com","domain":"example-outdoor.com"}},"device":{"devicetype":8,"w":1920,"h":1080,"geo":{"lat":42.48721,"lon":-83.03312,"type":3}},"source":{"schain":{"complete":1,"ver":"1.0","nodes":[{"asi":"ssp-a.example","sid":"pub-88","hp":1}]}}}\n{"id":"req-0007","imp":[{"id":"1","bidfloor":6,"bidfloorcur":"USD","banner":{"w":1920,"h":1080},"dt":1796137200000,"qty":{"multiplier":9,"sourcetype":1,"vendor":"measurement.example"}}],"dooh":{"id":"B-99813","name":"Woodward Southbound Digital","venuetype":["outdoor.billboards.roadside"],"venuetypetax":1,"publisher":{"id":"example-outdoor.com","domain":"example-outdoor.com"}},"device":{"devicetype":8,"w":1920,"h":1080,"geo":{"lat":42.48723,"lon":-83.03313,"type":3}},"source":{"schain":{"complete":1,"ver":"1.0","nodes":[{"asi":"reseller.example","sid":"r-1","hp":1},{"asi":"ssp-b.example","sid":"rs-77","hp":1}]}}}\n{"id":"req-0008","imp":[{"id":"1","bidfloor":9,"bidfloorcur":"USD","banner":{"w":1080,"h":1920},"dt":1796137200000,"qty":{"multiplier":4,"sourcetype":1,"vendor":"measurement.example"}}],"dooh":{"id":"A-9001","name":"DTW McNamara Gate A36","venuetype":["transit.airports.gates"],"venuetypetax":1,"publisher":{"id":"metro-screens.example","domain":"metro-screens.example"}},"device":{"devicetype":8,"w":1080,"h":1920,"geo":{"lat":42.21242,"lon":-83.35341,"type":3}},"source":{"schain":{"complete":1,"ver":"1.0","nodes":[{"asi":"ssp-a.example","sid":"pub-12","hp":1}]}}}\n{"id":"req-0009","imp":[{"id":"1","bidfloor":9,"bidfloorcur":"USD","banner":{"w":1080,"h":1920},"dt":1796137200000,"qty":{"multiplier":4,"sourcetype":1,"vendor":"measurement.example"}}],"dooh":{"id":"B-5550","name":"Concourse Shops Display","venuetype":["retail.malls.concourse"],"venuetypetax":1,"publisher":{"id":"metro-screens.example","domain":"metro-screens.example"}},"device":{"devicetype":8,"w":1080,"h":1920,"geo":{"lat":42.21258,"lon":-83.35338,"type":3}},"source":{"schain":{"complete":1,"ver":"1.0","nodes":[{"asi":"ssp-b.example","sid":"b-pub-9","hp":1}]}}}\n{"id":"req-0010","imp":[{"id":"1","bidfloor":7,"bidfloorcur":"USD","banner":{"w":1080,"h":1920},"dt":1796137200000,"qty":{"multiplier":6,"sourcetype":1,"vendor":"measurement.example"}}],"dooh":{"id":"A-MALL-1","name":"Somerset Mall Concourse North","venuetype":["retail.malls.concourse"],"venuetypetax":1,"publisher":{"id":"metro-screens.example","domain":"metro-screens.example"}},"device":{"devicetype":8,"w":1080,"h":1920,"geo":{"lat":42.56241,"lon":-83.18402,"type":3}},"source":{"schain":{"complete":1,"ver":"1.0","nodes":[{"asi":"ssp-a.example","sid":"pub-12","hp":1}]}}}\n{"id":"req-0011","imp":[{"id":"1","bidfloor":7,"bidfloorcur":"USD","banner":{"w":1080,"h":1920},"dt":1796137200000,"qty":{"multiplier":6,"sourcetype":1,"vendor":"measurement.example"}}],"dooh":{"id":"A-MALL-2","name":"Somerset Mall Concourse South","venuetype":["retail.malls.concourse"],"venuetypetax":1,"publisher":{"id":"metro-screens.example","domain":"metro-screens.example"}},"device":{"devicetype":8,"w":1080,"h":1920,"geo":{"lat":42.56241,"lon":-83.18402,"type":3}},"source":{"schain":{"complete":1,"ver":"1.0","nodes":[{"asi":"ssp-a.example","sid":"pub-12","hp":1}]}}}\n{"ssp":"ssp-b.example","request":{"id":"req-0012","imp":[{"id":"1","bidfloor":7.5,"bidfloorcur":"USD","banner":{"w":1080,"h":1920},"dt":1796137200000,"qty":{"multiplier":6,"sourcetype":1,"vendor":"measurement.example"}}],"dooh":{"id":"B-MALL-X","name":"Somerset Mall Concourse North","venuetype":["20501"],"venuetypetax":1,"publisher":{"id":"metro-screens.example","domain":"metro-screens.example"}},"device":{"devicetype":8,"w":1080,"h":1920,"geo":{"lat":42.56243,"lon":-83.18401,"type":3}}}}\n{"ssp":"ssp-c.example","request":{"id":"req-0013","imp":[{"id":"1","bidfloor":10,"bidfloorcur":"USD","banner":{"w":1080,"h":1920},"dt":1796137200000,"qty":{"multiplier":2,"sourcetype":1,"vendor":"measurement.example"}}],"dooh":{"id":"C-7781","name":"Royal Oak Gym Lobby","venuetype":["health_beauty.gyms.lobby"],"venuetypetax":1,"publisher":{"id":"fit-screens.example","domain":"fit-screens.example"}},"device":{"devicetype":8,"w":1080,"h":1920,"geo":{"lat":42.48946,"lon":-83.14462,"type":3}}}}\n{"id":"req-0014","imp":[{"id":"1","bidfloor":6,"bidfloorcur":"USD","banner":{"w":1080,"h":1920},"dt":1796137200000,"qty":{"multiplier":12,"sourcetype":1,"vendor":"measurement.example"}}],"dooh":{"id":"B-12000","name":"Woodward Ave Northbound Digital","venuetype":["outdoor.billboards.roadside"],"venuetypetax":1,"publisher":{"id":"example-outdoor.com","domain":"example-outdoor.com"}},"device":{"devicetype":8,"w":1080,"h":1920,"geo":{"lat":42.33143,"lon":-83.04575,"type":3}},"source":{"schain":{"complete":1,"ver":"1.0","nodes":[{"asi":"ssp-b.example","sid":"b-pub-1","hp":1}]}}}\n{"id":"web-1","site":{"page":"https://example.com"},"imp":[{"id":"1","banner":{"w":300,"h":250}}]}\n';

// fixtures/valid/banner-roadside.json
var banner_roadside_default = {
  id: "req-0001",
  at: 1,
  tmax: 500,
  cur: [
    "USD"
  ],
  imp: [
    {
      id: "1",
      bidfloor: 6,
      bidfloorcur: "USD",
      banner: {
        w: 1080,
        h: 1920,
        format: [
          {
            w: 1080,
            h: 1920
          }
        ],
        mimes: [
          "image/jpeg",
          "image/png"
        ]
      },
      dt: 17961372e5,
      exp: 3600,
      qty: {
        multiplier: 12.5,
        sourcetype: 1,
        vendor: "measurement.example"
      }
    }
  ],
  dooh: {
    id: "screen-4471",
    name: "Woodward Ave Northbound Digital",
    venuetype: [
      "outdoor.billboards.roadside"
    ],
    venuetypetax: 1,
    publisher: {
      id: "pub-88",
      name: "Example Outdoor Media",
      domain: "example-outdoor.com"
    },
    domain: "example-outdoor.com"
  },
  device: {
    devicetype: 8,
    w: 1080,
    h: 1920,
    ifa: "screen-4471",
    ifa_type: "ppid",
    geo: {
      lat: 42.48721,
      lon: -83.03312,
      type: 3,
      country: "USA"
    }
  },
  source: {
    schain: {
      complete: 1,
      ver: "1.0",
      nodes: [
        {
          asi: "ssp.example",
          sid: "pub-88",
          hp: 1
        }
      ]
    }
  }
};

// fixtures/valid/video-venue-id.json
var video_venue_id_default = {
  id: "req-0002",
  at: 1,
  tmax: 500,
  cur: [
    "USD"
  ],
  imp: [
    {
      id: "1",
      bidfloor: 6,
      bidfloorcur: "USD",
      dt: 17961372e5,
      exp: 3600,
      qty: {
        multiplier: 12.5,
        sourcetype: 1,
        vendor: "measurement.example"
      },
      video: {
        mimes: [
          "video/mp4"
        ],
        w: 1920,
        h: 1080,
        maxduration: 15,
        boxingallowed: 0
      }
    }
  ],
  dooh: {
    id: "screen-4471",
    name: "Woodward Ave Northbound Digital",
    venuetype: [
      "30101"
    ],
    venuetypetax: 1,
    publisher: {
      id: "pub-88",
      name: "Example Outdoor Media",
      domain: "example-outdoor.com"
    },
    domain: "example-outdoor.com"
  },
  device: {
    devicetype: 8,
    w: 1920,
    h: 1080,
    ifa: "screen-4471",
    ifa_type: "ppid",
    geo: {
      lat: 42.48721,
      lon: -83.03312,
      type: 3,
      country: "USA"
    }
  },
  source: {
    schain: {
      complete: 1,
      ver: "1.0",
      nodes: [
        {
          asi: "ssp.example",
          sid: "pub-88",
          hp: 1
        }
      ]
    }
  }
};

// fixtures/invalid/legacy-field-names.json
var legacy_field_names_default = {
  id: "req-0001",
  at: 1,
  tmax: 500,
  cur: [
    "USD"
  ],
  imp: [
    {
      id: "1",
      bidfloor: 6,
      bidfloorcur: "USD",
      banner: {
        w: 1080,
        h: 1920,
        format: [
          {
            w: 1080,
            h: 1920
          }
        ],
        mimes: [
          "image/jpeg",
          "image/png"
        ]
      },
      dt: 17961372e5,
      exp: 3600,
      qty: {
        multiplier: 12.5,
        sourcetype: 1,
        vendor: "measurement.example"
      }
    }
  ],
  dooh: {
    id: "screen-4471",
    name: "Woodward Ave Northbound Digital",
    publisher: {
      id: "pub-88",
      name: "Example Outdoor Media",
      domain: "example-outdoor.com"
    },
    domain: "example-outdoor.com",
    venuetax: 1,
    venuetypeid: 30101
  },
  device: {
    devicetype: 8,
    w: 1080,
    h: 1920,
    ifa: "screen-4471",
    ifa_type: "ppid",
    geo: {
      lat: 42.48721,
      type: 3,
      country: "USA",
      long: -83.03312
    }
  },
  source: {
    schain: {
      complete: 1,
      ver: "1.0",
      nodes: [
        {
          asi: "ssp.example",
          sid: "pub-88",
          hp: 1
        }
      ]
    }
  }
};

// fixtures/invalid/null-island.json
var null_island_default = {
  id: "req-0001",
  at: 1,
  tmax: 500,
  cur: [
    "USD"
  ],
  imp: [
    {
      id: "1",
      bidfloor: 6,
      bidfloorcur: "USD",
      banner: {
        w: 1080,
        h: 1920,
        format: [
          {
            w: 1080,
            h: 1920
          }
        ],
        mimes: [
          "image/jpeg",
          "image/png"
        ]
      },
      dt: 17961372e5,
      exp: 3600,
      qty: {
        multiplier: 12.5,
        sourcetype: 1,
        vendor: "measurement.example"
      }
    }
  ],
  dooh: {
    id: "screen-4471",
    name: "Woodward Ave Northbound Digital",
    venuetype: [
      "outdoor.billboards.roadside"
    ],
    venuetypetax: 1,
    publisher: {
      id: "pub-88",
      name: "Example Outdoor Media",
      domain: "example-outdoor.com"
    },
    domain: "example-outdoor.com"
  },
  device: {
    devicetype: 8,
    w: 1080,
    h: 1920,
    ifa: "screen-4471",
    ifa_type: "ppid",
    geo: {
      lat: 0,
      lon: 0,
      type: 3,
      country: "USA"
    }
  },
  source: {
    schain: {
      complete: 1,
      ver: "1.0",
      nodes: [
        {
          asi: "ssp.example",
          sid: "pub-88",
          hp: 1
        }
      ]
    }
  }
};

// fixtures/upstream/iab-ortb26-example-video.json
var iab_ortb26_example_video_default = {
  id: "873465983764395",
  at: 1,
  imp: [
    {
      id: "123456",
      secure: 1,
      exp: 720,
      bidfloor: 4.8,
      bidfloorcur: "GBP",
      video: {
        boxingallowed: 1,
        w: 960,
        h: 480,
        maxduration: 20,
        minduration: 20,
        mimes: [
          "video/jpeg",
          "video/mp4",
          "video/mov"
        ]
      },
      pmp: {
        private_auction: 1,
        deals: [
          {
            id: "V123",
            at: 1,
            bidfloor: 4.5
          }
        ]
      },
      dt: 1647010095,
      qty: {
        multiplier: 14.2,
        sourcetype: 0,
        vendor: "route.org.uk"
      }
    }
  ],
  device: {
    geo: {
      lat: 51.51112,
      long: -0.09043,
      lastfix: 0
    },
    devicetype: 8,
    w: 960,
    h: 480,
    ppi: 3,
    ifa: "1234928801",
    ifa_type: "ppid",
    eids: [
      {
        source: "oohspace.co.uk",
        uids: [
          {
            atype: 501,
            id: "1234928801"
          }
        ]
      }
    ]
  },
  dooh: {
    content: {},
    id: "1Frame",
    keywords: "LargeFormat,CANNON STREET STN,CANNON STREET,MAIN CONCOURSE",
    name: "Transvision",
    publisher: {
      id: "VJCDUK",
      name: "viooh"
    },
    domain: "viooh.com",
    venuetax: 1,
    venuetypeid: 10602
  },
  cur: [
    "GBP"
  ]
};

// fixtures/upstream/iab-ortb26-example-banner.json
var iab_ortb26_example_banner_default = {
  id: "162059897743978051070",
  at: 1,
  imp: [
    {
      id: "007",
      secure: 1,
      exp: 360,
      bidfloor: 5,
      bidfloorcur: "GBP",
      banner: {
        w: 1080,
        h: 1920,
        format: [
          {
            w: 1080,
            h: 1920
          },
          {
            w: 720,
            h: 1366
          }
        ],
        mimes: [
          "image/jpg",
          "image/png",
          "text/html"
        ]
      },
      pmp: {
        private_auction: 0,
        deals: [
          {
            id: "123",
            at: 1,
            bidfloor: 4.5
          },
          {
            id: "333",
            at: 1,
            bidfloor: 3
          },
          {
            id: "444",
            at: 1,
            bidfloor: 2
          }
        ]
      },
      dt: 12345670,
      qty: {
        multiplier: 14.2,
        sourcetype: 1,
        vendor: "route.org.uk"
      }
    }
  ],
  device: {
    geo: {
      lat: 1e-4,
      long: -0.1235,
      lastfix: 0
    },
    devicetype: 8,
    w: 1080,
    h: 1920,
    ppi: 72,
    ifa: "1235461904",
    ifa_type: "ppid",
    eids: [
      {
        source: "oohspace.co.uk",
        uids: [
          {
            atype: 501,
            id: "1235461904"
          }
        ]
      }
    ]
  },
  dooh: {
    content: {},
    id: "15790",
    keywords: "Roadside, Billboard, D96",
    name: "This",
    publisher: {
      id: "G1",
      name: "Global"
    },
    domain: "global.com",
    venuetax: 1,
    venuetypeid: 30101
  },
  cur: [
    "GBP"
  ]
};

// fixtures/upstream/prebid-server-dooh.json
var prebid_server_dooh_default = {
  description: "Simple DOOH request",
  config: {
    mockBidders: [
      { bidderName: "appnexus", currency: "USD", price: 0 }
    ],
    bidderInfoOverrides: {
      appnexus: {
        capabilities: {
          dooh: {
            mediaTypes: ["banner"]
          }
        }
      }
    }
  },
  mockBidRequest: {
    id: "some-request-id",
    dooh: {
      id: "12345"
    },
    imp: [
      {
        id: "some-impression-id",
        banner: {
          format: [
            {
              w: 1920,
              h: 1080
            }
          ]
        },
        ext: {
          appnexus: {
            placementId: 12883451
          }
        }
      }
    ],
    tmax: 500,
    ext: {}
  },
  expectedBidResponse: {
    id: "some-request-id",
    seatbid: [
      {
        bid: [
          {
            id: "appnexus-bid",
            impid: "some-impression-id",
            price: 0
          }
        ],
        seat: "appnexus"
      }
    ],
    bidid: "test bid id",
    cur: "USD",
    nbr: 0
  },
  expectedReturnCode: 200
};

// web/main.ts
var SAMPLES = [
  { label: "Complete banner request (passes)", data: banner_roadside_default },
  { label: "Complete video request (passes)", data: video_venue_id_default },
  { label: "IAB OpenRTB 2.6 example: video", data: iab_ortb26_example_video_default },
  { label: "IAB OpenRTB 2.6 example: banner", data: iab_ortb26_example_banner_default },
  { label: "Prebid Server test request", data: prebid_server_dooh_default.mockBidRequest },
  { label: "Old field names (venuetax, geo.long)", data: legacy_field_names_default },
  { label: "Placeholder location (0,0)", data: null_island_default }
];
var $ = (id) => document.getElementById(id);
var input = $("input");
var report = $("report");
var sample = $("sample");
var optNow = $("opt-now");
var optMult = $("opt-mult");
SAMPLES.forEach((s, i) => {
  const o = document.createElement("option");
  o.value = String(i);
  o.textContent = s.label;
  sample.append(o);
});
var esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function parse(text) {
  const t = text.trim();
  if (!t) return { items: [] };
  try {
    const d = JSON.parse(t);
    return { items: Array.isArray(d) && d.length > 0 && typeof d[0] === "object" ? d : [d] };
  } catch (e) {
    const lines = t.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (lines.length > 1) {
      const items = [];
      for (let i = 0; i < lines.length; i++) {
        try {
          items.push(JSON.parse(lines[i]));
        } catch {
          return { items: [], error: `Line ${i + 1} is not valid JSON.

${e.message}` };
        }
      }
      return { items };
    }
    return { items: [], error: `This is not valid JSON.

${e.message}` };
  }
}
function scoreClass(score) {
  return score >= 80 ? "good" : score >= 50 ? "mid" : "bad";
}
function renderOne(r) {
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
  const priced = r.metrics.imps.filter((m) => m.costPerPlayAtFloor !== void 0);
  if (priced.length > 0) {
    html += `<h3>Cost per play at floor</h3>
      <table><thead><tr><th>Imp</th><th class="num">Floor CPM</th><th class="num">Multiplier</th><th class="num">Cost per play</th></tr></thead><tbody>` + priced.map((m) => `<tr><td>${esc(m.impId ?? "?")}</td><td class="num">${esc(m.bidfloor)} ${esc(m.bidfloorcur)}</td><td class="num">${esc(m.multiplier)}</td><td class="num">${m.costPerPlayAtFloor.toFixed(5)} ${esc(m.bidfloorcur)}</td></tr>`).join("") + `</tbody></table>`;
  }
  return html;
}
function renderMany(reports) {
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
      <table><thead><tr><th>Rule</th><th>Severity</th><th class="num">Requests</th><th class="num">Share</th></tr></thead><tbody>` + s.byRule.map((r) => `<tr><td><span class="tag">${esc(r.ruleId)}</span></td><td><span class="pill ${r.severity}">${r.severity}</span></td><td class="num">${r.requests}</td><td class="num">${r.percent}%</td></tr>`).join("") + `</tbody></table>`;
  }
  html += `<h3>Each request</h3>` + reports.map((r, i) => `
    <details class="req">
      <summary><span class="tag ${r.valid ? "valid" : "invalid"}">${r.valid ? "VALID" : "INVALID"}</span> Request ${i + 1} \xB7 score ${r.score}</summary>
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
  const opts = {};
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
$("file").addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  input.value = await f.text();
  e.target.value = "";
  run();
});
$("run").addEventListener("click", run);
$("clear").addEventListener("click", () => {
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
var tabs = [$("tab-check"), $("tab-screens")];
function selectTab(tab) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute("aria-controls")).hidden = !on;
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
var sInput = $("s-input");
var sReport = $("s-report");
var sRadius = $("s-radius");
var sScore = $("s-score");
var fmt = (n, digits = 4) => n === void 0 ? "–" : n.toFixed(digits);
function pathCell(l) {
  const p = l.paths[0];
  if (!p || p.hops === 0) return `<span class="route">no schain</span>`;
  const state = p.complete === 1 ? "complete" : `<strong style="color:var(--error)">incomplete</strong>`;
  const route = p.nodes.map((n) => `<span class="hop">${esc(n.asi)}</span>`).join(" → ");
  return `<span class="route">${route}</span><br><small>${p.hops} hop${p.hops === 1 ? "" : "s"}, ${state}</small>`;
}
function renderCluster(c) {
  const w = c.weakestMatch;
  const first = c.listings[0];
  const why = [`within ${Math.round(w.distanceM)} m`, `size ${w.size}`, `venue ${w.venue}`, w.publisher ? "same publisher domain" : "", w.name ? "similar name" : ""].filter(Boolean).join(" \xB7 ");
  return `
    <div class="cluster">
      <div class="cluster-head">
        <h4>${esc(first.name ?? first.screenId)}</h4>
        <span class="conf ${c.confidence}">${c.confidence} confidence \xB7 score ${w.score}</span>
        <span class="why">${esc(first.venue ?? "")}${first.venue ? " \xB7 " : ""}${esc(why)}</span>
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
  const opts = {};
  const radius = Number(sRadius.value);
  if (Number.isFinite(radius) && radius > 0) opts.radiusM = radius;
  const score = Number(sScore.value);
  if (Number.isFinite(score) && score > 0) opts.minScore = score;
  const r = analyzeScreens(items, opts);
  const s = r.summary;
  let html = `
    <div class="cards">
      <div class="card"><b>${s.requests}</b><span>requests</span></div>
      <div class="card"><b>${s.listings}</b><span>listings (SSP \xD7 screen ID)</span></div>
      <div class="card"><b>${s.screens}</b><span>physical screens (est.)</span></div>
      <div class="card"><b>${s.duplicateClusters}</b><span>sold by 2+ SSPs</span></div>
    </div>`;
  if (s.skipped) html += `<p class="note">Skipped ${s.skipped} record${s.skipped === 1 ? "" : "s"} that ${s.skipped === 1 ? "is" : "are"} not a DOOH bid request.</p>`;
  html += `<h3>By SSP</h3><div class="scroll"><table>
    <thead><tr><th>SSP</th><th class="num">Listings</th><th class="num">Also sold elsewhere</th><th class="num">Avg hops</th><th class="num">Incomplete chains</th></tr></thead>
    <tbody>${s.bySsp.map((b) => `<tr><td>${esc(b.ssp)}</td><td class="num">${b.listings}</td><td class="num">${b.duplicated}</td><td class="num">${b.avgHops ?? "–"}</td><td class="num">${b.incompleteChains}</td></tr>`).join("")}</tbody>
  </table></div>`;
  html += `<h3>Screens sold through more than one SSP</h3>`;
  html += r.clusters.length ? r.clusters.map(renderCluster).join("") : `<div class="all-clear">No screen appears under more than one SSP in this batch.</div>`;
  if (r.pathIssues.length) {
    html += `<h3>Supply path issues</h3><ul class="issues">` + r.pathIssues.map((p) => `<li class="issue warning"><div class="issue-top"><span class="rule">${esc(p.listing)}</span><span>${esc(p.issue)}</span></div></li>`).join("") + `</ul>`;
  }
  html += `<p class="note">★ = best path for that screen: complete supply chain first, then fewest hops, then lowest cost per play at floor. Matching is an estimate: check high-value matches before acting on them.</p>`;
  sReport.innerHTML = html;
}
$("s-sample").addEventListener("click", () => {
  sInput.value = multi_ssp_default.trim();
  runScreens();
});
$("s-file").addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  sInput.value = await f.text();
  e.target.value = "";
  runScreens();
});
$("s-run").addEventListener("click", runScreens);
$("s-clear").addEventListener("click", () => {
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
