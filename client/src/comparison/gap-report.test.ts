import { describe, expect, it } from 'vitest';
import { ComparisonOutputError, parseGapReport } from './gap-report';

const resumeText = 'Ran Kubernetes clusters for four years.\nLed a team of five engineers.';
const valid = {
  matchScore: 71.6,
  summary: 'Strong infrastructure background.',
  requirements: [
    {
      requirement: 'Kubernetes experience',
      status: 'met',
      evidence: 'Ran Kubernetes clusters for four years',
      note: 'Direct match',
    },
    { requirement: 'Terraform', status: 'missing', evidence: '', note: 'Not mentioned' },
  ],
  keywordGaps: ['Terraform'],
  suggestions: [
    {
      section: 'Experience',
      suggestion: 'Lead with team size.',
      evidence: 'Led a team of five engineers.',
    },
    { section: 'Skills', suggestion: 'Add Terraform if you have used it.', evidence: '' },
  ],
};

describe('gap report validation', () => {
  it('accepts a valid report, rounds the score, and verifies quoted evidence', () => {
    const report = parseGapReport(JSON.stringify(valid), resumeText);
    expect(report.matchScore).toBe(72);
    expect(report.requirements[0]).toMatchObject({ status: 'met', evidenceVerified: true });
    expect(report.requirements[1]).toMatchObject({ status: 'missing', evidenceVerified: false });
    expect(report.suggestions.map((s) => s.unverified)).toEqual([false, true]);
    expect(report.keywordGaps).toEqual(['Terraform']);
  });

  it('flags evidence the model made up instead of trusting it', () => {
    const invented = {
      ...valid,
      requirements: [
        { requirement: 'AWS', status: 'met', evidence: 'Certified AWS architect', note: '' },
      ],
      suggestions: [{ section: 'Skills', suggestion: 'Highlight AWS.', evidence: 'Certified AWS architect' }],
    };
    const report = parseGapReport(JSON.stringify(invented), resumeText);
    expect(report.requirements[0].evidenceVerified).toBe(false);
    expect(report.suggestions[0].unverified).toBe(true);
  });

  it('matches evidence regardless of case, quotes, and whitespace', () => {
    const report = parseGapReport(
      JSON.stringify({
        ...valid,
        requirements: [
          { requirement: 'K8s', status: 'weak', evidence: '“ran   KUBERNETES clusters”', note: '' },
        ],
      }),
      resumeText,
    );
    expect(report.requirements[0].evidenceVerified).toBe(true);
  });

  it('tolerates markdown fences and surrounding prose', () => {
    const wrapped = `Here is the analysis:\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\`\nHope that helps!`;
    expect(parseGapReport(wrapped, resumeText).matchScore).toBe(72);
  });

  it('clamps overlong text and oversized lists instead of failing', () => {
    const report = parseGapReport(
      JSON.stringify({
        ...valid,
        summary: 's'.repeat(5_000),
        keywordGaps: Array.from({ length: 80 }, (_, i) => `kw${i}`),
      }),
      resumeText,
    );
    expect(report.summary.length).toBeLessThanOrEqual(1_500);
    expect(report.keywordGaps).toHaveLength(30);
  });

  it.each([
    ['no JSON at all', 'I cannot help with that.', 'did not return a structured analysis'],
    ['output cut off before the closing brace', '{"matchScore": 70, "summary": "ok", "requirements": [', 'cut off by the output limit'],
    ['broken JSON inside braces', '{"matchScore": 70, "summary": }', 'incomplete or malformed'],
    ['array instead of object', '[1, 2]', 'did not return a structured analysis'],
    ['missing score', JSON.stringify({ ...valid, matchScore: undefined }), 'invalid "matchScore"'],
    ['score out of range', JSON.stringify({ ...valid, matchScore: 140 }), 'invalid "matchScore"'],
    ['score as text', JSON.stringify({ ...valid, matchScore: '80' }), 'invalid "matchScore"'],
    ['missing summary', JSON.stringify({ ...valid, summary: '' }), 'missing "summary"'],
    [
      'bad status',
      JSON.stringify({ ...valid, requirements: [{ requirement: 'x', status: 'great', evidence: '' }] }),
      'invalid status',
    ],
    [
      'requirements not a list',
      JSON.stringify({ ...valid, requirements: 'many' }),
      'invalid "requirements"',
    ],
    [
      'suggestion without text',
      JSON.stringify({ ...valid, suggestions: [{ section: 'a', evidence: '' }] }),
      'missing "suggestions[0].suggestion"',
    ],
  ])('rejects %s', (_name, raw, message) => {
    expect(() => parseGapReport(raw, resumeText)).toThrow(ComparisonOutputError);
    expect(() => parseGapReport(raw, resumeText)).toThrow(message);
  });

  it('keeps the token usage on the error so wasted spend can still be accounted for', () => {
    try {
      parseGapReport('nonsense', resumeText, { inputTokens: 900, outputTokens: 40 });
      expect.unreachable();
    } catch (error) {
      expect((error as ComparisonOutputError).usage).toEqual({ inputTokens: 900, outputTokens: 40 });
    }
  });
});
