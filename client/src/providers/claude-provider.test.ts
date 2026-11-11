import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClaudeProviderAdapter } from './claude-provider';

const sdkMock = vi.hoisted(() => ({
  create: vi.fn(),
  retrieve: vi.fn(),
  constructorOptions: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class Anthropic {
    messages = { create: sdkMock.create };
    models = { retrieve: sdkMock.retrieve };

    constructor(options: unknown) {
      sdkMock.constructorOptions(options);
    }
  },
}));

describe('Claude provider adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the official SDK for browser requests and returns normalized text and usage', async () => {
    sdkMock.create.mockResolvedValue({
      content: [
        { type: 'text', text: 'Evidence-based' },
        { type: 'tool_use', id: 'tool-1', name: 'unused', input: {} },
        { type: 'text', text: ' suggestions' },
      ],
      usage: { input_tokens: 321, output_tokens: 78 },
    });

    const adapter = new ClaudeProviderAdapter();
    const controller = new AbortController();
    await expect(
      adapter.complete({
        apiKey: 'secret-key',
        model: 'claude-sonnet-5-5',
        systemPrompt: 'Use only supported evidence.',
        userPrompt: 'Compare the resume to the role.',
        maxOutputTokens: 512,
        signal: controller.signal,
      }),
    ).resolves.toEqual({
      text: 'Evidence-based suggestions',
      usage: { inputTokens: 321, outputTokens: 78 },
    });

    expect(sdkMock.constructorOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'secret-key',
        dangerouslyAllowBrowser: true,
        maxRetries: 0,
      }),
    );
    expect(sdkMock.create).toHaveBeenCalledWith(
      {
        model: 'claude-sonnet-5-5',
        max_tokens: 512,
        system: 'Use only supported evidence.',
        messages: [{ role: 'user', content: 'Compare the resume to the role.' }],
      },
      { signal: controller.signal },
    );
  });

  it('checks model access without sending a message', async () => {
    sdkMock.retrieve.mockResolvedValue({ id: 'claude-sonnet-5-5' });
    const adapter = new ClaudeProviderAdapter();

    await expect(adapter.testConnection('secret-key', 'claude-sonnet-5-5')).resolves.toBeUndefined();
    expect(sdkMock.retrieve).toHaveBeenCalledWith(
      'claude-sonnet-5-5',
      undefined,
      undefined,
    );
    expect(sdkMock.create).not.toHaveBeenCalled();
  });

  it('maps authentication and rate-limit failures to user-safe errors', async () => {
    sdkMock.retrieve.mockRejectedValue(Object.assign(new Error('private response body'), {
      status: 401,
    }));
    const adapter = new ClaudeProviderAdapter();

    await expect(adapter.testConnection('invalid-key', 'claude-sonnet-5-5')).rejects.toThrow(
      'Claude rejected this API key. Check the key in Provider settings.',
    );

    sdkMock.retrieve.mockRejectedValue(Object.assign(new Error('private response body'), {
      status: 429,
    }));
    await expect(adapter.testConnection('secret-key', 'claude-sonnet-5-5')).rejects.toThrow(
      'Claude rate-limited the request. Wait a moment and try again.',
    );
  });
});
