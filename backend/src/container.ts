import type { PrismaClient } from '@prisma/client';
import { PrismaCustomerRepository, type CustomerRepository } from './modules/customers/customer.repository';
import { CustomerService } from './modules/customers/customer.service';
import { PrismaShipmentRepository, type ShipmentRepository } from './modules/shipments/shipment.repository';
import { ShipmentService } from './modules/shipments/shipment.service';
import { PrismaChatRepository, type ChatRepository } from './modules/chat/chat.repository';
import { ChatService } from './modules/chat/chat.service';
import { createAiProvider, type AiProvider } from './modules/chat/ai.provider';
import { createToolExecutor } from './modules/chat/chat.tools';
import { createAnnouncementsProvider, type AnnouncementsProvider } from './modules/announcements/announcements.provider';
import { notificationBus, type NotificationBus } from './realtime/notificationBus';

/**
 * Composition root: the one place where concrete implementations are wired
 * together. Tests build their own container with in-memory fakes.
 */
export interface Container {
  customerRepo: CustomerRepository;
  shipmentRepo: ShipmentRepository;
  chatRepo: ChatRepository;
  customerService: CustomerService;
  shipmentService: ShipmentService;
  chatService: ChatService;
  aiProvider: AiProvider;
  announcements: AnnouncementsProvider;
  bus: NotificationBus;
}

export function buildContainer(
  db: PrismaClient,
  overrides: Partial<Pick<Container, 'customerRepo' | 'shipmentRepo' | 'chatRepo' | 'aiProvider' | 'announcements' | 'bus'>> = {},
): Container {
  const customerRepo = overrides.customerRepo ?? new PrismaCustomerRepository(db);
  const shipmentRepo = overrides.shipmentRepo ?? new PrismaShipmentRepository(db);
  const chatRepo = overrides.chatRepo ?? new PrismaChatRepository(db);
  const bus = overrides.bus ?? notificationBus;
  const aiProvider = overrides.aiProvider ?? createAiProvider();
  const announcements = overrides.announcements ?? createAnnouncementsProvider();

  const customerService = new CustomerService(customerRepo);
  const shipmentService = new ShipmentService(shipmentRepo, customerRepo, bus);
  const tools = createToolExecutor({ shipmentService, customerService, customerRepo, shipmentRepo });
  const chatService = new ChatService(chatRepo, aiProvider, tools);

  return { customerRepo, shipmentRepo, chatRepo, customerService, shipmentService, chatService, aiProvider, announcements, bus };
}
