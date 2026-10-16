import { PaginationMeta, registry, z } from '../../lib/zod';

export const SHIPMENT_STATUSES = [
  'Created',
  'PickedUp',
  'InTransit',
  'OutForDelivery',
  'Delivered',
  'Exception',
  'Cancelled',
] as const;
export const ShipmentStatusEnum = z.enum(SHIPMENT_STATUSES).openapi('ShipmentStatus');
export type ShipmentStatusValue = (typeof SHIPMENT_STATUSES)[number];

/**
 * Shipment lifecycle state machine. Anything not listed is rejected with 422,
 * which prevents e.g. a Delivered shipment going back to InTransit by mistake.
 */
export const ALLOWED_TRANSITIONS: Record<ShipmentStatusValue, ShipmentStatusValue[]> = {
  Created: ['PickedUp', 'Cancelled', 'Exception'],
  PickedUp: ['InTransit', 'Exception', 'Cancelled'],
  InTransit: ['OutForDelivery', 'Exception'],
  OutForDelivery: ['Delivered', 'InTransit', 'Exception'],
  Exception: ['InTransit', 'OutForDelivery', 'Cancelled'],
  Delivered: [],
  Cancelled: [],
};

const location = z.string().trim().min(2).max(120);

export const CreateShipmentSchema = registry.register(
  'CreateShipmentRequest',
  z
    .object({
      trackingNumber: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z0-9-]{6,32}$/, 'Tracking number must be 6-32 chars: A-Z, 0-9, -')
        .optional()
        .openapi({ description: 'Optional. Auto-generated (SHP-XXXXXXXXXX) when omitted.', example: 'SHP-24A9F3K2LM' }),
      customerId: z.string().uuid(),
      origin: location.openapi({ example: 'Mumbai, MH' }),
      destination: location.openapi({ example: 'Bengaluru, KA' }),
      status: z.literal('Created').default('Created').openapi({ description: 'New shipments always start as Created' }),
    })
    .strict()
    .refine((v) => v.origin.toLowerCase() !== v.destination.toLowerCase(), {
      message: 'Origin and destination must differ',
      path: ['destination'],
    }),
);

export const UpdateShipmentStatusSchema = registry.register(
  'UpdateShipmentStatusRequest',
  z
    .object({
      status: ShipmentStatusEnum,
      note: z.string().trim().max(500).optional().openapi({ example: 'Handed to last-mile partner' }),
    })
    .strict(),
);

export const ListShipmentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: ShipmentStatusEnum.optional(),
  customerId: z.string().uuid().optional(),
  search: z.string().trim().max(100).optional().openapi({ description: 'Matches tracking number, origin or destination' }),
});

export const TrackingParam = z.object({
  trackingNumber: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{6,32}$/).openapi({ param: { name: 'trackingNumber', in: 'path' } }),
});

export const ShipmentSchema = registry.register(
  'Shipment',
  z.object({
    id: z.string().uuid(),
    trackingNumber: z.string(),
    customerId: z.string().uuid(),
    customerName: z.string().optional(),
    customerCompany: z.string().optional(),
    origin: z.string(),
    destination: z.string(),
    status: ShipmentStatusEnum,
    allowedNextStatuses: z.array(ShipmentStatusEnum),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    createdBy: z.string().nullable(),
    updatedBy: z.string().nullable(),
  }),
);

export const ShipmentDetailSchema = registry.register(
  'ShipmentDetail',
  ShipmentSchema.extend({
    statusHistory: z.array(
      z.object({
        fromStatus: ShipmentStatusEnum.nullable(),
        toStatus: ShipmentStatusEnum,
        note: z.string().nullable(),
        changedBy: z.string().nullable(),
        changedAt: z.string().datetime(),
      }),
    ),
  }),
);

export const ShipmentListSchema = registry.register(
  'ShipmentList',
  z.object({ data: z.array(ShipmentSchema), meta: PaginationMeta }),
);

export type CreateShipmentInput = z.infer<typeof CreateShipmentSchema>;
export type UpdateShipmentStatusInput = z.infer<typeof UpdateShipmentStatusSchema>;
export type ListShipmentsQuery = z.infer<typeof ListShipmentsQuerySchema>;
