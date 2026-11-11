import type { AppSettingsRecord, ProviderId } from '../data/models';
import type { CredentialVault } from '../providers/credential-vault';
import type {
  ProviderAdapter,
  ProviderRegistry,
  ProviderUsage,
} from '../providers/provider-adapter';
import { ComparisonOutputError, parseGapReport, type GapReport } from './gap-report';
import {
  buildComparisonPrompt,
  type ComparisonJobInput,
  type ComparisonPrompt,
  type ComparisonResumeInput,
} from './prompt';

export interface ComparisonResult {
  providerId: ProviderId;
  model: string;
  prompt: ComparisonPrompt;
  report: GapReport;
  usage: ProviderUsage;
}

/** Sends an already-built prompt to one provider and validates the structured answer. */
export async function compareResumeToJob(input: {
  adapter: ProviderAdapter;
  apiKey: string;
  model: string;
  prompt: ComparisonPrompt;
  resumeText: string;
  signal?: AbortSignal;
}): Promise<ComparisonResult> {
  const { adapter, apiKey, model, prompt, resumeText, signal } = input;
  const response = await adapter.complete({
    apiKey,
    model,
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
    maxOutputTokens: prompt.maxOutputTokens,
    ...(signal ? { signal } : {}),
  });
  if (!response.text.trim()) {
    throw new ComparisonOutputError('The model returned an empty response. Try again.', response.usage);
  }
  return {
    providerId: adapter.id,
    model,
    prompt,
    report: parseGapReport(response.text, resumeText, response.usage),
    usage: response.usage,
  };
}

/**
 * Runs a comparison with the provider and model chosen in settings, using that provider's
 * encrypted API key. The provider must have been unlocked first.
 */
export async function runConfiguredComparison(input: {
  settings: Pick<AppSettingsRecord, 'preferredProvider' | 'providerModels'>;
  registry: ProviderRegistry;
  vault: CredentialVault;
  job: ComparisonJobInput;
  resume: ComparisonResumeInput;
  signal?: AbortSignal;
}): Promise<ComparisonResult> {
  const { settings, registry, vault, job, resume, signal } = input;
  const providerId = settings.preferredProvider;
  if (!providerId) {
    throw new Error('Choose a comparison provider in Provider settings first.');
  }
  const adapter = registry.get(providerId);
  const model = settings.providerModels?.[providerId] ?? adapter.defaultModel;
  if (!adapter.models.some((candidate) => candidate.id === model)) {
    throw new Error(
      `The selected ${adapter.name} model is no longer available. Choose a model in Provider settings.`,
    );
  }

  const prompt = buildComparisonPrompt(job, resume);
  return vault.withApiKey(providerId, (apiKey) =>
    compareResumeToJob({ adapter, apiKey, model, prompt, resumeText: resume.text, signal }),
  );
}
