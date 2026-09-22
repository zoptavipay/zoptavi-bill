import { useEffect, useState } from 'react';
import { fetchOwnerOverview, fetchStores, getActiveStoreId, remoteStoreToSettings, setActiveStoreId, type OwnerOverviewStore } from '../lib/auth';
import { saveSettings } from '../lib/db';
import { formatINR } from '../lib/gst';
import './OwnerOverview.css';

interface OwnerOverviewProps {
  onClose: () => void;
}

/** Owner-only, cross-store dashboard: reads live from the cloud (not the per-device cache) so
 * it reflects every store the owner has, from any device, regardless of which single store
 * this particular device happens to be billing from right now. */
export default function OwnerOverview({ onClose }: OwnerOverviewProps) {
  const [stores, setStores] = useState<OwnerOverviewStore[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const activeStoreId = getActiveStoreId();

  useEffect(() => {
    fetchOwnerOverview()
      .then(setStores)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load your stores.'));
  }, []);

  async function switchToStore(storeId: string) {
    setSwitching(storeId);
    try {
      const remoteStores = await fetchStores();
      const target = remoteStores.find((s) => s.id === storeId);
      if (!target) throw new Error('Store not found.');
      setActiveStoreId(target.id);
      await saveSettings(remoteStoreToSettings(target));
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not switch stores.');
      setSwitching(null);
    }
  }

  const totals = stores?.reduce(
    (acc, s) => ({
      todaySales: acc.todaySales + s.todaySales,
      lowStockCount: acc.lowStockCount + s.lowStockCount,
      stockValue: acc.stockValue + s.stockValue,
    }),
    { todaySales: 0, lowStockCount: 0, stockValue: 0 },
  );

  return (
    <div className="receipt-modal">
      <div className="receipt-modal-inner owner-overview-modal">
        <div className="ledger-header">
          <h2>All Stores</h2>
          <button className="scanner-close" onClick={onClose}>×</button>
        </div>

        {!stores && !error && <p className="empty-hint">Loading…</p>}
        {error && <p className="empty-hint" style={{ color: 'var(--color-danger)' }}>{error}</p>}

        {stores && stores.length === 0 && (
          <p className="empty-hint">You don't have any other stores yet — add one from the store picker.</p>
        )}

        {stores && stores.length > 0 && totals && (
          <>
            <div className="stat-cards">
              <div className="stat-card">
                <span className="stat-label">Stores</span>
                <span className="stat-value">{stores.length}</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Today, all stores</span>
                <span className="stat-value">{formatINR(totals.todaySales)}</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Low stock, all stores</span>
                <span className="stat-value">{totals.lowStockCount}</span>
              </div>
            </div>

            <div className="ledger-list">
              {stores.map((s) => (
                <div key={s.storeId} className="owner-store-card">
                  <div className="owner-store-card-head">
                    <strong>{s.storeName}</strong>
                    {s.storeId === activeStoreId && <span className="owner-store-active-badge">This device</span>}
                  </div>
                  <div className="owner-store-card-stats">
                    <div><span>Today</span><strong>{formatINR(s.todaySales)}</strong></div>
                    <div><span>Last 7 days</span><strong>{formatINR(s.weekSales)}</strong></div>
                    <div><span>Items</span><strong>{s.itemCount}</strong></div>
                    <div>
                      <span>Low stock</span>
                      <strong className={s.lowStockCount > 0 ? 'stock-low' : ''}>{s.lowStockCount}</strong>
                    </div>
                  </div>
                  {s.storeId !== activeStoreId && (
                    <button
                      className="btn-ghost owner-store-switch-btn"
                      disabled={switching === s.storeId}
                      onClick={() => switchToStore(s.storeId)}
                    >
                      {switching === s.storeId ? 'Switching…' : 'Bill from this store on this device'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        <div className="receipt-modal-actions">
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
