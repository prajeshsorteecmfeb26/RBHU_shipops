import { beforeEach, describe, expect, it } from 'vitest';
import { CustomerService } from '../src/modules/customers/customer.service';
import { CreateCustomerSchema, UpdateCustomerSchema } from '../src/modules/customers/customer.schemas';
import { ConflictError, NotFoundError } from '../src/lib/errors';
import { admin, FakeCustomerRepo } from './fakes';

describe('CustomerService', () => {
  let repo: FakeCustomerRepo;
  let service: CustomerService;

  beforeEach(() => {
    repo = new FakeCustomerRepo();
    service = new CustomerService(repo);
  });

  const valid = () => CreateCustomerSchema.parse({ name: 'Priya Sharma', email: 'Priya@Acme.IN ', company: 'Acme' });

  it('creates with audit fields and normalised email', async () => {
    const c = await service.create(valid(), admin);
    expect(c.email).toBe('priya@acme.in');
    expect(c.status).toBe('Active');
    expect(c.createdBy).toBe(admin.email);
  });

  it('rejects duplicate emails among active customers', async () => {
    await service.create(valid(), admin);
    await expect(service.create(valid(), admin)).rejects.toBeInstanceOf(ConflictError);
  });

  it('soft delete hides the customer but keeps the row, and frees the email', async () => {
    const c = await service.create(valid(), admin);
    await service.softDelete(c.id, admin);
    expect(repo.rows[0].deletedAt).toBeInstanceOf(Date);
    expect(repo.rows[0].deletedBy).toBe(admin.email);
    await expect(service.getById(c.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.create(valid(), admin)).resolves.toBeDefined();
  });

  it('prevents changing email to one owned by another customer', async () => {
    await service.create(valid(), admin);
    const other = await service.create({ ...valid(), email: 'other@acme.in' }, admin);
    await expect(service.update(other.id, { email: 'priya@acme.in' }, admin)).rejects.toBeInstanceOf(ConflictError);
  });

  it('validation: rejects bad email, unknown fields and empty updates', () => {
    expect(CreateCustomerSchema.safeParse({ name: 'AB', email: 'nope', company: 'X' }).success).toBe(false);
    expect(CreateCustomerSchema.safeParse({ ...valid(), isAdmin: true }).success).toBe(false);
    expect(UpdateCustomerSchema.safeParse({}).success).toBe(false);
    expect(UpdateCustomerSchema.safeParse({ status: 'Deleted' }).success).toBe(false);
  });
});
