import type { ShipmentStatus } from '../api/types';

const STATUS_LABELS: Record<ShipmentStatus, string> = {
  Created: 'Created',
  PickedUp: 'Picked up',
  InTransit: 'In transit',
  OutForDelivery: 'Out for delivery',
  Delivered: 'Delivered',
  Exception: 'Exception',
  Cancelled: 'Cancelled',
};
export const statusLabel = (s: ShipmentStatus) => STATUS_LABELS[s] ?? s;

/** Chart + badge colours per status (also used by the dashboard donut). */
export const STATUS_COLORS: Record<ShipmentStatus, string> = {
  Created: '#64748b',
  PickedUp: '#6366f1',
  InTransit: '#0ea5e9',
  OutForDelivery: '#f59e0b',
  Delivered: '#10b981',
  Exception: '#ef4444',
  Cancelled: '#94a3b8',
};

const dateFmt = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
export const formatDate = (iso: string) => dateFmt.format(new Date(iso));

export function timeAgo(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

const numFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
export const formatNumber = (n: number) => numFmt.format(n);
