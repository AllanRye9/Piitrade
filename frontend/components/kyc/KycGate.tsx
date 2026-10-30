'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

export type KycStatus = 'NOT_SUBMITTED' | 'PENDING' | 'APPROVED' | 'REJECTED';

/**
 * KYC state for gating Merchant / Partner flows.
 *  blocked  — nothing usable on file yet (never submitted, or rejected): the user must complete the form first.
 *  pending  — submitted, awaiting review: they may apply, but activation waits for approval.
 */
export function useKycStatus(enabled: boolean) {
  const [status, setStatus] = useState<KycStatus | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    api.get('/kyc/status')
      .then(({ data }) => { if (alive) setStatus((data?.kycStatus as KycStatus) ?? 'NOT_SUBMITTED'); })
      .catch(() => { if (alive) setStatus(null); });
    return () => { alive = false; };
  }, [enabled]);
  return {
    status,
    loaded: status !== null,
    blocked: status === 'NOT_SUBMITTED' || status === 'REJECTED',
    pending: status === 'PENDING',
    approved: status === 'APPROVED',
  };
}

export function KycBanner({ status, purpose }: { status: KycStatus | null; purpose: 'webstore' | 'partner' }) {
  if (!status) return null;
  const href = `/profile/verification?for=${purpose}`;
  const noun = purpose === 'webstore' ? 'Merchant account' : 'partner';
  if (status === 'APPROVED') {
    return <p className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">✅ Identity verified (KYC). You&rsquo;re cleared for a {noun}.</p>;
  }
  if (status === 'PENDING') {
    return <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">⏳ Your KYC documents are under review. A {noun} can be activated only once they are approved.</p>;
  }
  return (
    <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <p className="font-semibold">{status === 'REJECTED' ? 'Your KYC verification was rejected.' : 'KYC verification is required.'}</p>
      <p className="mt-0.5 text-xs">A {noun} must pass KYC: a short business form and a document upload.</p>
      <Link href={href} className="mt-2 inline-block rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700">
        {status === 'REJECTED' ? 'Resubmit verification →' : 'Complete verification →'}
      </Link>
    </div>
  );
}
