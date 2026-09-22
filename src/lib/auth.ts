// Client-side session + multi-store helpers for Google Sign-In (owner) and PIN sign-in (worker).
// Talks to the already-deployed Worker endpoints under /api/*.

import type { StoreSettings } from '../types';
import { clearLocalData } from './db';

export const GOOGLE_CLIENT_ID = '327393382045-qikr1uk2vqeqt74g9186dqe2h08g1u7r.apps.googleusercontent.com';

const TOKEN_KEY = 'zoptavi_session_token';
const OWNER_KEY = 'zoptavi_owner';
const ACTIVE_STORE_KEY = 'zoptavi_active_store_id';
const ROLE_KEY = 'zoptavi_role';

export type Role = 'owner' | 'worker';

export interface Owner {
  id: string;
  email: string;
  name: string;
}

/** Snake-case store row shape as returned by the Worker API — never carries the raw PIN,
 * only whether one is set (`worker_pin_set`). */
export interface RemoteStore {
  id: string;
  owner_id: string;
  store_name: string;
  address: string | null;
  gstin: string | null;
  phone: string | null;
  invoice_prefix: string | null;
  thermal_width: string | null;
  supply_contact_phone: string | null;
  store_code: string | null;
  worker_pin_set: boolean;
  created_at: string;
  updated_at: string;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getOwner(): Owner | null {
  const raw = localStorage.getItem(OWNER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Owner;
  } catch {
    return null;
  }
}

export function getRole(): Role {
  return localStorage.getItem(ROLE_KEY) === 'worker' ? 'worker' : 'owner';
}

export function setSession(token: string, owner: Owner): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(OWNER_KEY, JSON.stringify(owner));
  localStorage.setItem(ROLE_KEY, 'owner');
}

/** Stores a PIN-authenticated worker session, scoped to exactly one store — no Owner object,
 * since a worker isn't one. */
export function setWorkerSession(token: string, storeId: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(ACTIVE_STORE_KEY, storeId);
  localStorage.setItem(ROLE_KEY, 'worker');
  localStorage.removeItem(OWNER_KEY);
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(OWNER_KEY);
  localStorage.removeItem(ACTIVE_STORE_KEY);
  localStorage.removeItem(ROLE_KEY);
}

/** Full sign-out: clears the session and wipes the locally-cached items/bills/settings so a
 * different owner or worker signing in next on this device never sees stale data from
 * whoever used it before. */
export async function signOut(): Promise<void> {
  clearSession();
  await clearLocalData();
}

export function getActiveStoreId(): string | null {
  return localStorage.getItem(ACTIVE_STORE_KEY);
}

export function setActiveStoreId(id: string): void {
  localStorage.setItem(ACTIVE_STORE_KEY, id);
}

export function isSignedIn(): boolean {
  return !!getToken();
}

/** Fetch wrapper that attaches the bearer token and throws a readable Error on failure. */
async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = getToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  return res;
}

export async function signInWithGoogle(credential: string): Promise<{ token: string; owner: Owner }> {
  const res = await fetch('/api/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential }),
  });
  if (!res.ok) {
    let message = 'Sign-in failed. Please try again.';
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // ignore parse errors, use default message
    }
    throw new Error(message);
  }
  return res.json();
}

/** PIN sign-in for a worker: no Google account, just the store's short code + its 6-digit
 * PIN (both set by the owner in Settings). */
export async function signInWithPin(storeCode: string, pin: string): Promise<{ token: string; store: RemoteStore }> {
  const res = await fetch('/api/auth/worker-pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storeCode: storeCode.trim(), pin: pin.trim() }),
  });
  if (!res.ok) {
    let message = 'Invalid store code or PIN.';
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // ignore parse errors, use default message
    }
    throw new Error(message);
  }
  return res.json();
}

export async function fetchStores(): Promise<RemoteStore[]> {
  const res = await authedFetch('/api/stores');
  if (!res.ok) {
    if (res.status === 401) {
      clearSession();
    }
    throw new Error('Could not load your stores. Please check your connection and try again.');
  }
  return res.json();
}

export interface OwnerOverviewStore {
  storeId: string;
  storeName: string;
  itemCount: number;
  lowStockCount: number;
  stockValue: number;
  todaySales: number;
  todayBillCount: number;
  weekSales: number;
}

/** Cross-store snapshot for the owner dashboard — live from the cloud, not the local device
 * cache, so it reflects every store regardless of which one this device is currently on. */
export async function fetchOwnerOverview(): Promise<OwnerOverviewStore[]> {
  const res = await authedFetch('/api/owner/overview');
  if (!res.ok) {
    throw new Error('Could not load your stores’ overview. Please check your connection and try again.');
  }
  try {
    const data = (await res.json()) as { stores: OwnerOverviewStore[] };
    return data.stores;
  } catch {
    throw new Error('Could not load your stores’ overview. Please check your connection and try again.');
  }
}

export async function createStore(settings: StoreSettings): Promise<RemoteStore> {
  const res = await authedFetch('/api/stores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(storeSettingsToRemotePayload(settings)),
  });
  if (!res.ok) {
    throw new Error('Could not save this store online. It has still been saved on this device.');
  }
  return res.json();
}

async function patchStore(id: string, payload: Record<string, unknown>): Promise<RemoteStore> {
  const res = await authedFetch(`/api/stores/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let message = 'Could not update this store online.';
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // ignore parse errors, use default message
    }
    throw new Error(message);
  }
  return res.json();
}

export async function updateStore(id: string, settings: StoreSettings): Promise<RemoteStore> {
  return patchStore(id, storeSettingsToRemotePayload(settings));
}

/** Sets (or changes) the store's worker PIN — must be exactly 6 digits. Pass an empty string
 * to disable worker access for this store entirely. */
export async function updateStorePin(storeId: string, pin: string): Promise<RemoteStore> {
  return patchStore(storeId, { worker_pin: pin });
}

export function storeSettingsToRemotePayload(s: StoreSettings) {
  return {
    store_name: s.storeName,
    address: s.address,
    gstin: s.gstin,
    phone: s.phone,
    invoice_prefix: s.invoicePrefix,
    thermal_width: s.thermalWidth,
    supply_contact_phone: s.supplyContactPhone,
  };
}

export function remoteStoreToSettings(r: RemoteStore, existing?: StoreSettings): StoreSettings {
  return {
    storeName: r.store_name ?? '',
    address: r.address ?? '',
    gstin: r.gstin ?? '',
    phone: r.phone ?? '',
    invoicePrefix: r.invoice_prefix ?? 'ZB',
    nextBillSeq: existing?.nextBillSeq ?? 1,
    thermalWidth: (r.thermal_width as StoreSettings['thermalWidth']) ?? '80mm',
    onboarded: true,
    supplyContactPhone: r.supply_contact_phone ?? undefined,
    storeCode: r.store_code ?? undefined,
    workerPinSet: r.worker_pin_set,
  };
}
