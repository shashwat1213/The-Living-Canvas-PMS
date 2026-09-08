/**
 * Domain types for point of sale, mirroring `backend/src/modules/pos`. Money
 * is integer INR minor units (paise). Lists follow the shared page envelope.
 */
import type { PageMeta } from '../../lib/pagination';

export const OUTLET_TYPES = [
  'RESTAURANT',
  'BAR',
  'CAFE',
  'SPA',
  'MINIBAR',
  'GIFT_SHOP',
  'ROOM_SERVICE',
  'OTHER',
] as const;
export type OutletType = (typeof OUTLET_TYPES)[number];

export const OUTLET_TYPE_LABEL: Record<string, string> = {
  RESTAURANT: 'Restaurant',
  BAR: 'Bar',
  CAFE: 'Café',
  SPA: 'Spa',
  MINIBAR: 'Minibar',
  GIFT_SHOP: 'Gift shop',
  ROOM_SERVICE: 'Room service',
  OTHER: 'Other',
};

export interface Outlet {
  id: string;
  name: string;
  type: OutletType;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  outletId: string;
  name: string;
  sku: string | null;
  category: string | null;
  priceMinor: number;
  trackStock: boolean;
  stockQty: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type OrderStatus = 'OPEN' | 'CHARGED' | 'PAID' | 'VOID';
export type Settlement = 'UNSETTLED' | 'ROOM_CHARGE' | 'DIRECT';

export const ORDER_STATUS_LABEL: Record<string, string> = {
  OPEN: 'Open',
  CHARGED: 'Charged to room',
  PAID: 'Paid',
  VOID: 'Void',
};

export const PAYMENT_METHODS = ['CASH', 'CARD', 'UPI', 'BANK_TRANSFER', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  CASH: 'Cash',
  CARD: 'Card',
  UPI: 'UPI',
  BANK_TRANSFER: 'Bank transfer',
  OTHER: 'Other',
};

export interface OrderItem {
  id: string;
  productId: string;
  nameSnapshot: string;
  unitPriceMinor: number;
  quantity: number;
  lineTotalMinor: number;
}

export interface Order {
  id: string;
  reference: string;
  status: OrderStatus;
  settlement: Settlement;
  outlet: { id: string; name: string; type: string };
  reservation: { id: string; reference: string } | null;
  paymentMethod: PaymentMethod | null;
  totalMinor: number;
  folioChargeId: string | null;
  notes: string | null;
  settledAt: string | null;
  createdAt: string;
  items: OrderItem[];
}

export interface OutletsResponse {
  outlets: Outlet[];
  page: PageMeta;
}
export interface ProductsResponse {
  products: Product[];
  page: PageMeta;
}
export interface OrdersResponse {
  orders: Order[];
  page: PageMeta;
}
