import { OPENOOH_1_0, OPENOOH_1_1, Venue } from "../data/venues.js";
import { REF } from "../refs.js";
import { RuleContext } from "../types.js";
import { isObj } from "../util.js";

const index = (list: Venue[]) => {
  const byId = new Map<number, Venue>();
  const byName = new Map<string, Venue>();
  for (const v of list) {
    byId.set(v.id, v);
    byName.set(v.name, v);
  }
  return { byId, byName };
};

/** venuetypetax value -> taxonomy we can check against. */
const TAXONOMIES: Record<number, { label: string; byId: Map<number, Venue>; byName: Map<string, Venue> }> = {
  1: { label: "OpenOOH 1.0", ...index(OPENOOH_1_0) },
  5: { label: "OpenOOH 1.1", ...index(OPENOOH_1_1) },
};

const KNOWN_TAX = [0, 1, 2, 3, 4, 5];

/** Venue type of the screen, checked against the OpenOOH taxonomy. */
export function venue({ req, add }: RuleContext): void {
  const dooh = req.dooh;
  if (!isObj(dooh)) return; // STR-002 already reported

  // Taxonomy in use. OpenRTB 2.6 default is 1 (OpenOOH 1.0).
  let tax = 1;
  if (dooh.venuetypetax !== undefined) {
    if (!Number.isInteger(dooh.venuetypetax) || !KNOWN_TAX.includes(dooh.venuetypetax)) {
      add({ ruleId: "VEN-006", severity: "error", path: "$.dooh.venuetypetax", ref: REF.adcomVenueTax,
        message: `dooh.venuetypetax is ${JSON.stringify(dooh.venuetypetax)}, which is not a value in the AdCOM DOOH Venue Taxonomies list (0-5).` });
      return;
    }
    tax = dooh.venuetypetax;
  }

  const vt = dooh.venuetype;
  if (vt === undefined) {
    // Legacy fields (venuetypeid etc.) are reported by the legacy rules; still flag the gap.
    add({ ruleId: "VEN-001", severity: "warning", path: "$.dooh.venuetype", ref: REF.ortbDooh,
      message: "dooh.venuetype is missing. Buyers cannot target by environment (airport, gym, roadside...) without it." });
    return;
  }

  if (!Array.isArray(vt) || vt.length === 0 || !vt.every((v) => typeof v === "string")) {
    add({ ruleId: "VEN-002", severity: "error", path: "$.dooh.venuetype", ref: REF.ortbDooh,
      message: `dooh.venuetype must be a non-empty array of strings, got ${JSON.stringify(vt)}.` });
    return;
  }

  const taxonomy = TAXONOMIES[tax];
  if (!taxonomy) {
    add({ ruleId: "VEN-005", severity: "info", path: "$.dooh.venuetypetax", ref: REF.adcomVenueTax,
      message: `Venue taxonomy ${tax} is not checked by this tool yet (only OpenOOH 1.0 and 1.1 are). Venue values were not validated.` });
    return;
  }

  const found: Venue[] = [];
  vt.forEach((raw: string, i: number) => {
    const s = raw.trim();
    const v = /^\d+$/.test(s) ? taxonomy.byId.get(Number(s)) : taxonomy.byName.get(s.toLowerCase());
    if (!v) {
      add({ ruleId: "VEN-003", severity: "error", path: `$.dooh.venuetype[${i}]`, ref: REF.openooh,
        message: `"${raw}" is not a venue type in ${taxonomy.label}.` });
    } else {
      found.push(v);
    }
  });

  // OpenOOH: "No screens should be solely assigned to a parent venue type."
  if (found.length > 0 && found.every((v) => v.id < 100)) {
    add({ ruleId: "VEN-004", severity: "warning", path: "$.dooh.venuetype", ref: REF.openoohTiers,
      message: `Only a parent venue type is given (${found.map((v) => v.name).join(", ")}). Parent types are too broad to target; send at least a child type such as "transit.airports".` });
  }
}
