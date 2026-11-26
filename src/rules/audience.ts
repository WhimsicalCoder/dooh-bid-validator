import { REF } from "../refs.js";
import { RuleContext } from "../types.js";
import { imps, isNonEmptyStr, isNum, isObj } from "../util.js";

const SOURCE_TYPES: Record<number, string> = {
  0: "unknown",
  1: "measurement vendor",
  2: "publisher",
  3: "exchange",
};

/**
 * The impression multiplier: how many people one play is counted as.
 * It sets what the buyer pays, so where it comes from matters.
 */
export function audience({ req, add, options }: RuleContext): void {
  imps(req).forEach((imp, i) => {
    if (!isObj(imp)) return;
    const p = `$.imp[${i}].qty`;
    const qty = imp.qty;

    if (!isObj(qty)) {
      add({ ruleId: "AUD-001", severity: "error", path: p, ref: REF.implMultiplier,
        message: `Impression ${i} has no qty object, so there is no impression multiplier. Buyers cannot tell how many impressions one play is worth.` });
      return;
    }

    const m = qty.multiplier;
    if (!isNum(m) || m <= 0) {
      add({ ruleId: "AUD-002", severity: "error", path: `${p}.multiplier`, ref: REF.ortbQty,
        message: `qty.multiplier must be a number greater than 0 (required), got ${JSON.stringify(m)}.` });
    } else if (m > options.maxMultiplier) {
      add({ ruleId: "AUD-003", severity: "warning", path: `${p}.multiplier`, ref: REF.buyer,
        message: `qty.multiplier is ${m}, above the ${options.maxMultiplier} limit. Check how this audience estimate was made before buying.` });
    }

    const st = qty.sourcetype;
    if (st === undefined) {
      add({ ruleId: "AUD-004", severity: "warning", path: `${p}.sourcetype`, ref: REF.ortbQty,
        message: "qty.sourcetype is missing (recommended). Buyers cannot tell who measured the audience." });
    } else if (!Number.isInteger(st) || !(st in SOURCE_TYPES)) {
      add({ ruleId: "AUD-005", severity: "error", path: `${p}.sourcetype`, ref: REF.adcomSourceTypes,
        message: `qty.sourcetype is ${JSON.stringify(st)}. Allowed values: 0 unknown, 1 measurement vendor, 2 publisher, 3 exchange.` });
    } else if (st === 1 && !isNonEmptyStr(qty.vendor)) {
      add({ ruleId: "AUD-006", severity: "error", path: `${p}.vendor`, ref: REF.ortbQty,
        message: "qty.sourcetype is 1 (measurement vendor) but qty.vendor is missing. The vendor's domain is required in this case." });
    } else if (st !== 1) {
      add({ ruleId: "AUD-007", severity: "info", path: `${p}.sourcetype`, ref: REF.buyer,
        message: `Audience source is "${SOURCE_TYPES[st]}", not an independent measurement vendor.` });
    }
  });
}
