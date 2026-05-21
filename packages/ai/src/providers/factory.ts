import { StubLlmProvider, type LlmProvider } from './provider.js';
import { AnthropicProvider } from './anthropic.js';

/**
 * Provider selection policy:
 *   - ANTHROPIC_API_KEY set     → real AnthropicProvider (production behavior)
 *   - LLM_PROVIDER=stub          → always stub (force in tests/CI)
 *   - otherwise                  → stub fallback (so dev runs without keys)
 *
 * Logs the choice once at startup so it's obvious which mode the worker is in.
 */

let cached: LlmProvider | null = null;

export function getLlmProvider(): LlmProvider {
  if (cached) return cached;

  const force = process.env.LLM_PROVIDER?.toLowerCase();
  if (force === 'stub') {
    cached = new StubLlmProvider();
    log(`LLM provider: stub (forced via LLM_PROVIDER=stub)`);
    return cached;
  }

  if (process.env.ANTHROPIC_API_KEY) {
    cached = new AnthropicProvider();
    log(`LLM provider: anthropic (claude-opus-4-7)`);
    return cached;
  }

  cached = new StubLlmProvider();
  log(`LLM provider: stub (no ANTHROPIC_API_KEY set — set one for real explanations)`);
  return cached;
}

/** Test helper: reset the cached provider so env changes take effect. */
export function resetProviderCache(): void {
  cached = null;
}

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[adas/ai] ${msg}`);
}
