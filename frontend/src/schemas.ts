import { z } from 'zod';

// Client-side validation mirrors the API's Zod schemas for instant feedback.
// The API still validates everything: client checks are UX, not security.

export const customerFormSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(254),
  company: z.string().trim().min(1, 'Company is required').max(160),
  status: z.enum(['Active', 'Inactive']),
});
export type CustomerFormValues = z.infer<typeof customerFormSchema>;

export const shipmentFormSchema = z
  .object({
    customerId: z.string().uuid('Select a customer'),
    origin: z.string().trim().min(2, 'Origin is required').max(120),
    destination: z.string().trim().min(2, 'Destination is required').max(120),
    trackingNumber: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^([A-Z0-9-]{6,32})?$/, '6-32 characters: letters, digits or -')
      .optional(),
  })
  .refine((v) => v.origin.toLowerCase() !== v.destination.toLowerCase(), {
    message: 'Destination must differ from origin',
    path: ['destination'],
  });
export type ShipmentFormValues = z.infer<typeof shipmentFormSchema>;

export const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});
export type LoginValues = z.infer<typeof loginSchema>;
