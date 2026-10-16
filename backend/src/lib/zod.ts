import { extendZodWithOpenApi, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z, type ZodTypeAny } from 'zod';

// Extend zod once so every schema can carry OpenAPI metadata.
// The same Zod schemas drive request validation AND the Swagger document,
// so the docs can never drift from what the API actually accepts.
extendZodWithOpenApi(z);

export { z };
export const registry = new OpenAPIRegistry();

export const bearerAuth = registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

export const ErrorResponseSchema = registry.register(
  'ErrorResponse',
  z.object({
    error: z.object({
      code: z.string().openapi({ example: 'VALIDATION_ERROR' }),
      message: z.string(),
      details: z.unknown().optional(),
      requestId: z.string().optional(),
    }),
  }),
);

export const errorResponses = {
  400: { description: 'Validation error', content: { 'application/json': { schema: ErrorResponseSchema } } },
  401: { description: 'Missing or invalid token', content: { 'application/json': { schema: ErrorResponseSchema } } },
  403: { description: 'Insufficient role', content: { 'application/json': { schema: ErrorResponseSchema } } },
  404: { description: 'Not found', content: { 'application/json': { schema: ErrorResponseSchema } } },
  409: { description: 'Conflict', content: { 'application/json': { schema: ErrorResponseSchema } } },
} as const;

export const UuidParam = z.object({
  id: z.string().uuid().openapi({ param: { name: 'id', in: 'path' }, example: '3f1c2b1e-8a1f-4a43-9a5b-2f7a3c3d9e10' }),
});

export const PaginationMeta = registry.register(
  'PaginationMeta',
  z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  }),
);

/** Wraps a schema as an OpenAPI JSON body/response content block. */
export const json = (schema: ZodTypeAny) => ({ content: { 'application/json': { schema } } });
