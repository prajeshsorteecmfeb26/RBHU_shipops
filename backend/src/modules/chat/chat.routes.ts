import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../../lib/asyncHandler';
import { errorResponses, json, registry, UuidParam, z } from '../../lib/zod';
import { validate, validated } from '../../middleware/validate';
import { env } from '../../config/env';
import {
  ChatRequestSchema,
  ChatResponseSchema,
  ConversationDetailSchema,
  ConversationSummarySchema,
  type ChatRequest,
} from './chat.schemas';
import type { ChatService } from './chat.service';

export function createChatRouter(service: ChatService) {
  const router = Router();
  const security = [{ bearerAuth: [] }];

  // LLM calls cost money: limit per user, not per IP
  const chatLimiter = rateLimit({
    windowMs: 60_000,
    limit: env.NODE_ENV === 'test' ? 1000 : 20,
    keyGenerator: (req) => req.user?.id ?? req.ip ?? 'anon',
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many chat messages, slow down a little' } },
  });

  registry.registerPath({
    method: 'post', path: '/api/chat', tags: ['AI Assistant'], security,
    summary: 'Ask the AI assistant. Keeps conversation history; omit conversationId to start a new one.',
    request: { body: json(ChatRequestSchema) },
    responses: {
      200: { description: 'Assistant reply', ...json(ChatResponseSchema) },
      400: errorResponses[400], 404: errorResponses[404],
      503: { description: 'AI provider unavailable / rate limited', ...json(z.object({ error: z.any() })) },
      504: { description: 'AI provider timeout', ...json(z.object({ error: z.any() })) },
    },
  });
  router.post('/', chatLimiter, validate({ body: ChatRequestSchema }), asyncHandler(async (req, res) => {
    res.json(await service.send(validated<ChatRequest>(req, 'body'), req.user!));
  }));

  registry.registerPath({
    method: 'get', path: '/api/chat/conversations', tags: ['AI Assistant'], security,
    summary: "List the caller's conversations",
    responses: { 200: { description: 'Conversations', ...json(z.array(ConversationSummarySchema)) } },
  });
  router.get('/conversations', asyncHandler(async (req, res) => {
    res.json(await service.listConversations(req.user!));
  }));

  registry.registerPath({
    method: 'get', path: '/api/chat/conversations/{id}', tags: ['AI Assistant'], security,
    summary: 'Get a conversation with its messages', request: { params: UuidParam },
    responses: { 200: { description: 'Conversation', ...json(ConversationDetailSchema) }, 404: errorResponses[404] },
  });
  router.get('/conversations/:id', validate({ params: UuidParam }), asyncHandler(async (req, res) => {
    res.json(await service.getConversation(validated<{ id: string }>(req, 'params').id, req.user!));
  }));

  registry.registerPath({
    method: 'delete', path: '/api/chat/conversations/{id}', tags: ['AI Assistant'], security,
    summary: 'Delete a conversation', request: { params: UuidParam },
    responses: { 204: { description: 'Deleted' }, 404: errorResponses[404] },
  });
  router.delete('/conversations/:id', validate({ params: UuidParam }), asyncHandler(async (req, res) => {
    await service.deleteConversation(validated<{ id: string }>(req, 'params').id, req.user!);
    res.status(204).end();
  }));

  return router;
}
