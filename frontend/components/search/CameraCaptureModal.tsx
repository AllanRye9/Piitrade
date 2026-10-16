'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTr } from '@/lib/i18n/useTr';

/**
 * In-page camera for "search by photo" on devices without a native
 * capture flow (desktops / laptops). Phones and tablets skip this and use
 * <input capture="environment"> instead, which opens the OS camera.
 *
 * - Asks for the rear camera first (ideal), falls back to whatever exists.
 * - Always stops every media track on close/unmount (camera light goes off).
 * - Captured frame is downscaled (longest edge 1600px) and returned as a JPEG
 *   File, so it goes through the exact same pipeline as an uploaded photo.
 */

const MAX_EDGE = 1600;

interface CameraCaptureModalProps {
  onCapture: (file: File) => void;
  onClose: () => void;
  /** Shown when the camera is unavailable/blocked, or as a secondary action. */
  onUploadInstead: () => void;
}

type Facing = 'environment' | 'user';

export default function CameraCaptureModal({ onCapture, onClose, onUploadInstead }: CameraCaptureModalProps) {
  const tr = useTr();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const shutterRef = useRef<HTMLButtonElement>(null);
  const [facing, setFacing] = useState<Facing>('environment');
  const [ready, setReady] = useState(false);
  const [canFlip, setCanFlip] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // (Re)start the camera whenever the requested facing mode changes.
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError(null);
    stopStream();

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(tr('Your browser cannot open the camera. Please upload a photo instead.'));
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => { /* autoplay is allowed for muted inline video; ignore races */ });
        }
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          if (!cancelled) setCanFlip(devices.filter((d) => d.kind === 'videoinput').length > 1);
        } catch { /* flip button simply stays hidden */ }
      } catch (err) {
        if (cancelled) return;
        const name = (err as DOMException)?.name;
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          setError(tr('Camera access was blocked. Allow the camera in your browser settings, or upload a photo instead.'));
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          setError(tr('No camera was found on this device. You can upload a photo instead.'));
        } else {
          setError(tr('Could not start the camera. You can upload a photo instead.'));
        }
      }
    })();

    return () => { cancelled = true; stopStream(); };
    // tr is stable per language; re-running on it would needlessly restart the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing, stopStream]);

  // Escape closes; background scroll is locked while the dialog is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  useEffect(() => { if (ready) shutterRef.current?.focus(); }, [ready]);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) { setError(tr('Could not capture the photo. Please try again.')); return; }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) { setError(tr('Could not capture the photo. Please try again.')); return; }
      stopStream();
      onCapture(new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.9);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-0 backdrop-blur-sm sm:p-6"
      role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tr('Take a photo')}
        className="relative flex h-full w-full flex-col overflow-hidden bg-black sm:h-auto sm:max-w-lg sm:rounded-3xl sm:shadow-2xl sm:ring-1 sm:ring-white/10"
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
          <div className="min-w-0">
            <p className="text-sm font-semibold">{tr('Take a photo')}</p>
            <p className="truncate text-xs text-white/70">{tr('Point at the item you want to find')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={tr('Close camera')}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="relative min-h-0 flex-1 bg-neutral-900 sm:aspect-[4/3] sm:flex-none">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            onLoadedMetadata={() => setReady(true)}
            className={`h-full w-full object-cover ${facing === 'user' ? '-scale-x-100' : ''} ${error ? 'invisible' : ''}`}
          />
          {!ready && !error && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70" role="status">
              <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden="true" />
              {tr('Starting camera…')}
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center" role="alert">
              <p className="text-sm text-white/90">{error}</p>
              <button
                type="button"
                onClick={onUploadInstead}
                className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-100"
              >
                {tr('Upload a photo')}
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-4">
          <button
            type="button"
            onClick={onUploadInstead}
            className="rounded-full px-3 py-2 text-xs font-semibold text-white/80 transition-colors hover:bg-white/10 hover:text-white"
          >
            {tr('Upload instead')}
          </button>
          <button
            ref={shutterRef}
            type="button"
            onClick={capture}
            disabled={!ready || !!error}
            aria-label={tr('Capture photo')}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-white/20 ring-4 ring-white transition-transform hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
          >
            <span className="h-12 w-12 rounded-full bg-white" />
          </button>
          <div className="flex w-[4.5rem] justify-end">
            {canFlip && !error && (
              <button
                type="button"
                onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}
                aria-label={tr('Switch camera')}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M4 7h3l1.5-2h7L17 7h3a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V8a1 1 0 011-1z" /><path strokeLinecap="round" strokeLinejoin="round" d="M9 13a3 3 0 015.2-2M15 13a3 3 0 01-5.2 2" /></svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
