'use client';

/**
 * PhotoMismatchModal — shown when the posting form's image detector thinks one or more photos do
 * not show the same item as the seller's first photo.
 *
 * It lays the photos out side by side (first photo as the reference, flagged photos below) so the
 * seller can see exactly what was flagged, and asks them to decide before the listing goes to the
 * review step: remove the flagged photos, go back and edit, or confirm the photos are correct.
 * The detector is a heuristic, so "they are correct" is always available — it informs, it does
 * not block.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { resolveImageUrl } from '@/lib/utils';

export interface PhotoMismatchModalProps {
  /** The first photo, used as the reference the others were compared against. */
  referenceSrc: string;
  /** Photos the detector flagged, as stored in the form (resolved for display here). */
  flaggedSrcs: string[];
  /** Remove every flagged photo and return to the form. */
  onRemoveFlagged: () => void;
  /** Close and go back to the form without changing anything. */
  onGoBack: () => void;
  /** Seller confirms the photos belong to this listing: continue to the review step. */
  onConfirmContinue: () => void;
  /**
   * 'input'  — shown right after photos were added: confirming keeps the photos.
   * 'submit' — shown when the seller presses Post: confirming continues to the review step.
   */
  mode?: 'input' | 'submit';
  /** Which listing the photos belong to when a form has several, e.g. "Product 2". */
  context?: string;
}

function Thumb({ src, alt, onZoom, tone }: { src: string; alt: string; onZoom?: (s: string) => void; tone: 'ref' | 'flag' }) {
  const ring = tone === 'ref' ? 'border-emerald-300' : 'border-red-300';
  return (
    <button
      type="button"
      onClick={() => onZoom?.(src)}
      className={`group relative aspect-square w-full overflow-hidden rounded-xl border-2 bg-gray-50 ${ring}`}
      aria-label={`Zoom into ${alt}`}
    >
      <Image src={resolveImageUrl(src)} alt={alt} fill unoptimized className="object-cover transition-transform duration-200 group-hover:scale-105" />
      <span
        className={`absolute left-0 top-0 rounded-br-lg px-1.5 py-0.5 text-[10px] font-extrabold text-white ${tone === 'ref' ? 'bg-emerald-600/95' : 'bg-red-600/95'}`}
      >
        {tone === 'ref' ? 'FIRST PHOTO' : '⚠ NO MATCH'}
      </span>
    </button>
  );
}

export function PhotoMismatchModal({ referenceSrc, flaggedSrcs, onRemoveFlagged, onGoBack, onConfirmContinue, mode = 'submit', context }: PhotoMismatchModalProps) {
  const [zoomed, setZoomed] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (zoomed) setZoomed(null); else onGoBack(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onGoBack, zoomed]);

  const many = flaggedSrcs.length > 1;

  // Rendered into <body> so no parent stacking context (page sections, the mobile bottom nav at
  // z-50) can ever sit on top of the popup's buttons.
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" onClick={onGoBack}>
      <div
        role="alertdialog" aria-modal="true" aria-labelledby="photo-mismatch-title" aria-describedby="photo-mismatch-desc"
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-2xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xl" aria-hidden="true">⚠️</span>
          <div className="min-w-0">
            <h2 id="photo-mismatch-title" className="text-lg font-bold text-gray-900">
              {many ? `${flaggedSrcs.length} photos may not match your item` : 'A photo may not match your item'}
            </h2>
            <p id="photo-mismatch-desc" className="mt-0.5 text-sm text-gray-600">
              Our photo check found {many ? 'photos that do' : 'a photo that does'}n&apos;t look like the same item as your first photo.
              Please look at {many ? 'them' : 'it'} and confirm {mode === 'input' ? 'before you go on' : 'before you post'}. Listings with unrelated photos can be rejected by our reviewers.
            </p>
          </div>
        </div>

        {context && <p className="mb-1 text-xs font-bold uppercase tracking-wide text-amber-700">{context}</p>}
        <p className="mb-1.5 text-xs font-semibold text-gray-700">
          Your first photo (left) compared with {many ? `the ${flaggedSrcs.length} flagged photos` : 'the flagged photo'}
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Thumb src={referenceSrc} alt="your first photo" onZoom={setZoomed} tone="ref" />
          {flaggedSrcs.map((src, i) => (
            <Thumb key={src} src={src} alt={`flagged photo ${i + 1}`} onZoom={setZoomed} tone="flag" />
          ))}
        </div>

        <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-[11px] leading-snug text-gray-500">
          The check compares what each photo shows, so a different angle or a close-up of an accessory can occasionally be flagged by mistake.
          Tap a photo to zoom in.
        </p>

        <div className="mt-4 flex flex-col gap-2">
          <button type="button" onClick={onRemoveFlagged} className="w-full rounded-xl bg-red-600 py-2.5 text-sm font-bold text-white hover:bg-red-700">
            Remove {many ? 'flagged photos' : 'this photo'}
          </button>
          <button type="button" onClick={onConfirmContinue} className="w-full rounded-xl border-2 border-gray-200 bg-white py-2.5 text-sm font-bold text-gray-800 hover:bg-gray-50">
            {many ? 'These photos are correct' : 'This photo is correct'} — {mode === 'input' ? 'keep' : 'continue'}
          </button>
          <button type="button" onClick={onGoBack} className="w-full rounded-xl py-2 text-sm font-medium text-gray-500 hover:text-gray-800">
            Go back and review photos
          </button>
        </div>
      </div>

      {zoomed && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4"
          onClick={(e) => { e.stopPropagation(); setZoomed(null); }}
        >
          <button
            type="button" aria-label="Close zoomed photo" onClick={() => setZoomed(null)}
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={resolveImageUrl(zoomed)} alt="Zoomed photo" className="max-h-full max-w-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>,
    document.body
  );
}
