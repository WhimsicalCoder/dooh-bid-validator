import { REF } from "../refs.js";
import { RuleContext } from "../types.js";
import { imps, isNonEmptyStr, isObj } from "../util.js";

/** Basic shape of a DOOH bid request. */
export function structure({ req, add }: RuleContext): void {
  if (!isNonEmptyStr(req.id)) {
    add({ ruleId: "STR-001", severity: "error", path: "$.id", ref: REF.ortbRequest,
      message: "Bid request has no id." });
  }

  if (!isObj(req.dooh)) {
    add({ ruleId: "STR-002", severity: "error", path: "$.dooh", ref: REF.ortbDooh,
      message: "No dooh object. Without it, buyers cannot tell this is DOOH inventory." });
  }

  const others = ["site", "app"].filter((k) => req[k] !== undefined);
  if (req.dooh !== undefined && others.length > 0) {
    add({ ruleId: "STR-003", severity: "error", path: `$.${others[0]}`, ref: REF.ortbDooh,
      message: `Request has both dooh and ${others.join(" and ")}. A DOOH request must not contain a site or app object.` });
  }

  if (!Array.isArray(req.imp) || req.imp.length === 0) {
    add({ ruleId: "STR-004", severity: "error", path: "$.imp", ref: REF.ortbRequest,
      message: "Bid request has no impressions (imp array missing or empty)." });
  }
  imps(req).forEach((imp, i) => {
    if (!isObj(imp) || !isNonEmptyStr(imp.id)) {
      add({ ruleId: "STR-004", severity: "error", path: `$.imp[${i}].id`, ref: REF.ortbImp,
        message: `Impression ${i} has no id.` });
    }
  });

  if (isObj(req.dooh)) {
    if (!isNonEmptyStr(req.dooh.id)) {
      add({ ruleId: "STR-005", severity: "warning", path: "$.dooh.id", ref: REF.ortbDooh,
        message: "dooh.id is missing (recommended). Without a placement ID, buyers cannot track or deduplicate screens." });
    }
    if (!isObj(req.dooh.publisher) || !isNonEmptyStr(req.dooh.publisher.id)) {
      add({ ruleId: "STR-006", severity: "warning", path: "$.dooh.publisher.id", ref: REF.buyer,
        message: "dooh.publisher.id is missing. Buyers need it to match the media owner against sellers.json for supply path checks." });
    }
  }

  const dt = req.device?.devicetype;
  if (dt === undefined) {
    add({ ruleId: "STR-007", severity: "warning", path: "$.device.devicetype", ref: REF.implDevice,
      message: "device.devicetype is missing. DOOH screens should be identified as type 8 (OOH device)." });
  } else if (dt !== 8) {
    add({ ruleId: "STR-007", severity: "warning", path: "$.device.devicetype", ref: REF.adcomDeviceTypes,
      message: `device.devicetype is ${JSON.stringify(dt)}. DOOH screens should be identified as type 8 (OOH device).` });
  }
}
