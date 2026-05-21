import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLlmProvider, resetProviderCache } from '../src/providers/factory.ts';

/**
 * Provider factory tests verify the env-detection policy without making real
 * Anthropic API calls. We only check `provider.name`, never `complete()`.
 */

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const original: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    original[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    resetProviderCache();
    return fn();
  } finally {
    for (const k of Object.keys(original)) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
    resetProviderCache();
  }
}

test('factory returns stub when ANTHROPIC_API_KEY is unset', () => {
  withEnv({ ANTHROPIC_API_KEY: undefined, LLM_PROVIDER: undefined }, () => {
    const provider = getLlmProvider();
    assert.equal(provider.name, 'stub');
  });
});

test('factory returns anthropic when ANTHROPIC_API_KEY is set', () => {
  withEnv({ ANTHROPIC_API_KEY: 'sk-ant-test-key', LLM_PROVIDER: undefined }, () => {
    const provider = getLlmProvider();
    assert.equal(provider.name, 'anthropic');
  });
});

test('LLM_PROVIDER=stub overrides ANTHROPIC_API_KEY presence', () => {
  withEnv({ ANTHROPIC_API_KEY: 'sk-ant-test-key', LLM_PROVIDER: 'stub' }, () => {
    const provider = getLlmProvider();
    assert.equal(provider.name, 'stub');
  });
});

test('factory caches the provider across calls', () => {
  withEnv({ ANTHROPIC_API_KEY: undefined, LLM_PROVIDER: undefined }, () => {
    const a = getLlmProvider();
    const b = getLlmProvider();
    assert.equal(a, b, 'same instance returned');
  });
});
