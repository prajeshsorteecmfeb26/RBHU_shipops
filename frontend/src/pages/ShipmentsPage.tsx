import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useSearchParams } from 'react-router-dom';
import { ArrowRight, Plus, RefreshCcw, Search } from 'lucide-react';
import { useActiveCustomerOptions, useCreateShipment, useShipment, useShipments, useUpdateShipmentStatus } from '../api/hooks';
import { ApiError, errorMessage } from '../api/client';
import { SHIPMENT_STATUSES, type Shipment, type ShipmentStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { DataTable, type Column } from '../components/DataTable';
import { useToast } from '../components/Toaster';
import { Button, ErrorState, Modal, PageHeader, SelectField, Spinner, StatusBadge, TextAreaField, TextField } from '../components/ui';
import { formatDate, statusLabel, timeAgo } from '../lib/format';
import { useDebounce } from '../lib/useDebounce';
import { shipmentFormSchema, type ShipmentFormValues } from '../schemas';

function CreateShipmentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateShipment();
  const customers = useActiveCustomerOptions();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, reset, setError, formState: { errors } } = useForm<ShipmentFormValues>({
    resolver: zodResolver(shipmentFormSchema),
    defaultValues: { customerId: '', origin: '', destination: '', trackingNumber: '' },
  });

  useEffect(() => {
    if (open) { reset(); setFormError(null); }
  }, [open, reset]);

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      const s = await create.mutateAsync({ ...v, trackingNumber: v.trackingNumber || undefined });
      toast({ tone: 'success', title: 'Shipment created', body: s.trackingNumber });
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setError('trackingNumber', { message: err.message });
      else if (err instanceof ApiError && Object.keys(err.fieldErrors()).length) {
        Object.entries(err.fieldErrors()).forEach(([k, m]) => setError(k as keyof ShipmentFormValues, { message: m }));
      } else setFormError(errorMessage(err));
    }
  });

  return (
    <Modal open={open} onClose={onClose} title="Create shipment" footer={
      <>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" form="shipment-form" loading={create.isPending}>Create shipment</Button>
      </>
    }>
      <form id="shipment-form" onSubmit={onSubmit} noValidate className="form-grid">
        {formError && <div className="alert alert-error span-2" role="alert">{formError}</div>}
        <div className="span-2">
          <SelectField label="Customer" error={errors.customerId?.message} disabled={customers.isLoading} {...register('customerId')}>
            <option value="">{customers.isLoading ? 'Loading customers…' : 'Select an active customer'}</option>
            {customers.data?.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.company}</option>)}
          </SelectField>
        </div>
        <TextField label="Origin" placeholder="Mumbai, MH" error={errors.origin?.message} {...register('origin')} />
        <TextField label="Destination" placeholder="Bengaluru, KA" error={errors.destination?.message} {...register('destination')} />
        <div className="span-2">
          <TextField label="Tracking number (optional)" placeholder="Auto-generated if empty" hint="Leave blank to generate one like SHP-7KQ2M9XA3B" error={errors.trackingNumber?.message} {...register('trackingNumber')} />
        </div>
      </form>
    </Modal>
  );
}

