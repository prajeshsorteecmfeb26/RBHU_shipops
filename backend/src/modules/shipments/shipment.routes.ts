import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { errorResponses, json, registry, UuidParam, z } from '../../lib/zod';
import { authorize } from '../../middleware/auth';
import { validate, validated } from '../../middleware/validate';
import {
  CreateShipmentSchema,
  ListShipmentsQuerySchema,
  ShipmentDetailSchema,
  ShipmentListSchema,
  ShipmentSchema,
  TrackingParam,
  UpdateShipmentStatusSchema,
  type CreateShipmentInput,
  type ListShipmentsQuery,
  type UpdateShipmentStatusInput,
} from './shipment.schemas';
import type { ShipmentService } from './shipment.service';

export function createShipmentRouter(service: ShipmentService) {
  const router = Router();
  const security = [{ bearerAuth: [] }];
  const unprocessable = { description: 'Business rule violation (e.g. invalid status transition)', ...json(z.object({ error: z.any() })) };

  registry.registerPath({
    method: 'get', path: '/api/shipments', tags: ['Shipments'], security,
    summary: 'List shipments (paginated, filter by status/customer, search)',
    request: { query: ListShipmentsQuerySchema },
    responses: { 200: { description: 'Shipment page', ...json(ShipmentListSchema) } },
  });
  router.get('/', validate({ query: ListShipmentsQuerySchema }), asyncHandler(async (req, res) => {
    res.json(await service.list(validated<ListShipmentsQuery>(req, 'query')));
  }));

  registry.registerPath({
    method: 'get', path: '/api/shipments/track/{trackingNumber}', tags: ['Shipments'], security,
    summary: 'Retrieve shipment details by tracking number',
    request: { params: TrackingParam },
    responses: { 200: { description: 'Shipment', ...json(ShipmentDetailSchema) }, 404: errorResponses[404] },
  });
  router.get('/track/:trackingNumber', validate({ params: TrackingParam }), asyncHandler(async (req, res) => {
    res.json(await service.getByTrackingNumber(validated<{ trackingNumber: string }>(req, 'params').trackingNumber));
  }));

  registry.registerPath({
    method: 'get', path: '/api/shipments/{id}', tags: ['Shipments'], security,
    summary: 'Retrieve shipment details incl. status history',
    request: { params: UuidParam },
    responses: { 200: { description: 'Shipment', ...json(ShipmentDetailSchema) }, 404: errorResponses[404] },
  });
  router.get('/:id', validate({ params: UuidParam }), asyncHandler(async (req, res) => {
    res.json(await service.getById(validated<{ id: string }>(req, 'params').id));
  }));

  registry.registerPath({
    method: 'post', path: '/api/shipments', tags: ['Shipments'], security,
    summary: 'Create a shipment (OPERATOR, ADMIN). Broadcasts shipment_created.',
    request: { body: json(CreateShipmentSchema) },
    responses: {
      201: { description: 'Created', ...json(ShipmentSchema) },
      400: errorResponses[400], 409: errorResponses[409], 422: unprocessable,
    },
  });
  router.post('/', authorize('OPERATOR'), validate({ body: CreateShipmentSchema }), asyncHandler(async (req, res) => {
    const created = await service.create(validated<CreateShipmentInput>(req, 'body'), req.user!);
    res.status(201).location(`/api/shipments/${created.id}`).json(created);
  }));

  registry.registerPath({
    method: 'patch', path: '/api/shipments/{id}/status', tags: ['Shipments'], security,
    summary: 'Update shipment status (OPERATOR, ADMIN). Validates the state machine and broadcasts shipment_status_changed over WebSocket.',
    request: { params: UuidParam, body: json(UpdateShipmentStatusSchema) },
    responses: {
      200: { description: 'Updated', ...json(ShipmentSchema) },
      400: errorResponses[400], 404: errorResponses[404], 409: errorResponses[409], 422: unprocessable,
    },
  });
  router.patch('/:id/status', authorize('OPERATOR'), validate({ params: UuidParam, body: UpdateShipmentStatusSchema }),
    asyncHandler(async (req, res) => {
      const { id } = validated<{ id: string }>(req, 'params');
      res.json(await service.updateStatus(id, validated<UpdateShipmentStatusInput>(req, 'body'), req.user!));
    }));

  return router;
}
