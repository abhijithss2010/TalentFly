import type { ComparisonRunRecord, JobRecord } from '../data/models';
import { slugify } from './download';
import { parseRunResult, type RunReportEntry } from './run-result';

/** Keeps free text on one line so it cannot start headings, lists, or tables of its own. */
function inline(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function quote(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`.trimEnd())
    .join('\n');
}

const STATUS_LABEL = { met: 'Met', weak: 'Weak', missing: 'Missing' } as const;

function reportSection(entry: RunReportEntry): string[] {
  const { report } = entry;
  const lines: string[] = [
    `## Resume: ${inline(entry.resumeName)}`,
    '',
    `**Match: ${report.matchScore}/100**`,
    '',
    inline(report.summary),
    '',
  ];

  if (report.requirements.length > 0) {
    lines.push('### Requirements', '');
    for (const item of report.requirements) {
      lines.push(`- **${STATUS_LABEL[item.status]}**: ${inline(item.requirement)}`);
      if (item.evidence) {
        lines.push(
          item.evidenceVerified
            ? `  - Evidence from your resume: "${inline(item.evidence)}"`
            : `  - Unverified: the model cited "${inline(item.evidence)}", which was not found in this resume.`,
        );
      }
      if (item.note) lines.push(`  - ${inline(item.note)}`);
    }
    lines.push('');
  }

  if (report.keywordGaps.length > 0) {
    lines.push('### Keywords from the job missing in this resume', '');
    for (const keyword of report.keywordGaps) lines.push(`- ${inline(keyword)}`);
    lines.push('');
  }

  if (report.suggestions.length > 0) {
    lines.push(
      '### Suggestions',
      '',
      '_Ideas only. TalentFly never changes your resume._',
      '',
    );
    for (const item of report.suggestions) {
      const section = item.section ? `**${inline(item.section)}:** ` : '';
      lines.push(`- ${section}${inline(item.suggestion)}`);
      lines.push(
        item.unverified
          ? '  - Unverified: not based on text found in your resume. Use it only if it is true.'
          : `  - Based on: "${inline(item.evidence)}"`,
      );
    }
    lines.push('');
  }

  const tokens = [
    entry.usage.inputTokens !== undefined ? `${entry.usage.inputTokens} input` : '',
    entry.usage.outputTokens !== undefined ? `${entry.usage.outputTokens} output` : '',
  ].filter(Boolean);
  lines.push(
    `_Model: ${inline(entry.model)}${tokens.length > 0 ? ` · Tokens: ${tokens.join(', ')}` : ''}_`,
    '',
  );
  return lines;
}

/** Turns a saved run into a Markdown report. Returns null when the run has no saved report. */
export function runToMarkdown(
  run: ComparisonRunRecord,
  job: JobRecord | undefined,
): string | null {
  const result = parseRunResult(run.result);
  if (!result || result.reports.length === 0) return null;

  const lines: string[] = [
    `# ${inline(job?.title ?? 'Saved job')}: resume comparison`,
    '',
    `Created ${run.createdAt} · Run ${run.id}`,
    '',
    '> AI-generated analysis. Review it yourself before relying on it or sharing it.',
    '',
    '## Job',
    '',
  ];
  if (job?.company) lines.push(`- Company: ${inline(job.company)}`);
  if (job?.location) lines.push(`- Location: ${inline(job.location)}`);
  for (const [label, value] of Object.entries(job?.otherFields ?? {})) {
    lines.push(`- ${inline(label)}: ${inline(value)}`);
  }
  if (job?.sourceUrl) lines.push(`- Source: ${inline(job.sourceUrl)}`);
  if (job?.description) lines.push('', '### Job description', '', quote(job.description));
  lines.push('');

  for (const entry of result.reports) lines.push(...reportSection(entry));

  if (result.failures.length > 0) {
    lines.push('## Not compared', '');
    for (const failure of result.failures) {
      lines.push(`- ${inline(failure.resumeName)}: ${inline(failure.error)}`);
    }
    lines.push('');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

export function markdownFileName(run: ComparisonRunRecord, job: JobRecord | undefined): string {
  return `talentfly-${slugify(job?.title ?? 'comparison')}-${slugify(run.id, 'run')}.md`;
}
