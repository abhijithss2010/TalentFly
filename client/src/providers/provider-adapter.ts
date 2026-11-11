import type { ProviderId } from '../data/models';

export interface ProviderModel {
  id: string;
  name: string;
  description: string;
}

export interface ProviderCompletionRequest {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens: number;
  signal?: AbortSignal;
}

export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface ProviderCompletionResponse {
  text: string;
  usage: ProviderUsage;
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly name: string;
  readonly models: readonly ProviderModel[];
  readonly defaultModel: string;
  complete(request: ProviderCompletionRequest): Promise<ProviderCompletionResponse>;
  testConnection(apiKey: string, model: string, signal?: AbortSignal): Promise<void>;
}

export class ProviderRegistry {
  private readonly adapters: ReadonlyMap<ProviderId, ProviderAdapter>;

  constructor(adapters: readonly ProviderAdapter[]) {
    const registered = new Map<ProviderId, ProviderAdapter>();
    for (const adapter of adapters) {
      if (registered.has(adapter.id)) {
        throw new Error(`Provider "${adapter.id}" is registered more than once.`);
      }
      if (!adapter.models.some((model) => model.id === adapter.defaultModel)) {
        throw new Error(`Provider "${adapter.id}" has no model matching its default.`);
      }
      registered.set(adapter.id, adapter);
    }
    this.adapters = registered;
  }

  list(): readonly ProviderAdapter[] {
    return [...this.adapters.values()];
  }

  get(id: ProviderId): ProviderAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) {
      throw new Error(`The "${id}" provider is not available in this version of TalentFly.`);
    }
    return adapter;
  }

  has(id: ProviderId): boolean {
    return this.adapters.has(id);
  }
}
