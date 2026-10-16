/**
 * End-to-end API tests against a real PostgreSQL database (HTTP + WebSocket).
 * Enabled with RUN_INTEGRATION=1 and a migrated database in DATABASE_URL, e.g.:
 *   DATABASE_URL=postgresql://shipops:shipops@localhost:5432/shipops_test npx prisma migrate deploy
 *   RUN_INTEGRATION=1 DATABASE_URL=... npm test
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { buildContainer } from '../src/container';
import { createApp } from '../src/app';
import { attachWebSocketServer } from '../src/realtime/wsServer';

const enabled = process.env.RUN_INTEGRATION === '1';

describe.skipIf(!enabled)('API integration', () => {
  let server: Server;
  let baseUrl: string;
  let realtime: ReturnType<typeof attachWebSocketServer>;
  let adminToken: string;
  let viewerToken: string;
  const api = () => request(server);

  beforeAll(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE chat_messages, conversations, shipment_status_history, shipments, customers, users CASCADE');
    const hash = await bcrypt.hash('Passw0rd!', 4);
    await prisma.user.createMany({
      data: [
        { email: 'admin@it.local', name: 'IT Admin', role: 'ADMIN', passwordHash: hash },
        { email: 'viewer@it.local', name: 'IT Viewer', role: 'VIEWER', passwordHash: hash },
      ],
    });
    const container = buildContainer(prisma);
    server = createServer(createApp({ container, readinessCheck: async () => true }));
    realtime = attachWebSocketServer(server, container.bus);
    await new Promise<void>((r) => server.listen(0, r));
    baseUrl = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;

    adminToken = (await api().post('/api/auth/login').send({ email: 'admin@it.local', password: 'Passw0rd!' })).body.token;
    viewerToken = (await api().post('/api/auth/login').send({ email: 'viewer@it.local', password: 'Passw0rd!' })).body.token;
  });

  afterAll(async () => {
    await realtime?.close();
    await new Promise((r) => server?.close(r));
    await prisma.$disconnect();
  });

  it('rejects bad credentials and missing tokens', async () => {
    expect((await api().post('/api/auth/login').send({ email: 'admin@it.local', password: 'nope' })).status).toBe(401);
    const res = await api().get('/api/customers');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('returns structured 400s from Zod validation', async () => {
    const res = await api().post('/api/customers').set('Authorization', `Bearer ${adminToken}`).send({ name: 'A', email: 'bad' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(['name', 'email', 'company']));
  });

  it('enforces roles (viewer cannot create)', async () => {
    const res = await api().post('/api/customers').set('Authorization', `Bearer ${viewerToken}`).send({ name: 'Viewer Co', email: 'v@x.in', company: 'V' });
    expect(res.status).toBe(403);
  });

  it('full customer + shipment lifecycle with real-time notification', async () => {
    const auth = { Authorization: `Bearer ${adminToken}` };

    const cust = await api().post('/api/customers').set(auth).send({ name: 'Priya Sharma', email: 'priya@acme.in', company: 'Acme' });
    expect(cust.status).toBe(201);
    expect((await api().post('/api/customers').set(auth).send({ name: 'Dup', email: 'PRIYA@acme.in', company: 'X' })).status).toBe(409);

    const upd = await api().patch(`/api/customers/${cust.body.id}`).set(auth).send({ company: 'Acme Logistics' });
    expect(upd.body.company).toBe('Acme Logistics');

    const list = await api().get('/api/customers?search=acme').set(auth);
    expect(list.body.meta.total).toBe(1);

    const ship = await api().post('/api/shipments').set(auth).send({ customerId: cust.body.id, origin: 'Mumbai, MH', destination: 'Pune, MH' });
    expect(ship.status).toBe(201);

    // Connect a WebSocket client and wait for the status-change broadcast
    const ws = new WebSocket(baseUrl, ['shipops.v1', `bearer.${viewerToken}`]);
    const messages: Record<string, unknown>[] = [];
    await new Promise<void>((resolve, reject) => {
      ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString());
        messages.push(m);
        if (m.event === 'connected') resolve();
      });
      ws.on('error', reject);
    });
    const received = new Promise<Record<string, unknown>>((resolve) => {
      ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString());
        if (m.event === 'shipment_status_changed') resolve(m);
      });
    });

    const patched = await api().patch(`/api/shipments/${ship.body.id}/status`).set(auth).send({ status: 'PickedUp', note: 'Collected' });
    expect(patched.status).toBe(200);
    expect(await received).toMatchObject({ event: 'shipment_status_changed', shipmentId: ship.body.id, status: 'PickedUp', previousStatus: 'Created' });
    ws.close();

    const invalid = await api().patch(`/api/shipments/${ship.body.id}/status`).set(auth).send({ status: 'Delivered' });
    expect(invalid.status).toBe(422);

    const detail = await api().get(`/api/shipments/track/${ship.body.trackingNumber.toLowerCase()}`).set(auth);
    expect(detail.body.statusHistory.map((h: { toStatus: string }) => h.toStatus)).toEqual(['Created', 'PickedUp']);

    const stats = await api().get('/api/dashboard/stats').set(auth);
    expect(stats.body).toMatchObject({ totalCustomers: 1, totalShipments: 1 });

    // Soft delete: gone from API, row kept, email reusable
    expect((await api().delete(`/api/customers/${cust.body.id}`).set(auth)).status).toBe(204);
    expect((await api().get(`/api/customers/${cust.body.id}`).set(auth)).status).toBe(404);
    const row = await prisma.customer.findUnique({ where: { id: cust.body.id } });
    expect(row?.deletedAt).not.toBeNull();
    expect((await api().post('/api/customers').set(auth).send({ name: 'Priya Again', email: 'priya@acme.in', company: 'Acme' })).status).toBe(201);
  });

  it('rejects unauthenticated WebSocket upgrades', async () => {
    const ws = new WebSocket(baseUrl, ['shipops.v1']);
    const code = await new Promise((resolve) => ws.on('unexpected-response', (_req, res) => resolve(res.statusCode)));
    expect(code).toBe(401);
  });

  it('chat keeps conversation history per user', async () => {
    const auth = { Authorization: `Bearer ${adminToken}` };
    const first = await api().post('/api/chat').set(auth).send({ message: 'Give me a shipment summary' });
    expect(first.status).toBe(200);
    expect(first.body.message.content).toMatch(/shipments/);
    expect(first.body.meta.toolsUsed).toContain('get_operations_summary');

    await api().post('/api/chat').set(auth).send({ message: 'thanks', conversationId: first.body.conversationId });
    const conv = await api().get(`/api/chat/conversations/${first.body.conversationId}`).set(auth);
    expect(conv.body.messages).toHaveLength(4);

    // Another user cannot read it
    const other = await api().get(`/api/chat/conversations/${first.body.conversationId}`).set('Authorization', `Bearer ${viewerToken}`);
    expect(other.status).toBe(404);
  });

  it('serves announcements and OpenAPI docs', async () => {
    const res = await api().get('/announcements?limit=3').set('Authorization', `Bearer ${viewerToken}`);
    expect(res.body.source).toBe('mock');
    expect(res.body.data).toHaveLength(3);
    expect(res.body.data[0].pinned).toBe(true);
    const spec = await api().get('/api-docs/openapi.json');
    expect(spec.body.paths['/api/shipments/{id}/status']).toBeDefined();
  });
});
