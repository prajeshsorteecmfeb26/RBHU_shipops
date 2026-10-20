import OpenAI, { AzureOpenAI, APIError, APIConnectionTimeoutError } from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { env } from '../../config/env';
import { UpstreamError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { TOOL_DEFINITIONS, type ToolExecutor } from './chat.tools';
import { OfflineAssistant } from './offline.assistant';

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionResult {
  content: string;
  promptTokens?: number;
  outputTokens?: number;
  toolsUsed: string[];
}

export interface AiProvider {
  readonly name: string;
  complete(messages: ChatTurn[], tools: ToolExecutor): Promise<CompletionResult>;
}

const MAX_TOOL_ROUNDS = 3;

/** OpenAI and Azure OpenAI share the same Chat Completions surface. */
export class OpenAiCompatibleProvider implements AiProvider {
  constructor(
    public readonly name: string,
    private readonly client: OpenAI,
    private readonly model: string,
  ) {}

  async complete(turns: ChatTurn[], executeTool: ToolExecutor): Promise<CompletionResult> {
    const messages: ChatCompletionMessageParam[] = turns.map((t) => ({ role: t.role, content: t.content }));
    const toolsUsed: string[] = [];
    let promptTokens = 0;
    let outputTokens = 0;

    try {
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        const res = await this.client.chat.completions.create({
          model: this.model,
          messages,
          tools: TOOL_DEFINITIONS,
          // On the final round force a text answer so we never loop forever
          tool_choice: round === MAX_TOOL_ROUNDS ? 'none' : 'auto',
          temperature: 0.2,
          max_tokens: 800,
        });
        promptTokens += res.usage?.prompt_tokens ?? 0;
        outputTokens += res.usage?.completion_tokens ?? 0;

        const choice = res.choices[0];
        const msg = choice?.message;
        if (!msg) throw new UpstreamError('AI provider', 'Empty response');

        if (msg.tool_calls?.length) {
          messages.push(msg);
          for (const call of msg.tool_calls) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(call.function.arguments || '{}');
            } catch {
              /* malformed args -> tool receives {} and reports an error */
            }
            toolsUsed.push(call.function.name);
            const result = await executeTool(call.function.name, args);
            messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 8000) });
          }
          continue;
        }

        if (choice.finish_reason === 'content_filter') {
          return { content: "I can't help with that request.", promptTokens, outputTokens, toolsUsed };
        }
        return { content: msg.content?.trim() || "I couldn't produce an answer. Please rephrase.", promptTokens, outputTokens, toolsUsed };
      }
      throw new UpstreamError('AI provider', 'Too many tool rounds');
    } catch (err) {
      throw mapProviderError(err);
    }
  }
}

function mapProviderError(err: unknown): Error {
  if (err instanceof UpstreamError) return err;
  if (err instanceof APIConnectionTimeoutError) {
    return new UpstreamError('AI assistant', 'The AI service timed out. Please try again.', 504);
  }
  if (err instanceof APIError) {
    logger.warn({ status: err.status, code: err.code, type: err.type }, 'AI provider error');
    if (err.status === 429) return new UpstreamError('AI assistant', 'The AI service is busy (rate limited). Try again shortly.', 503);
    if (err.status === 401 || err.status === 403) return new UpstreamError('AI assistant', 'The AI service is misconfigured (credentials).', 503);
    if (err.status === 400 && err.code === 'content_filter') return new UpstreamError('AI assistant', 'That request was blocked by the content filter.', 422);
    return new UpstreamError('AI assistant', 'The AI service is temporarily unavailable.', 503);
  }
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Offline provider used when no LLM key is configured (and in tests/demos).
 * Delegates to the rule-based OfflineAssistant, which answers a broad range
 * of operations questions from live data through the same read-only tools.
 */
export class MockAiProvider implements AiProvider {
  readonly name = 'offline';

  complete(turns: ChatTurn[], executeTool: ToolExecutor): Promise<CompletionResult> {
    return new OfflineAssistant(executeTool).answer(turns);
  }
}

/**
 * Wraps a real LLM provider: if it is unavailable (quota, network, bad key),
 * the user still gets a data-grounded answer from the offline engine instead
 * of an error.
 */
export class FallbackAiProvider implements AiProvider {
  constructor(
    private readonly primary: AiProvider,
    private readonly fallback: AiProvider = new MockAiProvider(),
  ) {}

  get name() {
    return this.primary.name;
  }

  async complete(turns: ChatTurn[], executeTool: ToolExecutor): Promise<CompletionResult> {
    try {
      return await this.primary.complete(turns, executeTool);
    } catch (err) {
      if (err instanceof UpstreamError && err.statusCode !== 422) {
        logger.warn({ provider: this.primary.name, err: err.message }, 'AI provider failed - answering with offline assistant');
        return this.fallback.complete(turns, executeTool);
      }
      throw err;
    }
  }
}

/** 'auto' picks a real LLM when credentials are present, otherwise the offline assistant. */
export function resolveProviderName(): 'openai' | 'azure' | 'mock' {
  if (env.AI_PROVIDER !== 'auto') return env.AI_PROVIDER;
  if (env.AZURE_OPENAI_ENDPOINT && env.AZURE_OPENAI_DEPLOYMENT) return 'azure';
  if (env.OPENAI_API_KEY) return 'openai';
  return 'mock';
}

export function createAiProvider(): AiProvider {
  const provider = resolveProviderName();
  logger.info({ aiProvider: provider }, 'AI assistant provider selected');
  switch (provider) {
    case 'openai':
      return new FallbackAiProvider(new OpenAiCompatibleProvider(
        'openai',
        new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: env.AI_TIMEOUT_MS, maxRetries: 2 }),
        env.OPENAI_MODEL,
      ));
    case 'azure':
      return new FallbackAiProvider(new OpenAiCompatibleProvider(
        'azure-openai',
        new AzureOpenAI({
          endpoint: env.AZURE_OPENAI_ENDPOINT,
          apiKey: env.AZURE_OPENAI_API_KEY, // omit in Azure to use Managed Identity via azureADTokenProvider
          apiVersion: env.AZURE_OPENAI_API_VERSION,
          deployment: env.AZURE_OPENAI_DEPLOYMENT,
          timeout: env.AI_TIMEOUT_MS,
          maxRetries: 2,
        }),
        env.AZURE_OPENAI_DEPLOYMENT!,
      ));
    default:
      return new MockAiProvider();
  }
}
