import { useEffect, useState } from 'react';
import type { DashboardStats } from '../lib/stats';
import { getDashboardStats } from '../lib/stats';
import { formatINR } from '../lib/gst';
import './Dashboard.css';

interface DashboardProps {
  onClose: () => void;
}

export default function Dashboard({ onClose }: DashboardProps) {
  const [stats, setStats] = useState<DashboardStats | null>(null);

  useEffect(() => {
    getDashboardStats().then(setStats);
  }, []);

  return (
    <div className="receipt-modal">
      <div className="receipt-modal-inner dashboard-modal">
        <div className="ledger-header">
          <h2>Dashboard</h2>
          <button className="scanner-close" onClick={onClose}>×</button>
        </div>

        {!stats && <p className="empty-hint">Loading…</p>}

        {stats && (
          <div className="dashboard-body">
            <div className="stat-cards">
              <div className="stat-card">
                <span className="stat-label">Today</span>
                <span className="stat-value">{formatINR(stats.todaySales)}</span>
                <span className="stat-sub">{stats.todayBillCount} bill{stats.todayBillCount === 1 ? '' : 's'}</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Last 7 days</span>
                <span className="stat-value">{formatINR(stats.weekSales)}</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Last 30 days</span>
                <span className="stat-value">{formatINR(stats.monthSales)}</span>
              </div>
            </div>

            <h3 className="dashboard-section-title">Top items (30 days)</h3>
            {stats.topItems.length === 0 && <p className="empty-hint">No sales yet in the last 30 days.</p>}
            <div className="ledger-list">
              {stats.topItems.map((item) => (
                <div key={item.name} className="ledger-row" style={{ cursor: 'default' }}>
                  <div className="ledger-row-main">
                    <strong>{item.name}</strong>
                    <span>{item.qty} sold</span>
                  </div>
                  <div className="ledger-row-stats">
                    <span className="ledger-spend">{formatINR(item.revenue)}</span>
                  </div>
                </div>
              ))}
            </div>

            <h3 className="dashboard-section-title">Low stock</h3>
            {stats.lowStock.length === 0 && <p className="empty-hint">Nothing running low.</p>}
            <div className="ledger-list">
              {stats.lowStock.map((item) => (
                <div key={item.id} className="ledger-row" style={{ cursor: 'default' }}>
                  <div className="ledger-row-main">
                    <strong>{item.name}</strong>
                    <span>{item.unit}</span>
                  </div>
                  <div className="ledger-row-stats">
                    <span className={`stock-badge ${item.stock === 0 ? 'stock-out' : 'stock-low'}`}>
                      {item.stock === 0 ? 'Out of stock' : `${item.stock} left`}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <h3 className="dashboard-section-title">Recent bills</h3>
            {stats.recentBills.length === 0 && <p className="empty-hint">No bills yet.</p>}
            <div className="ledger-list">
              {stats.recentBills.map((bill) => (
                <div key={bill.id} className="ledger-row" style={{ cursor: 'default' }}>
                  <div className="ledger-row-main">
                    <strong>{bill.billNo}</strong>
                    <span>{new Date(bill.createdAt).toLocaleString('en-IN')}</span>
                  </div>
                  <div className="ledger-row-stats">
                    <span className="ledger-spend">{formatINR(bill.grandTotal)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="receipt-modal-actions">
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
