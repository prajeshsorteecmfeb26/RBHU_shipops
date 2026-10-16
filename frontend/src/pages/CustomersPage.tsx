import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useCustomers, useDeleteCustomer, useSaveCustomer } from '../api/hooks';
import { ApiError, errorMessage } from '../api/client';
import type { Customer, CustomerStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { DataTable, type Column } from '../components/DataTable';
import { useToast } from '../components/Toaster';
import { Button, ConfirmDialog, Modal, PageHeader, SelectField, StatusBadge, TextField } from '../components/ui';
import { formatDate } from '../lib/format';
import { useDebounce } from '../lib/useDebounce';
import { customerFormSchema, type CustomerFormValues } from '../schemas';

function CustomerFormModal({ open, customer, onClose }: { open: boolean; customer: Customer | null; onClose: () => void }) {
  const save = useSaveCustomer();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, reset, setError, formState: { errors, isDirty } } = useForm<CustomerFormValues>({
    resolver: zodResolver(customerFormSchema),
  });

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    reset(customer ? { name: customer.name, email: customer.email, company: customer.company, status: customer.status } : { name: '', email: '', company: '', status: 'Active' });
  }, [open, customer, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await save.mutateAsync({ id: customer?.id, input: values });
      toast({ tone: 'success', title: customer ? 'Customer updated' : 'Customer created', body: values.name });
      onClose();
    } catch (err) {
      // Map server-side field errors (Zod 400) and duplicate email (409) onto the form
      if (err instanceof ApiError) {
        const fields = err.fieldErrors();
        Object.entries(fields).forEach(([k, m]) => setError(k as keyof CustomerFormValues, { message: m }));
        if (err.status === 409) setError('email', { message: err.message });
        else if (!Object.keys(fields).length) setFormError(err.message);
      } else setFormError(errorMessage(err));
    }
  });

  return (
    <Modal open={open} onClose={onClose} title={customer ? 'Edit customer' : 'Add customer'} footer={
      <>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" form="customer-form" loading={save.isPending} disabled={!!customer && !isDirty}>{customer ? 'Save changes' : 'Create customer'}</Button>
      </>
    }>
      <form id="customer-form" onSubmit={onSubmit} noValidate className="form-grid">
        {formError && <div className="alert alert-error span-2" role="alert">{formError}</div>}
        <TextField label="Full name" autoComplete="off" error={errors.name?.message} {...register('name')} />
        <TextField label="Email" type="email" autoComplete="off" error={errors.email?.message} {...register('email')} />
        <TextField label="Company" error={errors.company?.message} {...register('company')} />
        <SelectField label="Status" error={errors.status?.message} {...register('status')}>
          <option value="Active">Active</option>
          <option value="Inactive">Inactive</option>
        </SelectField>
      </form>
    </Modal>
  );
}

export function CustomersPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<CustomerStatus | ''>('');
  const debounced = useDebounce(search);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<Customer | null>(null);
  const del = useDeleteCustomer();

  useEffect(() => setPage(1), [debounced, status]);
  const { data, isLoading, isFetching, error, refetch } = useCustomers({ page, pageSize: 10, search: debounced, status });

  const columns: Column<Customer>[] = [
    { key: 'name', header: 'Name', render: (c) => <div><strong>{c.name}</strong><div className="small muted show-mobile">{c.email}</div></div> },
    { key: 'email', header: 'Email', render: (c) => c.email, hideOnMobile: true },
    { key: 'company', header: 'Company', render: (c) => c.company },
    { key: 'status', header: 'Status', render: (c) => <StatusBadge status={c.status} /> },
    { key: 'updated', header: 'Last updated', render: (c) => <span className="small muted">{formatDate(c.updatedAt)}</span>, hideOnMobile: true },
    {
      key: 'actions', header: '', align: 'right',
      render: (c) => (
        <div className="row-actions">
          {can('OPERATOR') && (
            <button className="icon-btn" aria-label={`Edit ${c.name}`} onClick={() => { setEditing(c); setFormOpen(true); }}><Pencil size={16} /></button>
          )}
          {can('ADMIN') && (
            <button className="icon-btn danger" aria-label={`Delete ${c.name}`} onClick={() => setDeleting(c)}><Trash2 size={16} /></button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle="Create, edit and archive customer accounts."
        actions={can('OPERATOR') && <Button icon={<Plus size={16} />} onClick={() => { setEditing(null); setFormOpen(true); }}>Add customer</Button>}
      />

      <div className="toolbar">
        <div className="search">
          <Search size={16} aria-hidden />
          <input type="search" placeholder="Search name, email or company" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search customers" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value as CustomerStatus | '')} aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="Active">Active</option>
          <option value="Inactive">Inactive</option>
        </select>
      </div>

      <DataTable
        columns={columns}
        rows={data?.data}
        rowKey={(c) => c.id}
        loading={isLoading}
        fetching={isFetching}
        error={error ? errorMessage(error) : null}
        onRetry={() => refetch()}
        meta={data?.meta}
        onPageChange={setPage}
        emptyTitle={debounced || status ? 'No customers match your filters' : 'No customers yet'}
      />

      <CustomerFormModal open={formOpen} customer={editing} onClose={() => setFormOpen(false)} />
      <ConfirmDialog
        open={!!deleting}
        title="Delete customer?"
        message={<>“{deleting?.name}” will be archived (soft delete). Their shipment history is kept for auditing.</>}
        confirmLabel="Delete"
        loading={del.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          try {
            await del.mutateAsync(deleting!.id);
            toast({ tone: 'success', title: 'Customer deleted', body: deleting!.name });
          } catch (err) {
            toast({ tone: 'error', title: 'Delete failed', body: errorMessage(err) });
          }
          setDeleting(null);
        }}
      />
    </>
  );
}
