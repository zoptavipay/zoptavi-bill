import { useEffect, useMemo, useRef, useState } from 'react';
import type { Bill, BillLine, Item, StoreSettings } from '../types';
import { makeBillLine, totalsForLines, formatINR, exclusiveFromMrp, round2, resolveDiscountAmount } from '../lib/gst';
import { getItems, updateItemStock, nextBillNumber, saveBill, getSettings, saveSettings, addItem, updateItem } from '../lib/db';
import { syncNow } from '../lib/sync';
import { buildBillPdf, billPdfFileName } from '../lib/pdf';
import { lookupBarcodeOnline } from '../lib/barcodeLookup';
import { LOW_STOCK_THRESHOLD } from '../lib/stats';
import { getOwner, getRole, getActiveStoreId, fetchStores, updateStore, updateStorePin, signOut } from '../lib/auth';
import Receipt from './Receipt';
import BarcodeScanner from './BarcodeScanner';
import CustomerLedger from './CustomerLedger';
import Dashboard from './Dashboard';
import OwnerOverview from './OwnerOverview';
import BusinessSetup from './BusinessSetup';
import SuppliesOrder from './SuppliesOrder';
import './BillingScreen.css';

export default function BillingScreen() {
  const [items, setItems] = useState<Item[]>([]);
  const [cart, setCart] = useState<BillLine[]>([]);
  const [search, setSearch] = useState('');
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [paymentMode, setPaymentMode] = useState<Bill['paymentMode']>('cash');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerGstin, setCustomerGstin] = useState('');
  const [discountType, setDiscountType] = useState<'flat' | 'percent'>('flat');
  const [discountValue, setDiscountValue] = useState('');
  const [lastBill, setLastBill] = useState<Bill | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [newItemBarcode, setNewItemBarcode] = useState<string | null>(null);
  const [showAddItem, setShowAddItem] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [showLedger, setShowLedger] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showSupplies, setShowSupplies] = useState(false);
  const [showOwnerOverview, setShowOwnerOverview] = useState(false);
  const role = getRole();
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [lowStockDismissed, setLowStockDismissed] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getItems().then(setItems);
    getSettings().then(setSettings);
  }, []);

  const categories = useMemo(() => {
    const set = new Set(items.map((i) => i.category).filter((c): c is string => !!c));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      const matchesSearch =
        !q || i.name.toLowerCase().includes(q) || i.hsn.includes(q) || (i.barcode ?? '').includes(q);
      const matchesCategory = categoryFilter === 'all' || i.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [items, search, categoryFilter]);

  const totals = useMemo(() => totalsForLines(cart), [cart]);
  const discountAmount = useMemo(
    () => resolveDiscountAmount(totals.grandTotal, discountType, Number(discountValue) || 0),
    [totals.grandTotal, discountType, discountValue],
  );
  const payableTotal = round2(totals.grandTotal - discountAmount);

  const lowStockItems = useMemo(() => items.filter((i) => i.stock <= LOW_STOCK_THRESHOLD), [items]);

  function addToCart(item: Item) {
    if (item.stock <= 0) return;
    setCart((prev) => {
      const existing = prev.find((l) => l.itemId === item.id);
      const currentQty = existing ? existing.qty : 0;
      if (currentQty + 1 > item.stock) return prev;
      const newLine = makeBillLine(item, currentQty + 1);
      if (existing) {
        return prev.map((l) => (l.itemId === item.id ? newLine : l));
      }
      return [...prev, newLine];
    });
  }

  function changeQty(itemId: string, qty: number) {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    if (qty <= 0) {
      setCart((prev) => prev.filter((l) => l.itemId !== itemId));
      return;
    }
    if (qty > item.stock) qty = item.stock;
    setCart((prev) =>
      prev.map((l) => {
        if (l.itemId !== itemId) return l;
        // Keep any per-line GST override the user already set instead of resetting to
        // the item's master rate when qty changes.
        const override = l.gstRate !== item.gstRate ? l.gstRate : undefined;
        return makeBillLine(item, qty, override);
      }),
    );
  }

  function changeLineGstRate(itemId: string, gstRate: number) {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    setCart((prev) =>
      prev.map((l) => (l.itemId === itemId ? makeBillLine(item, l.qty, gstRate) : l)),
    );
  }

  function tryAddByBarcode(code: string) {
    const trimmed = code.trim();
    if (!trimmed) return false;
    const match = items.find((i) => i.barcode === trimmed);
    if (match) {
      addToCart(match);
      setSearch('');
      return true;
    }
    return false;
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      // Covers USB/Bluetooth scanners, which "type" the code then send Enter.
      // A barcode-shaped entry (8+ digits) that matches nothing is offered as a new item,
      // rather than silently doing nothing — that's the actual first-run experience most
      // shops will hit, since a fresh install only has 6 demo items in it.
      const trimmed = search.trim();
      if (!tryAddByBarcode(trimmed) && /^\d{8,}$/.test(trimmed)) {
        setNewItemBarcode(trimmed);
      }
    }
  }

  function handleScanned(code: string) {
    setShowScanner(false);
    if (!tryAddByBarcode(code)) {
      setNewItemBarcode(code);
    }
  }

  async function handleNewItemSave(item: Item) {
    const cameFromScan = newItemBarcode !== null;
    await addItem(item);
    const refreshed = await getItems();
    setItems(refreshed);
    setNewItemBarcode(null);
    setShowAddItem(false);
    setSearch('');
    // Only auto-add to the cart when this came from mid-billing barcode scan/entry — a
    // deliberate "+ Add item" from inventory management shouldn't silently start a sale.
    if (cameFromScan) addToCart(item);
  }

  async function handleEditItemSave(item: Item) {
    await updateItem(item);
    const refreshed = await getItems();
    setItems(refreshed);
    // If this item is already in the cart, refresh its line to reflect the new
    // price/GST/HSN too (keeping the same quantity).
    setCart((prev) =>
      prev.map((l) => (l.itemId === item.id ? makeBillLine(item, l.qty) : l)),
    );
    setEditingItem(null);
  }

  function removeLine(itemId: string) {
    setCart((prev) => prev.filter((l) => l.itemId !== itemId));
  }

  function clearCart() {
    setCart([]);
    setCustomerName('');
    setCustomerPhone('');
    setCustomerGstin('');
    setPaymentMode('cash');
    setDiscountType('flat');
    setDiscountValue('');
    setMobileCartOpen(false);
  }

  async function completeBill() {
    if (cart.length === 0 || !settings) return;
    const billNo = await nextBillNumber();
    const { subtotal, totalCgst, totalSgst, grandTotal: preDiscountTotal } = totalsForLines(cart);
    const discountAmt = resolveDiscountAmount(preDiscountTotal, discountType, Number(discountValue) || 0);
    const bill: Bill = {
      id: crypto.randomUUID(),
      billNo,
      createdAt: new Date().toISOString(),
      lines: cart,
      subtotal,
      totalCgst,
      totalSgst,
      discountType: discountAmt > 0 ? discountType : undefined,
      discountValue: discountAmt > 0 ? Number(discountValue) || 0 : undefined,
      discountAmount: discountAmt,
      grandTotal: round2(preDiscountTotal - discountAmt),
      paymentMode,
      customerName: customerName || undefined,
      customerPhone: customerPhone || undefined,
      customerGstin: customerGstin || undefined,
      synced: false,
    };
    await saveBill(bill);
    for (const line of cart) {
      await updateItemStock(line.itemId, -line.qty);
    }
    const refreshed = await getItems();
    setItems(refreshed);
    setLastBill(bill);
    clearCart();
    // Fire-and-forget: don't block the billing UI on network sync. syncNow() never throws.
    void syncNow();
  }

  function printReceipt() {
    window.print();
  }

  async function downloadPdf() {
    if (!lastBill || !settings) return;
    const blob = buildBillPdf(lastBill, settings);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = billPdfFileName(lastBill);
    a.click();
    URL.revokeObjectURL(url);
  }

  async function shareBill() {
    if (!lastBill || !settings) return;
    const blob = buildBillPdf(lastBill, settings);
    const fileName = billPdfFileName(lastBill);
    const file = new File([blob], fileName, { type: 'application/pdf' });

    // Web Share API with files works on most Android/mobile browsers and can hand the PDF
    // straight to WhatsApp (or any installed app) via the native share sheet.
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: `Invoice ${lastBill.billNo}`,
          text: `Invoice ${lastBill.billNo} from ${settings.storeName} — ${formatINR(lastBill.grandTotal)}`,
        });
        return;
      } catch {
        // user cancelled the share sheet — fall through to the WhatsApp link fallback below
      }
    }

    // Fallback: no file-sharing support (e.g. desktop browsers) — open WhatsApp with a text
    // summary, and also trigger a PDF download so the user can attach it manually.
    const phone = lastBill.customerPhone?.replace(/\D/g, '');
    const text = encodeURIComponent(
      `Invoice ${lastBill.billNo} from ${settings.storeName}\nTotal: ${formatINR(lastBill.grandTotal)}\nThank you for your purchase!`,
    );
    const waUrl = phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`;
    window.open(waUrl, '_blank');
    downloadPdf();
  }

  async function saveSettingsForm(next: StoreSettings) {
    await saveSettings(next);
    setSettings(next);
    setShowSettings(false);
    // Best-effort push to the server too, so a rename/address change here is reflected the
    // next time this store is picked from a different device, in the worker sign-in
    // response, or in the owner's cross-store overview — never blocks the local save.
    const storeId = getActiveStoreId();
    if (storeId) {
      updateStore(storeId, next).catch(() => {
        // offline or request failed — local billing keeps working regardless
      });
    }
  }

  if (!settings) return <div className="billing-loading">Loading…</div>;

  if (!settings.onboarded) {
    return (
      <BusinessSetup
        initial={settings}
        onDone={async (next) => {
          await saveSettings(next);
          setSettings(next);
        }}
      />
    );
  }

  return (
    <div className="billing-screen">
      <header className="billing-header">
        <h1>{settings.storeName}</h1>
        <nav className="billing-nav">
          <button className="btn-ghost nav-btn" onClick={() => setShowDashboard(true)}>
            <span className="nav-btn-icon">📊</span> Dashboard
            {lowStockItems.length > 0 && <span className="nav-badge">{lowStockItems.length}</span>}
          </button>
          <button className="btn-ghost nav-btn" onClick={() => setShowLedger(true)}>
            <span className="nav-btn-icon">👥</span> Customers
          </button>
          <button className="btn-ghost nav-btn" onClick={() => setShowSupplies(true)}>
            <span className="nav-btn-icon">📦</span> Supplies
          </button>
          {role === 'owner' && (
            <button className="btn-ghost nav-btn" onClick={() => setShowOwnerOverview(true)}>
              <span className="nav-btn-icon">🏬</span> All Stores
            </button>
          )}
          {role === 'owner' && (
            <button className="btn-ghost nav-btn" onClick={() => setShowSettings(true)}>
              <span className="nav-btn-icon">⚙️</span> Settings
            </button>
          )}
          <button
            className="btn-ghost nav-btn"
            onClick={async () => {
              if (!confirm('Sign out of this device? Locally cached data will be cleared.')) return;
              await signOut();
              window.location.reload();
            }}
          >
            <span className="nav-btn-icon">⎋</span> Sign out
          </button>
        </nav>
      </header>

      {lowStockItems.length > 0 && !lowStockDismissed && (
        <div className="low-stock-banner">
          <span className="low-stock-banner-text">
            ⚠ <strong>{lowStockItems.length}</strong> item{lowStockItems.length === 1 ? '' : 's'} low or out of stock —{' '}
            {lowStockItems.slice(0, 4).map((i) => i.name).join(', ')}
            {lowStockItems.length > 4 ? `, +${lowStockItems.length - 4} more` : ''}
          </span>
          <div className="low-stock-banner-actions">
            <button className="low-stock-view-btn" onClick={() => setShowDashboard(true)}>View</button>
            <button className="low-stock-dismiss-btn" onClick={() => setLowStockDismissed(true)} title="Dismiss">×</button>
          </div>
        </div>
      )}

      <div className="billing-main">
        <div className="billing-items-pane">
          <div className="search-row">
            <input
              className="billing-search"
              placeholder="Search items, HSN, or scan a barcode…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleSearchKeyDown}
            />
          </div>
          <div className="action-row">
            <button className="btn-add-item" onClick={() => setShowAddItem(true)}>
              + Add item
            </button>
            <button className="btn-scan" onClick={() => setShowScanner(true)} title="Scan with camera">
              📷 <span className="btn-scan-label">Scan</span>
            </button>
          </div>
          {categories.length > 0 && (
            <div className="category-chips">
              <button
                className={categoryFilter === 'all' ? 'active' : ''}
                onClick={() => setCategoryFilter('all')}
              >
                All
              </button>
              {categories.map((c) => (
                <button
                  key={c}
                  className={categoryFilter === c ? 'active' : ''}
                  onClick={() => setCategoryFilter(c)}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
          <div className="item-grid">
            {filtered.map((item) => {
              const isLow = item.stock > 0 && item.stock <= LOW_STOCK_THRESHOLD;
              return (
                <div key={item.id} className="item-card-wrap">
                  <button
                    className="item-card"
                    onClick={() => addToCart(item)}
                    disabled={item.stock <= 0}
                  >
                    <span className="item-name">{item.name}</span>
                    {item.category && <span className="item-category">{item.category}</span>}
                    <span className="item-price">
                      {formatINR(item.mrpInclusive ? (item.mrp ?? item.price) : item.price)} · {item.gstRate}% GST
                      {item.mrpInclusive && <span className="mrp-badge"> incl.</span>}
                    </span>
                    <span className={`item-stock ${isLow ? 'item-stock-low' : ''} ${item.stock <= 0 ? 'item-stock-out' : ''}`}>
                      {item.stock > 0 ? `${item.stock} ${item.unit} left` : 'Out of stock'}
                    </span>
                  </button>
                  <button
                    className="item-edit-btn"
                    title="Edit item (price, GST, HSN…)"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingItem(item);
                    }}
                  >
                    ✎
                  </button>
                </div>
              );
            })}
            {filtered.length === 0 && <p className="empty-hint">No items match{categoryFilter !== 'all' ? ' in this category' : ''}.</p>}
          </div>
        </div>

        <div className={`billing-cart-pane ${mobileCartOpen ? 'mobile-open' : ''}`}>
          <div className="cart-pane-header">
            <button className="mobile-cart-back" onClick={() => setMobileCartOpen(false)} aria-label="Back to items">‹</button>
            <h2>Bill{cart.length > 0 ? ` (${cart.length})` : ''}</h2>
          </div>
          <div className="cart-lines">
            {cart.length === 0 && <p className="empty-hint">Tap items to add them here.</p>}
            {cart.map((line) => (
              <div className="cart-line" key={line.itemId}>
                <div className="cart-line-name">
                  <strong>{line.name}</strong>
                  <span className="cart-line-gst">
                    HSN {line.hsn} ·{' '}
                    <select
                      value={line.gstRate}
                      onChange={(e) => changeLineGstRate(line.itemId, Number(e.target.value))}
                      title="Override GST rate for this line only"
                    >
                      <option value="0">0%</option>
                      <option value="2.5">2.5%</option>
                      <option value="5">5%</option>
                      <option value="12">12%</option>
                      <option value="18">18%</option>
                      <option value="28">28%</option>
                    </select>{' '}
                    GST
                  </span>
                </div>
                <div className="cart-line-qty">
                  <button onClick={() => changeQty(line.itemId, line.qty - 1)}>−</button>
                  <input
                    type="number"
                    value={line.qty}
                    min={0}
                    onChange={(e) => changeQty(line.itemId, Number(e.target.value))}
                  />
                  <button onClick={() => changeQty(line.itemId, line.qty + 1)}>+</button>
                </div>
                <div className="cart-line-amt">{formatINR(line.lineGrandTotal)}</div>
                <button className="cart-line-remove" onClick={() => removeLine(line.itemId)}>×</button>
              </div>
            ))}
          </div>

          <div className="customer-fields">
            <input placeholder="Customer name (optional)" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
            <input placeholder="Phone (optional)" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
            <input placeholder="Customer GSTIN (optional)" value={customerGstin} onChange={(e) => setCustomerGstin(e.target.value)} />
          </div>

          <div className="payment-modes">
            {(['cash', 'upi', 'card', 'credit'] as const).map((m) => (
              <button
                key={m}
                className={`payment-mode-btn ${paymentMode === m ? 'active' : ''}`}
                onClick={() => setPaymentMode(m)}
              >
                {m.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="discount-row">
            <span className="discount-label">Discount</span>
            <div className="discount-toggle">
              <button type="button" className={discountType === 'flat' ? 'active' : ''} onClick={() => setDiscountType('flat')}>₹</button>
              <button type="button" className={discountType === 'percent' ? 'active' : ''} onClick={() => setDiscountType('percent')}>%</button>
            </div>
            <input
              type="number"
              min={0}
              inputMode="decimal"
              placeholder="0"
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
            />
          </div>

          <div className="cart-totals">
            <div className="cart-row"><span>Subtotal</span><span>{formatINR(totals.subtotal)}</span></div>
            <div className="cart-row"><span>CGST</span><span>{formatINR(totals.totalCgst)}</span></div>
            <div className="cart-row"><span>SGST</span><span>{formatINR(totals.totalSgst)}</span></div>
            {discountAmount > 0 && (
              <div className="cart-row cart-row-discount"><span>Discount</span><span>−{formatINR(discountAmount)}</span></div>
            )}
            <div className="cart-row cart-grand"><span>Total</span><span>{formatINR(payableTotal)}</span></div>
          </div>

          <div className="cart-actions">
            <button className="btn-ghost" onClick={clearCart} disabled={cart.length === 0}>Clear</button>
            <button className="btn-solid" onClick={completeBill} disabled={cart.length === 0}>Complete Bill</button>
          </div>
        </div>
      </div>

      {cart.length > 0 && !mobileCartOpen && (
        <button className="mobile-cart-bar" onClick={() => setMobileCartOpen(true)}>
          <span>🛒 {cart.length} item{cart.length === 1 ? '' : 's'}</span>
          <span className="mobile-cart-bar-total">{formatINR(payableTotal)}</span>
          <span className="mobile-cart-bar-cta">View Bill ›</span>
        </button>
      )}

      {lastBill && (
        <div className="receipt-modal">
          <div className="receipt-modal-inner">
            <div ref={printRef}>
              <Receipt bill={lastBill} settings={settings} />
            </div>
            <div className="receipt-modal-actions">
              <button className="btn-ghost" onClick={() => setLastBill(null)}>Close</button>
              <button className="btn-ghost" onClick={downloadPdf}>Download PDF</button>
              <button className="btn-ghost" onClick={shareBill}>Share / WhatsApp</button>
              <button className="btn-solid" onClick={printReceipt}>Print</button>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <SettingsModal settings={settings} onCancel={() => setShowSettings(false)} onSave={saveSettingsForm} />
      )}

      {showScanner && (
        <BarcodeScanner onDetected={handleScanned} onClose={() => setShowScanner(false)} />
      )}

      {(newItemBarcode !== null || showAddItem) && (
        <NewItemModal
          barcode={newItemBarcode ?? undefined}
          existingCategories={categories}
          onCancel={() => {
            setNewItemBarcode(null);
            setShowAddItem(false);
          }}
          onSave={handleNewItemSave}
        />
      )}

      {editingItem && (
        <EditItemModal
          item={editingItem}
          existingCategories={categories}
          onCancel={() => setEditingItem(null)}
          onSave={handleEditItemSave}
        />
      )}

      {showLedger && <CustomerLedger onClose={() => setShowLedger(false)} />}

      {showDashboard && <Dashboard onClose={() => setShowDashboard(false)} />}

      {showSupplies && <SuppliesOrder settings={settings} onClose={() => setShowSupplies(false)} />}

      {showOwnerOverview && <OwnerOverview onClose={() => setShowOwnerOverview(false)} />}
    </div>
  );
}

function NewItemModal({
  barcode,
  existingCategories,
  onSave,
  onCancel,
}: {
  barcode?: string;
  existingCategories: string[];
  onSave: (item: Item) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [priceMode, setPriceMode] = useState<'mrp' | 'exclusive'>('mrp');
  const [price, setPrice] = useState('');
  const [gstRate, setGstRate] = useState('5');
  const [hsn, setHsn] = useState('');
  const [unit, setUnit] = useState('pc');
  const [stock, setStock] = useState('10');
  const [manualBarcode, setManualBarcode] = useState('');
  const [lookupState, setLookupState] = useState<'looking' | 'found' | 'not-found'>('looking');

  useEffect(() => {
    if (!barcode) return; // manually added item — nothing to look up
    let cancelled = false;
    setLookupState('looking');
    lookupBarcodeOnline(barcode).then((result) => {
      if (cancelled) return;
      if (result) {
        setName(result.name);
        setLookupState('found');
      } else {
        setLookupState('not-found');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [barcode]);

  const canSave = name.trim().length > 0 && Number(price) > 0;
  const exclusivePreview = priceMode === 'mrp' && Number(price) > 0 ? exclusiveFromMrp(Number(price), Number(gstRate)) : null;

  function save() {
    if (!canSave) return;
    const entered = Number(price);
    const mrpInclusive = priceMode === 'mrp';
    const owner = getOwner();
    onSave({
      id: crypto.randomUUID(),
      name: name.trim(),
      category: category.trim() || undefined,
      hsn: hsn.trim() || '0000',
      price: mrpInclusive ? exclusiveFromMrp(entered, Number(gstRate)) : entered,
      gstRate: Number(gstRate),
      unit: unit.trim() || 'pc',
      stock: Number(stock) || 0,
      barcode: barcode ?? (manualBarcode.trim() || undefined),
      mrpInclusive,
      mrp: mrpInclusive ? entered : undefined,
      addedBy: owner?.name || owner?.email || undefined,
    });
  }

  return (
    <div className="receipt-modal">
      <div className="receipt-modal-inner settings-form">
        <h2>New item</h2>
        {barcode && (
          <p className="empty-hint" style={{ padding: 0, marginBottom: 4 }}>
            {lookupState === 'looking' && <>Looking up barcode <strong>{barcode}</strong> online…</>}
            {lookupState === 'found' && <>Found a name from an online product database — check it's right, then fill in price and GST.</>}
            {lookupState === 'not-found' && <>No item matches barcode <strong>{barcode}</strong> yet, and it wasn't in the public product database either — add it once and it's scannable from now on.</>}
          </p>
        )}
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
        <label>
          Category
          <input
            list="item-category-options"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="e.g. Grocery, Stationery…"
          />
          <datalist id="item-category-options">
            {existingCategories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <div className="price-mode-toggle">
          <button type="button" className={priceMode === 'mrp' ? 'active' : ''} onClick={() => setPriceMode('mrp')}>MRP (GST included)</button>
          <button type="button" className={priceMode === 'exclusive' ? 'active' : ''} onClick={() => setPriceMode('exclusive')}>Price before GST</button>
        </div>
        <label>
          {priceMode === 'mrp' ? 'MRP — price printed on the pack (₹)' : 'Price before GST (₹)'}
          <input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        <label>
          GST rate
          <select value={gstRate} onChange={(e) => setGstRate(e.target.value)}>
            <option value="0">0%</option>
            <option value="2.5">2.5%</option>
            <option value="5">5%</option>
            <option value="12">12%</option>
            <option value="18">18%</option>
            <option value="28">28%</option>
          </select>
        </label>
        {exclusivePreview !== null && (
          <p className="empty-hint" style={{ padding: 0, margin: '-4px 0 2px', fontSize: 11.5 }}>
            = {formatINR(exclusivePreview)} + {formatINR(round2(Number(price) - exclusivePreview))} GST ({gstRate}%) — customer is charged {formatINR(Number(price))}, not more.
          </p>
        )}
        <label>HSN code (optional)<input value={hsn} onChange={(e) => setHsn(e.target.value)} /></label>
        <label>Unit<input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="pc, kg, ltr…" /></label>
        <label>Opening stock<input type="number" min={0} value={stock} onChange={(e) => setStock(e.target.value)} /></label>
        {!barcode && (
          <label>Barcode (optional)<input value={manualBarcode} onChange={(e) => setManualBarcode(e.target.value)} placeholder="Scan or type one in later too" /></label>
        )}
        <div className="receipt-modal-actions">
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn-solid" onClick={save} disabled={!canSave}>{barcode ? 'Add & bill it' : 'Add item'}</button>
        </div>
      </div>
    </div>
  );
}

function EditItemModal({
  item,
  existingCategories,
  onSave,
  onCancel,
}: {
  item: Item;
  existingCategories: string[];
  onSave: (item: Item) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(item.name);
  const [category, setCategory] = useState(item.category ?? '');
  const [priceMode, setPriceMode] = useState<'mrp' | 'exclusive'>(item.mrpInclusive === false ? 'exclusive' : 'mrp');
  const [price, setPrice] = useState(String(item.mrpInclusive ? (item.mrp ?? item.price) : item.price));
  const [gstRate, setGstRate] = useState(String(item.gstRate));
  const [hsn, setHsn] = useState(item.hsn);
  const [unit, setUnit] = useState(item.unit);
  const [stock, setStock] = useState(String(item.stock));
  const [barcode, setBarcode] = useState(item.barcode ?? '');

  const canSave = name.trim().length > 0 && Number(price) > 0;
  const exclusivePreview = priceMode === 'mrp' && Number(price) > 0 ? exclusiveFromMrp(Number(price), Number(gstRate)) : null;

  function save() {
    if (!canSave) return;
    const entered = Number(price);
    const mrpInclusive = priceMode === 'mrp';
    onSave({
      ...item,
      name: name.trim(),
      category: category.trim() || undefined,
      hsn: hsn.trim() || '0000',
      price: mrpInclusive ? exclusiveFromMrp(entered, Number(gstRate)) : entered,
      gstRate: Number(gstRate),
      unit: unit.trim() || 'pc',
      stock: Number(stock) || 0,
      barcode: barcode.trim() || undefined,
      mrpInclusive,
      mrp: mrpInclusive ? entered : undefined,
    });
  }

  return (
    <div className="receipt-modal">
      <div className="receipt-modal-inner settings-form">
        <h2>Edit item</h2>
        <p className="empty-hint" style={{ padding: 0, marginBottom: 4 }}>
          Fixes here (price, GST rate, HSN…) apply permanently to this item, not just the current bill.
          {item.addedBy && <> Added by <strong>{item.addedBy}</strong>.</>}
        </p>
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
        <label>
          Category
          <input
            list="item-category-options-edit"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="e.g. Grocery, Stationery…"
          />
          <datalist id="item-category-options-edit">
            {existingCategories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <div className="price-mode-toggle">
          <button type="button" className={priceMode === 'mrp' ? 'active' : ''} onClick={() => setPriceMode('mrp')}>MRP (GST included)</button>
          <button type="button" className={priceMode === 'exclusive' ? 'active' : ''} onClick={() => setPriceMode('exclusive')}>Price before GST</button>
        </div>
        <label>
          {priceMode === 'mrp' ? 'MRP — price printed on the pack (₹)' : 'Price before GST (₹)'}
          <input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        <label>
          GST rate
          <select value={gstRate} onChange={(e) => setGstRate(e.target.value)}>
            <option value="0">0%</option>
            <option value="2.5">2.5%</option>
            <option value="5">5%</option>
            <option value="12">12%</option>
            <option value="18">18%</option>
            <option value="28">28%</option>
          </select>
        </label>
        {exclusivePreview !== null && (
          <p className="empty-hint" style={{ padding: 0, margin: '-4px 0 2px', fontSize: 11.5 }}>
            = {formatINR(exclusivePreview)} + {formatINR(round2(Number(price) - exclusivePreview))} GST ({gstRate}%) — customer is charged {formatINR(Number(price))}, not more.
          </p>
        )}
        <label>HSN code<input value={hsn} onChange={(e) => setHsn(e.target.value)} /></label>
        <label>Unit<input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="pc, kg, ltr…" /></label>
        <label>Stock<input type="number" min={0} value={stock} onChange={(e) => setStock(e.target.value)} /></label>
        <label>Barcode (optional)<input value={barcode} onChange={(e) => setBarcode(e.target.value)} /></label>
        <div className="receipt-modal-actions">
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn-solid" onClick={save} disabled={!canSave}>Save changes</button>
        </div>
      </div>
    </div>
  );
}

function SettingsModal({
  settings,
  onSave,
  onCancel,
}: {
  settings: StoreSettings;
  onSave: (s: StoreSettings) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<StoreSettings>(settings);
  const [pin, setPin] = useState('');
  const [pinStatus, setPinStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [pinError, setPinError] = useState<string | null>(null);
  const [loadingWorkerInfo, setLoadingWorkerInfo] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const storeId = getActiveStoreId();
    if (!storeId) {
      setLoadingWorkerInfo(false);
      return;
    }
    fetchStores()
      .then((stores) => {
        if (cancelled) return;
        const mine = stores.find((s) => s.id === storeId);
        if (mine) {
          setForm((prev) => ({ ...prev, storeCode: mine.store_code ?? undefined, workerPinSet: mine.worker_pin_set }));
        }
      })
      .catch(() => {
        // offline or request failed — worker-access section just shows what we already have
      })
      .finally(() => {
        if (!cancelled) setLoadingWorkerInfo(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const canSavePin = /^\d{6}$/.test(pin);

  async function savePin() {
    const storeId = getActiveStoreId();
    if (!storeId || !canSavePin) return;
    setPinStatus('saving');
    setPinError(null);
    try {
      const updated = await updateStorePin(storeId, pin);
      setForm((prev) => ({ ...prev, storeCode: updated.store_code ?? undefined, workerPinSet: updated.worker_pin_set }));
      setPin('');
      setPinStatus('saved');
    } catch (err) {
      setPinError(err instanceof Error ? err.message : 'Could not save the PIN.');
      setPinStatus('error');
    }
  }

  async function removePin() {
    const storeId = getActiveStoreId();
    if (!storeId) return;
    if (!confirm('Turn off worker PIN access for this store?')) return;
    setPinStatus('saving');
    setPinError(null);
    try {
      const updated = await updateStorePin(storeId, '');
      setForm((prev) => ({ ...prev, storeCode: updated.store_code ?? undefined, workerPinSet: updated.worker_pin_set }));
      setPinStatus('idle');
    } catch (err) {
      setPinError(err instanceof Error ? err.message : 'Could not update.');
      setPinStatus('error');
    }
  }

  return (
    <div className="receipt-modal">
      <div className="receipt-modal-inner settings-form">
        <h2>Store Settings</h2>
        <label>Store name<input value={form.storeName} onChange={(e) => setForm({ ...form, storeName: e.target.value })} /></label>
        <label>Address<input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
        <label>GSTIN<input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} /></label>
        <label>Phone<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
        <label>Invoice prefix<input value={form.invoicePrefix} onChange={(e) => setForm({ ...form, invoicePrefix: e.target.value })} /></label>
        <label>
          Supply order WhatsApp number (optional)
          <input
            value={form.supplyContactPhone ?? ''}
            onChange={(e) => setForm({ ...form, supplyContactPhone: e.target.value })}
            placeholder="Zoptavi's supply contact, once set up"
          />
        </label>
        <label>
          Printer width
          <select value={form.thermalWidth} onChange={(e) => setForm({ ...form, thermalWidth: e.target.value as StoreSettings['thermalWidth'] })}>
            <option value="58mm">58mm thermal</option>
            <option value="80mm">80mm thermal</option>
            <option value="a4">A4 / browser print</option>
          </select>
        </label>

        <div className="settings-section-title">Worker access</div>
        {loadingWorkerInfo ? (
          <p className="empty-hint" style={{ padding: 0 }}>Loading…</p>
        ) : form.storeCode ? (
          <>
            <p className="empty-hint" style={{ padding: 0, marginBottom: 4 }}>
              Give a worker this store code and a PIN to let them bill on this store without a
              Google account — they pick "Worker (PIN)" on the sign-in screen.
            </p>
            <div className="store-code-display">
              Store code: <strong>{form.storeCode}</strong>
            </div>
            <p className="empty-hint" style={{ padding: 0, marginBottom: 4 }}>
              {form.workerPinSet ? 'A PIN is set.' : 'No PIN set yet — workers can’t sign in until you set one.'}
            </p>
            <div className="worker-pin-row">
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                placeholder="New 6-digit PIN"
              />
              <button type="button" className="btn-ghost" disabled={!canSavePin || pinStatus === 'saving'} onClick={savePin}>
                {form.workerPinSet ? 'Change PIN' : 'Set PIN'}
              </button>
            </div>
            {form.workerPinSet && (
              <button type="button" className="worker-pin-remove" onClick={removePin} disabled={pinStatus === 'saving'}>
                Turn off worker access
              </button>
            )}
            {pinStatus === 'saved' && <p className="empty-hint" style={{ padding: 0, color: 'var(--color-success)' }}>Saved.</p>}
            {pinStatus === 'error' && pinError && <p className="empty-hint" style={{ padding: 0, color: 'var(--color-danger)' }}>{pinError}</p>}
          </>
        ) : (
          <p className="empty-hint" style={{ padding: 0 }}>
            Sign in online once to set up worker access for this store.
          </p>
        )}

        <div className="receipt-modal-actions">
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn-solid" onClick={() => onSave(form)}>Save</button>
        </div>
      </div>
    </div>
  );
}
