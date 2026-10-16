import type { ChatMessage, Conversation, PrismaClient } from '@prisma/client';

export interface ChatRepository {
  findConversation(id: string, userId: string): Promise<Conversation | null>;
  createConversation(userId: string, title: string): Promise<Conversation>;
  recentMessages(conversationId: string, limit: number): Promise<ChatMessage[]>;
  appendExchange(
    conversationId: string,
    user: string,
    assistant: { content: string; promptTokens?: number; outputTokens?: number },
  ): Promise<ChatMessage>;
  listConversations(userId: string): Promise<Conversation[]>;
  getConversationWithMessages(id: string, userId: string): Promise<(Conversation & { messages: ChatMessage[] }) | null>;
  deleteConversation(id: string, userId: string): Promise<number>;
}

export class PrismaChatRepository implements ChatRepository {
  constructor(private readonly db: PrismaClient) {}

  // Ownership is part of every query: users can only ever see their own chats
  findConversation(id: string, userId: string) {
    return this.db.conversation.findFirst({ where: { id, userId } });
  }

  createConversation(userId: string, title: string) {
    return this.db.conversation.create({ data: { userId, title } });
  }

  async recentMessages(conversationId: string, limit: number) {
    const rows = await this.db.chatMessage.findMany({
      where: { conversationId, role: { in: ['user', 'assistant'] } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.reverse();
  }

  /** User + assistant messages are persisted together so history never has orphan turns. */
  async appendExchange(conversationId: string, user: string, assistant: { content: string; promptTokens?: number; outputTokens?: number }) {
    const now = Date.now();
    const [, reply] = await this.db.$transaction([
      this.db.chatMessage.create({ data: { conversationId, role: 'user', content: user, createdAt: new Date(now) } }),
      this.db.chatMessage.create({
        data: {
          conversationId,
          role: 'assistant',
          content: assistant.content,
          promptTokens: assistant.promptTokens,
          outputTokens: assistant.outputTokens,
          createdAt: new Date(now + 1),
        },
      }),
      this.db.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date(now) } }),
    ]);
    return reply;
  }

  listConversations(userId: string) {
    return this.db.conversation.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' }, take: 50 });
  }

  getConversationWithMessages(id: string, userId: string) {
    return this.db.conversation.findFirst({
      where: { id, userId },
      include: { messages: { where: { role: { in: ['user', 'assistant'] } }, orderBy: { createdAt: 'asc' } } },
    });
  }

  async deleteConversation(id: string, userId: string) {
    const { count } = await this.db.conversation.deleteMany({ where: { id, userId } });
    return count;
  }
}
