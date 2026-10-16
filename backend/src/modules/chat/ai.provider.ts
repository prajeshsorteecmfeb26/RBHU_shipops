import OpenAI, { AzureOpenAI, APIError, APIConnectionTimeoutError } from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { env } from '../../config/env';
import { UpstreamError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { TOOL_DEFINITIONS, type ToolExecutor } from './chat.tools';

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
 * Offline provider for local development, tests and demos without an API key.
 * It still exercises the tool path so the end-to-end flow is realistic.
 */
export class MockAiProvider implements AiProvider {
  readonly name = 'mock';

  async complete(turns: ChatTurn[], executeTool: ToolExecutor): Promise<CompletionResult> {
    const last = [...turns].reverse().find((t) => t.role === 'user')?.content ?? '';
    const priorUserTurns = turns.filter((t) => t.role === 'user').length - 1;
    const tracking = last.toUpperCase().match(/\b[A-Z]{2,5}-[A-Z0-9]{4,}\b/)?.[0];

    if (tracking) {
      const r = (await executeTool('get_shipment_by_tracking_number', { trackingNumber: tracking })) as {
        found: boolean;
        shipment?: { trackingNumber: string; status: string; origin: string; destination: string; customerName?: string; updatedAt: string };
      };
      if (!r.found || !r.shipment) {
        return { content: `I couldn't find a shipment with tracking number **${tracking}**. Please double-check it.`, toolsUsed: ['get_shipment_by_tracking_number'] };
      }
      const s = r.shipment;
      return {
        toolsUsed: ['get_shipment_by_tracking_number'],
        content: `**${s.trackingNumber}** is currently **${s.status}**.\n- Route: ${s.origin} -> ${s.destination}\n- Customer: ${s.customerName ?? 'n/a'}\n- Last update: ${s.updatedAt}`,
      };
    }

    if (/(how many|count|summary|overview|status distribution|stats)/i.test(last)) {
      const stats = (await executeTool('get_operations_summary', {})) as {
        totalCustomers: number; totalShipments: number; statusDistribution: { status: string; count: number }[];
      };
      const lines = stats.statusDistribution.filter((s) => s.count > 0).map((s) => `- ${s.status}: ${s.count}`).join('\n');
      return {
        toolsUsed: ['get_operations_summary'],
        content: `We have **${stats.totalCustomers}** customers and **${stats.totalShipments}** shipments.\n${lines}`,
      };
    }

    return {
      toolsUsed: [],
      content:
        `(Mock AI mode - set AI_PROVIDER=openai or azure for real answers.)\n` +
        `You said: "${last.slice(0, 200)}". ` +
        (priorUserTurns > 0 ? `This is message #${priorUserTurns + 1} in our conversation, so context is being kept. ` : '') +
        `Try asking about a tracking number (e.g. "Where is SHP-...?") or "give me a shipment summary".`,
    };
  }
}

export function createAiProvider(): AiProvider {
  switch (env.AI_PROVIDER) {
    case 'openai':
      return new OpenAiCompatibleProvider(
        'openai',
        new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: env.AI_TIMEOUT_MS, maxRetries: 2 }),
        env.OPENAI_MODEL,
      );
    case 'azure':
      return new OpenAiCompatibleProvider(
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
      );
    default:
      return new MockAiProvider();
  }
}
