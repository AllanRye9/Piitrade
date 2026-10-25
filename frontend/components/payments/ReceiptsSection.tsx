'use client';

/**
 * Profile → Payment receipts. Every completed mobile-money payment keeps its digital receipt here:
 * the unique tracking code, the amount, and a PDF the payer can download or have emailed again.
 */
import { useCallback, useEffect, useState } from 'react';
import { apiErrorMessage, downloadReceiptPdf, emailReceiptAgain, fetchMyReceipts, formatMomoAmount, type MomoReceipt } from '@/lib/momo';

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function ReceiptsSection() {
  const [receipts, setReceipts] = useState<MomoReceipt[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setReceipts(await fetchMyReceipts()); setError(''); }
    catch (e) { setError(apiErrorMessage(e, 'We could not load your receipts. Please refresh the page.')); setReceipts([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setNote(''); setError('');
    try { await fn(); } catch (e) { setError(apiErrorMessage(e, 'That did not work. Please try again.')); } finally { setBusy(null); }
  };

  return (
    <div id="receipts" className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden scroll-mt-24">
      <div className="flex items-center justify-between px-3 sm:px-4 py-2.5 border-b border-gray-100">
        <h2 className="font-bold text-gray-900 flex items-center gap-2">
          <span className="w-2 h-5 bg-emerald-500 rounded-full inline-block" />
          Payment receipts
        </h2>
        <a href="/receipts/verify" className="text-xs font-semibold text-red-600 hover:text-red-700">Verify a receipt →</a>
      </div>

      <div className="p-3 sm:p-4">
        {receipts === null && <p className="text-sm text-gray-500">Loading your receipts…</p>}
        {error && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">{error}</p>}
        {note && <p className="mb-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800" role="status">{note}</p>}
        {receipts && receipts.length === 0 && !error && (
          <p className="text-sm text-gray-500">No receipts yet. When you pay with Mobile Money, your receipt appears here and is emailed to you.</p>
        )}

        {receipts && receipts.length > 0 && (
          <ul className="divide-y divide-gray-100">
            {receipts.map((r) => (
              <li key={r.paymentId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-gray-900">
                    {r.item}
                    {r.isTest && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 align-middle text-[10px] font-bold text-amber-800">TEST</span>}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">{when(r.issuedAt)} · <b className="text-gray-800">{formatMomoAmount(r.currency, r.amount)}</b></p>
                  <p className="mt-0.5 flex items-center gap-2 text-xs">
                    <span className="select-all font-mono font-bold tracking-wide text-emerald-800">{r.receiptNumber}</span>
                    <button
                      type="button"
                      className="text-[11px] font-medium text-gray-500 hover:text-gray-800"
                      onClick={async () => { try { await navigator.clipboard.writeText(r.receiptNumber); setCopied(r.receiptNumber); setTimeout(() => setCopied(null), 1500); } catch { /* clipboard blocked */ } }}
                    >
                      {copied === r.receiptNumber ? 'Copied ✓' : 'Copy'}
                    </button>
                    <span className={r.emailed ? 'text-emerald-600' : 'text-gray-400'}>{r.emailed ? '✉ Emailed' : '✉ Not emailed yet'}</span>
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button" disabled={busy !== null}
                    onClick={() => run(`pdf-${r.paymentId}`, () => downloadReceiptPdf(r.paymentId, r.receiptNumber))}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {busy === `pdf-${r.paymentId}` ? 'Preparing…' : '⬇ PDF'}
                  </button>
                  <button
                    type="button" disabled={busy !== null}
                    onClick={() => run(`mail-${r.paymentId}`, async () => {
                      const sent = await emailReceiptAgain(r.paymentId);
                      setNote(sent ? 'Receipt emailed to the address on your account.' : 'There is no email address on your account.');
                      await load();
                    })}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {busy === `mail-${r.paymentId}` ? 'Sending…' : '✉ Email me'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
