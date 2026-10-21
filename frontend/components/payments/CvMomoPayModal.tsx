'use client';

/**
 * CV download payments over MTN MoMo.
 *
 * Replaces the CV pages' original "initiate then confirm in the browser" modal when MoMo is on.
 * The server creates the download token (priced from the admin-set CV package) and only marks it
 * paid after MTN confirms — the browser can no longer confirm a payment itself. Guests (no account)
 * pay with the token secret returned by /cv-payment/initiate, which also authorises status polling.
 */
import { api } from '@/lib/api';
import { MomoPayModal } from '@/components/payments/MomoPayModal';

interface Props {
  country: string;
  deviceId: string;
  /** Holder details the CV pages already send to /cv-payment/initiate. */
  holder: { name?: string; title?: string; email?: string; phone?: string };
  /** Display-only price (the server charges the admin-set package price). */
  price: { amount: string; currency: string };
  onPaid: (rawToken: string, tokenId: string) => void;
  onClose: () => void;
}

export function CvMomoPayModal({ country, deviceId, holder, price, onPaid, onClose }: Props) {
  return (
    <MomoPayModal
      title="CV download"
      amountLabel={`${price.currency} ${price.amount}`}
      defaultPhone={holder.phone}
      buildRequest={async () => {
        const { data } = await api.post('/cv-payment/initiate', { country, deviceId, holder });
        const { tokenId, rawToken } = data as { tokenId: string; rawToken: string };
        return { purpose: 'CV_DOWNLOAD', tokenId, rawToken };
      }}
      onCompleted={(_payment, request) => {
        if (request.rawToken && request.tokenId) onPaid(request.rawToken, request.tokenId);
      }}
      onClose={onClose}
    />
  );
}

/** Shown for the instant it takes to learn whether MoMo is on, so the old form never flashes up. */
export function MomoLoadingShell({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="rounded-2xl bg-white px-6 py-5 text-sm text-gray-600 shadow-2xl" role="status" onClick={(e) => e.stopPropagation()}>
        Loading payment options…
      </div>
    </div>
  );
}

/** MoMo is the only payment method; shown when it is switched off or misconfigured. */
export function MomoUnavailableModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-bold text-gray-900">Payments unavailable</h2>
        <p className="mt-2 text-sm text-gray-600">MTN Mobile Money payments are not available right now. Please try again later.</p>
        <button type="button" onClick={onClose} className="mt-4 w-full rounded-xl bg-gray-100 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-200">Close</button>
      </div>
    </div>
  );
}
