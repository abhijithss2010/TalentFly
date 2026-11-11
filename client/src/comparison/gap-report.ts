import type { ProviderUsage } from '../providers/provider-adapter';

export type RequirementStatus = 'met' | 'weak' | 'missing';

export interface RequirementAssessment {
  requirement: string;
  status: RequirementStatus;
  /** Text the model quoted from the resume as support; empty when it found none. */
  evidence: string;
  /** True only when `evidence` really appears in the resume text. Never trust the model on this. */
  evidenceVerified: boolean;
  note: string;
}

export interface ReportSuggestion {
  section: string;
  suggestion: string;
  /** Resume text this suggestion is based on; empty when the model could not quote any. */
  evidence: string;
  /** True unless `evidence` is quoted from the resume. Unverified suggestions need the user's confirmation. */
  unverified: boolean;
}

export interface GapReport {
  /** Whole number 0–100. */
  matchScore: number;
  summary: string;
  requirements: RequirementAssessment[];
  keywordGaps: string[];
  suggestions: ReportSuggestion[];
}

export class ComparisonOutputError extends Error {
  constructor(
    message: string,
    /** Tokens already spent on the unusable response, when the provider reported them. */
    readonly usage?: ProviderUsage,
  ) {
    super(message);
    this.name = 'ComparisonOutputError';
  }
}

export const REPORT_LIMITS = {
  maxRequirements: 30,
  maxKeywordGaps: 30,
  maxSuggestions: 15,
  summary: 1_500,
  requirement: 300,
  evidence: 500,
  note: 500,
  suggestion: 800,
  section: 100,
  keyword: 60,
} as const;

const STATUSES: readonly RequirementStatus[] = ['met', 'weak', 'missing'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’“”"'`]/g, '')
    .replace(/[\s ]+/g, ' ')
    .trim();
}

function text(value: unknown, field: string, max: number, required = false): string {
  if (value === undefined || value === null) {
    if (required) throw new ComparisonOutputError(`The analysis is missing "${field}".`);
    return '';
  }
  if (typeof value !== 'string') {
    throw new ComparisonOutputError(`The analysis has an invalid "${field}" (expected text).`);
  }
  const trimmed = value.trim();
  if (required && !trimmed) {
    throw new ComparisonOutputError(`The analysis is missing "${field}".`);
  }
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
}

function list(value: unknown, field: string): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ComparisonOutputError(`The analysis has an invalid "${field}" (expected a list).`);
  }
  return value;
}

function extractJson(raw: string): unknown {
  const unfenced = raw.replace(/```(?:json)?/gi, '');
  const start = unfenced.indexOf('{');
  if (start === -1) {
    throw new ComparisonOutputError(
      'The model did not return a structured analysis. Try again.',
    );
  }
  const end = unfenced.lastIndexOf('}');
  if (end <= start) {
    throw new ComparisonOutputError(
      'The model returned an incomplete analysis (it was probably cut off by the output limit). Try again.',
    );
  }
  try {
    return JSON.parse(unfenced.slice(start, end + 1));
  } catch {
    throw new ComparisonOutputError(
      'The model returned an incomplete or malformed analysis (it may have been cut off). Try again.',
    );
  }
}

/**
 * Validates the model's structured output and checks its quoted evidence against the resume.
 * Throws {@link ComparisonOutputError} for anything that is not a usable report.
 */
export function parseGapReport(
  raw: string,
  resumeText: string,
  usage?: ProviderUsage,
): GapReport {
  try {
    const parsed = extractJson(raw);
    if (!isRecord(parsed)) {
      throw new ComparisonOutputError('The analysis is not a JSON object.');
    }

    const score = parsed.matchScore;
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) {
      throw new ComparisonOutputError('The analysis has an invalid "matchScore" (expected 0–100).');
    }

    const resume = normalize(resumeText);
    const isQuoted = (evidence: string) => evidence !== '' && resume.includes(normalize(evidence));

    const requirements = list(parsed.requirements, 'requirements')
      .slice(0, REPORT_LIMITS.maxRequirements)
      .map((item, index): RequirementAssessment => {
        if (!isRecord(item)) {
          throw new ComparisonOutputError(`Requirement ${index + 1} is not an object.`);
        }
        if (!STATUSES.includes(item.status as RequirementStatus)) {
          throw new ComparisonOutputError(
            `Requirement ${index + 1} has an invalid status (expected met, weak, or missing).`,
          );
        }
        const evidence = text(item.evidence, `requirements[${index}].evidence`, REPORT_LIMITS.evidence);
        return {
          requirement: text(item.requirement, `requirements[${index}].requirement`, REPORT_LIMITS.requirement, true),
          status: item.status as RequirementStatus,
          evidence,
          evidenceVerified: isQuoted(evidence),
          note: text(item.note, `requirements[${index}].note`, REPORT_LIMITS.note),
        };
      });

    const keywordGaps = list(parsed.keywordGaps, 'keywordGaps')
      .slice(0, REPORT_LIMITS.maxKeywordGaps)
      .map((item, index) => text(item, `keywordGaps[${index}]`, REPORT_LIMITS.keyword, true));

    const suggestions = list(parsed.suggestions, 'suggestions')
      .slice(0, REPORT_LIMITS.maxSuggestions)
      .map((item, index): ReportSuggestion => {
        if (!isRecord(item)) {
          throw new ComparisonOutputError(`Suggestion ${index + 1} is not an object.`);
        }
        const evidence = text(item.evidence, `suggestions[${index}].evidence`, REPORT_LIMITS.evidence);
        return {
          section: text(item.section, `suggestions[${index}].section`, REPORT_LIMITS.section),
          suggestion: text(item.suggestion, `suggestions[${index}].suggestion`, REPORT_LIMITS.suggestion, true),
          evidence,
          unverified: !isQuoted(evidence),
        };
      });

    return {
      matchScore: Math.round(score),
      summary: text(parsed.summary, 'summary', REPORT_LIMITS.summary, true),
      requirements,
      keywordGaps,
      suggestions,
    };
  } catch (error) {
    if (error instanceof ComparisonOutputError && usage && error.usage === undefined) {
      throw new ComparisonOutputError(error.message, usage);
    }
    throw error;
  }
}
