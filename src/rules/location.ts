import { REF } from "../refs.js";
import { RuleContext } from "../types.js";
import { decimals, isNum, isObj } from "../util.js";

/**
 * Screen location. DOOH screens usually sit on private networks, so IP geolocation
 * does not work: lat/lon is the only reliable location signal for a buyer.
 */
export function location({ req, add }: RuleContext): void {
  const geo = req.device?.geo;
  if (!isObj(geo)) {
    add({ ruleId: "LOC-001", severity: "error", path: "$.device.geo", ref: REF.implDevice,
      message: "device.geo is missing. lat/lon is required for DOOH because IP-based location does not work for screens." });
    return;
  }

  const { lat, lon } = geo;
  if (lat === undefined || lon === undefined) {
    const missing = [lat === undefined && "lat", lon === undefined && "lon"].filter(Boolean).join(" and ");
    add({ ruleId: "LOC-001", severity: "error", path: "$.device.geo", ref: REF.implDevice,
      message: `device.geo.${missing} missing. lat/lon is required for DOOH transactions.` });
    return;
  }

  if (!isNum(lat) || lat < -90 || lat > 90 || !isNum(lon) || lon < -180 || lon > 180) {
    add({ ruleId: "LOC-002", severity: "error", path: "$.device.geo", ref: REF.ortbGeo,
      message: `Invalid coordinates (lat ${JSON.stringify(lat)}, lon ${JSON.stringify(lon)}). lat must be a number from -90 to 90 and lon from -180 to 180.` });
    return;
  }

  if (Math.abs(lat) < 0.001 && Math.abs(lon) < 0.001) {
    add({ ruleId: "LOC-003", severity: "warning", path: "$.device.geo", ref: REF.buyer,
      message: `Coordinates are at or next to 0,0 ("Null Island" in the Atlantic). This is almost always a placeholder, not a real screen.` });
  } else if (decimals(lat) < 3 || decimals(lon) < 3) {
    add({ ruleId: "LOC-004", severity: "warning", path: "$.device.geo", ref: REF.buyer,
      message: `Coordinates have fewer than 3 decimal places (lat ${lat}, lon ${lon}), so the screen's position is only known to within about 100 m or worse.` });
  }

  if (geo.type === undefined) {
    add({ ruleId: "LOC-005", severity: "info", path: "$.device.geo.type", ref: REF.ortbGeo,
      message: "device.geo.type is missing (recommended when passing lat/lon). It tells buyers where the location came from." });
  }
}
