import { apiFetch } from '../../lib/api';
import { toQueryString } from '../../lib/pagination';
import type {
  Order,
  OrdersResponse,
  Outlet,
  OutletsResponse,
  PaymentMethod,
  Product,
  ProductsResponse,
} from './types';

/**
 * The only place POS endpoints are named. Everything lives under a property,
 * so each call carries the property id — the backend resolves it through the
 * tenant-scoped client, which is what makes a cross-organization property a
 * 404 rather than a leak. `apiFetch` serializes the body itself, so callers
 * pass a plain object.
 */
const base = (propertyId: string) => `/api/v1/properties/${propertyId}/pos`;

// ----- Outlets -----
export function listOutlets(
  propertyId: string,
  params: { page?: number; pageSize?: number; search?: string; status?: string } = {},
): Promise<OutletsResponse> {
  return apiFetch<OutletsResponse>(`${base(propertyId)}/outlets${toQueryString(params)}`);
}

export function createOutlet(
  propertyId: string,
  body: { name: string; type?: string },
): Promise<{ outlet: Outlet }> {
  return apiFetch(`${base(propertyId)}/outlets`, { method: 'POST', body });
}

export function updateOutlet(
  propertyId: string,
  outletId: string,
  body: Partial<{ name: string; type: string; isActive: boolean }>,
): Promise<{ outlet: Outlet }> {
  return apiFetch(`${base(propertyId)}/outlets/${outletId}`, { method: 'PATCH', body });
}

// ----- Products -----
export function listProducts(
  propertyId: string,
  outletId: string,
  params: { page?: number; pageSize?: number; search?: string; status?: string } = {},
): Promise<ProductsResponse> {
  return apiFetch<ProductsResponse>(`${base(propertyId)}/outlets/${outletId}/products${toQueryString(params)}`);
}

export function createProduct(
  propertyId: string,
  outletId: string,
  body: Record<string, unknown>,
): Promise<{ product: Product }> {
  return apiFetch(`${base(propertyId)}/outlets/${outletId}/products`, { method: 'POST', body });
}

export function updateProduct(
  propertyId: string,
  outletId: string,
  productId: string,
  body: Record<string, unknown>,
): Promise<{ product: Product }> {
  return apiFetch(`${base(propertyId)}/outlets/${outletId}/products/${productId}`, { method: 'PATCH', body });
}

// ----- Orders -----
export function listOrders(
  propertyId: string,
  params: { page?: number; pageSize?: number; search?: string; status?: string; outletId?: string } = {},
): Promise<OrdersResponse> {
  return apiFetch<OrdersResponse>(`${base(propertyId)}/orders${toQueryString(params)}`);
}

export function createOrder(
  propertyId: string,
  body: {
    outletId: string;
    items: { productId: string; quantity: number }[];
    settlement?: 'ROOM_CHARGE' | 'DIRECT';
    reservationId?: string;
    paymentMethod?: PaymentMethod;
    notes?: string;
  },
): Promise<{ order: Order }> {
  return apiFetch(`${base(propertyId)}/orders`, { method: 'POST', body });
}

export function voidOrder(propertyId: string, orderId: string): Promise<{ order: Order }> {
  return apiFetch(`${base(propertyId)}/orders/${orderId}/void`, { method: 'POST' });
}
