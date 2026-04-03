import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

export const apiClient = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
});

// Inject Shopify session token from sessionStorage
apiClient.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = sessionStorage.getItem('shopify_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ─── Products ─────────────────────────────────────────────────────────────────

export interface ProductsQuery {
  search?: string;
  vendor?: string;
  status?: string;
  inStock?: boolean;
  excludeFromFeeds?: boolean;
  page?: number;
  limit?: number;
}

export const productsApi = {
  list: (params: ProductsQuery) =>
    apiClient.get('/products', { params }).then((r) => r.data),

  get: (id: string) =>
    apiClient.get(`/products/${id}`).then((r) => r.data),

  toggleExclude: (id: string, exclude: boolean) =>
    apiClient.patch(`/products/${id}/exclude`, { exclude }).then((r) => r.data),

  vendors: () =>
    apiClient.get('/products/vendors').then((r) => r.data),
};

// ─── Feeds ────────────────────────────────────────────────────────────────────

export const feedsApi = {
  dashboard: () =>
    apiClient.get('/feeds/dashboard').then((r) => r.data),

  list: () =>
    apiClient.get('/feeds').then((r) => r.data),

  get: (id: string) =>
    apiClient.get(`/feeds/${id}`).then((r) => r.data),

  create: (data: any) =>
    apiClient.post('/feeds', data).then((r) => r.data),

  update: (id: string, data: any) =>
    apiClient.put(`/feeds/${id}`, data).then((r) => r.data),

  delete: (id: string) =>
    apiClient.delete(`/feeds/${id}`),

  triggerRun: (id: string) =>
    apiClient.post(`/feeds/${id}/run`).then((r) => r.data),

  getRuns: (id: string, limit = 20) =>
    apiClient.get(`/feeds/${id}/runs`, { params: { limit } }).then((r) => r.data),
};

// ─── Media ────────────────────────────────────────────────────────────────────

export const mediaApi = {
  resolve: (sku: string) =>
    apiClient.get('/media/resolve', { params: { sku } }).then((r) => r.data),

  previewUrls: (sku: string, count = 5) =>
    apiClient.get('/media/preview-urls', { params: { sku, count } }).then((r) => r.data),
};
