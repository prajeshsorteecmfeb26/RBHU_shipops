import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { errorResponses, json, registry, UuidParam } from '../../lib/zod';
import { authorize } from '../../middleware/auth';
import { validate, validated } from '../../middleware/validate';
import {
  CreateCustomerSchema,
  CustomerListSchema,
  CustomerSchema,
  ListCustomersQuerySchema,
  UpdateCustomerSchema,
  type CreateCustomerInput,
  type ListCustomersQuery,
  type UpdateCustomerInput,
} from './customer.schemas';
import type { CustomerService } from './customer.service';

export function createCustomerRouter(service: CustomerService) {
  const router = Router();
  const security = [{ bearerAuth: [] }];

  registry.registerPath({
    method: 'get', path: '/api/customers', tags: ['Customers'], security,
    summary: 'List customers (paginated, searchable, excludes soft-deleted)',
    request: { query: ListCustomersQuerySchema },
    responses: { 200: { description: 'Customer page', ...json(CustomerListSchema) }, 401: errorResponses[401] },
  });
  router.get('/', validate({ query: ListCustomersQuerySchema }), asyncHandler(async (req, res) => {
    res.json(await service.list(validated<ListCustomersQuery>(req, 'query')));
  }));

  registry.registerPath({
    method: 'get', path: '/api/customers/{id}', tags: ['Customers'], security,
    summary: 'Get a customer', request: { params: UuidParam },
    responses: { 200: { description: 'Customer', ...json(CustomerSchema) }, 404: errorResponses[404] },
  });
  router.get('/:id', validate({ params: UuidParam }), asyncHandler(async (req, res) => {
    res.json(await service.getById(validated<{ id: string }>(req, 'params').id));
  }));

  registry.registerPath({
    method: 'post', path: '/api/customers', tags: ['Customers'], security,
    summary: 'Create a customer (OPERATOR, ADMIN)',
    request: { body: json(CreateCustomerSchema) },
    responses: {
      201: { description: 'Created', ...json(CustomerSchema) },
      400: errorResponses[400], 403: errorResponses[403], 409: errorResponses[409],
    },
  });
  router.post('/', authorize('OPERATOR'), validate({ body: CreateCustomerSchema }), asyncHandler(async (req, res) => {
    const created = await service.create(validated<CreateCustomerInput>(req, 'body'), req.user!);
    res.status(201).location(`/api/customers/${created.id}`).json(created);
  }));

  registry.registerPath({
    method: 'patch', path: '/api/customers/{id}', tags: ['Customers'], security,
    summary: 'Update a customer (partial) (OPERATOR, ADMIN)',
    request: { params: UuidParam, body: json(UpdateCustomerSchema) },
    responses: {
      200: { description: 'Updated', ...json(CustomerSchema) },
      400: errorResponses[400], 404: errorResponses[404], 409: errorResponses[409],
    },
  });
  router.patch('/:id', authorize('OPERATOR'), validate({ params: UuidParam, body: UpdateCustomerSchema }),
    asyncHandler(async (req, res) => {
      const { id } = validated<{ id: string }>(req, 'params');
      res.json(await service.update(id, validated<UpdateCustomerInput>(req, 'body'), req.user!));
    }));

  registry.registerPath({
    method: 'delete', path: '/api/customers/{id}', tags: ['Customers'], security,
    summary: 'Soft delete a customer (ADMIN). Sets deletedAt; record is retained for audit.',
    request: { params: UuidParam },
    responses: { 204: { description: 'Deleted' }, 403: errorResponses[403], 404: errorResponses[404] },
  });
  router.delete('/:id', authorize('ADMIN'), validate({ params: UuidParam }), asyncHandler(async (req, res) => {
    await service.softDelete(validated<{ id: string }>(req, 'params').id, req.user!);
    res.status(204).end();
  }));

  return router;
}
