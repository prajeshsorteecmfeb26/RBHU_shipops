import { EventEmitter } from 'node:events';

/**
 * Domain events broadcast to connected clients.
 * `shipment_status_changed` matches the assessment's sample event and adds
 * context fields (trackingNumber, previousStatus, ...) so the UI can render a
 * meaningful toast without an extra API call.
 */
export type NotificationEvent =
  | {
      event: 'shipment_status_changed';
      shipmentId: string;
      trackingNumber: string;
      status: string;
      previousStatus: string;
      changedBy: string;
      timestamp: string;
    }
  | {
      event: 'shipment_created';
      shipmentId: string;
      trackingNumber: string;
      status: string;
      changedBy: string;
      timestamp: string;
    };

/**
 * Publisher/subscriber seam between the domain and the transport.
 *
 * The in-memory implementation is correct for a single instance. When the API is
 * scaled out to N App Service instances, a client connected to instance A must
 * still hear about a change processed by instance B, so the bus is swapped for a
 * shared backplane (Redis pub/sub, Azure Service Bus topic, or by moving the
 * socket layer itself to Azure Web PubSub). Services only depend on this
 * interface, so that swap does not touch business code. See docs/architecture.md.
 */
export interface NotificationBus {
  publish(event: NotificationEvent): Promise<void>;
  subscribe(handler: (event: NotificationEvent) => void): () => void;
}

export class InMemoryNotificationBus implements NotificationBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  async publish(event: NotificationEvent) {
    this.emitter.emit('event', event);
  }

  subscribe(handler: (event: NotificationEvent) => void) {
    this.emitter.on('event', handler);
    return () => this.emitter.off('event', handler);
  }
}

export const notificationBus: NotificationBus = new InMemoryNotificationBus();
