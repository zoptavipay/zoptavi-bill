import { useEffect, useState } from 'react';
import BillingScreen from './components/BillingScreen';
import SignIn from './components/SignIn';
import StorePicker from './components/StorePicker';
import { getActiveStoreId, isSignedIn } from './lib/auth';
import { getSettings } from './lib/db';
import type { StoreSettings } from './types';

type Phase = 'checking' | 'signin' | 'store-picker' | 'app';

function App() {
  const [phase, setPhase] = useState<Phase>('checking');
  const [localDefaults, setLocalDefaults] = useState<StoreSettings | null>(null);

  useEffect(() => {
    getSettings().then((settings) => {
      setLocalDefaults(settings);
      if (isSignedIn() && getActiveStoreId()) {
        // Already signed in with a store picked on this device — skip straight to
        // billing, preserving the offline-first "only log in once" experience.
        setPhase('app');
      } else if (isSignedIn()) {
        setPhase('store-picker');
      } else {
        setPhase('signin');
      }
    });
  }, []);

  if (phase === 'checking' || !localDefaults) {
    return <div className="billing-loading">Loading…</div>;
  }

  if (phase === 'signin') {
    return <SignIn onSignedIn={() => setPhase('store-picker')} />;
  }

  if (phase === 'store-picker') {
    return (
      <StorePicker
        localDefaults={localDefaults}
        onStoreSelected={() => setPhase('app')}
      />
    );
  }

  return <BillingScreen />;
}

export default App;
