const apiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

function deriveWsUrl(): string {
  const explicit = import.meta.env.VITE_WS_URL as string | undefined;
  if (explicit) return explicit;
  const base = apiUrl || window.location.origin;
  return base.replace(/^http/, 'ws') + '/ws';
}

export const config = {
  apiUrl,
  wsUrl: deriveWsUrl(),
};
