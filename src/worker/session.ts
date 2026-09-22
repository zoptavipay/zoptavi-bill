import { base64UrlToUint8Array, stringToBase64Url, uint8ArrayToBase64Url } from "./base64.ts";
import type { OwnerSessionPayload, SessionPayload, WorkerSessionPayload } from "./types.ts";

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

async function getHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function sign(payload: object, secret: string): Promise<string> {
  const payloadB64 = stringToBase64Url(JSON.stringify(payload));
  const key = await getHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  const signatureB64 = uint8ArrayToBase64Url(new Uint8Array(signature));
  return `${payloadB64}.${signatureB64}`;
}

/** Issues a compact `<payload>.<signature>` token (HMAC-SHA256), not a full JWT, for a
 * Google-authenticated owner. */
export async function createSessionToken(
  ownerId: string,
  email: string,
  secret: string,
): Promise<string> {
  const payload: OwnerSessionPayload = {
    owner_id: ownerId,
    email,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  return sign(payload, secret);
}

/** Issues a session token for a PIN-authenticated worker, scoped to exactly one store —
 * distinguished from an owner token by `kind: 'worker'` so existing owner tokens (issued
 * before this field existed) keep verifying correctly. */
export async function createWorkerSessionToken(storeId: string, secret: string): Promise<string> {
  const payload: WorkerSessionPayload = {
    kind: "worker",
    store_id: storeId,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  return sign(payload, secret);
}

export async function verifySessionToken(
  token: string,
  secret: string,
): Promise<SessionPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, signatureB64] = parts;

  const key = await getHmacKey(secret);
  const signatureBytes = base64UrlToUint8Array(signatureB64);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes.buffer as ArrayBuffer,
    new TextEncoder().encode(payloadB64).buffer as ArrayBuffer,
  );
  if (!valid) return null;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToUint8Array(payloadB64)));
  } catch {
    return null;
  }

  if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }

  if (payload.kind === "worker") {
    if (typeof payload.store_id !== "string") return null;
    return { kind: "worker", store_id: payload.store_id, exp: payload.exp };
  }

  if (typeof payload.owner_id !== "string" || typeof payload.email !== "string") {
    return null;
  }
  return { owner_id: payload.owner_id, email: payload.email, exp: payload.exp };
}

export function isWorkerSession(session: SessionPayload): session is WorkerSessionPayload {
  return (session as WorkerSessionPayload).kind === "worker";
}

/** Extracts and verifies the bearer session token from an Authorization header. */
export async function getSessionFromRequest(
  request: Request,
  secret: string,
): Promise<SessionPayload | null> {
  const header = request.headers.get("Authorization");
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;
  return verifySessionToken(token, secret);
}
