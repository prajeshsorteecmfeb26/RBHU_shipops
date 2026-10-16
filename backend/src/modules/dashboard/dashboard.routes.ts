import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { registry, z } from '../../lib/zod';
import type { CustomerRepository } from '../customers/customer.repository';
import type { ShipmentRepository } from '../shipments/shipment.repository';
import { SHIPMENT_STATUSES, ShipmentStatusEnum } from '../shipments/shipment.schemas';

export const DashboardStatsSchema = registry.register(
  'DashboardStats',
  z.object({
    totalCustomers: z.number().int(),
    totalShipments: z.number().int(),
    statusDistribution: z.array(z.object({ status: ShipmentStatusEnum, count: z.number().int() })),
    generatedAt: z.string().datetime(),
  }),
);

export async function getDashboardStats(customers: CustomerRepository, shipments: ShipmentRepository) {
  const [totalCustomers, totalShipments, byStatus] = await Promise.all([
    customers.count(),
    shipments.count(),
    shipments.countByStatus(),
  ]);
  return {
    totalCustomers,
    totalShipments,
    // Always return every status (zero-filled) so charts have a stable shape
    statusDistribution: SHIPMENT_STATUSES.map((status) => ({ status, count: byStatus[status] ?? 0 })),
    generatedAt: new Date().toISOString(),
  };
}

export function createDashboardRouter(customers: CustomerRepository, shipments: ShipmentRepository) {
  const router = Router();

  registry.registerPath({
    method: 'get', path: '/api/dashboard/stats', tags: ['Dashboard'], security: [{ bearerAuth: [] }],
    summary: 'Totals and shipment status distribution for the dashboard',
    responses: { 200: { description: 'Stats', content: { 'application/json': { schema: DashboardStatsSchema } } } },
  });
  router.get('/stats', asyncHandler(async (_req, res) => {
    res.json(await getDashboardStats(customers, shipments));
  }));

  return router;
}
