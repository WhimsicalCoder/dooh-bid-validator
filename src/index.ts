import { audience } from "./rules/audience.js";
import { creative } from "./rules/creative.js";
import { legacy } from "./rules/legacy.js";
import { location } from "./rules/location.js";
import { structure } from "./rules/structure.js";
import { timing } from "./rules/timing.js";
import { venue } from "./rules/venue.js";
import { ImpMetrics, Issue, Report, Rule, RuleContext, Severity, ValidateOptions } from "./types.js";
import { imps, isNum, isObj } from "./util.js";

export * from "./types.js";

export const RULES: Record<string, Rule> = { structure, location, venue, legacy, audience, timing, creative };

const DEFAULTS = {
  maxLeadTimeMs: 2 * 60 * 60 * 1000,
  pastToleranceMs: 5 * 60 * 1000,
  maxMultiplier: 10000,
};

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/**
 * Accepts a plain OpenRTB bid request, or a Prebid Server test file
 * (which wraps the request in "mockBidRequest").
 */
export function unwrap(input: any): any {
  if (isObj(input) && isObj(input.mockBidRequest)) return input.mockBidRequest;
  return input;
}

export function validate(input: unknown, opts: ValidateOptions = {}): Report {
  const req = unwrap(input);
  const issues: Issue[] = [];

  if (!isObj(req)) {
    issues.push({ ruleId: "STR-000", severity: "error", path: "$", ref: "OpenRTB 2.6 §3.2.1 (BidRequest)",
      message: "Input is not a JSON object, so it cannot be an OpenRTB bid request." });
    return finish(issues, []);
  }

  const disabled = new Set(opts.disable ?? []);
  const ctx: RuleContext = {
    req,
    options: {
      maxLeadTimeMs: opts.maxLeadTimeMs ?? DEFAULTS.maxLeadTimeMs,
      pastToleranceMs: opts.pastToleranceMs ?? DEFAULTS.pastToleranceMs,
      maxMultiplier: opts.maxMultiplier ?? DEFAULTS.maxMultiplier,
      now: opts.now,
    },
    add: (issue) => {
      if (!disabled.has(issue.ruleId)) issues.push(issue);
    },
  };

  for (const rule of Object.values(RULES)) rule(ctx);
  return finish(issues, metrics(req));
}

function metrics(req: any): ImpMetrics[] {
  return imps(req).filter(isObj).map((imp) => {
    const multiplier = isNum(imp.qty?.multiplier) && imp.qty.multiplier > 0 ? imp.qty.multiplier : undefined;
    const bidfloor = isNum(imp.bidfloor) ? imp.bidfloor : undefined;
    return {
      impId: typeof imp.id === "string" ? imp.id : undefined,
      multiplier,
      bidfloor,
      bidfloorcur: typeof imp.bidfloorcur === "string" ? imp.bidfloorcur : bidfloor !== undefined ? "USD" : undefined,
      // OpenRTB 2.6 Implementation §7.9.4: cost = (price / 1000) * multiplier
      costPerPlayAtFloor: multiplier !== undefined && bidfloor !== undefined ? (bidfloor / 1000) * multiplier : undefined,
    };
  });
}

function finish(issues: Issue[], imps: ImpMetrics[]): Report {
  issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.ruleId.localeCompare(b.ruleId));
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const i of issues) counts[i.severity]++;
  const score = Math.max(0, 100 - 25 * counts.error - 8 * counts.warning);
  return { valid: counts.error === 0, score, counts, issues, metrics: { imps } };
}
