import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { describe, expect, it, vi } from 'vitest';
import { StatusBadge, TextField } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { customerFormSchema, shipmentFormSchema, type CustomerFormValues } from '../schemas';
import { ApiError } from '../api/client';

describe('StatusBadge', () => {
  it('renders human-friendly shipment labels', () => {
    render(<StatusBadge status="OutForDelivery" />);
    expect(screen.getByText('Out for delivery')).toBeInTheDocument();
  });
});

describe('form validation', () => {
  function Form({ onValid }: { onValid: (v: CustomerFormValues) => void }) {
    const { register, handleSubmit, formState: { errors } } = useForm<CustomerFormValues>({
      resolver: zodResolver(customerFormSchema),
      defaultValues: { name: '', email: '', company: '', status: 'Active' },
    });
    return (
      <form onSubmit={handleSubmit(onValid)}>
        <TextField label="Name" error={errors.name?.message} {...register('name')} />
        <TextField label="Email" error={errors.email?.message} {...register('email')} />
        <TextField label="Company" error={errors.company?.message} {...register('company')} />
        <button type="submit">Save</button>
      </form>
    );
  }

  it('shows field errors and blocks submit, then submits normalised values', async () => {
    const onValid = vi.fn();
    render(<Form onValid={onValid} />);
    await userEvent.type(screen.getByLabelText('Email'), 'not-an-email');
    await userEvent.click(screen.getByText('Save'));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Name must be at least 2 characters')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(onValid).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText('Name'), 'Priya');
    await userEvent.clear(screen.getByLabelText('Email'));
    await userEvent.type(screen.getByLabelText('Email'), 'PRIYA@Acme.in');
    await userEvent.type(screen.getByLabelText('Company'), 'Acme');
    await userEvent.click(screen.getByText('Save'));
    expect(onValid).toHaveBeenCalledWith(expect.objectContaining({ email: 'priya@acme.in' }), expect.anything());
  });

  it('shipment schema rejects identical origin/destination', () => {
    const r = shipmentFormSchema.safeParse({ customerId: crypto.randomUUID(), origin: 'Pune', destination: 'pune' });
    expect(r.success).toBe(false);
  });
});

describe('DataTable', () => {
  it('shows empty and error states', () => {
    const { rerender } = render(<DataTable columns={[]} rows={[]} rowKey={() => 'x'} emptyTitle="No customers yet" />);
    expect(screen.getByText('No customers yet')).toBeInTheDocument();
    rerender(<DataTable columns={[]} rows={undefined} rowKey={() => 'x'} error="Boom" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Boom');
  });
});

describe('ApiError', () => {
  it('maps zod details to field errors', () => {
    const e = new ApiError(400, 'VALIDATION_ERROR', 'bad', [{ path: 'email', message: 'Invalid email' }]);
    expect(e.fieldErrors()).toEqual({ email: 'Invalid email' });
  });
});
