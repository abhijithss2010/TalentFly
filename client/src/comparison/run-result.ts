import type { ProviderUsage } from '../providers/provider-adapter';
import type { GapReport } from './gap-report';

/** One compared resume. */
export type RunReportEntry = {
  resumeId: string;
  resumeName: string;
  model: string;
  report: GapReport;
  usage: ProviderUsage;
  completedAt: string;
};

/** A resume that could not be compared in this run. */
export type RunFailureEntry = {
  resumeId: string;
  resumeName: string;
  error: string;
};

/** Saved on `ComparisonRunRecord.result`. Reloading it never calls the provider. */
export type RunResult = {
  version: 1;
  reports: RunReportEntry[];
  failures: RunFailureEntry[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * Reads a saved run result defensively (it may come from an import or an older build).
 * Returns null when it is missing or not a result this version understands.
 */
export function parseRunResult(value: unknown): RunResult | null {
  if (!isRecord(value) || value.version !== 1) return null;
  if (!Array.isArray(value.reports) || !Array.isArray(value.failures)) return null;

  const reportsValid = value.reports.every((entry) => {
    if (!isRecord(entry) || !isRecord(entry.report)) return false;
    const report = entry.report;
    return (
      isText(entry.resumeId) &&
      isText(entry.resumeName) &&
      isText(entry.model) &&
      isText(entry.completedAt) &&
      isRecord(entry.usage) &&
      typeof report.matchScore === 'number' &&
      isText(report.summary) &&
      Array.isArray(report.requirements) &&
      Array.isArray(report.keywordGaps) &&
      Array.isArray(report.suggestions)
    );
  });
  const failuresValid = value.failures.every(
    (entry) =>
      isRecord(entry) &&
      isText(entry.resumeId) &&
      isText(entry.resumeName) &&
      isText(entry.error),
  );
  return reportsValid && failuresValid ? (value as unknown as RunResult) : null;
}
