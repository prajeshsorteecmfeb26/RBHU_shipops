import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type {
  AnalysisResult,
  Announcement,
  ChatMessage,
  ChatResponse,
  ConversationSummary,
  Customer,
  CustomerStatus,
  DashboardStats,
  Paged,
  Shipment,
  ShipmentDetail,
  ShipmentStatus,
} from './types';

/** Central query keys: real-time events invalidate these to refresh the UI. */
export const qk = {
  stats: ['dashboard', 'stats'] as const,
  customers: (params?: object) => ['customers', params ?? {}] as const,
  customersAll: ['customers'] as const,
  shipments: (params?: object) => ['shipments', params ?? {}] as const,
  shipmentsAll: ['shipments'] as const,
  shipment: (id: string) => ['shipment', id] as const,
  conversations: ['chat', 'conversations'] as const,
  conversation: (id: string) => ['chat', 'conversation', id] as const,
  announcements: ['announcements'] as const,
};

const qs = (params: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
};

// ---------- Dashboard ----------
export const useDashboardStats = () =>
  useQuery({ queryKey: qk.stats, queryFn: () => api.get<DashboardStats>('/api/dashboard/stats') });

// ---------- Customers ----------
export interface CustomerQuery {
  page: number;
  pageSize: number;
  search?: string;
  status?: CustomerStatus | '';
}
export const useCustomers = (params: CustomerQuery) =>
  useQuery({
    queryKey: qk.customers(params),
    queryFn: () => api.get<Paged<Customer>>(`/api/customers${qs({ ...params, status: params.status || undefined })}`),
    placeholderData: keepPreviousData,
  });

/** Active customers for selects (create-shipment form). */
export const useActiveCustomerOptions = () =>
  useQuery({
    queryKey: qk.customers({ purpose: 'options' }),
    queryFn: () => api.get<Paged<Customer>>('/api/customers?status=Active&pageSize=100&sortBy=name&sortOrder=asc'),
    select: (r) => r.data,
  });

export type CustomerInput = { name: string; email: string; company: string; status: CustomerStatus };

export function useSaveCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: CustomerInput }) =>
      id ? api.patch<Customer>(`/api/customers/${id}`, input) : api.post<Customer>('/api/customers', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.customersAll });
      qc.invalidateQueries({ queryKey: qk.stats });
    },
  });
}

export function useDeleteCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/customers/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.customersAll });
      qc.invalidateQueries({ queryKey: qk.stats });
    },
  });
}

// ---------- Shipments ----------
export interface ShipmentQuery {
  page: number;
  pageSize: number;
  search?: string;
  status?: ShipmentStatus | '';
}
export const useShipments = (params: ShipmentQuery) =>
  useQuery({
    queryKey: qk.shipments(params),
    queryFn: () => api.get<Paged<Shipment>>(`/api/shipments${qs({ ...params, status: params.status || undefined })}`),
    placeholderData: keepPreviousData,
  });

export const useShipment = (id: string | null) =>
  useQuery({
    queryKey: qk.shipment(id ?? ''),
    queryFn: () => api.get<ShipmentDetail>(`/api/shipments/${id}`),
    enabled: !!id,
  });

export function useCreateShipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { customerId: string; origin: string; destination: string; trackingNumber?: string }) =>
      api.post<Shipment>('/api/shipments', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.shipmentsAll });
      qc.invalidateQueries({ queryKey: qk.stats });
    },
  });
}

export function useUpdateShipmentStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, note }: { id: string; status: ShipmentStatus; note?: string }) =>
      api.patch<Shipment>(`/api/shipments/${id}/status`, { status, note: note || undefined }),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: qk.shipmentsAll });
      qc.invalidateQueries({ queryKey: qk.shipment(s.id) });
      qc.invalidateQueries({ queryKey: qk.stats });
    },
  });
}

// ---------- AI assistant ----------
export const useConversations = () =>
  useQuery({ queryKey: qk.conversations, queryFn: () => api.get<ConversationSummary[]>('/api/chat/conversations') });

export const useConversation = (id: string | null) =>
  useQuery({
    queryKey: qk.conversation(id ?? ''),
    queryFn: () => api.get<ConversationSummary & { messages: ChatMessage[] }>(`/api/chat/conversations/${id}`),
    enabled: !!id,
  });

export function useSendChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { message: string; conversationId?: string }) => api.post<ChatResponse>('/api/chat', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.conversations }),
  });
}

export function useDeleteConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/chat/conversations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.conversations }),
  });
}

// ---------- Analytics ----------
export const useAnalyzeSales = () =>
  useMutation({
    mutationFn: ({ file, includePng }: { file: File; includePng: boolean }) => {
      const form = new FormData();
      form.append('file', file);
      return api.upload<AnalysisResult>(`/api/analytics/analyze?includePng=${includePng}`, form);
    },
  });

// ---------- Announcements (SharePoint PoC) ----------
export const useAnnouncements = () =>
  useQuery({
    queryKey: qk.announcements,
    queryFn: () => api.get<{ source: string; data: Announcement[] }>('/api/announcements?limit=5'),
    staleTime: 5 * 60_000,
  });
