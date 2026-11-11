import type Anthropic from '@anthropic-ai/sdk';
import type { ProviderAdapter, ProviderCompletionRequest, ProviderModel } from './provider-adapter';

export const CLAUDE_MODELS: readonly ProviderModel[] = [
  {
    id: 'claude-sonnet-5-5',
    name: 'Claude Sonnet 5.5',
    description: 'Balanced speed and capability',
  },
  {
    id: 'claude-haiku-5-5',
    name: 'Claude Haiku 5.5',
    description: 'Fast responses for lighter tasks',
  },
  {
    id: 'claude-opus-5-5',
    name: 'Claude Opus 5.5',
    description: 'Highest capability for demanding tasks',
  },
];

type AnthropicClient = InstanceType<typeof Anthropic>;
export type ClientFactory = (apiKey: string) => Promise<AnthropicClient>;

async function createAnthropicClient(apiKey: string): Promise<AnthropicClient> {
  const { default: AnthropicClientConstructor } = await import('@anthropic-ai/sdk');
  return new AnthropicClientConstructor({
    apiKey,
    dangerouslyAllowBrowser: true,
    maxRetries: 0,
    timeout: 120_000,
  });
}

function providerError(error: unknown): Error {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = error.status;
    if (status === 401) {
      return new Error('Claude rejected this API key. Check the key in Provider settings.');
    }
    if (status === 403) {
      return new Error('This API key is not allowed to use the selected Claude model.');
    }
    if (status === 404) {
      return new Error('The selected Claude model is unavailable for this API key.');
    }
    if (status === 429) {
      return new Error('Claude rate-limited the request. Wait a moment and try again.');
    }
    if (status === 400) {
      return new Error('Claude rejected the request. Check the selected model and request settings.');
    }
    if (typeof status === 'number' && status >= 500) {
      return new Error(`Claude is temporarily unavailable (HTTP ${status}).`);
    }
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return new Error('The Claude request was cancelled.');
  }
  if (error instanceof Error && error.name === 'APIConnectionTimeoutError') {
    return new Error('The Claude request timed out. Check your connection and try again.');
  }
  return new Error(
    'Could not reach the Claude API. Check your connection and confirm browser access is permitted.',
  );
}

export class ClaudeProviderAdapter implements ProviderAdapter {
  readonly id = 'claude' as const;
  readonly name = 'Claude';
  readonly models = CLAUDE_MODELS;
  readonly defaultModel = 'claude-sonnet-5-5';

  constructor(
    private readonly clientFactory: ClientFactory = createAnthropicClient,
  ) {}

  async complete(request: ProviderCompletionRequest) {
    try {
      const client = await this.clientFactory(request.apiKey);
      const response = await client.messages.create(
        {
          model: request.model,
          max_tokens: request.maxOutputTokens,
          system: request.systemPrompt,
          messages: [{ role: 'user', content: request.userPrompt }],
        },
        request.signal ? { signal: request.signal } : undefined,
      );
      const text = response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
      return {
        text,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    } catch (error) {
      throw providerError(error);
    }
  }

  async testConnection(apiKey: string, model: string, signal?: AbortSignal): Promise<void> {
    try {
      const client = await this.clientFactory(apiKey);
      await client.models.retrieve(
        model,
        undefined,
        signal ? { signal } : undefined,
      );
    } catch (error) {
      throw providerError(error);
    }
  }
}
