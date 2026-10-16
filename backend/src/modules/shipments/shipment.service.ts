import { randomBytes } from 'node:crypto';
import type { ShipmentStatus } from '@prisma/client';
import { ConflictError, NotFoundError, UnprocessableError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type { NotificationBus } from '../../realtime/notificationBus';
import type { AuthUser } from '../../types/express';
import type { CustomerRepository } from '../customers/customer.repository';
import type { ShipmentRepository, ShipmentWithCustomer, ShipmentWithDetail } from './shipment.repository';
import {
  ALLOWED_TRANSITIONS,
  type CreateShipmentInput,
  type ListShipmentsQuery,
  type ShipmentStatusValue,
  type UpdateShipmentStatusInput,
} from './shipment.schemas';

export function toShipmentDto(s: ShipmentWithCustomer) {
  return {
    id: s.id,
    trackingNumber: s.trackingNumber,
    customerId: s.customerId,
    customerName: s.customer?.name,
    customerCompany: s.customer?.company,
    origin: s.origin,
    destination: s.destination,
    status: s.status,
    allowedNextStatuses: ALLOWED_TRANSITIONS[s.status as ShipmentStatusValue],
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    createdBy: s.createdBy,
    updatedBy: s.updatedBy,
  };
}

export function toShipmentDetailDto(s: ShipmentWithDetail) {
  return {
    ...toShipmentDto(s),
    statusHistory: s.statusHistory.map((h) => ({
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      note: h.note,
      changedBy: h.changedBy,
      changedAt: h.changedAt.toISOString(),
    })),
  };
}

const TRACKING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I ambiguity

export function generateTrackingNumber(): string {
  const bytes = randomBytes(10);
  let out = '';
  for (const b of bytes) out += TRACKING_ALPHABET[b % TRACKING_ALPHABET.length];
  return `SHP-${out}`;
}

export function isTransitionAllowed(from: ShipmentStatusValue, to: ShipmentStatusValue) {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export class ShipmentService {
  constructor(
    private readonly shipments: ShipmentRepository,
    private readonly customers: CustomerRepository,
    private readonly bus: NotificationBus,
  ) {}

  async create(input: CreateShipmentInput, actor: AuthUser) {
    const customer = await this.customers.findById(input.customerId);
    if (!customer) throw new UnprocessableError(`Customer '${input.customerId}' does not exist`);
    if (customer.status !== 'Active') throw new UnprocessableError('Shipments can only be created for Active customers');

    let trackingNumber = input.trackingNumber;
    if (trackingNumber) {
      if (await this.shipments.existsTrackingNumber(trackingNumber)) {
        throw new ConflictError(`Tracking number '${trackingNumber}' is already in use`);
      }
    } else {
      do trackingNumber = generateTrackingNumber();
      while (await this.shipments.existsTrackingNumber(trackingNumber));
    }

    const created = await this.shipments.create(
      { trackingNumber, customerId: input.customerId, origin: input.origin, destination: input.destination, status: 'Created' },
      actor.email,
    );
    logger.info({ shipmentId: created.id, trackingNumber, actor: actor.email }, 'shipment created');

    await this.bus.publish({
      event: 'shipment_created',
      shipmentId: created.id,
      trackingNumber: created.trackingNumber,
      status: created.status,
      changedBy: actor.email,
      timestamp: new Date().toISOString(),
    });
    return toShipmentDto(created);
  }

  async updateStatus(id: string, input: UpdateShipmentStatusInput, actor: AuthUser) {
    const current = await this.shipments.findById(id);
    if (!current) throw new NotFoundError('Shipment', id);

    const from = current.status as ShipmentStatusValue;
    const to = input.status;
    if (from === to) throw new UnprocessableError(`Shipment is already '${to}'`);
    if (!isTransitionAllowed(from, to)) {
      throw new UnprocessableError(`Invalid status transition ${from} -> ${to}`, {
        currentStatus: from,
        allowedNextStatuses: ALLOWED_TRANSITIONS[from],
      });
    }

    const updated = await this.shipments.transitionStatus(id, from as ShipmentStatus, to as ShipmentStatus, actor.email, input.note);
    if (!updated) {
      throw new ConflictError('Shipment status was changed by another user. Reload and try again.');
    }
    logger.info({ shipmentId: id, from, to, actor: actor.email }, 'shipment status changed');

    // Notify after commit so clients never see an event for a rolled-back change
    await this.bus.publish({
      event: 'shipment_status_changed',
      shipmentId: id,
      trackingNumber: updated.trackingNumber,
      status: to,
      previousStatus: from,
      changedBy: actor.email,
      timestamp: new Date().toISOString(),
    });
    return toShipmentDto(updated);
  }

  async getById(id: string) {
    const s = await this.shipments.findById(id);
    if (!s) throw new NotFoundError('Shipment', id);
    return toShipmentDetailDto(s);
  }

  async getByTrackingNumber(trackingNumber: string) {
    const s = await this.shipments.findByTrackingNumber(trackingNumber);
    if (!s) throw new NotFoundError('Shipment', trackingNumber);
    return toShipmentDetailDto(s);
  }

  async list(query: ListShipmentsQuery) {
    const { rows, total } = await this.shipments.list(query);
    return {
      data: rows.map(toShipmentDto),
      meta: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) },
    };
  }
}
