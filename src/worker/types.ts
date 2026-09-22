/**
 * Environment bindings for the zoptavi-bill Worker.
 *
 * D1Database and Fetcher come from Cloudflare's runtime types, generated into
 * `worker-configuration.d.ts` at the project root via `npx wrangler types`
 * (run automatically whenever `wrangler.jsonc` bindings change). That file
 * declares them as ambient globals, so no import is required here.
 */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  GOOGLE_CLIENT_ID: string;
  SESSION_SECRET: string;
}

export interface Owner {
  id: string;
  email: string;
  name: string | null;
  google_sub: string | null;
  created_at: string;
}

export interface Store {
  id: string;
  owner_id: string;
  store_name: string;
  address: string | null;
  gstin: string | null;
  phone: string | null;
  invoice_prefix: string | null;
  thermal_width: string | null;
  supply_contact_phone: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionPayload {
  owner_id: string;
  email: string;
  exp: number;
}

export interface ItemRow {
  id: string;
  store_id: string;
  name: string;
  hsn: string | null;
  price: number;
  gst_rate: number;
  unit: string | null;
  stock: number;
  category: string | null;
  barcode: string | null;
  mrp_inclusive: number;
  mrp: number | null;
  updated_at: string;
  deleted: number;
}

export interface BillRow {
  id: string;
  store_id: string;
  bill_no: string | null;
  created_at: string;
  lines_json: string;
  subtotal: number | null;
  total_cgst: number | null;
  total_sgst: number | null;
  grand_total: number | null;
  payment_mode: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_gstin: string | null;
  updated_at: string;
}
