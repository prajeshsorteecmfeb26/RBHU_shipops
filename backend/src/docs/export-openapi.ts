/* Writes the generated OpenAPI spec to ../docs/openapi.json (run: npm run openapi:export) */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { buildContainer } from '../container';
import { createApp } from '../app';
import { getOpenApiDocument } from './openapi';

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: 'postgresql://unused' }) }); // never connects
createApp({ container: buildContainer(db) });
const out = resolve(__dirname, '../../../docs/openapi.json');
writeFileSync(out, JSON.stringify(getOpenApiDocument(), null, 2));
// eslint-disable-next-line no-console
console.log(`OpenAPI spec written to ${out}`);
