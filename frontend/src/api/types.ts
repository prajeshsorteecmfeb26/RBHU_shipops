export type Role = 'ADMIN' | 'OPERATOR' | 'VIEWER';
export type CustomerStatus = 'Active' | 'Inactive';
export const SHIPMENT_STATUSES = ['Created', 'PickedUp', 'InTransit', 'OutForDelivery', 'Delivered', 'Exception', 'Cancelled'] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
export interface Paged<T> {
  data: T[];
  meta: PageMeta;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  company: string;
  status: CustomerStatus;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface Shipment {
  id: string;
  trackingNumber: string;
  customerId: string;
  customerName?: string;
  customerCompany?: string;
  origin: string;
  destination: string;
  status: ShipmentStatus;
  allowedNextStatuses: ShipmentStatus[];
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface ShipmentDetail extends Shipment {
  statusHistory: { fromStatus: ShipmentStatus | null; toStatus: ShipmentStatus; note: string | null; changedBy: string | null; changedAt: string }[];
}

export interface DashboardStats {
  totalCustomers: number;
  totalShipments: number;
  statusDistribution: { status: ShipmentStatus; count: number }[];
  generatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}
export interface ChatResponse {
  conversationId: string;
  message: ChatMessage & { role: 'assistant' };
  meta: { provider: string; toolsUsed: string[]; promptTokens?: number; outputTokens?: number; latencyMs: number };
}
export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  category: string;
  author: string;
  publishedAt: string;
  pinned: boolean;
  url?: string;
}

export interface AnalysisResult {
  summary: {
    totalRows: number;
    validRows: number;
    skippedRows: number;
    totalRevenue: number;
    averageRevenue: number;
    medianRevenue: number;
    minRevenue: number;
    maxRevenue: number;
    stdDevRevenue: number;
    percentile25: number;
    percentile75: number;
    salespeopleCount: number;
    regionCount: number;
    topRegion: string | null;
    topSalesperson: string | null;
  };
  revenueByRegion: { region: string; revenue: number; share: number; deals: number; salespeople: number }[];
  topSalespeople: { rank: number; salesperson: string; revenue: number; deals: number; regions: string[] }[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  charts: { revenueByRegion: { data: any[]; layout: any }; topSalespeople: { data: any[]; layout: any } };
  png?: { revenueByRegion: string | null; topSalespeople: string | null };
  warnings: string[];
}

/** Payload pushed over the WebSocket */
export type RealtimeEvent =
  | { event: 'connected'; clientId: string; timestamp: string }
  | { event: 'pong'; timestamp: string }
  | { event: 'shipment_status_changed'; shipmentId: string; trackingNumber: string; status: ShipmentStatus; previousStatus: ShipmentStatus; changedBy: string; timestamp: string }
  | { event: 'shipment_created'; shipmentId: string; trackingNumber: string; status: ShipmentStatus; changedBy: string; timestamp: string };
