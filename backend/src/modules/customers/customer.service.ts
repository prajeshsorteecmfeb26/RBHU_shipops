import type { Customer } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type { AuthUser } from '../../types/express';
import type { CustomerRepository } from './customer.repository';
import type { CreateCustomerInput, ListCustomersQuery, UpdateCustomerInput } from './customer.schemas';

/** Public shape: hides soft-delete internals from API consumers. */
export function toCustomerDto(c: Customer) {
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    company: c.company,
    status: c.status,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    createdBy: c.createdBy,
    updatedBy: c.updatedBy,
  };
}

export class CustomerService {
  constructor(private readonly repo: CustomerRepository) {}

  async create(input: CreateCustomerInput, actor: AuthUser) {
    if (await this.repo.findActiveByEmail(input.email)) {
      throw new ConflictError(`A customer with email '${input.email}' already exists`);
    }
    const customer = await this.repo.create({ ...input, createdBy: actor.email, updatedBy: actor.email });
    logger.info({ customerId: customer.id, actor: actor.email }, 'customer created');
    return toCustomerDto(customer);
  }

  async update(id: string, input: UpdateCustomerInput, actor: AuthUser) {
    await this.getOrThrow(id);
    if (input.email) {
      const clash = await this.repo.findActiveByEmail(input.email);
      if (clash && clash.id !== id) throw new ConflictError(`A customer with email '${input.email}' already exists`);
    }
    const customer = await this.repo.update(id, { ...input, updatedBy: actor.email });
    logger.info({ customerId: id, actor: actor.email, fields: Object.keys(input) }, 'customer updated');
    return toCustomerDto(customer);
  }

  async list(query: ListCustomersQuery) {
    const { rows, total } = await this.repo.list(query);
    return {
      data: rows.map(toCustomerDto),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  async getById(id: string) {
    return toCustomerDto(await this.getOrThrow(id));
  }

  /** Soft delete keeps shipment history intact and the record recoverable for audit. */
  async softDelete(id: string, actor: AuthUser) {
    await this.getOrThrow(id);
    await this.repo.softDelete(id, actor.email);
    logger.info({ customerId: id, actor: actor.email }, 'customer soft-deleted');
  }

  private async getOrThrow(id: string) {
    const c = await this.repo.findById(id);
    if (!c) throw new NotFoundError('Customer', id);
    return c;
  }
}
