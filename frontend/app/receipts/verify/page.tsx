'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiErrorMessage, formatMomoAmount, verifyReceiptCode, type ReceiptCheck } from '@/lib/momo';

function VerifyReceipt() {
  const params = useSearchParams();
  const [code, setCode] = useState(params.get('code') ?? '');
  const [result, setResult] = useState<ReceiptCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const check = async (value: string) => {
    if (!value.trim()) return;
    setBusy(true); setError(''); setResult(null);
    try { setResult(await verifyReceiptCode(value.trim())); }
    catch (e) { setError(apiErrorMessage(e, 'We could not check that code right now. Please try again.')); }
    finally { setBusy(false); }
  };
  // Check once on load when the page was opened from a receipt link (?code=…).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { const c = params.get('code'); if (c) void check(c); }, []);

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-8">
      <h1 className="text-xl font-extrabold text-gray-900">Verify a Piitrade receipt</h1>
      <p className="mt-1 text-sm text-gray-600">Enter the receipt tracking code printed on the PDF (it looks like <span className="font-mono">PTR-7K2M-9QXA-4D8H</span>).</p>

      <div className="mt-4 flex gap-2">
        <input
          value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void check(code); }}
          placeholder="PTR-XXXX-XXXX-XXXX" aria-label="Receipt tracking code" autoCapitalize="characters" spellCheck={false}
          className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2.5 font-mono text-base uppercase tracking-wide focus:outline-none focus:ring-2 focus:ring-red-300 sm:text-sm"
        />
        <button type="button" onClick={() => check(code)} disabled={busy || !code.trim()} className="rounded-xl bg-red-600 px-4 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50">
          {busy ? 'Checking…' : 'Check'}
        </button>
      </div>

      <div aria-live="polite" className="mt-4">
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {result && result.valid && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4" data-testid="verify-valid">
            <p className="text-sm font-extrabold text-emerald-800">✓ Genuine receipt{result.isTest ? ' (TEST payment: no real money)' : ''}</p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-gray-500">Code</dt><dd className="font-mono font-bold text-gray-900">{result.receiptNumber}</dd>
              <dt className="text-gray-500">For</dt><dd className="font-semibold text-gray-900">{result.item}</dd>
              <dt className="text-gray-500">Amount</dt><dd className="font-semibold text-gray-900">{formatMomoAmount(result.currency, result.amount)}</dd>
              <dt className="text-gray-500">Issued</dt><dd className="text-gray-900">{new Date(result.issuedAt).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' })}</dd>
              <dt className="text-gray-500">Status</dt><dd className="font-bold text-emerald-700">PAID</dd>
            </dl>
          </div>
        )}
        {result && !result.valid && (
          <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700" data-testid="verify-invalid">
            ✗ We could not find a receipt with that code. Check it for typing mistakes (the code never contains the digits 0 or 1, or the letters O, I or L).
          </p>
        )}
      </div>
    </main>
  );
}

export default function VerifyReceiptPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-lg px-4 py-8 text-sm text-gray-500">Loading…</main>}>
      <VerifyReceipt />
    </Suspense>
  );
}
