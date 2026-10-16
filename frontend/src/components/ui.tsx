import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AlertCircle, Inbox, Loader2, X } from 'lucide-react';
import type { ShipmentStatus } from '../api/types';
import { STATUS_COLORS, statusLabel } from '../lib/format';

// ---------- Button ----------
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: ReactNode;
};
export function Button({ variant = 'primary', size = 'md', loading, icon, children, disabled, className = '', ...rest }: ButtonProps) {
  return (
    <button className={`btn btn-${variant} btn-${size} ${className}`} disabled={disabled || loading} {...rest}>
      {loading ? <Loader2 size={16} className="spin" aria-hidden /> : icon}
      {children && <span>{children}</span>}
    </button>
  );
}

// ---------- Form fields (forwardRef so react-hook-form can register them) ----------
interface FieldWrapProps {
  label: string;
  error?: string;
  hint?: string;
  id: string;
  children: ReactNode;
}
function FieldWrap({ label, error, hint, id, children }: FieldWrapProps) {
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? (
        <p className="field-error" id={`${id}-err`} role="alert">{error}</p>
      ) : hint ? (
        <p className="field-hint">{hint}</p>
      ) : null}
    </div>
  );
}

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string };
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(({ label, error, hint, id, ...rest }, ref) => {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldWrap label={label} error={error} hint={hint} id={fid}>
      <input ref={ref} id={fid} aria-invalid={!!error} aria-describedby={error ? `${fid}-err` : undefined} {...rest} />
    </FieldWrap>
  );
});
TextField.displayName = 'TextField';

type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string; hint?: string; children: ReactNode };
export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(({ label, error, hint, id, children, ...rest }, ref) => {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldWrap label={label} error={error} hint={hint} id={fid}>
      <select ref={ref} id={fid} aria-invalid={!!error} {...rest}>{children}</select>
    </FieldWrap>
  );
});
SelectField.displayName = 'SelectField';

type TextAreaFieldProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string; hint?: string };
export const TextAreaField = forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(({ label, error, hint, id, ...rest }, ref) => {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldWrap label={label} error={error} hint={hint} id={fid}>
      <textarea ref={ref} id={fid} aria-invalid={!!error} {...rest} />
    </FieldWrap>
  );
});
TextAreaField.displayName = 'TextAreaField';

// ---------- Modal (focus + Escape handling) ----------
export function Modal({ title, open, onClose, children, footer, wide }: { title: string; open: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.modal-close)');
    first?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={ref}>
        <header className="modal-header">
          <h2 id="modal-title">{title}</h2>
          <button className="icon-btn modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', onConfirm, onCancel, loading }: { open: boolean; title: string; message: ReactNode; confirmLabel?: string; onConfirm: () => void; onCancel: () => void; loading?: boolean }) {
  return (
    <Modal open={open} title={title} onClose={onCancel} footer={
      <>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button variant="danger" onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
      </>
    }>
      <p className="muted">{message}</p>
    </Modal>
  );
}

// ---------- Display ----------
export function StatusBadge({ status }: { status: ShipmentStatus | 'Active' | 'Inactive' }) {
  const color = status === 'Active' ? '#10b981' : status === 'Inactive' ? '#94a3b8' : STATUS_COLORS[status];
  const label = status === 'Active' || status === 'Inactive' ? status : statusLabel(status);
  return (
    <span className="badge" style={{ ['--badge' as string]: color }}>
      <span className="badge-dot" aria-hidden />
      {label}
    </span>
  );
}

export function StatCard({ label, value, icon, sub, tone = 'default' }: { label: string; value: ReactNode; icon: ReactNode; sub?: ReactNode; tone?: 'default' | 'accent' | 'warn' }) {
  return (
    <div className={`card stat-card stat-${tone}`}>
      <div className="stat-icon" aria-hidden>{icon}</div>
      <div>
        <p className="stat-label">{label}</p>
        <p className="stat-value">{value}</p>
        {sub && <p className="stat-sub">{sub}</p>}
      </div>
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="state" role="status">
      <Loader2 className="spin" size={22} aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state state-error" role="alert">
      <AlertCircle size={22} aria-hidden />
      <span>{message}</span>
      {onRetry && <Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state">
      <Inbox size={22} aria-hidden />
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
