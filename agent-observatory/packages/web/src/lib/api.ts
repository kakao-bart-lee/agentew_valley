const DEV_API_BASE = 'http://localhost:3561';

export const getApiBase = () =>
  (window as any).__OBSERVATORY_API__
  ?? (import.meta as any).env?.VITE_WEBSOCKET_URL
  ?? ((import.meta as any).env?.DEV ? DEV_API_BASE : window.location.origin);

export const getSocketUrl = () =>
  (import.meta as any).env?.VITE_WEBSOCKET_URL
  ?? (window as any).__OBSERVATORY_API__
  ?? ((import.meta as any).env?.DEV ? DEV_API_BASE : window.location.origin);

export const fetchWithAuth = async (url: string, options: RequestInit = {}) => {
  const token = localStorage.getItem('OBSERVATORY_TOKEN') || (import.meta as any).env?.VITE_DASHBOARD_API_KEY;
  const headers = new Headers(options.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(url, { ...options, headers });
};

export async function fetchJsonWithAuth<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetchWithAuth(url, options);
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}
