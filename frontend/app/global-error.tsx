'use client';

import { useEffect } from 'react';

// This replaces the entire root layout (including <html>/<body>) when an
// error is thrown from app/layout.tsx itself — e.g. a provider crashing
// during render — which app/error.tsx cannot catch since it renders inside
// that same layout. Kept dependency-free on purpose.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Unhandled global error:', error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '2rem',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.75rem', color: '#111827' }}>
            Something went wrong
          </h1>
          <p style={{ color: '#6b7280', maxWidth: '28rem', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
            Piitrade hit an unexpected error. Please try again.
          </p>
          <button
            onClick={() => reset()}
            style={{
              padding: '0.625rem 1.25rem',
              background: '#0284c7',
              color: '#fff',
              fontWeight: 600,
              fontSize: '0.875rem',
              borderRadius: '0.75rem',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Try Again
          </button>
        </div>
      </body>
    </html>
  );
}
