import type { BillRow, Env, ItemRow, Owner, SessionPayload, Store } from "./types.ts";
import { GoogleTokenVerificationError, verifyGoogleIdToken } from "./googleAuth.ts";
import {
  createSessionToken,
  createWorkerSessionToken,
  getSessionFromRequest,
  isWorkerSession,
} from "./session.ts";

const JSON_HEADERS = { "content-type": "application/json" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function errorResponse(status: number, message: string): Response {
  return jsonResponse({ error: message }, status);
}

const STORE_FIELDS = [
  "store_name",
  "address",
  "gstin",
  "phone",
  "invoice_prefix",
  "thermal_width",
  "supply_contact_phone",
] as const;
type StoreField = (typeof STORE_FIELDS)[number];

const WORKER_PIN_PATTERN = /^\d{6}$/;
const WORKER_PIN_MAX_ATTEMPTS = 5;
const WORKER_PIN_LOCKOUT_MINUTES = 15;
// Excludes visually-ambiguous characters (0/O, 1/I) so a worker copying the code by hand
// off a printed slip doesn't misread it.
const STORE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateStoreCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let code = "";
  for (const b of bytes) code += STORE_CODE_ALPHABET[b % STORE_CODE_ALPHABET.length];
  return code;
}

async function hashPin(pin: string, storeId: string): Promise<string> {
  const data = new TextEncoder().encode(`${storeId}:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Assigns a fresh, unique store_code to a store that doesn't have one yet (either just
 * created, or created before this feature existed) — retries on the astronomically unlikely
 * unique-index collision. */
async function assignStoreCode(env: Env, storeId: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateStoreCode();
    try {
      await env.DB.prepare("UPDATE stores SET store_code = ? WHERE id = ?").bind(code, storeId).run();
      return code;
    } catch {
      // unique constraint hit — try another code
    }
  }
  throw new Error("Could not assign a unique store code");
}

/** Strips security-sensitive columns before a Store row ever reaches the client, replacing
 * the PIN hash with a plain boolean the Settings UI can use to show "PIN set" vs not. */
function sanitizeStore(store: Store) {
  const { worker_pin_hash, worker_pin_fail_count: _fail, worker_pin_locked_until: _locked, ...rest } = store;
  return { ...rest, worker_pin_set: !!worker_pin_hash };
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    try {
      if (url.pathname === "/api/auth/google" && request.method === "POST") {
        return await handleGoogleAuth(request, env);
      }

      if (url.pathname === "/api/auth/worker-pin" && request.method === "POST") {
        return await handleWorkerPinAuth(request, env);
      }

      if (url.pathname === "/api/owner/overview" && request.method === "GET") {
        return await handleOwnerOverview(request, env);
      }

      if (url.pathname === "/api/stores" && request.method === "GET") {
        return await handleListStores(request, env);
      }

      if (url.pathname === "/api/stores" && request.method === "POST") {
        return await handleCreateStore(request, env);
      }

      const storeMatch = url.pathname.match(/^\/api\/stores\/([^/]+)$/);
      if (storeMatch && request.method === "PATCH") {
        return await handleUpdateStore(request, env, storeMatch[1]);
      }

      const syncMatch = url.pathname.match(/^\/api\/sync\/([^/]+)$/);
      if (syncMatch && request.method === "POST") {
        return await handleSyncPush(request, env, syncMatch[1]);
      }
      if (syncMatch && request.method === "GET") {
        return await handleSyncPull(request, env, syncMatch[1]);
      }

      return errorResponse(404, "Not found");
    } catch (err) {
      console.error("Unhandled worker error:", err);
      return errorResponse(500, "Internal server error");
    }
  },
} satisfies ExportedHandler<Env>;

async function handleGoogleAuth(request: Request, env: Env): Promise<Response> {
  let body: { credential?: unknown };
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid JSON body");
  }

  if (typeof body.credential !== "string" || !body.credential) {
    return errorResponse(400, "Missing credential");
  }

  let payload;
  try {
    payload = await verifyGoogleIdToken(body.credential, env.GOOGLE_CLIENT_ID);
  } catch (err) {
    if (err instanceof GoogleTokenVerificationError) {
      return errorResponse(401, "Google token verification failed");
    }
    console.error("Google auth error:", err);
    return errorResponse(401, "Google token verification failed");
  }

  const email = payload.email;
  const googleSub = payload.sub;
  const name = typeof payload.name === "string" ? payload.name : null;

  if (!email) {
    return errorResponse(401, "Google account has no email");
  }

  const owner = await upsertOwner(env, googleSub, email, name);

  const token = await createSessionToken(owner.id, owner.email, env.SESSION_SECRET);

  return jsonResponse({
    token,
    owner: { id: owner.id, email: owner.email, name: owner.name },
  });
}

async function upsertOwner(
  env: Env,
  googleSub: string,
  email: string,
  name: string | null,
): Promise<Owner> {
  const bySub = await env.DB.prepare("SELECT * FROM owners WHERE google_sub = ?")
    .bind(googleSub)
    .first<Owner>();
  if (bySub) {
    if (name && name !== bySub.name) {
      await env.DB.prepare("UPDATE owners SET name = ? WHERE id = ?").bind(name, bySub.id).run();
      return { ...bySub, name };
    }
    return bySub;
  }

  const byEmail = await env.DB.prepare("SELECT * FROM owners WHERE email = ?")
    .bind(email)
    .first<Owner>();
  if (byEmail) {
    await env.DB.prepare("UPDATE owners SET google_sub = ?, name = COALESCE(?, name) WHERE id = ?")
      .bind(googleSub, name, byEmail.id)
      .run();
    return { ...byEmail, google_sub: googleSub, name: name ?? byEmail.name };
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO owners (id, email, name, google_sub) VALUES (?, ?, ?, ?)",
  )
    .bind(id, email, name, googleSub)
    .run();

  const created = await env.DB.prepare("SELECT * FROM owners WHERE id = ?").bind(id).first<Owner>();
  if (!created) throw new Error("Failed to create owner");
  return created;
}

async function handleWorkerPinAuth(request: Request, env: Env): Promise<Response> {
  let body: { storeCode?: unknown; pin?: unknown };
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid JSON body");
  }

  if (typeof body.storeCode !== "string" || typeof body.pin !== "string") {
    return errorResponse(400, "Store code and PIN are required");
  }

  const storeCode = body.storeCode.trim().toUpperCase();
  const pin = body.pin.trim();

  const store = await env.DB.prepare("SELECT * FROM stores WHERE store_code = ?")
    .bind(storeCode)
    .first<Store>();
  if (!store || !store.worker_pin_hash) {
    return errorResponse(401, "Invalid store code or PIN");
  }

  if (store.worker_pin_locked_until && store.worker_pin_locked_until > new Date().toISOString()) {
    return errorResponse(429, "Too many attempts — try again in a few minutes.");
  }

  const candidateHash = await hashPin(pin, store.id);
  if (candidateHash !== store.worker_pin_hash) {
    const failCount = (store.worker_pin_fail_count ?? 0) + 1;
    const lockedUntil =
      failCount >= WORKER_PIN_MAX_ATTEMPTS
        ? new Date(Date.now() + WORKER_PIN_LOCKOUT_MINUTES * 60 * 1000).toISOString()
        : null;
    await env.DB.prepare(
      "UPDATE stores SET worker_pin_fail_count = ?, worker_pin_locked_until = ? WHERE id = ?",
    )
      .bind(failCount, lockedUntil, store.id)
      .run();
    return errorResponse(401, "Invalid store code or PIN");
  }

  await env.DB.prepare(
    "UPDATE stores SET worker_pin_fail_count = 0, worker_pin_locked_until = NULL WHERE id = ?",
  )
    .bind(store.id)
    .run();

  const token = await createWorkerSessionToken(store.id, env.SESSION_SECRET);
  return jsonResponse({ token, store: sanitizeStore(store) });
}

/** Cross-store summary for the signed-in owner: per-store stock/low-stock/sales, so an owner
 * with several stores can see them all at a glance without picking one to bill from. Reads
 * D1 directly (not the per-device IndexedDB cache) since it's meant to work from any device. */
async function handleOwnerOverview(request: Request, env: Env): Promise<Response> {
  const session = await getSessionFromRequest(request, env.SESSION_SECRET);
  if (!session || isWorkerSession(session)) return errorResponse(401, "Unauthorized");

  const { results } = await env.DB.prepare("SELECT * FROM stores WHERE owner_id = ?")
    .bind(session.owner_id)
    .all<Store>();
  const stores = results ?? [];

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const overview = await Promise.all(
    stores.map(async (store) => {
      const itemStats = await env.DB.prepare(
        `SELECT COUNT(*) as itemCount,
                SUM(CASE WHEN stock <= 10 THEN 1 ELSE 0 END) as lowStockCount,
                COALESCE(SUM(price * stock), 0) as stockValue
         FROM items WHERE store_id = ? AND deleted = 0`,
      )
        .bind(store.id)
        .first<{ itemCount: number; lowStockCount: number; stockValue: number }>();

      const todaySales = await env.DB.prepare(
        "SELECT COALESCE(SUM(grand_total), 0) as total, COUNT(*) as count FROM bills WHERE store_id = ? AND created_at >= ?",
      )
        .bind(store.id, todayStart)
        .first<{ total: number; count: number }>();

      const weekSales = await env.DB.prepare(
        "SELECT COALESCE(SUM(grand_total), 0) as total FROM bills WHERE store_id = ? AND created_at >= ?",
      )
        .bind(store.id, weekAgo)
        .first<{ total: number }>();

      return {
        storeId: store.id,
        storeName: store.store_name,
        itemCount: itemStats?.itemCount ?? 0,
        lowStockCount: itemStats?.lowStockCount ?? 0,
        stockValue: itemStats?.stockValue ?? 0,
        todaySales: todaySales?.total ?? 0,
        todayBillCount: todaySales?.count ?? 0,
        weekSales: weekSales?.total ?? 0,
      };
    }),
  );

  return jsonResponse({ stores: overview });
}

async function handleListStores(request: Request, env: Env): Promise<Response> {
  const session = await getSessionFromRequest(request, env.SESSION_SECRET);
  if (!session || isWorkerSession(session)) return errorResponse(401, "Unauthorized");

  const { results } = await env.DB.prepare("SELECT * FROM stores WHERE owner_id = ?")
    .bind(session.owner_id)
    .all<Store>();
  const stores = results ?? [];

  // Backfill a store_code for any store created before this feature existed, so every
  // store the owner can see always has one to hand to a worker.
  for (const store of stores) {
    if (!store.store_code) {
      store.store_code = await assignStoreCode(env, store.id);
    }
  }

  return jsonResponse(stores.map(sanitizeStore));
}

async function handleCreateStore(request: Request, env: Env): Promise<Response> {
  const session = await getSessionFromRequest(request, env.SESSION_SECRET);
  if (!session || isWorkerSession(session)) return errorResponse(401, "Unauthorized");

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid JSON body");
  }

  if (typeof body.store_name !== "string" || !body.store_name.trim()) {
    return errorResponse(400, "store_name is required");
  }

  const id = crypto.randomUUID();
  const values: Record<StoreField, string | null> = {
    store_name: body.store_name,
    address: typeof body.address === "string" ? body.address : null,
    gstin: typeof body.gstin === "string" ? body.gstin : null,
    phone: typeof body.phone === "string" ? body.phone : null,
    invoice_prefix: typeof body.invoice_prefix === "string" ? body.invoice_prefix : "INV",
    thermal_width: typeof body.thermal_width === "string" ? body.thermal_width : "58mm",
    supply_contact_phone:
      typeof body.supply_contact_phone === "string" ? body.supply_contact_phone : null,
  };

  await env.DB.prepare(
    `INSERT INTO stores (id, owner_id, store_name, address, gstin, phone, invoice_prefix, thermal_width, supply_contact_phone)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      session.owner_id,
      values.store_name,
      values.address,
      values.gstin,
      values.phone,
      values.invoice_prefix,
      values.thermal_width,
      values.supply_contact_phone,
    )
    .run();

  await assignStoreCode(env, id);

  const created = await env.DB.prepare("SELECT * FROM stores WHERE id = ?").bind(id).first<Store>();
  if (!created) return errorResponse(500, "Failed to create store");
  return jsonResponse(sanitizeStore(created), 201);
}

