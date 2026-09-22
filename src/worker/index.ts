import type { Env, Owner, Store } from "./types.ts";
import { GoogleTokenVerificationError, verifyGoogleIdToken } from "./googleAuth.ts";
import { createSessionToken, getSessionFromRequest } from "./session.ts";

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

async function handleListStores(request: Request, env: Env): Promise<Response> {
  const session = await getSessionFromRequest(request, env.SESSION_SECRET);
  if (!session) return errorResponse(401, "Unauthorized");

  const { results } = await env.DB.prepare("SELECT * FROM stores WHERE owner_id = ?")
    .bind(session.owner_id)
    .all<Store>();

  return jsonResponse(results ?? []);
}

async function handleCreateStore(request: Request, env: Env): Promise<Response> {
  const session = await getSessionFromRequest(request, env.SESSION_SECRET);
  if (!session) return errorResponse(401, "Unauthorized");

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

  const created = await env.DB.prepare("SELECT * FROM stores WHERE id = ?").bind(id).first<Store>();
  if (!created) return errorResponse(500, "Failed to create store");
  return jsonResponse(created, 201);
}

async function handleUpdateStore(request: Request, env: Env, storeId: string): Promise<Response> {
  const session = await getSessionFromRequest(request, env.SESSION_SECRET);
  if (!session) return errorResponse(401, "Unauthorized");

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
  const bindings: (string | null)[] = [];
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

  if (updates.length === 0) {
    return jsonResponse(existing);
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
  return jsonResponse(updated);
}
