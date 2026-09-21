import { useState } from 'react';
import type { StoreSettings, SupplyOrderLine } from '../types';
import './BillingScreen.css';

interface SuppliesOrderProps {
  settings: StoreSettings;
  onClose: () => void;
}

const CATALOGUE = [
  { key: 'paper80', label: '80mm thermal paper roll' },
  { key: 'paper58', label: '58mm thermal paper roll' },
  { key: 'labels', label: 'Barcode labels (roll of 500)' },
];

export default function SuppliesOrder({ settings, onClose }: SuppliesOrderProps) {
  const [qty, setQty] = useState<Record<string, number>>({});

  const lines: SupplyOrderLine[] = CATALOGUE
    .map((c) => ({ label: c.label, qty: qty[c.key] ?? 0 }))
    .filter((l) => l.qty > 0);

  function setItemQty(key: string, value: number) {
    setQty((prev) => ({ ...prev, [key]: Math.max(0, value) }));
  }

  function sendOrder() {
    const summary = lines.map((l) => `${l.qty} × ${l.label}`).join('\n');
    const text = encodeURIComponent(
      `New supply order request\nStore: ${settings.storeName}${settings.phone ? ` (${settings.phone})` : ''}\n\n${summary}\n\n— sent from Zoptavi Tab`,
    );
    const phone = settings.supplyContactPhone?.replace(/\D/g, '');
    const waUrl = phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`;
    window.open(waUrl, '_blank');
  }

  return (
    <div className="receipt-modal">
      <div className="receipt-modal-inner ledger-modal">
        <div className="ledger-header">
          <h2>Order supplies</h2>
          <button className="scanner-close" onClick={onClose}>×</button>
        </div>

        <p className="empty-hint" style={{ padding: 0, marginBottom: 10 }}>
          Pick what you need and send the request over WhatsApp — pricing is confirmed when the order
          is placed, since it depends on your delivery location and current supplier rates.
        </p>

        <div className="ledger-list">
          {CATALOGUE.map((c) => (
            <div key={c.key} className="ledger-row" style={{ cursor: 'default' }}>
              <div className="ledger-row-main">
                <strong>{c.label}</strong>
              </div>
              <div className="cart-line-qty">
                <button onClick={() => setItemQty(c.key, (qty[c.key] ?? 0) - 1)}>−</button>
                <input
                  type="number"
                  min={0}
                  value={qty[c.key] ?? 0}
                  onChange={(e) => setItemQty(c.key, Number(e.target.value))}
                />
                <button onClick={() => setItemQty(c.key, (qty[c.key] ?? 0) + 1)}>+</button>
              </div>
            </div>
          ))}
        </div>

        {!settings.supplyContactPhone && (
          <p className="empty-hint" style={{ padding: '10px 0 0' }}>
            No supply contact number is set yet in Settings — this will open WhatsApp without a specific
            recipient until one is added.
          </p>
        )}

        <div className="receipt-modal-actions">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-solid" disabled={lines.length === 0} onClick={sendOrder}>
            Send order via WhatsApp
          </button>
        </div>
      </div>
    </div>
  );
}
