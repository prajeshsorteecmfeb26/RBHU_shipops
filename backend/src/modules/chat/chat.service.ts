import { env } from '../../config/env';
import { NotFoundError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type { AuthUser } from '../../types/express';
import type { AiProvider, ChatTurn } from './ai.provider';
import type { ChatRepository } from './chat.repository';
import type { ToolExecutor } from './chat.tools';
import type { ChatRequest } from './chat.schemas';
import { buildSystemPrompt, titleFromFirstMessage } from './prompts';

export class ChatService {
  constructor(
    private readonly repo: ChatRepository,
    private readonly provider: AiProvider,
    private readonly tools: ToolExecutor,
    private readonly maxHistory = env.AI_MAX_HISTORY_MESSAGES,
  ) {}

  async send(input: ChatRequest, user: AuthUser) {
    const started = Date.now();

    // 1. Resolve (or lazily create) the conversation - always scoped to the caller
    let conversationId = input.conversationId;
    if (conversationId) {
      const conv = await this.repo.findConversation(conversationId, user.id);
      if (!conv) throw new NotFoundError('Conversation', conversationId);
    }

    // 2. Build context window: system prompt + last N turns + the new question.
    //    A sliding window keeps token usage bounded for long conversations.
    const history = conversationId ? await this.repo.recentMessages(conversationId, this.maxHistory) : [];
    const turns: ChatTurn[] = [
      { role: 'system', content: buildSystemPrompt({ userName: user.name, userRole: user.role, now: new Date() }) },
      ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user', content: input.message },
    ];

    // 3. Call the model (tools resolve shipment/customer facts from our DB).
    //    If this throws, nothing is persisted, so the history stays consistent.
    const result = await this.provider.complete(turns, this.tools);

    // 4. Persist the exchange
    if (!conversationId) {
      conversationId = (await this.repo.createConversation(user.id, titleFromFirstMessage(input.message))).id;
    }
    const reply = await this.repo.appendExchange(conversationId, input.message, {
      content: result.content,
      promptTokens: result.promptTokens,
      outputTokens: result.outputTokens,
    });

    const latencyMs = Date.now() - started;
    logger.info(
      { conversationId, provider: this.provider.name, toolsUsed: result.toolsUsed, latencyMs, promptTokens: result.promptTokens, outputTokens: result.outputTokens },
      'chat completion',
    );

    return {
      conversationId,
      message: { id: reply.id, role: 'assistant' as const, content: reply.content, createdAt: reply.createdAt.toISOString() },
      meta: {
        provider: this.provider.name,
        toolsUsed: result.toolsUsed,
        promptTokens: result.promptTokens,
        outputTokens: result.outputTokens,
        latencyMs,
      },
    };
  }

  async listConversations(user: AuthUser) {
    const rows = await this.repo.listConversations(user.id);
    return rows.map((c) => ({ id: c.id, title: c.title, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString() }));
  }

  async getConversation(id: string, user: AuthUser) {
    const c = await this.repo.getConversationWithMessages(id, user.id);
    if (!c) throw new NotFoundError('Conversation', id);
    return {
      id: c.id,
      title: c.title,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      messages: c.messages.map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt.toISOString() })),
    };
  }

  async deleteConversation(id: string, user: AuthUser) {
    if ((await this.repo.deleteConversation(id, user.id)) === 0) throw new NotFoundError('Conversation', id);
  }
}
