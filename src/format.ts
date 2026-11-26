import { Report, Severity } from "./types.js";

const ICON: Record<Severity, string> = { error: "✖", warning: "▲", info: "·" };

export function formatReport(report: Report, label?: string): string {
  const lines: string[] = [];
  const status = report.valid ? "VALID" : "INVALID";
  const { error, warning, info } = report.counts;
  lines.push(`${label ? label + "  " : ""}${status}  score ${report.score}/100  (${error} errors, ${warning} warnings, ${info} info)`);

  for (const i of report.issues) {
    lines.push(`  ${ICON[i.severity]} ${i.ruleId}  ${i.message}`);
    lines.push(`      at ${i.path}  [${i.ref}]`);
  }

  for (const m of report.metrics.imps) {
    if (m.costPerPlayAtFloor !== undefined) {
      lines.push(`  $ imp ${m.impId ?? "?"}: floor ${m.bidfloor} ${m.bidfloorcur} CPM × multiplier ${m.multiplier} = ${m.costPerPlayAtFloor.toFixed(5)} ${m.bidfloorcur} per play`);
    }
  }
  return lines.join("\n");
}

export interface Summary {
  requests: number;
  valid: number;
  averageScore: number;
  byRule: Array<{ ruleId: string; severity: Severity; requests: number; percent: number }>;
}

/** Aggregate many reports: how often each rule fired, counted once per request. */
export function summarize(reports: Report[]): Summary {
  const byRule = new Map<string, { severity: Severity; requests: number }>();
  for (const r of reports) {
    const seen = new Set<string>();
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
    averageScore: n ? Math.round((reports.reduce((s, r) => s + r.score, 0) / n) * 10) / 10 : 0,
    byRule: [...byRule.entries()]
      .map(([ruleId, e]) => ({ ruleId, ...e, percent: n ? Math.round((e.requests / n) * 1000) / 10 : 0 }))
      .sort((a, b) => b.requests - a.requests || a.ruleId.localeCompare(b.ruleId)),
  };
}

export function formatSummary(s: Summary): string {
  const lines = [
    `${s.requests} requests, ${s.valid} valid (${s.requests ? Math.round((s.valid / s.requests) * 100) : 0}%), average score ${s.averageScore}/100`,
    "",
    "Rule      Severity  Requests  Share",
  ];
  for (const r of s.byRule) {
    lines.push(`${r.ruleId.padEnd(10)}${r.severity.padEnd(10)}${String(r.requests).padStart(8)}  ${String(r.percent).padStart(5)}%`);
  }
  return lines.join("\n");
}
