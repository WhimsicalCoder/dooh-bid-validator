import { REF } from "../refs.js";
import { RuleContext } from "../types.js";
import { imps, isNum, isObj } from "../util.js";

// A plausible imp.dt is a millisecond timestamp between 2015 and 2100.
const MIN_MS = Date.UTC(2015, 0, 1);
const MAX_MS = Date.UTC(2100, 0, 1);

const fmtDuration = (ms: number) => {
  const min = Math.round(Math.abs(ms) / 60000);
  return min < 120 ? `${min} min` : `${(min / 60).toFixed(1)} h`;
};

/** imp.dt: when the ad is expected to play. */
export function timing({ req, add, options }: RuleContext): void {
  imps(req).forEach((imp, i) => {
    if (!isObj(imp)) return;
    const p = `$.imp[${i}].dt`;
    const dt = imp.dt;

    if (dt === undefined) {
      add({ ruleId: "TIM-001", severity: "warning", path: p, ref: REF.ortbImp,
        message: `Impression ${i} has no dt, so buyers don't know when the ad will play (matters for dayparting and pacing).` });
      return;
    }

    if (!isNum(dt) || dt < MIN_MS || dt > MAX_MS) {
      let hint = "";
      if (isNum(dt) && dt * 1000 >= MIN_MS && dt * 1000 <= MAX_MS) hint = " It looks like seconds; OpenRTB uses milliseconds.";
      add({ ruleId: "TIM-002", severity: "error", path: p, ref: REF.ortbImp,
        message: `imp.dt is ${JSON.stringify(dt)}, which is not a plausible Unix timestamp in milliseconds.${hint}` });
      return;
    }

    if (options.now === undefined) return; // lead-time checks need a reference time

    const lead = dt - options.now;
    if (lead < -options.pastToleranceMs) {
      add({ ruleId: "TIM-003", severity: "warning", path: p, ref: REF.implLeadTime,
        message: `imp.dt is ${fmtDuration(lead)} in the past. The play time has already gone by.` });
    } else if (lead > options.maxLeadTimeMs) {
      add({ ruleId: "TIM-004", severity: "warning", path: p, ref: REF.implLeadTime,
        message: `imp.dt is ${fmtDuration(lead)} ahead, longer than the ${fmtDuration(options.maxLeadTimeMs)} lead time limit. The accepted lead time is up to 1-2 hours.` });
    }
  });
}
