import { PaginationMeta, registry, z } from '../../lib/zod';

export const CustomerStatusEnum = z.enum(['Active', 'Inactive']).openapi('CustomerStatus');

const name = z.string().trim().min(2, 'Name must be at least 2 characters').max(120);
const email = z.string().trim().toLowerCase().email('Must be a valid email').max(254);
const company = z.string().trim().min(1, 'Company is required').max(160);

export const CreateCustomerSchema = registry.register(
  'CreateCustomerRequest',
  z
    .object({
      name: name.openapi({ example: 'Priya Sharma' }),
      email: email.openapi({ example: 'priya@acme.in' }),
      company: company.openapi({ example: 'Acme Logistics' }),
      status: CustomerStatusEnum.default('Active'),
    })
    .strict(),
);

export const UpdateCustomerSchema = registry.register(
  'UpdateCustomerRequest',
  z
    .object({ name, email, company, status: CustomerStatusEnum })
    .partial()
    .strict()
    .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' }),
);

export const ListCustomersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional().openapi({ description: 'Matches name, email or company (case-insensitive)' }),
  status: CustomerStatusEnum.optional(),
  sortBy: z.enum(['name', 'email', 'company', 'createdAt', 'updatedAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const CustomerSchema = registry.register(
  'Customer',
  z.object({
    id: z.string().uuid(),
    name: z.string(),
    email: z.string().email(),
    company: z.string(),
    status: CustomerStatusEnum,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    createdBy: z.string().nullable(),
    updatedBy: z.string().nullable(),
  }),
);

export const CustomerListSchema = registry.register(
  'CustomerList',
  z.object({ data: z.array(CustomerSchema), meta: PaginationMeta }),
);

export type CreateCustomerInput = z.infer<typeof CreateCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof UpdateCustomerSchema>;
export type ListCustomersQuery = z.infer<typeof ListCustomersQuerySchema>;
