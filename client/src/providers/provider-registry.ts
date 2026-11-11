import { ClaudeProviderAdapter } from './claude-provider';
import { ProviderRegistry } from './provider-adapter';

export function createProviderRegistry(): ProviderRegistry {
  return new ProviderRegistry([new ClaudeProviderAdapter()]);
}
