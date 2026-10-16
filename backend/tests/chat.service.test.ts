import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, Conversation } from '@prisma/client';
import { ChatService } from '../src/modules/chat/chat.service';
import { MockAiProvider, type AiProvider, type ChatTurn } from '../src/modules/chat/ai.provider';
import type { ChatRepository } from '../src/modules/chat/chat.repository';
import { NotFoundError, UpstreamError } from '../src/lib/errors';
import { admin } from './fakes';

class FakeChatRepo implements ChatRepository {
  convs: Conversation[] = [];
  msgs: ChatMessage[] = [];
  async findConversation(id: string, userId: string) { return this.convs.find((c) => c.id === id && c.userId === userId) ?? null; }
  async createConversation(userId: string, title: string) {
    const c = { id: randomUUID(), userId, title, createdAt: new Date(), updatedAt: new Date() };
    this.convs.push(c);
    return c;
  }
  async recentMessages(conversationId: string, limit: number) { return this.msgs.filter((m) => m.conversationId === conversationId).slice(-limit); }
  async appendExchange(conversationId: string, user: string, a: { content: string }) {
    const mk = (role: 'user' | 'assistant', content: string) =>
      ({ id: randomUUID(), conversationId, role, content, promptTokens: null, outputTokens: null, createdAt: new Date() }) as ChatMessage;
    this.msgs.push(mk('user', user));
    const reply = mk('assistant', a.content);
    this.msgs.push(reply);
    return reply;
  }
  async listConversations() { return this.convs; }
  async getConversationWithMessages() { return null; }
  async deleteConversation() { return 0; }
}

describe('ChatService', () => {
  it('starts a conversation and sends prior history on the next turn', async () => {
    const repo = new FakeChatRepo();
    const seen: ChatTurn[][] = [];
    const provider: AiProvider = { name: 'spy', complete: async (turns) => { seen.push(turns); return { content: `reply ${seen.length}`, toolsUsed: [] }; } };
    const service = new ChatService(repo, provider, async () => ({}), 20);

    const first = await service.send({ message: 'Hello there' }, admin);
    expect(repo.convs[0].title).toBe('Hello there');
    await service.send({ message: 'And again', conversationId: first.conversationId }, admin);

    const secondCall = seen[1];
    expect(secondCall[0].role).toBe('system');
    expect(secondCall[0].content).toContain('ShipOps Assistant');
    expect(secondCall.slice(1).map((t) => t.content)).toEqual(['Hello there', 'reply 1', 'And again']);
  });

  it("refuses another user's conversation", async () => {
    const repo = new FakeChatRepo();
    const conv = await repo.createConversation(randomUUID(), 'x');
    const service = new ChatService(repo, new MockAiProvider(), async () => ({}));
    await expect(service.send({ message: 'hi', conversationId: conv.id }, admin)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('does not persist anything when the provider fails', async () => {
    const repo = new FakeChatRepo();
    const provider: AiProvider = { name: 'down', complete: async () => { throw new UpstreamError('AI', 'down', 503); } };
    const service = new ChatService(repo, provider, async () => ({}));
    await expect(service.send({ message: 'hi' }, admin)).rejects.toBeInstanceOf(UpstreamError);
    expect(repo.msgs).toHaveLength(0);
    expect(repo.convs).toHaveLength(0);
  });

  it('mock provider grounds tracking-number answers with the tool', async () => {
    const tool = vi.fn(async () => ({ found: true, shipment: { trackingNumber: 'SHP-ABC123', status: 'InTransit', origin: 'Mumbai', destination: 'Pune', updatedAt: 'now' } }));
    const res = await new MockAiProvider().complete([{ role: 'user', content: 'where is shp-abc123?' }], tool);
    expect(tool).toHaveBeenCalledWith('get_shipment_by_tracking_number', { trackingNumber: 'SHP-ABC123' });
    expect(res.content).toContain('InTransit');
  });
});
