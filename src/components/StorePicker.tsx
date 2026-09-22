import { useEffect, useState } from 'react';
import type { StoreSettings } from '../types';
import {
  createStore,
  fetchStores,
  remoteStoreToSettings,
  setActiveStoreId,
  type RemoteStore,
} from '../lib/auth';
import { saveSettings } from '../lib/db';
import BusinessSetup from './BusinessSetup';
import './StorePicker.css';

interface StorePickerProps {
  /** Local StoreSettings to prefill the "add new store" form with. */
  localDefaults: StoreSettings;
  onStoreSelected: (settings: StoreSettings) => void;
}

type Phase = 'loading' | 'error' | 'empty' | 'single' | 'multiple' | 'adding';

export default function StorePicker({ localDefaults, onStoreSelected }: StorePickerProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [stores, setStores] = useState<RemoteStore[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    setError(null);
    fetchStores()
      .then(async (list) => {
        if (cancelled) return;
        setStores(list);
        if (list.length === 0) {
          setPhase('empty');
        } else if (list.length === 1) {
          const settings = remoteStoreToSettings(list[0], localDefaults);
          setActiveStoreId(list[0].id);
          await saveSettings(settings);
          onStoreSelected(settings);
        } else {
          setPhase('multiple');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load your stores.');
        setPhase('error');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryCount]);

  async function selectStore(store: RemoteStore) {
    const settings = remoteStoreToSettings(store, localDefaults);
    setActiveStoreId(store.id);
    await saveSettings(settings);
    onStoreSelected(settings);
  }

  async function handleNewStore(settings: StoreSettings) {
    setSaving(true);
    setError(null);
    try {
      const created = await createStore(settings);
      setActiveStoreId(created.id);
      await saveSettings(settings);
      onStoreSelected(settings);
    } catch (err) {
      // Backend save failed — still let the shop keep billing offline with this store,
      // just without server sync for now. Save locally so they aren't blocked.
      await saveSettings(settings);
      setError(err instanceof Error ? err.message : 'Could not save this store online.');
      onStoreSelected(settings);
    } finally {
      setSaving(false);
    }
  }

  if (phase === 'loading' || phase === 'single') {
    return (
      <div className="setup-screen">
        <div className="setup-card">
          <p className="empty-hint">Loading your stores…</p>
        </div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="setup-screen">
        <div className="setup-card">
          <span className="setup-eyebrow">Zoptavi Tab</span>
          <h1>Couldn't load your stores</h1>
          <p className="setup-intro">{error}</p>
          <button className="btn-solid" onClick={() => setRetryCount((c) => c + 1)}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'empty' || phase === 'adding') {
    return (
      <BusinessSetup
        initial={localDefaults}
        onDone={handleNewStore}
        saving={saving}
        saveError={error}
      />
    );
  }

  // phase === 'multiple'
  return (
    <div className="setup-screen">
      <div className="setup-card store-picker-card">
        <span className="setup-eyebrow">Zoptavi Tab</span>
        <h1>Choose a store</h1>
        <p className="setup-intro">You have more than one store signed in — pick which one to bill from.</p>
        <div className="store-list">
          {stores.map((s) => (
            <button key={s.id} className="store-list-item" onClick={() => selectStore(s)}>
              <strong>{s.store_name || 'Untitled store'}</strong>
              {s.address && <span>{s.address}</span>}
            </button>
          ))}
        </div>
        <button className="btn-ghost store-add-btn" onClick={() => setPhase('adding')}>
          + Add new store
        </button>
      </div>
    </div>
  );
}
