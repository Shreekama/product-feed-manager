'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

interface User {
  email: string;
  name: string;
}

interface AuthState {
  checking: boolean;
  authenticated: boolean;
  user: User | null;
}

// ── PKCE helpers ──────────────────────────────────────────────────────────────
function genVerifier(): string {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...Array.from(a)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function genChallenge(v: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v));
  return btoa(String.fromCharCode(...Array.from(new Uint8Array(h))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function genState(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}

// ── Inner component (uses useSearchParams — must be inside Suspense) ──────────
function AuthOverlayInner({ onAuth }: { onAuth: (user: User) => void }) {
  const searchParams = useSearchParams();
  const [state, setState] = useState<AuthState>({ checking: true, authenticated: false, user: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/status');
      const data = await res.json() as any;
      if (data.authenticated) {
        setState({ checking: false, authenticated: true, user: data.user });
        onAuth(data.user);
      } else {
        setState({ checking: false, authenticated: false, user: null });
      }
    } catch {
      setState({ checking: false, authenticated: false, user: null });
    }
  }, [onAuth]);

  // Handle OAuth callback (Microsoft redirects back with ?code=)
  useEffect(() => {
    const code = searchParams.get('code');
    const returnedState = searchParams.get('state');

    if (code) {
      const storedState = sessionStorage.getItem('sk_oauth_state');
      const codeVerifier = sessionStorage.getItem('sk_code_verifier');
      sessionStorage.removeItem('sk_oauth_state');
      sessionStorage.removeItem('sk_code_verifier');

      // Clear query params from URL
      window.history.replaceState({}, '', window.location.pathname);

      if (returnedState !== storedState) {
        setState({ checking: false, authenticated: false, user: null });
        setError('Security check failed. Please try again.');
        return;
      }

      // Exchange code for session
      fetch('/api/auth/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, codeVerifier }),
      })
        .then(r => r.json())
        .then((data: any) => {
          if (data.ok) {
            setState({ checking: false, authenticated: true, user: data.user });
            onAuth(data.user);
          } else {
            setState({ checking: false, authenticated: false, user: null });
            setError(data.error || 'Authentication failed. Please try again.');
          }
        })
        .catch(() => {
          setState({ checking: false, authenticated: false, user: null });
          setError('Authentication failed. Please try again.');
        });
    } else {
      checkStatus();
    }
  }, [searchParams, checkStatus, onAuth]);

  const initiateLogin = async () => {
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/config');
      if (!res.ok) throw new Error('Auth service unavailable');
      const config = await res.json() as any;

      if (!config.clientId || !config.tenantId) {
        throw new Error('Auth not configured — ENTRA_CLIENT_ID and ENTRA_TENANT_ID must be set.');
      }

      const verifier = genVerifier();
      const challenge = await genChallenge(verifier);
      const oauthState = genState();

      sessionStorage.setItem('sk_code_verifier', verifier);
      sessionStorage.setItem('sk_oauth_state', oauthState);

      const redirect = encodeURIComponent(window.location.origin + '/');
      window.location.href =
        `${config.authUrl}/${config.tenantId}/oauth2/v2.0/authorize` +
        `?client_id=${config.clientId}` +
        `&response_type=code` +
        `&redirect_uri=${redirect}` +
        `&response_mode=query` +
        `&scope=openid%20profile%20email` +
        `&state=${oauthState}` +
        `&code_challenge=${challenge}` +
        `&code_challenge_method=S256`;
    } catch (e: any) {
      setError(e.message);
      setLoading(false);
    }
  };

  // Still checking session — show nothing (avoids flash)
  if (state.checking) return null;

  // Already authenticated — don't render the overlay
  if (state.authenticated) return null;

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        {/* Shreekama logo — permanent, do not change */}
        <div style={{ marginBottom: 28 }}>
          <img
            src="https://www.shreekama.com/cdn/shop/files/Shreekama_logo_Light.png"
            alt="Shreekama"
            style={{ display: 'block', width: 160, height: 'auto', margin: '0 auto', filter: 'brightness(1.1)' }}
          />
        </div>

        <h1 style={styles.headline}>Product Feed Manager</h1>
        <p style={styles.body}>Sign in with your Microsoft account to continue.</p>

        <button
          onClick={initiateLogin}
          disabled={loading}
          style={{ ...styles.msBtn, opacity: loading ? 0.6 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}
        >
          {/* Microsoft Windows 4-colour logo */}
          <svg width="20" height="20" viewBox="0 0 21 21" fill="none" aria-hidden="true">
            <rect x="1"  y="1"  width="9" height="9" fill="#F25022"/>
            <rect x="11" y="1"  width="9" height="9" fill="#7FBA00"/>
            <rect x="1"  y="11" width="9" height="9" fill="#00A4EF"/>
            <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
          </svg>
          <span>{loading ? 'Redirecting…' : 'Continue with Microsoft'}</span>
        </button>

        {error && (
          <div style={styles.errorBox}>
            {error}
          </div>
        )}

        <p style={styles.hint}>Protected by Microsoft Entra ID</p>
      </div>
    </div>
  );
}

