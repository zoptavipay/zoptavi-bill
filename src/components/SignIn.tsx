import { useEffect, useRef, useState } from 'react';
import { GOOGLE_CLIENT_ID, setSession, signInWithGoogle, type Owner } from '../lib/auth';
import './SignIn.css';

interface SignInProps {
  onSignedIn: (owner: Owner) => void;
}

// Minimal shape of what we use from Google Identity Services — the full types
// live in @types/google.accounts, which this project doesn't depend on.
interface GoogleIdCredentialResponse {
  credential: string;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: GoogleIdCredentialResponse) => void;
          }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
          prompt?: () => void;
        };
      };
    };
  }
}

let gsiScriptPromise: Promise<void> | null = null;

function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (gsiScriptPromise) return gsiScriptPromise;

  gsiScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load Google Sign-In script.')));
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Sign-In script.'));
    document.head.appendChild(script);
  });
  return gsiScriptPromise;
}

export default function SignIn({ onSignedIn }: SignInProps) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'signing-in' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function handleCredential(response: GoogleIdCredentialResponse) {
      setStatus('signing-in');
      setError(null);
      try {
        const { token, owner } = await signInWithGoogle(response.credential);
        setSession(token, owner);
        onSignedIn(owner);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.');
        setStatus('error');
      }
    }

    setStatus('loading');
    setError(null);
    loadGoogleScript()
      .then(() => {
        if (cancelled) return;
        if (!window.google?.accounts?.id) {
          throw new Error('Google Sign-In is unavailable right now.');
        }
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleCredential,
        });
        if (buttonRef.current) {
          buttonRef.current.innerHTML = '';
          // Cap at 320 (Google's max) but shrink to fit narrow phone screens instead of
          // overflowing the card — offsetWidth reflects the card's actual available width.
          const width = Math.max(220, Math.min(320, buttonRef.current.offsetWidth || 320));
          window.google.accounts.id.renderButton(buttonRef.current, {
            type: 'standard',
            theme: 'outline',
            size: 'large',
            text: 'signin_with',
            shape: 'pill',
            width,
          });
        }
        setStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load Google Sign-In.');
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [retryCount, onSignedIn]);

  return (
    <div className="setup-screen">
      <div className="setup-card signin-card">
        <span className="setup-eyebrow">Welcome to Zoptavi Tab</span>
        <h1>Sign in to get started</h1>
        <p className="setup-intro">
          Sign in with Google to sync your store across devices. The app still works fully offline
          after you sign in once — billing, stock, and receipts never need an internet connection.
        </p>

        <div className="signin-button-wrap">
          <div ref={buttonRef} />
          {status === 'loading' && <p className="empty-hint">Loading Google Sign-In…</p>}
          {status === 'signing-in' && <p className="empty-hint">Signing you in…</p>}
        </div>

        {status === 'error' && error && (
          <div className="signin-error">
            <p>{error}</p>
            <button className="btn-ghost" onClick={() => setRetryCount((c) => c + 1)}>
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
