import { randomUUID } from 'node:crypto';
import type { Customer, Prisma, ShipmentStatus } from '@prisma/client';
import type { CustomerRepository } from '../src/modules/customers/customer.repository';
import type { ShipmentRepository, ShipmentWithDetail } from '../src/modules/shipments/shipment.repository';
import type { NotificationBus, NotificationEvent } from '../src/realtime/notificationBus';
import type { AuthUser } from '../src/types/express';

export const admin: AuthUser = { id: randomUUID(), email: 'admin@test.local', name: 'Admin', role: 'ADMIN' };

export class FakeCustomerRepo implements CustomerRepository {
  rows: Customer[] = [];
  async findById(id: string) { return this.rows.find((c) => c.id === id && !c.deletedAt) ?? null; }
  async findActiveByEmail(email: string) { return this.rows.find((c) => c.email === email && !c.deletedAt) ?? null; }
  async list() { const r = this.rows.filter((c) => !c.deletedAt); return { rows: r, total: r.length }; }
  async create(data: Prisma.CustomerUncheckedCreateInput) {
    const now = new Date();
    const c = { id: randomUUID(), status: 'Active', createdAt: now, updatedAt: now, createdBy: null, updatedBy: null, deletedAt: null, deletedBy: null, ...data } as Customer;
    this.rows.push(c);
    return c;
  }
  async update(id: string, data: Prisma.CustomerUncheckedUpdateInput) {
    const c = this.rows.find((r) => r.id === id)!;
    Object.assign(c, data, { updatedAt: new Date() });
    return c;
  }
  async softDelete(id: string, by: string) { return this.update(id, { deletedAt: new Date(), deletedBy: by, status: 'Inactive' }); }
  async count() { return this.rows.filter((c) => !c.deletedAt).length; }
}

export class FakeShipmentRepo implements ShipmentRepository {
  rows: ShipmentWithDetail[] = [];
  /** When set, the next transition behaves as if another request won the race */
  simulateRace = false;
  constructor(private customers: FakeCustomerRepo) {}
  async findById(id: string) { return this.rows.find((s) => s.id === id) ?? null; }
  async findByTrackingNumber(tn: string) { return this.rows.find((s) => s.trackingNumber === tn) ?? null; }
  async existsTrackingNumber(tn: string) { return this.rows.some((s) => s.trackingNumber === tn); }
  async list() { return { rows: this.rows, total: this.rows.length }; }
  async create(data: Prisma.ShipmentUncheckedCreateInput, actor: string) {
    const now = new Date();
    const c = await this.customers.findById(data.customerId);
    const s: ShipmentWithDetail = {
      id: randomUUID(), trackingNumber: data.trackingNumber, customerId: data.customerId, origin: data.origin,
      destination: data.destination, status: (data.status ?? 'Created') as ShipmentStatus, createdAt: now, updatedAt: now,
      createdBy: actor, updatedBy: actor, customer: { name: c!.name, company: c!.company }, statusHistory: [],
    };
    this.rows.push(s);
    return s;
  }
  async transitionStatus(id: string, from: ShipmentStatus, to: ShipmentStatus, actor: string, note?: string) {
    if (this.simulateRace) return null;
    const s = this.rows.find((r) => r.id === id && r.status === from);
    if (!s) return null;
    s.status = to;
    s.statusHistory.push({ id: randomUUID(), shipmentId: id, fromStatus: from, toStatus: to, note: note ?? null, changedBy: actor, changedAt: new Date() });
    return s;
  }
  async countByStatus() {
    const out: Record<string, number> = {};
    for (const s of this.rows) out[s.status] = (out[s.status] ?? 0) + 1;
    return out;
  }
  async count() { return this.rows.length; }
}

export class RecordingBus implements NotificationBus {
  events: NotificationEvent[] = [];
  async publish(e: NotificationEvent) { this.events.push(e); }
  subscribe() { return () => {}; }
}
