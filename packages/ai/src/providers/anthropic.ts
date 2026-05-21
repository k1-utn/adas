import Anthropic from '@anthropic-ai/sdk';
import type {
  LlmCompletionRequest,
  LlmCompletionResult,
  LlmProvider,
} from './provider.js';

/**
 * Production Anthropic provider for the agent pipeline.
 *
 * Defaults:
 *   - Model: claude-opus-4-7 (most capable; per skill guidance)
 *   - Adaptive thinking: model decides depth per request
 *   - Effort: "high" — balances quality and token cost for explain/supplement agents
 *   - JSON mode: the agents already wrap calls with strict JSON system prompts and
 *     validate with Zod; we additionally amend the system prompt when jsonMode is set
 *     to make the constraint hard
 *
 * Embeddings: Anthropic does not provide an embeddings API. The RAG layer (pgvector
 * lookup over OEM procedures) is not lit up in the current pipeline; if/when it is,
 * swap in Voyage AI (Anthropic's recommended embeddings partner) here.
 */

const DEFAULT_MODEL = 'claude-opus-4-7';
const DEFAULT_MAX_TOKENS = 4096;

export interface AnthropicProviderOptions {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
}

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(opts: AnthropicProviderOptions = {}) {
    const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'AnthropicProvider requires ANTHROPIC_API_KEY (env var or constructor opts)',
      );
    }
    this.client = new Anthropic({ apiKey });
    this.model = opts.model ?? DEFAULT_MODEL;
    this.maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  async complete(req: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const start = Date.now();

    // Note: `temperature` from the request is ignored on opus-4-7 (the API rejects
    // sampling params on 4.7). For deterministic-ish JSON output we rely on adaptive
    // thinking + a strict system-prompt instruction rather than temperature=0.
    const systemPrompt = req.jsonMode
      ? `${req.system}\n\nReturn ONLY valid JSON. No prose, no markdown fences, no commentary.`
      : req.system;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      thinking: { type: 'adaptive' },
      system: systemPrompt,
      messages: [{ role: 'user', content: req.user }],
    });

    // Concatenate text blocks (thinking blocks are present but we don't surface them).
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    return {
      text,
      model: response.model,
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
      latencyMs: Date.now() - start,
    };
  }

  async embed(_texts: string[]): Promise<number[][]> {
    throw new Error(
      'AnthropicProvider does not implement embeddings. Wire a Voyage AI provider ' +
        'when the OEM procedure RAG layer is activated.',
    );
  }
}
