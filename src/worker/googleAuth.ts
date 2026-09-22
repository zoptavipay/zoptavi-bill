import { base64UrlDecodeToString, base64UrlToUint8Array } from "./base64.ts";

const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ALLOWED_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

interface GoogleJwk {
  kid: string;
  kty: string;
  alg: string;
  n: string;
  e: string;
  use?: string;
}

interface GoogleCertsResponse {
  keys: GoogleJwk[];
}

export interface GoogleIdTokenPayload {
  iss: string;
  aud: string;
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  exp: number;
  iat: number;
  [key: string]: unknown;
}

export class GoogleTokenVerificationError extends Error {}

/**
 * Verifies a Google ID token (JWT) per
 * https://developers.google.com/identity/sign-in/web/backend-auth,
 * using the Workers-native fetch + Web Crypto APIs (no Node crypto).
 */
export async function verifyGoogleIdToken(
  credential: string,
  expectedAudience: string,
): Promise<GoogleIdTokenPayload> {
  const parts = credential.split(".");
  if (parts.length !== 3) {
    throw new GoogleTokenVerificationError("Malformed token");
  }
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { alg: string; kid: string; typ?: string };
  let payload: GoogleIdTokenPayload;
  try {
    header = JSON.parse(base64UrlDecodeToString(headerB64));
    payload = JSON.parse(base64UrlDecodeToString(payloadB64));
  } catch {
    throw new GoogleTokenVerificationError("Malformed token");
  }

  if (header.alg !== "RS256") {
    throw new GoogleTokenVerificationError("Unsupported algorithm");
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= now) {
    throw new GoogleTokenVerificationError("Token expired");
  }
  if (!ALLOWED_ISSUERS.has(payload.iss)) {
    throw new GoogleTokenVerificationError("Invalid issuer");
  }
  if (payload.aud !== expectedAudience) {
    throw new GoogleTokenVerificationError("Invalid audience");
  }

  const jwk = await fetchGoogleJwk(header.kid);
  if (!jwk) {
    throw new GoogleTokenVerificationError("Unknown signing key");
  }

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );

  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlToUint8Array(signatureB64);

  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    signature.buffer as ArrayBuffer,
    signedData.buffer as ArrayBuffer,
  );

  if (!valid) {
    throw new GoogleTokenVerificationError("Invalid signature");
  }

  return payload;
}

async function fetchGoogleJwk(kid: string): Promise<GoogleJwk | null> {
  const res = await fetch(GOOGLE_CERTS_URL);
  if (!res.ok) {
    throw new GoogleTokenVerificationError("Failed to fetch Google certs");
  }
  const data = (await res.json()) as GoogleCertsResponse;
  return data.keys.find((k) => k.kid === kid) ?? null;
}
