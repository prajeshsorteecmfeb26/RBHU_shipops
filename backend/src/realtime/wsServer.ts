import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { corsOrigins, env } from '../config/env';
import { logger } from '../lib/logger';
import { verifyToken } from '../modules/auth/token.service';
import type { NotificationBus, NotificationEvent } from './notificationBus';

const PROTOCOL = 'shipops.v1';
const MAX_BUFFERED_BYTES = 1024 * 1024; // drop events for clients that can't keep up

interface ClientMeta {
  id: string;
  userEmail: string;
  isAlive: boolean;
}

/**
 * Extracts the JWT. Browsers cannot set Authorization headers on WebSocket
 * upgrades, so the client sends it as a subprotocol: ["shipops.v1", "bearer.<jwt>"].
 * A ?token= query parameter is accepted as a fallback (e.g. for wscat).
 */
function extractToken(req: IncomingMessage): string | undefined {
  const protocols = String(req.headers['sec-websocket-protocol'] ?? '')
    .split(',')
    .map((p) => p.trim());
  const bearer = protocols.find((p) => p.startsWith('bearer.'));
  if (bearer) return bearer.slice('bearer.'.length);
  const url = new URL(req.url ?? '/', 'http://localhost');
  return url.searchParams.get('token') ?? undefined;
}

function reject(socket: Duplex, status: number, message: string) {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export function attachWebSocketServer(server: Server, bus: NotificationBus) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 16 * 1024, // clients only send tiny control messages
    handleProtocols: (protocols) => (protocols.has(PROTOCOL) ? PROTOCOL : false),
  });
  const meta = new WeakMap<WebSocket, ClientMeta>();

  // Authenticate BEFORE upgrading so unauthenticated sockets never get opened
  server.on('upgrade', async (req, socket, head) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    if (pathname !== '/ws') return reject(socket, 404, 'Not Found');

    const origin = req.headers.origin;
    if (origin && !corsOrigins.includes(origin)) {
      logger.warn({ origin }, 'ws upgrade rejected: origin not allowed');
      return reject(socket, 403, 'Forbidden');
    }

    const token = extractToken(req);
    if (!token) return reject(socket, 401, 'Unauthorized');
    try {
      const { claims } = await verifyToken(token);
      wss.handleUpgrade(req, socket, head, (ws) => {
        meta.set(ws, { id: randomUUID(), userEmail: claims.email, isAlive: true });
        wss.emit('connection', ws, req);
      });
    } catch {
      reject(socket, 401, 'Unauthorized');
    }
  });

  wss.on('connection', (ws) => {
    const m = meta.get(ws)!;
    logger.info({ clientId: m.id, user: m.userEmail, clients: wss.clients.size }, 'ws client connected');
    ws.send(JSON.stringify({ event: 'connected', clientId: m.id, timestamp: new Date().toISOString() }));

    ws.on('pong', () => {
      m.isAlive = true;
    });
    ws.on('message', (raw) => {
      // Only a tiny application-level ping is supported; everything else is ignored
      try {
        const msg = JSON.parse(raw.toString());
        if (msg?.type === 'ping') ws.send(JSON.stringify({ event: 'pong', timestamp: new Date().toISOString() }));
      } catch {
        /* ignore malformed client messages */
      }
    });
    ws.on('close', () => logger.info({ clientId: m.id, clients: wss.clients.size }, 'ws client disconnected'));
    ws.on('error', (err) => logger.warn({ err, clientId: m.id }, 'ws client error'));
  });

  // Heartbeat: terminate connections that stopped answering pings (dead NAT / sleeping laptops)
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const m = meta.get(ws);
      if (!m) continue;
      if (!m.isAlive) {
        ws.terminate();
        continue;
      }
      m.isAlive = false;
      ws.ping();
    }
  }, env.WS_HEARTBEAT_MS);
  heartbeat.unref();

  const broadcast = (event: NotificationEvent) => {
    const payload = JSON.stringify(event);
    let delivered = 0;
    for (const ws of wss.clients) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (ws.bufferedAmount > MAX_BUFFERED_BYTES) continue; // backpressure protection
      ws.send(payload);
      delivered++;
    }
    logger.debug({ event: event.event, delivered }, 'ws broadcast');
  };
  const unsubscribe = bus.subscribe(broadcast);

  return {
    wss,
    clientCount: () => wss.clients.size,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(heartbeat);
        unsubscribe();
        for (const ws of wss.clients) ws.close(1001, 'Server shutting down');
        wss.close(() => resolve());
      }),
  };
}
