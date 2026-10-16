import type { CustomerService } from '../customers/customer.service';
import type { ShipmentService } from '../shipments/shipment.service';
import { NotFoundError } from '../../lib/errors';
import { getDashboardStats } from '../dashboard/dashboard.routes';
import type { CustomerRepository } from '../customers/customer.repository';
import type { ShipmentRepository } from '../shipments/shipment.repository';

/**
 * Read-only tools the model can call (OpenAI function calling).
 * Tools go through the same services as the REST API, so the assistant can
 * never see more than an authenticated user could, and never writes data.
 */
export const TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'get_shipment_by_tracking_number',
      description: 'Get a shipment, its customer and full status history by tracking number.',
      parameters: {
        type: 'object',
        properties: { trackingNumber: { type: 'string', description: 'Tracking number, e.g. SHP-ABC1234567' } },
        required: ['trackingNumber'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_operations_summary',
      description: 'Get total customers, total shipments and shipment count per status.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_customers',
      description: 'Search active customers by name, company or email. Returns at most 5.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Search text' } },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
];

export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export function createToolExecutor(deps: {
  shipmentService: ShipmentService;
  customerService: CustomerService;
  customerRepo: CustomerRepository;
  shipmentRepo: ShipmentRepository;
}): ToolExecutor {
  return async (name, args) => {
    try {
      switch (name) {
        case 'get_shipment_by_tracking_number': {
          const tn = String(args.trackingNumber ?? '').trim().toUpperCase();
          if (!/^[A-Z0-9-]{6,32}$/.test(tn)) return { found: false, reason: 'Invalid tracking number format' };
          const s = await deps.shipmentService.getByTrackingNumber(tn);
          return { found: true, shipment: s };
        }
        case 'get_operations_summary':
          return await getDashboardStats(deps.customerRepo, deps.shipmentRepo);
        case 'search_customers': {
          const q = String(args.query ?? '').slice(0, 100);
          const res = await deps.customerService.list({ page: 1, pageSize: 5, search: q, sortBy: 'name', sortOrder: 'asc' });
          return {
            total: res.meta.total,
            customers: res.data.map((c) => ({ id: c.id, name: c.name, company: c.company, email: c.email, status: c.status })),
          };
        }
        default:
          return { error: `Unknown tool ${name}` };
      }
    } catch (err) {
      if (err instanceof NotFoundError) return { found: false, reason: 'No shipment with that tracking number' };
      throw err;
    }
  };
}
