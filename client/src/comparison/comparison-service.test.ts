import { describe, expect, it, vi } from 'vitest';
import type { CredentialVault } from '../providers/credential-vault';
import { ClaudeProviderAdapter } from '../providers/claude-provider';
import { ProviderRegistry } from '../providers/provider-adapter';
import { ComparisonOutputError } from './gap-report';
import { buildComparisonPrompt } from './prompt';
import { compareResumeToJob, runConfiguredComparison } from './comparison-service';

const job = { title: 'Platform Engineer', company: 'Example', description: 'Own the platform.' };
const resume = { name: 'My resume', text: 'Ran Kubernetes clusters for four years.' };
const report = {
  matchScore: 80,
  summary: 'Good fit.',
  requirements: [
    { requirement: 'Kubernetes', status: 'met', evidence: 'Ran Kubernetes clusters', note: '' },
  ],
  keywordGaps: [],
  suggestions: [],
};

function claudeReplying(reply: () => Promise<unknown>) {
  const create = vi.fn((_params: unknown, _options?: unknown) => reply());
  const adapter = new ClaudeProviderAdapter(async () => ({ messages: { create } }) as never);
  return { adapter, create };
}

const okResponse = (body: unknown = report) => async () => ({
  content: [{ type: 'text', text: typeof body === 'string' ? body : JSON.stringify(body) }],
  usage: { input_tokens: 1200, output_tokens: 300 },
});

describe('compareResumeToJob with the Claude adapter', () => {
  it('sends the previewed prompt and returns a validated report with usage', async () => {
    const { adapter, create } = claudeReplying(okResponse());
    const prompt = buildComparisonPrompt(job, resume);
    const controller = new AbortController();

    const result = await compareResumeToJob({
      adapter,
      apiKey: 'sk-test',
      model: 'claude-sonnet-5-5',
      prompt,
      resumeText: resume.text,
      signal: controller.signal,
    });

    expect(create).toHaveBeenCalledWith(
      {
        model: 'claude-sonnet-5-5',
        max_tokens: prompt.maxOutputTokens,
        system: prompt.systemPrompt,
        messages: [{ role: 'user', content: prompt.userPrompt }],
      },
      { signal: controller.signal },
    );
    expect(result.report.matchScore).toBe(80);
    expect(result.report.requirements[0].evidenceVerified).toBe(true);
    expect(result.usage).toEqual({ inputTokens: 1200, outputTokens: 300 });
    expect(result).toMatchObject({ providerId: 'claude', model: 'claude-sonnet-5-5' });
  });

  it.each([
    ['malformed output', okResponse('Sorry, here is some prose instead.'), 'did not return a structured analysis'],
    ['an empty response', okResponse('   '), 'empty response'],
  ])('rejects %s without saving a report and keeps the usage', async (_name, reply, message) => {
    const { adapter } = claudeReplying(reply);
    const run = compareResumeToJob({
      adapter,
      apiKey: 'sk-test',
      model: 'claude-sonnet-5-5',
      prompt: buildComparisonPrompt(job, resume),
      resumeText: resume.text,
    });
    await expect(run).rejects.toThrow(ComparisonOutputError);
    await expect(run).rejects.toMatchObject({
      message: expect.stringContaining(message),
      usage: { inputTokens: 1200, outputTokens: 300 },
    });
  });

  it.each([
    [Object.assign(new Error('private body'), { status: 401 }), 'Claude rejected this API key'],
    [Object.assign(new Error('private body'), { status: 429 }), 'rate-limited'],
    [Object.assign(new Error('private body'), { status: 529 }), 'temporarily unavailable'],
    [Object.assign(new Error('timed out'), { name: 'APIConnectionTimeoutError' }), 'timed out'],
    [Object.assign(new Error('aborted'), { name: 'AbortError' }), 'cancelled'],
  ])('maps provider failures to safe messages (%#)', async (failure, message) => {
    const { adapter } = claudeReplying(async () => {
      throw failure;
    });
    const run = compareResumeToJob({
      adapter,
      apiKey: 'sk-test',
      model: 'claude-sonnet-5-5',
      prompt: buildComparisonPrompt(job, resume),
      resumeText: resume.text,
    });
    await expect(run).rejects.toThrow(message);
    await expect(run).rejects.not.toThrow('private body');
  });
});

describe('runConfiguredComparison', () => {
  function fakeVault(unlocked: boolean) {
    const withApiKey = vi.fn(async (_id: string, operation: (key: string) => Promise<unknown>) => {
      if (!unlocked) throw new Error('Unlock this provider before using its API key.');
      return operation('sk-from-vault');
    });
    return { vault: { withApiKey } as unknown as CredentialVault, withApiKey };
  }

  it('uses the selected provider, its saved model, and its encrypted key', async () => {
    const { adapter, create } = claudeReplying(okResponse());
    const { vault, withApiKey } = fakeVault(true);

    const result = await runConfiguredComparison({
      settings: { preferredProvider: 'claude', providerModels: { claude: 'claude-haiku-5-5' } },
      registry: new ProviderRegistry([adapter]),
      vault,
      job,
      resume,
    });

    expect(withApiKey).toHaveBeenCalledWith('claude', expect.any(Function));
    expect(create.mock.calls[0][0]).toMatchObject({ model: 'claude-haiku-5-5' });
    expect(result.model).toBe('claude-haiku-5-5');
    expect(result.prompt.userPrompt).toContain('Own the platform.');
  });

  it('falls back to the provider default model when none was saved', async () => {
    const { adapter, create } = claudeReplying(okResponse());
    await runConfiguredComparison({
      settings: { preferredProvider: 'claude' },
      registry: new ProviderRegistry([adapter]),
      vault: fakeVault(true).vault,
      job,
      resume,
    });
    expect(create.mock.calls[0][0]).toMatchObject({ model: 'claude-sonnet-5-5' });
  });

  it('explains missing setup instead of calling the provider', async () => {
    const { adapter, create } = claudeReplying(okResponse());
    const registry = new ProviderRegistry([adapter]);

    await expect(
      runConfiguredComparison({ settings: { preferredProvider: null }, registry, vault: fakeVault(true).vault, job, resume }),
    ).rejects.toThrow('Choose a comparison provider');

    await expect(
      runConfiguredComparison({ settings: { preferredProvider: 'copilot' }, registry, vault: fakeVault(true).vault, job, resume }),
    ).rejects.toThrow('"copilot" provider is not available');

    await expect(
      runConfiguredComparison({
        settings: { preferredProvider: 'claude', providerModels: { claude: 'retired-model' } },
        registry,
        vault: fakeVault(true).vault,
        job,
        resume,
      }),
    ).rejects.toThrow('model is no longer available');

    await expect(
      runConfiguredComparison({ settings: { preferredProvider: 'claude' }, registry, vault: fakeVault(false).vault, job, resume }),
    ).rejects.toThrow('Unlock this provider');

    expect(create).not.toHaveBeenCalled();
  });

  it('does not touch the key when the inputs are unusable', async () => {
    const { adapter } = claudeReplying(okResponse());
    const { vault, withApiKey } = fakeVault(true);
    await expect(
      runConfiguredComparison({
        settings: { preferredProvider: 'claude' },
        registry: new ProviderRegistry([adapter]),
        vault,
        job,
        resume: { name: 'Empty', text: '' },
      }),
    ).rejects.toThrow('has no readable text');
    expect(withApiKey).not.toHaveBeenCalled();
  });
});
