/* Seeds demo users, customers and shipments. Idempotent: safe to run repeatedly. */
import 'dotenv/config';
import { PrismaClient, type ShipmentStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const SEED = 'seed-script';

const users = [
  { email: 'admin@shipops.local', name: 'Asha Admin', role: 'ADMIN' as const, password: 'Admin@123' },
  { email: 'operator@shipops.local', name: 'Omar Operator', role: 'OPERATOR' as const, password: 'Operator@123' },
  { email: 'viewer@shipops.local', name: 'Vikram Viewer', role: 'VIEWER' as const, password: 'Viewer@123' },
];

const customers = [
  { name: 'Priya Sharma', email: 'priya@acmelogistics.in', company: 'Acme Logistics' },
  { name: 'Rahul Mehta', email: 'rahul@bluedart-traders.in', company: 'Blue Harbour Traders' },
  { name: 'Ananya Iyer', email: 'ananya@sunrise-retail.in', company: 'Sunrise Retail' },
  { name: 'Karan Singh', email: 'karan@northstar.co.in', company: 'Northstar Pharma' },
  { name: 'Fatima Khan', email: 'fatima@coastalfoods.in', company: 'Coastal Foods' },
  { name: 'Arjun Nair', email: 'arjun@techwave.in', company: 'TechWave Electronics', status: 'Inactive' as const },
];

const cities = ['Mumbai, MH', 'Pune, MH', 'Bengaluru, KA', 'Chennai, TN', 'Delhi, DL', 'Hyderabad, TS', 'Kolkata, WB', 'Ahmedabad, GJ', 'Navi Mumbai, MH'];

// Paths through the state machine used to build realistic history
const paths: ShipmentStatus[][] = [
  ['Created'],
  ['Created', 'PickedUp'],
  ['Created', 'PickedUp', 'InTransit'],
  ['Created', 'PickedUp', 'InTransit', 'OutForDelivery'],
  ['Created', 'PickedUp', 'InTransit', 'OutForDelivery', 'Delivered'],
  ['Created', 'PickedUp', 'InTransit', 'Exception'],
  ['Created', 'Cancelled'],
];

async function main() {
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role },
      create: { email: u.email, name: u.name, role: u.role, passwordHash: await bcrypt.hash(u.password, 12) },
    });
  }

  const customerIds: string[] = [];
  for (const c of customers) {
    const existing = await prisma.customer.findFirst({ where: { email: c.email, deletedAt: null } });
    const row = existing ?? (await prisma.customer.create({ data: { ...c, createdBy: SEED, updatedBy: SEED } }));
    if ((c.status ?? 'Active') === 'Active') customerIds.push(row.id);
  }

  let n = 0;
  for (let i = 0; i < 24; i++) {
    const trackingNumber = `SHP-DEMO${String(1000 + i).padStart(6, '0')}`;
    if (await prisma.shipment.findUnique({ where: { trackingNumber } })) continue;

    const path = paths[i % paths.length];
    const origin = cities[i % cities.length];
    const destination = cities[(i * 3 + 2) % cities.length] === origin ? cities[(i + 1) % cities.length] : cities[(i * 3 + 2) % cities.length];
    const start = Date.now() - (path.length + 2) * 6 * 3600_000 - i * 3600_000;

    await prisma.shipment.create({
      data: {
        trackingNumber,
        customerId: customerIds[i % customerIds.length],
        origin,
        destination,
        status: path[path.length - 1],
        createdBy: SEED,
        updatedBy: SEED,
        createdAt: new Date(start),
        statusHistory: {
          create: path.map((to, idx) => ({
            fromStatus: idx === 0 ? null : path[idx - 1],
            toStatus: to,
            changedBy: SEED,
            note: idx === 0 ? 'Shipment created' : undefined,
            changedAt: new Date(start + idx * 6 * 3600_000),
          })),
        },
      },
    });
    n++;
  }

  // eslint-disable-next-line no-console
  console.log(`Seed complete: ${users.length} users, ${customers.length} customers, ${n} new shipments`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
