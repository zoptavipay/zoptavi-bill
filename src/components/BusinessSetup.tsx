import { useState } from 'react';
import type { StoreSettings } from '../types';
import './BusinessSetup.css';

interface BusinessSetupProps {
  initial: StoreSettings;
  onDone: (settings: StoreSettings) => void | Promise<void>;
  saving?: boolean;
  saveError?: string | null;
}

export default function BusinessSetup({ initial, onDone, saving, saveError }: BusinessSetupProps) {
  const [form, setForm] = useState<StoreSettings>({ ...initial, storeName: initial.storeName === 'My Store' ? '' : initial.storeName });
  const canContinue = form.storeName.trim().length > 0;

  return (
    <div className="setup-screen">
      <div className="setup-card">
        <span className="setup-eyebrow">Welcome to Zoptavi Tab</span>
        <h1>Let's set up your store</h1>
        <p className="setup-intro">
          A few details for your invoices — GSTIN and address are optional if you're not GST-registered
          yet, but the store name is needed before you can start billing.
        </p>

        <label>
          Store name *
          <input
            value={form.storeName}
            onChange={(e) => setForm({ ...form, storeName: e.target.value })}
            placeholder="e.g. Sharma General Store"
            autoFocus
          />
        </label>
        <label>
          Address
          <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Shop no., street, city" />
        </label>
        <label>
          GSTIN (optional)
          <input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} placeholder="22AAAAA0000A1Z5" />
        </label>
        <label>
          Phone
          <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="10-digit mobile number" />
        </label>
        <label>
          Invoice number prefix
          <input value={form.invoicePrefix} onChange={(e) => setForm({ ...form, invoicePrefix: e.target.value.toUpperCase() })} />
        </label>
        <label>
          Bill printer
          <select value={form.thermalWidth} onChange={(e) => setForm({ ...form, thermalWidth: e.target.value as StoreSettings['thermalWidth'] })}>
            <option value="58mm">58mm thermal</option>
            <option value="80mm">80mm thermal</option>
            <option value="a4">A4 / browser print</option>
          </select>
        </label>

        {saveError && <p className="setup-error">{saveError}</p>}

        <button
          className="btn-solid"
          disabled={!canContinue || !!saving}
          onClick={() => onDone({ ...form, onboarded: true })}
        >
          {saving ? 'Saving…' : 'Start billing'}
        </button>
      </div>
    </div>
  );
}
