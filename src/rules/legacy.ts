import { REF } from "../refs.js";
import { RuleContext } from "../types.js";
import { isObj } from "../util.js";

/**
 * Field names that look right but are not OpenRTB 2.6. A buyer's parser silently ignores
 * them, so the data is effectively missing. Several of these appear even in the IAB's own
 * DOOH example request (Implementation §7.9.6.1).
 */
export function legacy({ req, add }: RuleContext): void {
  const dooh = req.dooh;
  if (isObj(dooh)) {
    if (dooh.venuetax !== undefined) {
      add({ ruleId: "LEG-001", severity: "warning", path: "$.dooh.venuetax", ref: REF.ortbDooh,
        message: "dooh.venuetax is not an OpenRTB 2.6 field. The field is called venuetypetax." });
    }
    if (dooh.venuetypeid !== undefined) {
      add({ ruleId: "LEG-002", severity: "warning", path: "$.dooh.venuetypeid", ref: REF.ortbDooh,
        message: "dooh.venuetypeid is not an OpenRTB 2.6 field. Send the venue in dooh.venuetype as an array of strings, e.g. [\"30101\"] or [\"outdoor.billboards.roadside\"]." });
    }
  }

  const geo = req.device?.geo;
  if (isObj(geo) && geo.long !== undefined) {
    add({ ruleId: "LEG-003", severity: "warning", path: "$.device.geo.long", ref: REF.ortbGeo,
      message: "device.geo.long is not an OpenRTB field. Longitude goes in device.geo.lon." });
  }

  const ext = req.device?.ext?.dooh;
  if (isObj(ext)) {
    const keys = ["venuetypelist", "venuetypeid", "venuetypestring"].filter((k) => ext[k] !== undefined);
    if (keys.length > 0) {
      add({ ruleId: "LEG-004", severity: "info", path: "$.device.ext.dooh", ref: REF.ortbDooh,
        message: `Venue sent in the OpenRTB 2.5-era extension (device.ext.dooh.${keys.join(", ")}). OpenRTB 2.6 buyers look in dooh.venuetype.` });
    }
  }
}
