import { get, set, update, createStore, keys, del } from 'idb-keyval';
import type { Bill, Item, StoreSettings } from '../types';

// Dedicated IndexedDB database for Zoptavi Tab (kept isolated from any other
// site data, per the "separate project" decision).
const store = createStore('zoptavi-bill-db', 'kv');

const ITEMS_KEY = 'items';
const SETTINGS_KEY = 'settings';
const BILL_PREFIX = 'bill:';

const defaultSettings: StoreSettings = {
  storeName: 'My Store',
  address: '',
  gstin: '',
  phone: '',
  invoicePrefix: 'ZB',
  nextBillSeq: 1,
  thermalWidth: '80mm',
  onboarded: false,
};

const seedItems: Item[] = [
  { id: 'i1', name: 'Rice 1kg', hsn: '1006', price: 60, gstRate: 5, unit: 'kg', stock: 50, category: 'Grocery', barcode: '8901030875021' },
  { id: 'i2', name: 'Cooking Oil 1L', hsn: '1512', price: 150, gstRate: 5, unit: 'ltr', stock: 30, category: 'Grocery', barcode: '8901030875038' },
  { id: 'i3', name: 'Notebook', hsn: '4820', price: 40, gstRate: 12, unit: 'pc', stock: 100, category: 'Stationery', barcode: '8901030875045' },
  { id: 'i4', name: 'Ballpoint Pen', hsn: '9608', price: 10, gstRate: 12, unit: 'pc', stock: 200, category: 'Stationery', barcode: '8901030875052' },
  { id: 'i5', name: 'Soap Bar', hsn: '3401', price: 35, gstRate: 18, unit: 'pc', stock: 80, category: 'Personal Care', barcode: '8901030875069' },
  { id: 'i6', name: 'Biscuit Pack', hsn: '1905', price: 25, gstRate: 18, unit: 'pc', stock: 120, category: 'Snacks', barcode: '8901030875076' },
];

export async function getItems(): Promise<Item[]> {
  const items = await get<Item[]>(ITEMS_KEY, store);
  if (!items || items.length === 0) {
    await set(ITEMS_KEY, seedItems, store);
    return seedItems;
  }
  return items;
}

export async function saveItems(items: Item[]): Promise<void> {
  await set(ITEMS_KEY, items, store);
}

export async function addItem(item: Item): Promise<void> {
  await update<Item[]>(ITEMS_KEY, (items) => [...(items ?? []), item], store);
}

/** Replaces one item by id — used by the "Edit item" flow to fix name/price/GST/HSN later. */
export async function updateItem(updated: Item): Promise<void> {
  await update<Item[]>(
    ITEMS_KEY,
    (items) => {
      if (!items) return [];
      return items.map((it) => (it.id === updated.id ? updated : it));
    },
    store,
  );
}

export async function updateItemStock(itemId: string, delta: number): Promise<void> {
  await update<Item[]>(
    ITEMS_KEY,
    (items) => {
      if (!items) return [];
      return items.map((it) => (it.id === itemId ? { ...it, stock: Math.max(0, it.stock + delta) } : it));
    },
    store,
  );
}

export async function getSettings(): Promise<StoreSettings> {
  const s = await get<StoreSettings>(SETTINGS_KEY, store);
  return s ?? defaultSettings;
}

export async function saveSettings(s: StoreSettings): Promise<void> {
  await set(SETTINGS_KEY, s, store);
}

export async function nextBillNumber(): Promise<string> {
  const s = await getSettings();
  const seq = s.nextBillSeq;
  await saveSettings({ ...s, nextBillSeq: seq + 1 });
  return `${s.invoicePrefix}-${String(seq).padStart(4, '0')}`;
}

export async function saveBill(bill: Bill): Promise<void> {
  await set(BILL_PREFIX + bill.id, bill, store);
}

export async function getAllBills(): Promise<Bill[]> {
  const allKeys = await keys(store);
  const billKeys = allKeys.filter((k) => typeof k === 'string' && k.startsWith(BILL_PREFIX));
  const bills = await Promise.all(billKeys.map((k) => get<Bill>(k as string, store)));
  return bills
    .filter((b): b is Bill => !!b)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function deleteBill(id: string): Promise<void> {
  await del(BILL_PREFIX + id, store);
}

export async function getUnsyncedBills(): Promise<Bill[]> {
  const bills = await getAllBills();
  return bills.filter((b) => !b.synced);
}
