import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { config } from '../config';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toaster';
import { qk } from '../api/hooks';
import type { RealtimeEvent } from '../api/types';
import { statusLabel } from '../lib/format';

export type ConnectionState = 'connecting' | 'open' | 'closed';
type ShipmentEvent = Extract<RealtimeEvent, { event: 'shipment_status_changed' | 'shipment_created' }>;

interface RealtimeValue {
  state: ConnectionState;
  feed: ShipmentEvent[];
  unread: number;
  markRead: () => void;
}

const RealtimeContext = createContext<RealtimeValue | null>(null);

/**
 * Single WebSocket per tab with exponential-backoff reconnect.
 * Events (1) show a toast, (2) append to the notification feed, and
 * (3) invalidate React Query caches so lists and the dashboard refresh themselves.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { token, user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [state, setState] = useState<ConnectionState>('closed');
  const [feed, setFeed] = useState<ShipmentEvent[]>([]);
  const [unread, setUnread] = useState(0);
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    if (!token) return;
    let ws: WebSocket | null = null;
    let attempt = 0;
    let retryTimer: number | undefined;
    let pingTimer: number | undefined;
    let disposed = false;

    const connect = () => {
      setState('connecting');
      // Token travels as a subprotocol (browsers can't set headers on WS upgrades)
      ws = new WebSocket(config.wsUrl, ['shipops.v1', `bearer.${token}`]);

      ws.onopen = () => {
        attempt = 0;
        setState('open');
        pingTimer = window.setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'ping' })), 25_000);
      };

      ws.onmessage = (msg) => {
        let evt: RealtimeEvent;
        try {
          evt = JSON.parse(msg.data);
        } catch {
          return;
        }
        if (evt.event !== 'shipment_status_changed' && evt.event !== 'shipment_created') return;

        setFeed((f) => [evt, ...f].slice(0, 30));
        setUnread((n) => n + 1);
        qc.invalidateQueries({ queryKey: qk.shipmentsAll });
        qc.invalidateQueries({ queryKey: qk.shipment(evt.shipmentId) });
        qc.invalidateQueries({ queryKey: qk.stats });

        const byMe = evt.changedBy === user?.email;
        toastRef.current({
          tone: 'info',
          title: evt.event === 'shipment_created' ? 'New shipment' : `Shipment ${statusLabel(evt.status)}`,
          body:
            evt.event === 'shipment_created'
              ? `${evt.trackingNumber} created${byMe ? '' : ` by ${evt.changedBy}`}`
              : `${evt.trackingNumber}: ${statusLabel(evt.previousStatus)} → ${statusLabel(evt.status)}${byMe ? '' : ` (by ${evt.changedBy})`}`,
        });
      };

      ws.onclose = (e) => {
        window.clearInterval(pingTimer);
        setState('closed');
        if (disposed || e.code === 1008) return;
        // 1s, 2s, 4s ... capped at 30s, with jitter to avoid thundering-herd reconnects after a deploy
        const delay = Math.min(30_000, 1000 * 2 ** attempt) * (0.75 + Math.random() * 0.5);
        attempt++;
        retryTimer = window.setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      window.clearInterval(pingTimer);
      ws?.close(1000, 'logout');
    };
  }, [token, qc, user?.email]);

  return (
    <RealtimeContext.Provider value={{ state, feed, unread, markRead: () => setUnread(0) }}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime() {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error('useRealtime must be used inside RealtimeProvider');
  return ctx;
}