async function handleUpdateStore(request: Request, env: Env, storeId: string): Promise<Response> {
  const session = await getSessionFromRequest(request, env.SESSION_SECRET);
  if (!session) return errorResponse(401, "Unauthorized");
  // Workers can bill and manage stock, but never touch store identity/settings or their own
  // PIN — only the owner (Google session) can reach this route.
  if (isWorkerSession(session)) return errorResponse(403, "Forbidden");

  const existing = await env.DB.prepare("SELECT * FROM stores WHERE id = ?")
    .bind(storeId)
    .first<Store>();
  if (!existing) return errorResponse(404, "Store not found");
  if (existing.owner_id !== session.owner_id) return errorResponse(403, "Forbidden");

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid JSON body");
  }

  const updates: string[] = [];
  const bindings: (string | null | number)[] = [];
  for (const field of STORE_FIELDS) {
    if (field in body) {
      const value = body[field];
      if (value !== null && typeof value !== "string") {
        return errorResponse(400, `${field} must be a string or null`);
      }
      updates.push(`${field} = ?`);
      bindings.push(value);
    }
  }

  // worker_pin is handled separately from the generic STORE_FIELDS loop: it's never stored
  // as-is, only its hash — and clearing it (null/empty) disables worker access entirely.
  if ("worker_pin" in body) {
    const raw = body.worker_pin;
    if (raw === null || raw === "") {
      updates.push("worker_pin_hash = ?", "worker_pin_fail_count = 0", "worker_pin_locked_until = NULL");
      bindings.push(null);
    } else if (typeof raw === "string" && WORKER_PIN_PATTERN.test(raw)) {
      const hash = await hashPin(raw, storeId);
      updates.push("worker_pin_hash = ?", "worker_pin_fail_count = 0", "worker_pin_locked_until = NULL");
      bindings.push(hash);
    } else {
      return errorResponse(400, "worker_pin must be exactly 6 digits");
    }
  }

  if (updates.length === 0) {
    return jsonResponse(sanitizeStore(existing));
  }

  updates.push("updated_at = datetime('now')");
  bindings.push(storeId);

  await env.DB.prepare(`UPDATE stores SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...bindings)
    .run();

  const updated = await env.DB.prepare("SELECT * FROM stores WHERE id = ?")
    .bind(storeId)
    .first<Store>();
  if (!updated) return errorResponse(500, "Failed to update store");
  if (!updated.store_code) updated.store_code = await assignStoreCode(env, storeId);
  return jsonResponse(sanitizeStore(updated));
}

/** Frontend camelCase Item shape, as sent/received on /api/sync. */
interface SyncItem {
  id: string;
  name: string;
  hsn: string;
  price: number;
  gstRate: number;
  unit: string;
  stock: number;
  category?: string;
  barcode?: string;
  mrpInclusive?: boolean;
  mrp?: number;
  addedBy?: string;
}

/** Frontend camelCase Bill shape, as sent/received on /api/sync. */
interface SyncBill {
  id: string;
  billNo: string;
  createdAt: string;
  lines: unknown[];
  subtotal: number;
  totalCgst: number;
  totalSgst: number;
  grandTotal: number;
  paymentMode: string;
  customerName?: string;
  customerPhone?: string;
  customerGstin?: string;
  synced: boolean;
}

function itemRowToSyncItem(row: ItemRow): SyncItem {
  return {
    id: row.id,
    name: row.name,
    hsn: row.hsn ?? "",
    price: row.price,
    gstRate: row.gst_rate,
    unit: row.unit ?? "",
    stock: row.stock,
    category: row.category ?? undefined,
    barcode: row.barcode ?? undefined,
    mrpInclusive: !!row.mrp_inclusive,
    mrp: row.mrp ?? undefined,
    addedBy: row.added_by ?? undefined,
  };
}

function billRowToSyncBill(row: BillRow): SyncBill {
  return {
    id: row.id,
    billNo: row.bill_no ?? "",
    createdAt: row.created_at,
    lines: JSON.parse(row.lines_json),
    subtotal: row.subtotal ?? 0,
    totalCgst: row.total_cgst ?? 0,
    totalSgst: row.total_sgst ?? 0,
    grandTotal: row.grand_total ?? 0,
    paymentMode: row.payment_mode ?? "cash",
    customerName: row.customer_name ?? undefined,
    customerPhone: row.customer_phone ?? undefined,
    customerGstin: row.customer_gstin ?? undefined,
    synced: true,
  };
}

/** Verifies the session token grants access to `storeId` — either the owner of that store
 * (Google session), or a worker session scoped to exactly that store (PIN sign-in). Returns
 * the Response to send back on failure, otherwise the verified session. */
async function requireStoreAccess(
  request: Request,
  env: Env,
  storeId: string,
): Promise<{ session: SessionPayload } | Response> {
  const session = await getSessionFromRequest(request, env.SESSION_SECRET);
  if (!session) return errorResponse(401, "Unauthorized");

  if (isWorkerSession(session)) {
    if (session.store_id !== storeId) return errorResponse(403, "Forbidden");
    return { session };
  }

  const store = await env.DB.prepare("SELECT * FROM stores WHERE id = ?")
    .bind(storeId)
    .first<Store>();
  if (!store) return errorResponse(404, "Store not found");
  if (store.owner_id !== session.owner_id) return errorResponse(403, "Forbidden");

  return { session };
}

async function handleSyncPush(request: Request, env: Env, storeId: string): Promise<Response> {
  const access = await requireStoreAccess(request, env, storeId);
  if (access instanceof Response) return access;

  let body: { items?: SyncItem[]; bills?: SyncBill[] };
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid JSON body");
  }

  const items = Array.isArray(body.items) ? body.items : [];
  const bills = Array.isArray(body.bills) ? body.bills : [];
  const now = new Date().toISOString();

  // Frontend Item/Bill types don't carry their own updated_at, so we stamp "now" on every
  // pushed row. Combined with the ON CONFLICT ... WHERE excluded.updated_at > <table>.updated_at
  // guard below, this means "last device to sync wins" for a given row — acceptable for the
  // small/single-device-per-store scale this app targets in v1.
  const itemStmt = env.DB.prepare(
    `INSERT INTO items (id, store_id, name, hsn, price, gst_rate, unit, stock, category, barcode, mrp_inclusive, mrp, added_by, updated_at, deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(store_id, id) DO UPDATE SET
       name = excluded.name, hsn = excluded.hsn, price = excluded.price, gst_rate = excluded.gst_rate,
       unit = excluded.unit, stock = excluded.stock, category = excluded.category, barcode = excluded.barcode,
       mrp_inclusive = excluded.mrp_inclusive, mrp = excluded.mrp,
       added_by = COALESCE(items.added_by, excluded.added_by), updated_at = excluded.updated_at
     WHERE excluded.updated_at > items.updated_at`,
  );
  const billStmt = env.DB.prepare(
    `INSERT INTO bills (id, store_id, bill_no, created_at, lines_json, subtotal, total_cgst, total_sgst, grand_total, payment_mode, customer_name, customer_phone, customer_gstin, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(store_id, id) DO UPDATE SET
       bill_no = excluded.bill_no, created_at = excluded.created_at, lines_json = excluded.lines_json,
       subtotal = excluded.subtotal, total_cgst = excluded.total_cgst, total_sgst = excluded.total_sgst,
       grand_total = excluded.grand_total, payment_mode = excluded.payment_mode, customer_name = excluded.customer_name,
       customer_phone = excluded.customer_phone, customer_gstin = excluded.customer_gstin, updated_at = excluded.updated_at
     WHERE excluded.updated_at > bills.updated_at`,
  );

  const itemBinds = items.map((it) =>
    itemStmt.bind(
      it.id,
      storeId,
      it.name,
      it.hsn ?? null,
      it.price ?? 0,
      it.gstRate ?? 0,
      it.unit ?? null,
      it.stock ?? 0,
      it.category ?? null,
      it.barcode ?? null,
      it.mrpInclusive ? 1 : 0,
      it.mrp ?? null,
      it.addedBy ?? null,
      now,
    ),
  );
  const billBinds = bills.map((b) =>
    billStmt.bind(
      b.id,
      storeId,
      b.billNo ?? null,
      b.createdAt,
      JSON.stringify(b.lines ?? []),
      b.subtotal ?? 0,
      b.totalCgst ?? 0,
      b.totalSgst ?? 0,
      b.grandTotal ?? 0,
      b.paymentMode ?? null,
      b.customerName ?? null,
      b.customerPhone ?? null,
      b.customerGstin ?? null,
      now,
    ),
  );

  // D1 supports batching prepared statements atomically; fall back to sequential awaits if
  // the binding doesn't expose .batch() for some reason.
  const allBinds = [...itemBinds, ...billBinds];
  if (allBinds.length > 0) {
    if (typeof env.DB.batch === "function") {
      await env.DB.batch(allBinds);
    } else {
      for (const stmt of allBinds) {
        await stmt.run();
      }
    }
  }

  return jsonResponse({ ok: true, synced: { items: items.length, bills: bills.length } });
}

async function handleSyncPull(request: Request, env: Env, storeId: string): Promise<Response> {
  const access = await requireStoreAccess(request, env, storeId);
  if (access instanceof Response) return access;

  const url = new URL(request.url);
  const since = url.searchParams.get("since") ?? "";
  const syncedAt = new Date().toISOString();

  const itemRows = since
    ? await env.DB.prepare(
        "SELECT * FROM items WHERE store_id = ? AND updated_at > ? AND deleted = 0",
      )
        .bind(storeId, since)
        .all<ItemRow>()
    : await env.DB.prepare("SELECT * FROM items WHERE store_id = ? AND deleted = 0")
        .bind(storeId)
        .all<ItemRow>();

  const billRows = since
    ? await env.DB.prepare("SELECT * FROM bills WHERE store_id = ? AND updated_at > ?")
        .bind(storeId, since)
        .all<BillRow>()
    : await env.DB.prepare("SELECT * FROM bills WHERE store_id = ?").bind(storeId).all<BillRow>();

  return jsonResponse({
    items: (itemRows.results ?? []).map(itemRowToSyncItem),
    bills: (billRows.results ?? []).map(billRowToSyncBill),
    syncedAt,
  });
}
