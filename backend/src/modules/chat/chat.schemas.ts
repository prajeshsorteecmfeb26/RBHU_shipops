import { registry, z } from '../../lib/zod';

export const ChatRequestSchema = registry.register(
  'ChatRequest',
  z
    .object({
      message: z.string().trim().min(1, 'Message cannot be empty').max(4000, 'Message is too long (max 4000 chars)')
        .openapi({ example: 'Where is shipment SHP-24A9F3K2LM?' }),
      conversationId: z.string().uuid().optional()
        .openapi({ description: 'Omit to start a new conversation; pass the returned id to continue it.' }),
    })
    .strict(),
);

export const ChatResponseSchema = registry.register(
  'ChatResponse',
  z.object({
    conversationId: z.string().uuid(),
    message: z.object({
      id: z.string().uuid(),
      role: z.literal('assistant'),
      content: z.string(),
      createdAt: z.string().datetime(),
    }),
    meta: z.object({
      provider: z.string(),
      toolsUsed: z.array(z.string()),
      promptTokens: z.number().int().optional(),
      outputTokens: z.number().int().optional(),
      latencyMs: z.number().int(),
    }),
  }),
);

export const ConversationSummarySchema = registry.register(
  'ConversationSummary',
  z.object({ id: z.string().uuid(), title: z.string(), createdAt: z.string(), updatedAt: z.string() }),
);

export const ConversationDetailSchema = registry.register(
  'ConversationDetail',
  ConversationSummarySchema.extend({
    messages: z.array(z.object({ id: z.string(), role: z.enum(['user', 'assistant']), content: z.string(), createdAt: z.string() })),
  }),
);

export type ChatRequest = z.infer<typeof ChatRequestSchema>;
