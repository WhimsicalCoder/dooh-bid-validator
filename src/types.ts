export type Severity = "error" | "warning" | "info";

export interface Issue {
  /** Stable rule ID, e.g. "LOC-001". */
  ruleId: string;
  severity: Severity;
  message: string;
  /** JSON path of the field the issue is about, e.g. "$.imp[0].qty.multiplier". */
  path: string;
  /** Where the requirement comes from (spec section or guideline). */
  ref: string;
}

export interface ImpMetrics {
  impId: string | undefined;
  multiplier: number | undefined;
  bidfloor: number | undefined;
  bidfloorcur: string | undefined;
  /** Media cost of one play at the floor price: (bidfloor / 1000) * multiplier. */
  costPerPlayAtFloor: number | undefined;
}

export interface Report {
  /** True when there are no errors. Warnings and info do not make a request invalid. */
  valid: boolean;
  /** 0-100. Starts at 100; each error costs 25 points, each warning 8. */
  score: number;
  counts: Record<Severity, number>;
  issues: Issue[];
  metrics: { imps: ImpMetrics[] };
}

export interface ValidateOptions {
  /**
   * Reference time (ms since epoch) for lead-time checks on imp.dt.
   * Leave unset when validating historical logs: the lead-time rules are then skipped.
   */
  now?: number;
  /** Warn when imp.dt is further ahead than this (ms). Default: 2 hours, per IAB guidance. */
  maxLeadTimeMs?: number;
  /** Warn when imp.dt is in the past by more than this (ms). Default: 5 minutes. */
  pastToleranceMs?: number;
  /** Warn when qty.multiplier is above this. Default: 10000. */
  maxMultiplier?: number;
  /** Rule IDs to skip. */
  disable?: string[];
}

export interface RuleContext {
  req: any;
  options: Required<Omit<ValidateOptions, "now" | "disable">> & { now?: number };
  add: (issue: Issue) => void;
}

export type Rule = (ctx: RuleContext) => void;
