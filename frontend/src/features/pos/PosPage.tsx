import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Badge, type BadgeTone } from '../../components/Badge';
import { useAuth } from '../../auth/useAuth';
import { ApiError } from '../../lib/api';
import { formatMinor } from '../rate-plans/money';
import { getProperty } from '../properties/api';
import type { Property } from '../properties/types';
import * as posApi from './api';
import { OutletDialog } from './OutletDialog';
import { ProductDialog } from './ProductDialog';
import { canManagePos, canOperatePos, canReadPos } from './permissions';
import {
  ORDER_STATUS_LABEL,
  OUTLET_TYPE_LABEL,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  type Order,
  type Outlet,
  type PaymentMethod,
  type Product,
} from './types';
import './pos.css';

const STATUS_TONE: Record<string, BadgeTone> = {
  OPEN: 'neutral',
  CHARGED: 'accent',
  PAID: 'positive',
  VOID: 'muted',
};

interface CartLine {
  product: Product;
  quantity: number;
}

export function PosPage() {
  const { propertyId } = useParams<{ propertyId: string }>();
  const { session } = useAuth();

  const mayRead = canReadPos(session);
  const mayOperate = canOperatePos(session);
  const mayManage = canManagePos(session);

  const [property, setProperty] = useState<Property | null>(null);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [activeOutletId, setActiveOutletId] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Cart + settlement controls.
  const [cart, setCart] = useState<CartLine[]>([]);
  const [settlement, setSettlement] = useState<'DIRECT' | 'ROOM_CHARGE'>('DIRECT');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [reservationId, setReservationId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Dialogs.
  const [outletDialogOpen, setOutletDialogOpen] = useState(false);
  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const flash = useCallback((msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3500);
  }, []);

  const loadOutlets = useCallback(async () => {
    if (!propertyId) return;
    try {
      const res = await posApi.listOutlets(propertyId, { pageSize: 100 });
      setOutlets(res.outlets);
      setActiveOutletId((current) => current ?? res.outlets.find((o) => o.isActive)?.id ?? res.outlets[0]?.id ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load outlets.');
    }
  }, [propertyId]);

  const loadProducts = useCallback(async () => {
    if (!propertyId || !activeOutletId) {
      setProducts([]);
      return;
    }
    try {
      const res = await posApi.listProducts(propertyId, activeOutletId, { pageSize: 100 });
      setProducts(res.products);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the catalogue.');
    }
  }, [propertyId, activeOutletId]);

  const loadOrders = useCallback(async () => {
    if (!propertyId) return;
    try {
      const res = await posApi.listOrders(propertyId, { pageSize: 15 });
      setOrders(res.orders);
    } catch {
      // Non-fatal for the till; leave the last-known list.
    }
  }, [propertyId]);

  useEffect(() => {
    if (!mayRead) return;
    void loadOutlets();
  }, [mayRead, loadOutlets]);

  useEffect(() => {
    if (!mayRead) return;
    void loadProducts();
    void loadOrders();
  }, [mayRead, loadProducts, loadOrders]);

  useEffect(() => {
    if (!propertyId) return;
    getProperty(propertyId)
      .then(setProperty)
      .catch(() => setProperty(null));
  }, [propertyId]);

  // Switching outlet clears the in-progress cart — lines are outlet-specific.
  useEffect(() => {
    setCart([]);
  }, [activeOutletId]);

  const cartTotal = useMemo(() => cart.reduce((a, l) => a + l.product.priceMinor * l.quantity, 0), [cart]);

  function addToCart(product: Product) {
    setCart((current) => {
      const existing = current.find((l) => l.product.id === product.id);
      if (existing) {
        return current.map((l) => (l.product.id === product.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...current, { product, quantity: 1 }];
    });
  }

  function setQty(productId: string, quantity: number) {
    setCart((current) =>
      quantity <= 0
        ? current.filter((l) => l.product.id !== productId)
        : current.map((l) => (l.product.id === productId ? { ...l, quantity } : l)),
    );
  }

  async function submitOrder() {
    if (!propertyId || !activeOutletId || cart.length === 0) return;
    setSubmitting(true);
    try {
      const body = {
        outletId: activeOutletId,
        items: cart.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
        settlement,
        ...(settlement === 'DIRECT' ? { paymentMethod } : {}),
        ...(settlement === 'ROOM_CHARGE' ? { reservationId: reservationId.trim() } : {}),
      };
      const { order } = await posApi.createOrder(propertyId, body);
      flash(`Order ${order.reference} — ${ORDER_STATUS_LABEL[order.status]}.`);
      setCart([]);
      setReservationId('');
      await Promise.all([loadOrders(), loadProducts()]);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not place the order.');
    } finally {
      setSubmitting(false);
    }
  }

  async function onVoid(order: Order) {
    if (!propertyId) return;
    try {
      await posApi.voidOrder(propertyId, order.id);
      flash(`Order ${order.reference} voided.`);
      await Promise.all([loadOrders(), loadProducts()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not void the order.');
    }
  }

  if (!mayRead) {
    return (
      <section className="pos-page">
        <h1>Point of sale</h1>
        <p className="empty-state">You don&apos;t have access to point of sale for this property.</p>
      </section>
    );
  }

  const activeOutlet = outlets.find((o) => o.id === activeOutletId) ?? null;
  const canSubmit =
    mayOperate &&
    cart.length > 0 &&
    !submitting &&
    (settlement === 'DIRECT' || (settlement === 'ROOM_CHARGE' && reservationId.trim().length > 0));

  return (
    <section className="pos-page">
      <p className="pos-breadcrumb">
        <Link to="/app/properties">&larr; Properties</Link>
      </p>

      <header className="pos-header">
        <div>
          <h1>Point of sale{property ? ` — ${property.name}` : ''}</h1>
          <p className="pos-subtitle">Ring up outlet sales and charge them to a room or take direct payment.</p>
        </div>
        {mayManage && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setOutletDialogOpen(true)}>
            + New outlet
          </button>
        )}
      </header>

      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="page-success" role="status">
          {notice}
        </p>
      )}

      {outlets.length === 0 ? (
        <p className="empty-state">
          No outlets yet.{' '}
          {mayManage ? 'Create one to start selling.' : 'A manager can set one up.'}
        </p>
      ) : (
        <>
          <div className="pos-outlet-tabs" role="tablist">
            {outlets.map((o) => (
              <button
                key={o.id}
                type="button"
                role="tab"
                aria-selected={o.id === activeOutletId}
                className={`pos-tab ${o.id === activeOutletId ? 'pos-tab-active' : ''}`}
                onClick={() => setActiveOutletId(o.id)}
              >
                {o.name}
                {!o.isActive && <span className="pos-tab-retired"> (retired)</span>}
              </button>
            ))}
          </div>

          <div className="pos-till">
            {/* Catalogue */}
            <div className="pos-catalogue">
              <div className="pos-catalogue-head">
                <h2>{activeOutlet ? OUTLET_TYPE_LABEL[activeOutlet.type] ?? activeOutlet.type : 'Catalogue'}</h2>
                {mayManage && activeOutletId && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setEditingProduct(null);
                      setProductDialogOpen(true);
                    }}
                  >
                    + Product
                  </button>
                )}
              </div>
              {products.length === 0 ? (
                <p className="empty-state">No products in this outlet yet.</p>
              ) : (
                <ul className="pos-product-grid">
                  {products.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="pos-product"
                        disabled={!mayOperate || !p.isActive || (p.trackStock && p.stockQty <= 0)}
                        onClick={() => addToCart(p)}
                        title={mayOperate ? 'Add to order' : 'You cannot take orders'}
                      >
                        <span className="pos-product-name">{p.name}</span>
                        <span className="pos-product-price">{formatMinor(p.priceMinor)}</span>
                        {p.trackStock && <span className="pos-product-stock">{p.stockQty} in stock</span>}
                        {!p.isActive && <span className="pos-product-retired">retired</span>}
                      </button>
                      {mayManage && (
                        <button
                          type="button"
                          className="pos-product-edit"
                          onClick={() => {
                            setEditingProduct(p);
                            setProductDialogOpen(true);
                          }}
                        >
                          Edit
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Cart / order builder */}
            <aside className="pos-cart">
              <h2>Current order</h2>
              {cart.length === 0 ? (
                <p className="pos-cart-empty">Tap a product to start an order.</p>
              ) : (
                <>
                  <ul className="pos-cart-lines">
                    {cart.map((l) => (
                      <li key={l.product.id} className="pos-cart-line">
                        <div className="pos-cart-line-main">
                          <span className="pos-cart-line-name">{l.product.name}</span>
                          <span className="pos-cart-line-price">{formatMinor(l.product.priceMinor)}</span>
                        </div>
                        <div className="pos-cart-qty">
                          <button type="button" onClick={() => setQty(l.product.id, l.quantity - 1)} aria-label="Decrease">
                            −
                          </button>
                          <span>{l.quantity}</span>
                          <button type="button" onClick={() => setQty(l.product.id, l.quantity + 1)} aria-label="Increase">
                            +
                          </button>
                        </div>
                        <span className="pos-cart-line-total">{formatMinor(l.product.priceMinor * l.quantity)}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="pos-cart-total">
                    <span>Total</span>
                    <span>{formatMinor(cartTotal)}</span>
                  </div>

                  <fieldset className="pos-settle">
                    <legend>Settlement</legend>
                    <label>
                      <input
                        type="radio"
                        name="settlement"
                        checked={settlement === 'DIRECT'}
                        onChange={() => setSettlement('DIRECT')}
                      />
                      Direct payment
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="settlement"
                        checked={settlement === 'ROOM_CHARGE'}
                        onChange={() => setSettlement('ROOM_CHARGE')}
                      />
                      Charge to room
                    </label>

                    {settlement === 'DIRECT' ? (
                      <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
                        {PAYMENT_METHODS.map((m) => (
                          <option key={m} value={m}>
                            {PAYMENT_METHOD_LABEL[m]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        placeholder="Reservation ID"
                        value={reservationId}
                        onChange={(e) => setReservationId(e.target.value)}
                        aria-label="Reservation ID"
                      />
                    )}
                  </fieldset>

                  <button type="button" className="btn btn-primary" disabled={!canSubmit} onClick={submitOrder}>
                    {submitting ? 'Placing…' : `Place order · ${formatMinor(cartTotal)}`}
                  </button>
                  {!mayOperate && <p className="pos-cart-note">You have read-only access to point of sale.</p>}
                </>
              )}
            </aside>
          </div>
        </>
      )}

      {/* Recent orders */}
      <div className="pos-orders">
        <h2>Recent orders</h2>
        {orders.length === 0 ? (
          <p className="empty-state">No orders yet.</p>
        ) : (
          <table className="pos-orders-table">
            <thead>
              <tr>
                <th scope="col">Reference</th>
                <th scope="col">Outlet</th>
                <th scope="col">Status</th>
                <th scope="col" className="pos-num">Total</th>
                <th scope="col">Settlement</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>{o.reference}</td>
                  <td>{o.outlet.name}</td>
                  <td>
                    <Badge tone={STATUS_TONE[o.status] ?? 'neutral'}>{ORDER_STATUS_LABEL[o.status] ?? o.status}</Badge>
                  </td>
                  <td className="pos-num">{formatMinor(o.totalMinor)}</td>
                  <td>
                    {o.settlement === 'ROOM_CHARGE'
                      ? `Room ${o.reservation?.reference ?? ''}`.trim()
                      : o.settlement === 'DIRECT'
                        ? PAYMENT_METHOD_LABEL[o.paymentMethod ?? ''] ?? 'Direct'
                        : '—'}
                  </td>
                  <td className="pos-num">
                    {mayOperate && o.status === 'OPEN' && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onVoid(o)}>
                        Void
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {outletDialogOpen && propertyId && (
        <OutletDialog
          propertyId={propertyId}
          onClose={() => setOutletDialogOpen(false)}
          onSaved={async () => {
            setOutletDialogOpen(false);
            await loadOutlets();
            flash('Outlet created.');
          }}
        />
      )}

      {productDialogOpen && propertyId && activeOutletId && (
        <ProductDialog
          propertyId={propertyId}
          outletId={activeOutletId}
          product={editingProduct}
          onClose={() => setProductDialogOpen(false)}
          onSaved={async () => {
            setProductDialogOpen(false);
            await loadProducts();
            flash(editingProduct ? 'Product updated.' : 'Product added.');
          }}
        />
      )}
    </section>
  );
}
