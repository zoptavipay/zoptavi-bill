import { base64UrlToUint8Array, stringToBase64Url, uint8ArrayToBase64Url } from "./base64.ts";
import type { SessionPayload } from "./types.ts";

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

/** Issues a compact `<payload>.<signature>` token (HMAC-SHA256), not a full JWT. */
export async function createSessionToken(
  ownerId: string,
  email: string,
  secret: string,
): Promise<string> {
  const payload: SessionPayload = {
    owner_id: ownerId,
    email,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const payloadB64 = stringToBase64Url(JSON.stringify(payload));
  const key = await getHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  const signatureB64 = uint8ArrayToBase64Url(new Uint8Array(signature));
  return `${payloadB64}.${signatureB64}`;
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

  let payload: SessionPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToUint8Array(payloadB64)));
  } catch {
    return null;
  }

  if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }
  if (typeof payload.owner_id !== "string" || typeof payload.email !== "string") {
    return null;
  }
  return payload;
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
