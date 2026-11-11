import { describe, expect, it, vi } from 'vitest';
import { ProviderRegistry, type ProviderAdapter } from './provider-adapter';

function adapter(id: 'claude' | 'copilot' = 'claude'): ProviderAdapter {
  return {
    id,
    name: id === 'claude' ? 'Claude' : 'Copilot',
    models: [{ id: `${id}-model`, name: 'Test model', description: 'For tests' }],
    defaultModel: `${id}-model`,
    complete: vi.fn(async () => ({ text: 'result', usage: {} })),
    testConnection: vi.fn(async () => undefined),
  };
}

describe('provider registry', () => {
  it('lists and resolves registered providers without coupling callers to adapters', () => {
    const claude = adapter();
    const copilot = adapter('copilot');
    const registry = new ProviderRegistry([claude, copilot]);

    expect(registry.list()).toEqual([claude, copilot]);
    expect(registry.get('claude')).toBe(claude);
    expect(registry.has('copilot')).toBe(true);
    expect(registry.has('claude')).toBe(true);
  });

  it('rejects duplicate providers and missing default models', () => {
    const claude = adapter();
    expect(() => new ProviderRegistry([claude, claude])).toThrow(
      'Provider "claude" is registered more than once.',
    );

    expect(
      () =>
        new ProviderRegistry([
          { ...claude, defaultModel: 'unknown-model' },
        ]),
    ).toThrow('Provider "claude" has no model matching its default.');
  });

  it('reports an unavailable provider explicitly', () => {
    const registry = new ProviderRegistry([adapter()]);

    expect(() => registry.get('copilot')).toThrow(
      'The "copilot" provider is not available in this version of TalentFly.',
    );
  });
});
