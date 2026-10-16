import type { Prisma, PrismaClient, Shipment, ShipmentStatus, ShipmentStatusHistory } from '@prisma/client';
import type { ListShipmentsQuery } from './shipment.schemas';

export type ShipmentWithCustomer = Shipment & { customer: { name: string; company: string } };
export type ShipmentWithDetail = ShipmentWithCustomer & { statusHistory: ShipmentStatusHistory[] };

export interface ShipmentRepository {
  findById(id: string): Promise<ShipmentWithDetail | null>;
  findByTrackingNumber(trackingNumber: string): Promise<ShipmentWithDetail | null>;
  existsTrackingNumber(trackingNumber: string): Promise<boolean>;
  list(q: ListShipmentsQuery): Promise<{ rows: ShipmentWithCustomer[]; total: number }>;
  create(data: Prisma.ShipmentUncheckedCreateInput, actor: string): Promise<ShipmentWithCustomer>;
  /**
   * Atomically transitions status if (and only if) it is still `from`.
   * Returns null when another request changed it first (optimistic concurrency).
   */
  transitionStatus(
    id: string,
    from: ShipmentStatus,
    to: ShipmentStatus,
    actor: string,
    note?: string,
  ): Promise<ShipmentWithCustomer | null>;
  countByStatus(): Promise<Record<string, number>>;
  count(): Promise<number>;
}

const withCustomer = { customer: { select: { name: true, company: true } } } as const;
const withDetail = { ...withCustomer, statusHistory: { orderBy: { changedAt: 'asc' } } } as const;

export class PrismaShipmentRepository implements ShipmentRepository {
  constructor(private readonly db: PrismaClient) {}

  findById(id: string) {
    return this.db.shipment.findUnique({ where: { id }, include: withDetail });
  }

  findByTrackingNumber(trackingNumber: string) {
    return this.db.shipment.findUnique({ where: { trackingNumber }, include: withDetail });
  }

  async existsTrackingNumber(trackingNumber: string) {
    return (await this.db.shipment.count({ where: { trackingNumber } })) > 0;
  }

  async list(q: ListShipmentsQuery) {
    const where: Prisma.ShipmentWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.search
        ? {
            OR: [
              { trackingNumber: { contains: q.search, mode: 'insensitive' } },
              { origin: { contains: q.search, mode: 'insensitive' } },
              { destination: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.db.$transaction([
      this.db.shipment.findMany({
        where,
        include: withCustomer,
        orderBy: { updatedAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.shipment.count({ where }),
    ]);
    return { rows, total };
  }

  create(data: Prisma.ShipmentUncheckedCreateInput, actor: string) {
    return this.db.shipment.create({
      data: {
        ...data,
        createdBy: actor,
        updatedBy: actor,
        statusHistory: { create: { fromStatus: null, toStatus: data.status ?? 'Created', changedBy: actor, note: 'Shipment created' } },
      },
      include: withCustomer,
    });
  }

  async transitionStatus(id: string, from: ShipmentStatus, to: ShipmentStatus, actor: string, note?: string) {
    return this.db.$transaction(async (tx) => {
      const { count } = await tx.shipment.updateMany({
        where: { id, status: from },
        data: { status: to, updatedBy: actor },
      });
      if (count === 0) return null;
      await tx.shipmentStatusHistory.create({
        data: { shipmentId: id, fromStatus: from, toStatus: to, changedBy: actor, note },
      });
      return tx.shipment.findUniqueOrThrow({ where: { id }, include: withCustomer });
    });
  }

  async countByStatus() {
    const groups = await this.db.shipment.groupBy({ by: ['status'], _count: { _all: true } });
    return Object.fromEntries(groups.map((g) => [g.status, g._count._all]));
  }

  count() {
    return this.db.shipment.count();
  }
}