function UpdateStatusModal({ shipment, onClose }: { shipment: Shipment | null; onClose: () => void }) {
  const update = useUpdateShipmentStatus();
  const toast = useToast();
  const [status, setStatus] = useState<ShipmentStatus | ''>('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStatus(shipment?.allowedNextStatuses[0] ?? '');
    setNote('');
    setError(null);
  }, [shipment]);

  if (!shipment) return null;
  const terminal = shipment.allowedNextStatuses.length === 0;

  const submit = async () => {
    if (!status) return setError('Choose a new status');
    try {
      await update.mutateAsync({ id: shipment.id, status, note });
      toast({ tone: 'success', title: 'Status updated', body: `${shipment.trackingNumber} → ${statusLabel(status)}` });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Modal open title={`Update ${shipment.trackingNumber}`} onClose={onClose} footer={
      <>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        {!terminal && <Button onClick={submit} loading={update.isPending}>Update status</Button>}
      </>
    }>
      <div className="status-flow">
        <StatusBadge status={shipment.status} />
        <ArrowRight size={16} aria-hidden />
        {status ? <StatusBadge status={status} /> : <span className="muted">—</span>}
      </div>
      {terminal ? (
        <p className="muted">This shipment is <strong>{statusLabel(shipment.status)}</strong>, which is a final status. It can no longer change.</p>
      ) : (
        <div className="form-grid">
          {error && <div className="alert alert-error span-2" role="alert">{error}</div>}
          <div className="span-2">
            <SelectField label="New status" value={status} onChange={(e) => setStatus(e.target.value as ShipmentStatus)} hint="Only transitions allowed by the shipment lifecycle are listed.">
              {shipment.allowedNextStatuses.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </SelectField>
          </div>
          <div className="span-2">
            <TextAreaField label="Note (optional)" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Handed over to last-mile partner" />
          </div>
        </div>
      )}
    </Modal>
  );
}

function ShipmentDetailModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, isLoading, error } = useShipment(id);
  return (
    <Modal open={!!id} onClose={onClose} title={data ? data.trackingNumber : 'Shipment'} wide>
      {isLoading ? <Spinner /> : error ? <ErrorState message={errorMessage(error)} /> : data && (
        <>
          <dl className="detail-grid">
            <div><dt>Status</dt><dd><StatusBadge status={data.status} /></dd></div>
            <div><dt>Customer</dt><dd>{data.customerName} <span className="muted">({data.customerCompany})</span></dd></div>
            <div><dt>Route</dt><dd>{data.origin} → {data.destination}</dd></div>
            <div><dt>Created</dt><dd>{formatDate(data.createdAt)} <span className="muted">by {data.createdBy}</span></dd></div>
          </dl>
          <h3 className="section-title">Status history</h3>
          <ol className="timeline">
            {[...data.statusHistory].reverse().map((h, i) => (
              <li key={i}>
                <StatusBadge status={h.toStatus} />
                <div>
                  <span className="small">{formatDate(h.changedAt)} · {h.changedBy}</span>
                  {h.note && <p className="small muted">{h.note}</p>}
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </Modal>
  );
}

export function ShipmentsPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const status = (params.get('status') ?? '') as ShipmentStatus | '';
  const debounced = useDebounce(search);
  const [createOpen, setCreateOpen] = useState(false);
  const [updating, setUpdating] = useState<Shipment | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => setPage(1), [debounced, status]);
  const { data, isLoading, isFetching, error, refetch } = useShipments({ page, pageSize: 10, search: debounced, status });

  const columns: Column<Shipment>[] = [
    { key: 'tn', header: 'Tracking #', render: (s) => <span className="mono">{s.trackingNumber}</span> },
    { key: 'customer', header: 'Customer', render: (s) => <div>{s.customerName}<div className="small muted">{s.customerCompany}</div></div>, hideOnMobile: true },
    { key: 'route', header: 'Route', render: (s) => <span className="route">{s.origin} <ArrowRight size={13} aria-hidden /> {s.destination}</span> },
    { key: 'status', header: 'Status', render: (s) => <StatusBadge status={s.status} /> },
    { key: 'updated', header: 'Updated', render: (s) => <span className="small muted" title={formatDate(s.updatedAt)}>{timeAgo(s.updatedAt)}</span>, hideOnMobile: true },
    {
      key: 'actions', header: '', align: 'right',
      render: (s) => can('OPERATOR') && s.allowedNextStatuses.length > 0 ? (
        <Button size="sm" variant="secondary" icon={<RefreshCcw size={14} />} onClick={(e) => { e.stopPropagation(); setUpdating(s); }}>Update</Button>
      ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Shipments"
        subtitle="Track shipments and move them through their lifecycle. Changes are pushed live to everyone."
        actions={can('OPERATOR') && <Button icon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>Create shipment</Button>}
      />

      <div className="toolbar">
        <div className="search">
          <Search size={16} aria-hidden />
          <input type="search" placeholder="Search tracking number, origin, destination" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search shipments" />
        </div>
        <select
          value={status}
          onChange={(e) => setParams(e.target.value ? { status: e.target.value } : {})}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {SHIPMENT_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </select>
      </div>

      <DataTable
        columns={columns}
        rows={data?.data}
        rowKey={(s) => s.id}
        loading={isLoading}
        fetching={isFetching}
        error={error ? errorMessage(error) : null}
        onRetry={() => refetch()}
        meta={data?.meta}
        onPageChange={setPage}
        onRowClick={(s) => setDetailId(s.id)}
        emptyTitle={debounced || status ? 'No shipments match your filters' : 'No shipments yet'}
      />

      <CreateShipmentModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <UpdateStatusModal shipment={updating} onClose={() => setUpdating(null)} />
      <ShipmentDetailModal id={detailId} onClose={() => setDetailId(null)} />
    </>
  );
}
