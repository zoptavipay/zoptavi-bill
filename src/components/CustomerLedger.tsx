import { useEffect, useMemo, useState } from 'react';
import type { CustomerSummary } from '../lib/customers';
import { getCustomerSummaries } from '../lib/customers';
import { formatINR } from '../lib/gst';
import './CustomerLedger.css';

interface CustomerLedgerProps {
  onClose: () => void;
}

export default function CustomerLedger({ onClose }: CustomerLedgerProps) {
  const [customers, setCustomers] = useState<CustomerSummary[] | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<CustomerSummary | null>(null);

  useEffect(() => {
    getCustomerSummaries().then(setCustomers);
  }, []);

  const filtered = useMemo(() => {
    if (!customers) return [];
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) => c.phone.includes(q) || (c.name ?? '').toLowerCase().includes(q),
    );
  }, [customers, search]);

  return (
    <div className="receipt-modal">
      <div className="receipt-modal-inner ledger-modal">
        <div className="ledger-header">
          <h2>{selected ? selected.name || selected.phone : 'Customers'}</h2>
          <button className="scanner-close" onClick={selected ? () => setSelected(null) : onClose}>
            {selected ? '←' : '×'}
          </button>
        </div>

        {!selected && (
          <>
            <input
              className="billing-search"
              placeholder="Search by name or phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ marginBottom: 10 }}
            />
            {customers === null && <p className="empty-hint">Loading…</p>}
            {customers !== null && filtered.length === 0 && (
              <p className="empty-hint">
                No customers yet — a customer shows up here automatically once you capture their
                phone number on a bill.
              </p>
            )}
            <div className="ledger-list">
              {filtered.map((c) => (
                <button key={c.phone} className="ledger-row" onClick={() => setSelected(c)}>
                  <div className="ledger-row-main">
                    <strong>{c.name || 'Unnamed customer'}</strong>
                    <span>{c.phone}</span>
                  </div>
                  <div className="ledger-row-stats">
                    <span>{c.billCount} bill{c.billCount === 1 ? '' : 's'}</span>
                    <span className="ledger-spend">{formatINR(c.totalSpend)}</span>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {selected && (
          <div className="ledger-list">
            <div className="ledger-detail-summary">
              <div><span>Total spend</span><strong>{formatINR(selected.totalSpend)}</strong></div>
              <div><span>Bills</span><strong>{selected.billCount}</strong></div>
              <div><span>Last purchase</span><strong>{new Date(selected.lastPurchase).toLocaleDateString('en-IN')}</strong></div>
            </div>
            {selected.bills.map((bill) => (
              <div key={bill.id} className="ledger-row" style={{ cursor: 'default' }}>
                <div className="ledger-row-main">
                  <strong>{bill.billNo}</strong>
                  <span>{new Date(bill.createdAt).toLocaleString('en-IN')} · {bill.lines.length} item{bill.lines.length === 1 ? '' : 's'}</span>
                </div>
                <div className="ledger-row-stats">
                  <span className="ledger-spend">{formatINR(bill.grandTotal)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="receipt-modal-actions">
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