// ── Inline styles (mirrors the reference CSS tokens exactly) ──────────────────
const styles = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    zIndex: 999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: `
      radial-gradient(ellipse at 30% 50%, rgba(255,255,255,0.07) 0%, transparent 60%),
      radial-gradient(circle, rgba(255,255,255,0.10) 1px, transparent 1px),
      linear-gradient(135deg, #631664 0%, #8e4ba8 100%)
    `,
    backgroundSize: 'auto, 26px 26px, 100% 100%',
  },
  card: {
    background: 'rgba(25, 0, 30, 0.78)',
    backdropFilter: 'blur(40px)',
    WebkitBackdropFilter: 'blur(40px)',
    border: '1px solid rgba(255,255,255,0.18)',
    borderRadius: 24,
    boxShadow: '0 24px 80px rgba(0,0,0,0.50), inset 0 0 0 1px rgba(255,255,255,0.06)',
    padding: '48px 44px',
    maxWidth: 400,
    width: '90%',
    textAlign: 'center' as const,
    animation: 'pfm-fadeUp 0.6s cubic-bezier(0.4, 0, 0.2, 1) both',
  },
  headline: {
    fontFamily: "'Cormorant Garamond', Georgia, serif",
    fontSize: 32,
    fontWeight: 300,
    lineHeight: 1.2,
    color: '#ffffff',
    marginBottom: 12,
  },
  body: {
    fontSize: 15,
    fontWeight: 300,
    color: 'rgba(255,255,255,0.70)',
    marginBottom: 28,
    fontFamily: "'DM Sans', system-ui, sans-serif",
  },
  msBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    width: '100%',
    padding: '13px 24px',
    background: '#ffffff',
    color: '#1e1e1e',
    border: 'none',
    borderRadius: 12,
    fontFamily: "'DM Sans', system-ui, sans-serif",
    fontSize: 15,
    fontWeight: 500,
    boxShadow: '0 2px 16px rgba(0,0,0,0.30)',
    transition: 'transform 0.15s ease, box-shadow 0.15s ease',
  },
  errorBox: {
    marginTop: 12,
    padding: '10px 14px',
    background: 'rgba(232,85,85,0.12)',
    border: '1px solid rgba(232,85,85,0.25)',
    borderRadius: 8,
    color: '#ff9999',
    fontSize: 13,
    textAlign: 'left' as const,
    fontFamily: "'DM Sans', system-ui, sans-serif",
  },
  hint: {
    marginTop: 14,
    fontSize: 13,
    color: 'rgba(255,255,255,0.50)',
    fontFamily: "'DM Sans', system-ui, sans-serif",
  },
};

// ── Public export: wrapped in Suspense ────────────────────────────────────────
export function AuthOverlay({ onAuth }: { onAuth: (user: User) => void }) {
  return (
    <Suspense fallback={null}>
      <AuthOverlayInner onAuth={onAuth} />
    </Suspense>
  );
}
