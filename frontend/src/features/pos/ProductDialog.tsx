import { useState, type FormEvent } from 'react';

import { Modal } from '../../components/Modal';
import { ApiError } from '../../lib/api';
import { minorToRupeesInput, parseRupeesToMinor } from '../rate-plans/money';
import { createProduct, updateProduct } from './api';
import type { Product } from './types';

interface ProductDialogProps {
  propertyId: string;
  outletId: string;
  /** `null` opens the dialog in create mode. */
  product: Product | null;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Create or edit a catalogue product. Price is entered in rupees and converted
 * to integer paise at the edge (the API only ever sees paise). Stock tracking
 * is opt-in per product — services leave it off, minibar goods turn it on.
 */
export function ProductDialog({ propertyId, outletId, product, onClose, onSaved }: ProductDialogProps) {
  const editing = product !== null;
  const [name, setName] = useState(product?.name ?? '');
  const [sku, setSku] = useState(product?.sku ?? '');
  const [category, setCategory] = useState(product?.category ?? '');
  const [price, setPrice] = useState(product ? minorToRupeesInput(product.priceMinor) : '');
  const [trackStock, setTrackStock] = useState(product?.trackStock ?? false);
  const [stockQty, setStockQty] = useState(String(product?.stockQty ?? 0));
  const [isActive, setIsActive] = useState(product?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const priceMinor = parseRupeesToMinor(price);
    if (priceMinor === null) {
      setError('Enter a valid price (e.g. 250 or 250.50).');
      return;
    }
    const qty = Number(stockQty);
    if (trackStock && (!Number.isInteger(qty) || qty < 0)) {
      setError('Stock quantity must be a non-negative whole number.');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateProduct(propertyId, outletId, product.id, {
          name: name.trim(),
          sku: sku.trim() ? sku.trim() : null,
          category: category.trim() ? category.trim() : null,
          priceMinor,
          trackStock,
          stockQty: qty,
          isActive,
        });
      } else {
        await createProduct(propertyId, outletId, {
          name: name.trim(),
          ...(sku.trim() ? { sku: sku.trim() } : {}),
          ...(category.trim() ? { category: category.trim() } : {}),
          priceMinor,
          trackStock,
          ...(trackStock ? { stockQty: qty } : {}),
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the product.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={editing ? 'Edit product' : 'New product'}
      onClose={onClose}
      size="wide"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="product-form" className="btn btn-primary" disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Add product'}
          </button>
        </>
      }
    >
      <form id="product-form" onSubmit={onSubmit} className="form-grid">
        {error && (
          <p className="page-error" role="alert">
            {error}
          </p>
        )}
        <label>
          Name
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required autoFocus />
        </label>
        <div className="form-row">
          <label>
            Price (₹)
            <input type="text" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 250" required />
          </label>
          <label>
            SKU (optional)
            <input type="text" value={sku} onChange={(e) => setSku(e.target.value)} maxLength={40} />
          </label>
        </div>
        <label>
          Category (optional)
          <input type="text" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={80} />
        </label>
        <label className="form-check">
          <input type="checkbox" checked={trackStock} onChange={(e) => setTrackStock(e.target.checked)} />
          Track stock for this product
        </label>
        {trackStock && (
          <label>
            Stock quantity
            <input type="number" min={0} value={stockQty} onChange={(e) => setStockQty(e.target.value)} />
          </label>
        )}
        {editing && (
          <label className="form-check">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Active (uncheck to retire)
          </label>
        )}
      </form>
    </Modal>
  );
}
