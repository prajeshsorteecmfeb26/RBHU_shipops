import type { CustomerService } from '../customers/customer.service';
import type { ShipmentService } from '../shipments/shipment.service';
import { NotFoundError } from '../../lib/errors';
import { SHIPMENT_STATUSES, type ShipmentStatusValue } from '../shipments/shipment.schemas';
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
  {
    type: 'function' as const,
    function: {
      name: 'list_shipments',
      description:
        'List shipments (most recently updated first), optionally filtered by status, customer name/company, or a city/location matching origin or destination. Returns the total match count and up to `limit` rows.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: [...SHIPMENT_STATUSES], description: 'Only shipments in this status' },
          customer: { type: 'string', description: 'Customer name, company or email (partial match)' },
          location: { type: 'string', description: 'City or place matched against origin or destination, e.g. Delhi' },
          limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max rows to return (default 10)' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_customer_details',
      description: 'Get a customer (by name, company or email) with their shipments and per-status counts.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Customer name, company or email' } },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_customers',
      description: 'List customers (up to 50), optionally only Active or Inactive ones, with the total count.',
      parameters: {
        type: 'object',
        properties: { status: { type: 'string', enum: ['Active', 'Inactive'] } },
        additionalProperties: false,
      },
    },
  },
];

function shipmentRow(s: { trackingNumber: string; status: string; origin: string; destination: string; customerName?: string; customerCompany?: string; updatedAt: string }) {
  return { trackingNumber: s.trackingNumber, status: s.status, origin: s.origin, destination: s.destination, customerName: s.customerName, customerCompany: s.customerCompany, updatedAt: s.updatedAt };
}

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
        case 'list_shipments': {
          const limit = Math.min(50, Math.max(1, Number(args.limit) || 10));
          const status = SHIPMENT_STATUSES.includes(args.status as ShipmentStatusValue) ? (args.status as ShipmentStatusValue) : undefined;
          const location = args.location ? String(args.location).trim().slice(0, 100) : undefined;
          let customerIds: string[] | undefined;
          if (args.customer) {
            const found = await deps.customerService.list({ page: 1, pageSize: 20, search: String(args.customer).trim().slice(0, 100), sortBy: 'name', sortOrder: 'asc' });
            customerIds = found.data.map((c) => c.id);
            if (customerIds.length === 0) return { total: 0, shipments: [], note: `No customer matches '${String(args.customer)}'` };
          }
          const ids = customerIds ?? [undefined];
          const rows: ReturnType<typeof shipmentRow>[] = [];
          let total = 0;
          for (const customerId of ids) {
            const res = await deps.shipmentService.list({ page: 1, pageSize: 100, status, customerId, search: location });
            total += res.meta.total;
            rows.push(...res.data.map(shipmentRow));
          }
          rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          return { total, shipments: rows.slice(0, limit) };
        }
        case 'get_customer_details': {
          const q = String(args.query ?? '').trim().slice(0, 100);
          if (!q) return { found: false, reason: 'Empty query' };
          const found = await deps.customerService.list({ page: 1, pageSize: 5, search: q, sortBy: 'name', sortOrder: 'asc' });
          const c = found.data[0];
          if (!c) return { found: false, reason: `No customer matches '${q}'` };
          const ships = await deps.shipmentService.list({ page: 1, pageSize: 100, customerId: c.id });
          const statusCounts: Record<string, number> = {};
          for (const s of ships.data) statusCounts[s.status] = (statusCounts[s.status] ?? 0) + 1;
          return {
            found: true,
            otherMatches: found.data.slice(1).map((o) => o.name),
            customer: { id: c.id, name: c.name, company: c.company, email: c.email, status: c.status, createdAt: c.createdAt },
            totalShipments: ships.meta.total,
            statusCounts,
            shipments: ships.data.slice(0, 20).map(shipmentRow),
          };
        }
        case 'list_customers': {
          const status = args.status === 'Active' || args.status === 'Inactive' ? args.status : undefined;
          const res = await deps.customerService.list({ page: 1, pageSize: 50, status, sortBy: 'name', sortOrder: 'asc' });
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
