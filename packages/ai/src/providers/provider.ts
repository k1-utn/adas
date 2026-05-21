/**
 * Provider abstraction so agents are model-agnostic. The orchestrator injects a concrete
 * provider (OpenAI, Anthropic, or a deterministic stub for tests). Agents never import an
 * SDK directly — this keeps prompts/versioning testable and lets us swap models per agent.
 */

export interface LlmCompletionRequest {
  /** Versioned prompt id, recorded in ProcessingStep for reproducibility. */
  promptVersion: string;
  system: string;
  user: string;
  /** When set, the provider should return strict JSON matching this intent. */
  jsonMode?: boolean;
  temperature?: number;
}

export interface LlmCompletionResult {
  text: string;
  model: string;
  tokensUsed?: number;
  latencyMs: number;
}

export interface LlmProvider {
  readonly name: string;
  complete(req: LlmCompletionRequest): Promise<LlmCompletionResult>;
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * Deterministic stub provider. Lets the entire pipeline run end-to-end in tests and local
 * dev with no API keys, and gives predictable output. Real providers live in ./providers.
 */
export class StubLlmProvider implements LlmProvider {
  readonly name = 'stub';
  private readonly canned: Record<string, string>;
  constructor(canned: Record<string, string> = {}) {
    this.canned = canned;
  }

  async complete(req: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const text = this.canned[req.promptVersion] ?? '{}';
    return { text, model: 'stub-1', tokensUsed: 0, latencyMs: 1 };
  }

  async embed(texts: string[]): Promise<number[][]> {
    // Cheap, stable pseudo-embedding for tests (NOT for production retrieval quality).
    return texts.map((t) => {
      const v = new Array(1536).fill(0);
      for (let i = 0; i < t.length; i++) v[i % 1536] += t.charCodeAt(i) / 255;
      return v;
    });
  }
}
