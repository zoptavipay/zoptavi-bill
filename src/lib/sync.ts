// Sync layer: pushes locally-changed items/bills to the cloud D1 database and pulls down
// anything newer from other devices for the same store. Offline-first — this must never throw
// or block the billing UI; every failure just resolves { ok: false, error } so callers can
// ignore it or show a small status indicator.

import type { Bill, Item } from '../types';
import { getActiveStoreId, getToken } from './auth';
import { getItems, saveItems, getAllBills, saveBill, getUnsyncedBills } from './db';

const LAST_SYNC_PREFIX = 'zoptavi_last_sync_';

export interface SyncResult {
  ok: boolean;
  error?: string;
}

type SyncListener = (syncing: boolean) => void;
const listeners = new Set<SyncListener>();

function notify(syncing: boolean) {
  listeners.forEach((l) => l(syncing));
}

/** Subscribe to sync-in-progress state changes. Returns an unsubscribe function. */
export function onSyncStateChange(listener: SyncListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let inFlight = false;

export async function syncNow(): Promise<SyncResult> {
  const storeId = getActiveStoreId();
  const token = getToken();

  if (!storeId || !token) {
    return { ok: false, error: 'offline or not signed in' };
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, error: 'offline or not signed in' };
  }

  if (inFlight) {
    return { ok: false, error: 'sync already in progress' };
  }

  inFlight = true;
  notify(true);
  try {
    // 1. Push local unsynced bills + all local items up to the server.
    const unsyncedBills = await getUnsyncedBills();
    const localItems = await getItems();

    const pushRes = await fetch(`/api/sync/${storeId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ items: localItems, bills: unsyncedBills }),
    });

    if (!pushRes.ok) {
      return { ok: false, error: `sync push failed (${pushRes.status})` };
    }

    // Mark the bills we just pushed as synced locally so we don't re-push them every time.
    for (const bill of unsyncedBills) {
      await saveBill({ ...bill, synced: true });
    }

    // 2. Pull anything newer from the server (other devices for this store) since our
    // last successful sync.
    const lastSyncKey = LAST_SYNC_PREFIX + storeId;
    const since = localStorage.getItem(lastSyncKey) ?? '';
    const pullUrl = since
      ? `/api/sync/${storeId}?since=${encodeURIComponent(since)}`
      : `/api/sync/${storeId}`;

    const pullRes = await fetch(pullUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!pullRes.ok) {
      return { ok: false, error: `sync pull failed (${pullRes.status})` };
    }
    const data = (await pullRes.json()) as { items: Item[]; bills: Bill[]; syncedAt: string };

    // Merge items: overwrite-by-id with whatever the server returned. Items rarely conflict
    // in practice for a single shop with one or two devices, so we skip timestamp comparison
    // here and just trust the server's copy for any item it sent back — simplest correct
    // behavior for v1, revisit if multi-device concurrent-edit conflicts turn out to matter.
    if (data.items && data.items.length > 0) {
      const byId = new Map(localItems.map((it) => [it.id, it]));
      for (const remote of data.items) {
        byId.set(remote.id, remote);
      }
      await saveItems(Array.from(byId.values()));
    }

    // Merge bills: bills are write-once, so a simple "add if not already present locally"
    // upsert is sufficient — no need to diff contents.
    if (data.bills && data.bills.length > 0) {
      const localBills = await getAllBills();
      const localIds = new Set(localBills.map((b) => b.id));
      for (const remote of data.bills) {
        if (!localIds.has(remote.id)) {
          await saveBill({ ...remote, synced: true });
        }
      }
    }

    localStorage.setItem(lastSyncKey, data.syncedAt);

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'sync failed' };
  } finally {
    inFlight = false;
    notify(false);
  }
}

let bootWired = false;

/** Wires up automatic syncing: runs once immediately (if online) and again whenever the
 * browser regains connectivity. Safe to call more than once — only wires listeners once. */
export function wireAutoSync(): void {
  if (typeof window === 'undefined') return;

  if (!bootWired) {
    bootWired = true;
    window.addEventListener('online', () => {
      syncNow();
    });
  }

  if (navigator.onLine) {
    syncNow();
  }
}

export type SyncStatus = 'synced' | 'syncing' | 'offline';

/** Lightweight status for a small UI indicator — derives from navigator.onLine and whether
 * a sync is currently in flight. No polling; updates on browser online/offline events and
 * on syncNow() start/end. */
export function getSyncStatus(): SyncStatus {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  return inFlight ? 'syncing' : 'synced';
}

export function onSyncStatusChange(listener: (status: SyncStatus) => void): () => void {
  const notifySyncing = () => listener(getSyncStatus());
  const unsubscribe = onSyncStateChange(notifySyncing);
  window.addEventListener('online', notifySyncing);
  window.addEventListener('offline', notifySyncing);
  return () => {
    unsubscribe();
    window.removeEventListener('online', notifySyncing);
    window.removeEventListener('offline', notifySyncing);
  };
}
