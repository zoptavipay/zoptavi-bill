import type { Bill, StoreSettings } from '../types';
import { formatINR, gstSummaryByRate } from '../lib/gst';
import './Receipt.css';

interface ReceiptProps {
  bill: Bill;
  settings: StoreSettings;
}

export default function Receipt({ bill, settings }: ReceiptProps) {
  const summary = gstSummaryByRate(bill.lines);
  const widthClass =
    settings.thermalWidth === '58mm' ? 'receipt-58' : settings.thermalWidth === '80mm' ? 'receipt-80' : 'receipt-a4';

  return (
    <div className={`receipt ${widthClass}`} id="receipt-print-area">
      <div className="receipt-head">
        <h2>{settings.storeName}</h2>
        {settings.address && <p>{settings.address}</p>}
        {settings.phone && <p>Ph: {settings.phone}</p>}
        {settings.gstin && <p>GSTIN: {settings.gstin}</p>}
      </div>

      <div className="receipt-meta">
        <div className="receipt-row">
          <span>Bill No: {bill.billNo}</span>
          <span>{new Date(bill.createdAt).toLocaleString('en-IN')}</span>
        </div>
        {(bill.customerName || bill.customerPhone) && (
          <div className="receipt-row">
            <span>{bill.customerName || ''}</span>
            <span>{bill.customerPhone || ''}</span>
          </div>
        )}
        {bill.customerGstin && <div className="receipt-row"><span>Customer GSTIN: {bill.customerGstin}</span></div>}
      </div>

      <table className="receipt-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>HSN</th>
            <th>Qty</th>
            <th>Rate</th>
            <th>Amt</th>
          </tr>
        </thead>
        <tbody>
          {bill.lines.map((l) => (
            <tr key={l.itemId}>
              <td>{l.name}</td>
              <td>{l.hsn}</td>
              <td>{l.qty} {l.unit}</td>
              <td>{l.price.toFixed(2)}</td>
              <td>{l.lineTotal.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="receipt-gst-summary">
        <table className="receipt-table">
          <thead>
            <tr>
              <th>GST%</th>
              <th>Taxable</th>
              <th>CGST</th>
              <th>SGST</th>
            </tr>
          </thead>
          <tbody>
            {summary.map((s) => (
              <tr key={s.rate}>
                <td>{s.rate}%</td>
                <td>{s.taxable.toFixed(2)}</td>
                <td>{s.cgst.toFixed(2)}</td>
                <td>{s.sgst.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="receipt-totals">
        <div className="receipt-row"><span>Subtotal</span><span>{formatINR(bill.subtotal)}</span></div>
        <div className="receipt-row"><span>CGST</span><span>{formatINR(bill.totalCgst)}</span></div>
        <div className="receipt-row"><span>SGST</span><span>{formatINR(bill.totalSgst)}</span></div>
        <div className="receipt-row receipt-grand"><span>Grand Total</span><span>{formatINR(bill.grandTotal)}</span></div>
        <div className="receipt-row"><span>Payment</span><span>{bill.paymentMode.toUpperCase()}</span></div>
      </div>

      <div className="receipt-foot">
        <p>Thank you, visit again!</p>
      </div>
    </div>
  );
}
