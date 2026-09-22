// Core data model for Zoptavi Tab — core billing MVP (single store, offline-first)

export interface Item {
  id: string;
  name: string;
  hsn: string; // HSN/SAC code
  price: number; // unit price, GST-EXCLUSIVE (taxable value), in rupees — always the canonical
  // price used for every calculation. When mrpInclusive is true, this is back-calculated
  // from mrp so billing charges exactly the MRP printed on the pack, not MRP + extra GST.
  gstRate: number; // total GST %, e.g. 5, 12, 18
  unit: string; // pc, kg, box, etc
  stock: number; // current stock on hand
  category?: string;
  barcode?: string; // EAN-13 or in-house barcode, for scan lookup
  mrpInclusive?: boolean; // true if the shop enters prices as MRP (GST already included) —
  // the common case for most retail/grocery. false/undefined means price is entered before GST.
  mrp?: number; // the GST-inclusive price as entered by the owner, kept only for display/editing
  // so the item card and edit form show the number the owner recognizes, not the derived one.
  addedBy?: string; // name/email of the signed-in owner who added this item, for provenance —
  // set once at creation time, never changed by edits.
}

export interface BillLine {
  itemId: string;
  name: string;
  hsn: string;
  qty: number;
  unit: string;
  price: number; // unit price at time of billing, GST-exclusive
  gstRate: number;
  lineTotal: number; // qty * price, before GST
  cgst: number;
  sgst: number;
  lineGrandTotal: number; // lineTotal + cgst + sgst
}

export interface Bill {
  id: string; // local UUID
  billNo: string; // human-readable sequential number, e.g. ZB-0001
  createdAt: string; // ISO timestamp
  lines: BillLine[];
  subtotal: number; // sum of lineTotal
  totalCgst: number;
  totalSgst: number;
  discountType?: 'flat' | 'percent'; // how the discount was entered, for display/editing later
  discountValue?: number; // the raw number the shop typed (₹ amount, or % points)
  discountAmount: number; // resolved ₹ amount actually taken off, clamped to the pre-discount total
  grandTotal: number; // final payable amount = subtotal + CGST + SGST − discountAmount
  paymentMode: 'cash' | 'upi' | 'card' | 'credit';
  customerName?: string;
  customerPhone?: string;
  customerGstin?: string;
  synced: boolean; // whether pushed to backend (phase 2 — always false for now)
}

export interface StoreSettings {
  storeName: string;
  address: string;
  gstin: string;
  phone: string;
  invoicePrefix: string; // e.g. "ZB"
  nextBillSeq: number;
  thermalWidth: '58mm' | '80mm' | 'a4';
  onboarded: boolean; // has this store completed the first-run business setup?
  supplyContactPhone?: string; // Zoptavi's supply-order WhatsApp number, once set up
  storeCode?: string; // short code a worker enters (with the PIN) to sign in to this store
  workerPinSet?: boolean; // whether a worker PIN is currently configured server-side
}

export interface SupplyOrderLine {
  label: string;
  qty: number;
}
