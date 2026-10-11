'use client';

import { useState } from 'react';
import { QrScanner } from './QrScanner';
import { parseDeliveryQr } from '@/lib/deliveryQr';

interface Props {
  orderNumber: string;
  /** Resolves to an error message to show, or null when delivery was confirmed. */
  onSubmit: (code: string) => Promise<string | null>;
  onClose: () => void;
}

/** Seller confirms handover by scanning the customer's QR or typing their 6-digit code. */
export function DeliveryConfirmModal({ orderNumber, onSubmit, onClose }: Props) {
  const [code, setCode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (value: string) => {
    setBusy(true);
    setError('');
    const err = await onSubmit(value);
    setBusy(false);
    if (err) setError(err);
    else onClose();
  };

  const handleScan = (text: string) => {
    setScanning(false);
    const parsed = parseDeliveryQr(text);
    if (!parsed) {
      setError('That QR code is not a Piitrade delivery code.');
      return;
    }
    // Catch "scanned the wrong customer" here, so it does not burn one of the 5 attempts.
    if (parsed.orderNumber && parsed.orderNumber !== orderNumber) {
      setError(`This QR belongs to a different order (${parsed.orderNumber}). Ask the customer to open order ${orderNumber}.`);
      return;
    }
    setCode(parsed.code);
    void submit(parsed.code);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="dcm-title">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl space-y-4">
        <div>
          <h2 id="dcm-title" className="text-lg font-bold text-gray-900">Confirm delivery</h2>
          <p className="mt-1 text-sm text-gray-600">
            Ask the customer for the delivery code on their order page <strong>{orderNumber}</strong> — scan their QR or type the 6 digits.
            Only confirm once they have the item.
          </p>
        </div>

        {scanning ? (
          <QrScanner onResult={handleScan} onClose={() => setScanning(false)} />
        ) : (
          <>
            <button
              type="button"
              onClick={() => { setError(''); setScanning(true); }}
              className="w-full rounded-xl bg-gray-900 py-3 text-sm font-semibold text-white hover:bg-black"
            >
              📷 Scan customer&apos;s QR
            </button>

            <div className="flex items-center gap-3 text-xs text-gray-400" aria-hidden>
              <span className="h-px flex-1 bg-gray-200" /> or type the code <span className="h-px flex-1 bg-gray-200" />
            </div>

            <label className="block">
              <span className="sr-only">6-digit delivery code</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^\d\s-]/g, '').slice(0, 7))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000 000"
                className="w-full rounded-xl border border-gray-300 px-4 py-3 text-center text-2xl font-bold tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </label>
          </>
        )}

        {error && <p role="alert" className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</p>}

        {!scanning && (
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-gray-300 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50">
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || code.replace(/\D/g, '').length !== 6}
              onClick={() => submit(code)}
              className="flex-1 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy ? 'Confirming…' : 'Confirm delivery'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
