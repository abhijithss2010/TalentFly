import { describe, expect, it } from 'vitest';
import type { ComparisonRunRecord, JobRecord } from '../data/models';
import { sampleResult } from '../test-helpers/local-data';
import { markdownFileName, runToMarkdown } from './markdown-export';

const job: JobRecord = {
  id: 'job_1',
  title: 'Platform Engineer',
  company: 'Example Co',
  location: 'Paris',
  sourceUrl: 'https://app.whoz.com/jobs/1',
  description: 'Own the deployment platform.\nMentor engineers.',
  otherFields: { Reference: 'REF-42' },
  createdAt: '2026-11-12T09:00:00.000Z',
  updatedAt: '2026-11-12T09:00:00.000Z',
};
const run: ComparisonRunRecord = {
  id: 'run_abc-123',
  jobId: 'job_1',
  resumeIds: ['resume_1'],
  status: 'done',
  provider: 'claude',
  result: sampleResult('resume_1') as unknown as Record<string, unknown>,
  createdAt: '2026-11-12T09:30:00.000Z',
  updatedAt: '2026-11-12T10:00:00.000Z',
};

describe('Markdown export', () => {
  it('includes job context, score, requirements, keyword gaps, suggestions, and usage', () => {
    const markdown = runToMarkdown(run, job) ?? '';

    expect(markdown).toContain('# Platform Engineer: resume comparison');
    expect(markdown).toContain('AI-generated analysis. Review it yourself');
    expect(markdown).toContain('- Company: Example Co');
    expect(markdown).toContain('- Reference: REF-42');
    expect(markdown).toContain('- Source: https://app.whoz.com/jobs/1');
    expect(markdown).toContain('> Own the deployment platform.\n> Mentor engineers.');
    expect(markdown).toContain('## Resume: Platform resume');
    expect(markdown).toContain('**Match: 81/100**');
    expect(markdown).toContain('- **Met**: Kubernetes experience');
    expect(markdown).toContain('Evidence from your resume: "Ran Kubernetes clusters"');
    expect(markdown).toContain('- **Missing**: Terraform');
    expect(markdown).toContain('- Terraform');
    expect(markdown).toContain('_Ideas only. TalentFly never changes your resume._');
    expect(markdown).toContain('Based on: "Ran Kubernetes clusters"');
    expect(markdown).toContain('Unverified: not based on text found in your resume.');
    expect(markdown).toContain('Model: claude-sonnet-5-5 · Tokens: 1200 input, 300 output');
    expect(markdown.endsWith('\n')).toBe(true);
  });

  it('marks evidence the model cited but the resume does not contain', () => {
    const result = sampleResult('resume_1');
    result.reports[0].report.requirements[0] = {
      requirement: 'AWS',
      status: 'met',
      evidence: 'Certified AWS architect',
      evidenceVerified: false,
      note: '',
    };
    const markdown = runToMarkdown({ ...run, result: result as never }, job) ?? '';
    expect(markdown).toContain('Unverified: the model cited "Certified AWS architect"');
    expect(markdown).not.toContain('Evidence from your resume: "Certified AWS architect"');
  });

  it('flattens model text so it cannot create headings, lists, or tables', () => {
    const result = sampleResult('resume_1');
    result.reports[0].report.summary = 'Fine.\n\n# Injected heading\n- injected item';
    result.reports[0].report.requirements[0].note = 'line one\n## another heading';
    const markdown = runToMarkdown({ ...run, result: result as never }, job) ?? '';

    expect(markdown).toContain('Fine. # Injected heading - injected item');
    expect(markdown).not.toMatch(/^# Injected heading/m);
    expect(markdown).not.toMatch(/^## another heading/m);
  });

  it('lists resumes that could not be compared', () => {
    const result = sampleResult('resume_1');
    result.failures = [{ resumeId: 'resume_2', resumeName: 'Other', error: 'Claude rate-limited the request.' }];
    const markdown = runToMarkdown({ ...run, result: result as never }, job) ?? '';
    expect(markdown).toContain('## Not compared');
    expect(markdown).toContain('- Other: Claude rate-limited the request.');
  });

  it('has nothing to export without a saved report', () => {
    expect(runToMarkdown({ ...run, status: 'received', result: undefined }, job)).toBeNull();
    expect(runToMarkdown({ ...run, result: { version: 99 } }, job)).toBeNull();
  });

  it('builds a safe file name', () => {
    expect(markdownFileName(run, job)).toBe('talentfly-platform-engineer-run-abc-123.md');
    expect(markdownFileName(run, { ...job, title: '../../Étude <script>' })).toBe(
      'talentfly-etude-script-run-abc-123.md',
    );
    expect(markdownFileName(run, undefined)).toBe('talentfly-comparison-run-abc-123.md');
  });
});
