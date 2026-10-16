import { beforeEach, describe, expect, it } from 'vitest';
import { ShipmentService, generateTrackingNumber, isTransitionAllowed } from '../src/modules/shipments/shipment.service';
import { CreateShipmentSchema } from '../src/modules/shipments/shipment.schemas';
import { ConflictError, NotFoundError, UnprocessableError } from '../src/lib/errors';
import { admin, FakeCustomerRepo, FakeShipmentRepo, RecordingBus } from './fakes';

describe('ShipmentService', () => {
  let customers: FakeCustomerRepo;
  let shipments: FakeShipmentRepo;
  let bus: RecordingBus;
  let service: ShipmentService;
  let customerId: string;

  beforeEach(async () => {
    customers = new FakeCustomerRepo();
    shipments = new FakeShipmentRepo(customers);
    bus = new RecordingBus();
    service = new ShipmentService(shipments, customers, bus);
    customerId = (await customers.create({ name: 'Priya', email: 'p@x.in', company: 'Acme' })).id;
  });

  const input = () => CreateShipmentSchema.parse({ customerId, origin: 'Mumbai', destination: 'Pune' });

  it('creates a shipment with a generated tracking number and emits shipment_created', async () => {
    const s = await service.create(input(), admin);
    expect(s.trackingNumber).toMatch(/^SHP-[A-Z2-9]{10}$/);
    expect(s.status).toBe('Created');
    expect(s.allowedNextStatuses).toEqual(['PickedUp', 'Cancelled', 'Exception']);
    expect(bus.events[0]).toMatchObject({ event: 'shipment_created', shipmentId: s.id });
  });

  it('rejects duplicate tracking numbers', async () => {
    await service.create({ ...input(), trackingNumber: 'SHP-DUP0001' }, admin);
    await expect(service.create({ ...input(), trackingNumber: 'SHP-DUP0001' }, admin)).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects shipments for inactive or unknown customers', async () => {
    await customers.update(customerId, { status: 'Inactive' });
    await expect(service.create(input(), admin)).rejects.toBeInstanceOf(UnprocessableError);
    await expect(service.create({ ...input(), customerId: crypto.randomUUID() }, admin)).rejects.toBeInstanceOf(UnprocessableError);
  });

  it('applies a valid transition and broadcasts shipment_status_changed', async () => {
    const s = await service.create(input(), admin);
    const updated = await service.updateStatus(s.id, { status: 'PickedUp' }, admin);
    expect(updated.status).toBe('PickedUp');
    expect(bus.events.at(-1)).toMatchObject({
      event: 'shipment_status_changed', shipmentId: s.id, status: 'PickedUp', previousStatus: 'Created', changedBy: admin.email,
    });
  });

  it('rejects invalid transitions with the allowed next statuses', async () => {
    const s = await service.create(input(), admin);
    const err = await service.updateStatus(s.id, { status: 'Delivered' }, admin).catch((e) => e);
    expect(err).toBeInstanceOf(UnprocessableError);
    expect(err.details).toEqual({ currentStatus: 'Created', allowedNextStatuses: ['PickedUp', 'Cancelled', 'Exception'] });
    expect(bus.events.filter((e) => e.event === 'shipment_status_changed')).toHaveLength(0);
  });

  it('returns 409 when a concurrent update won the race (optimistic concurrency)', async () => {
    const s = await service.create(input(), admin);
    shipments.simulateRace = true;
    await expect(service.updateStatus(s.id, { status: 'PickedUp' }, admin)).rejects.toBeInstanceOf(ConflictError);
  });

  it('404s for unknown shipments', async () => {
    await expect(service.updateStatus(crypto.randomUUID(), { status: 'PickedUp' }, admin)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('shipment state machine', () => {
  it.each([
    ['Created', 'PickedUp', true],
    ['InTransit', 'Delivered', false],
    ['OutForDelivery', 'Delivered', true],
    ['Delivered', 'InTransit', false],
    ['Cancelled', 'Created', false],
    ['Exception', 'InTransit', true],
  ] as const)('%s -> %s allowed=%s', (from, to, ok) => {
    expect(isTransitionAllowed(from, to)).toBe(ok);
  });

  it('generates unambiguous tracking numbers', () => {
    for (let i = 0; i < 200; i++) expect(generateTrackingNumber()).not.toMatch(/[01IO]/);
  });
});

describe('CreateShipmentSchema', () => {
  it('normalises tracking numbers to upper case and rejects same origin/destination', () => {
    const id = crypto.randomUUID();
    expect(CreateShipmentSchema.parse({ customerId: id, origin: 'A1', destination: 'B1', trackingNumber: 'shp-abc123' }).trackingNumber).toBe('SHP-ABC123');
    expect(CreateShipmentSchema.safeParse({ customerId: id, origin: 'Mumbai', destination: 'mumbai' }).success).toBe(false);
    expect(CreateShipmentSchema.safeParse({ customerId: id, origin: 'A1', destination: 'B1', status: 'Delivered' }).success).toBe(false);
  });
});
