import type { Customer, Prisma, PrismaClient } from '@prisma/client';
import type { ListCustomersQuery } from './customer.schemas';

/**
 * Repository: the only layer that talks to Prisma for customers.
 * Soft-deleted rows are excluded from every read by default, so callers
 * cannot accidentally surface deleted customers.
 */
export interface CustomerRepository {
  findById(id: string): Promise<Customer | null>;
  findActiveByEmail(email: string): Promise<Customer | null>;
  list(q: ListCustomersQuery): Promise<{ rows: Customer[]; total: number }>;
  create(data: Prisma.CustomerUncheckedCreateInput): Promise<Customer>;
  update(id: string, data: Prisma.CustomerUncheckedUpdateInput): Promise<Customer>;
  softDelete(id: string, deletedBy: string): Promise<Customer>;
  count(): Promise<number>;
}

const notDeleted = { deletedAt: null } as const;

export class PrismaCustomerRepository implements CustomerRepository {
  constructor(private readonly db: PrismaClient) {}

  findById(id: string) {
    return this.db.customer.findFirst({ where: { id, ...notDeleted } });
  }

  findActiveByEmail(email: string) {
    return this.db.customer.findFirst({ where: { email, ...notDeleted } });
  }

  async list(q: ListCustomersQuery) {
    const where: Prisma.CustomerWhereInput = {
      ...notDeleted,
      ...(q.status ? { status: q.status } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              { email: { contains: q.search, mode: 'insensitive' } },
              { company: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.db.$transaction([
      this.db.customer.findMany({
        where,
        orderBy: { [q.sortBy]: q.sortOrder },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.customer.count({ where }),
    ]);
    return { rows, total };
  }

  create(data: Prisma.CustomerUncheckedCreateInput) {
    return this.db.customer.create({ data });
  }

  update(id: string, data: Prisma.CustomerUncheckedUpdateInput) {
    return this.db.customer.update({ where: { id }, data });
  }

  softDelete(id: string, deletedBy: string) {
    return this.db.customer.update({
      where: { id },
      data: { deletedAt: new Date(), deletedBy, updatedBy: deletedBy, status: 'Inactive' },
    });
  }

  count() {
    return this.db.customer.count({ where: notDeleted });
  }
}
