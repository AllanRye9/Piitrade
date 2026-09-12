'use client';

import { useEffect } from 'react';

export interface ContactSellerInfo {
  sellerName: string;
  /** Direct-call number. Falsy hides the Call Seller button. */
  phone?: string | null;
  /** WhatsApp contact — falls back to `phone` when not set separately, so
   *  most sellers (who only have one number) still get a working Chat
   *  button. Falsy (and no phone fallback) hides the Chat Seller button. */
  whatsapp?: string | null;
  listingTitle: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  contacts: ContactSellerInfo[];
  /** Shown above the contact card(s). Defaults to an explanation of why
   *  they're seeing this instead of an online checkout. */
  heading?: string;
  subheading?: string;
}

function waLink(number: string, listingTitle: string) {
  const digits = number.replace(/[^0-9]/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(`Hi, I'm interested in your listing: ${listingTitle}`)}`;
}

/**
 * ContactSellerModal
 *
 * Piitrade doesn't process card or bank-transfer payments for ordinary
 * buyers — that's an admin-only capability (see /checkout's role guard).
 * Everyone else arranges payment directly with the seller, so this modal
 * is what "Buy Now" (and the cart's "Proceed to Checkout") open instead of
 * navigating to the payment form. Motors and Property listings skip the
 * cart entirely and use these same Call/Chat buttons inline on the listing
 * page instead of Add to Cart/Buy Now (see ListingDetailClient).
 */
export default function ContactSellerModal({ open, onClose, contacts, heading, subheading }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-[2px] p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Contact seller"
    >
      <div
        className="w-full sm:max-w-sm bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white flex items-start justify-between gap-3 p-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-extrabold text-gray-900">{heading || 'Contact the Seller'}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {subheading || 'Piitrade puts you in touch directly — arrange payment and pickup or delivery with the seller.'}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-4 space-y-4">
          {contacts.map((c, i) => {
            const whatsappNumber = c.whatsapp || c.phone;
            if (!c.phone && !whatsappNumber) {
              return (
                <div key={i} className="rounded-xl border border-dashed border-gray-200 p-4 text-center">
                  <p className="text-sm font-semibold text-gray-700">{c.sellerName}</p>
                  <p className="text-xs text-gray-400 mt-1">No contact number on file for this seller yet.</p>
                </div>
              );
            }
            return (
              <div key={i} className="rounded-xl border border-gray-100 p-3.5">
                <p className="text-sm font-semibold text-gray-900 truncate">{c.sellerName}</p>
                <p className="text-xs text-gray-400 truncate mb-3">{c.listingTitle}</p>
                <div className="space-y-2">
                  {c.phone && (
                    <a
                      href={`tel:${c.phone}`}
                      className="flex items-center gap-2.5 p-3 rounded-xl bg-[#FFF4EC] border border-[#FFE1CC] hover:border-[#F55906] transition-all text-sm font-semibold text-[#F55906]"
                    >
                      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                      Call Seller — {c.phone}
                    </a>
                  )}
                  {whatsappNumber && (
                    <a
                      href={waLink(whatsappNumber, c.listingTitle)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2.5 p-3 rounded-xl bg-[#F0FDF4] border border-[#DCFCE7] hover:border-[#22C55E] transition-all text-sm font-semibold text-[#15803D]"
                    >
                      <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347zM11.99 2C6.477 2 2 6.477 2 12c0 1.778.465 3.45 1.28 4.9L2 22l5.237-1.257A9.956 9.956 0 0011.99 22C17.513 22 22 17.523 22 12c0-5.516-4.483-9.996-10.01-10z" /></svg>
                      Chat on WhatsApp
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
