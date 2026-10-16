import { OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { registry } from '../lib/zod';

let cached: ReturnType<OpenApiGeneratorV3['generateDocument']> | undefined;

/** Builds the OpenAPI 3.0 document from every path/schema registered by the routers. */
export function getOpenApiDocument() {
  cached ??= new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'ShipOps Platform API',
      version: '1.0.0',
      description:
        'Customer & shipment management, sales analytics gateway, AI assistant and intranet announcements.\n\n' +
        '**Auth:** call `POST /api/auth/login` (demo users in README), then click *Authorize* and paste the token.\n\n' +
        '**Real-time:** connect to `ws://<host>/ws` with subprotocols `["shipops.v1", "bearer.<token>"]` to receive ' +
        '`shipment_status_changed` and `shipment_created` events.',
    },
    servers: [{ url: '/' }],
    tags: [
      { name: 'Auth' },
      { name: 'Dashboard' },
      { name: 'Customers' },
      { name: 'Shipments' },
      { name: 'Analytics' },
      { name: 'AI Assistant' },
      { name: 'Announcements (SharePoint PoC)' },
      { name: 'Health' },
    ],
  });
  return cached;
}
