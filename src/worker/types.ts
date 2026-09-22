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
