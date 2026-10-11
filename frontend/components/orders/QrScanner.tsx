'use client';

import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

interface Props {
  /** Called once with the decoded text; the scanner stops itself afterwards. */
  onResult: (text: string) => void;
  onClose: () => void;
}

/**
 * Camera QR scanner (getUserMedia + jsQR). Needs HTTPS and camera permission;
 * if either is missing the user is told and can type the code instead.
 * Frames are decoded locally in the browser — no image leaves the device.
 */
export function QrScanner({ onResult, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    let last = 0;

    const stop = () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };

    const tick = (ts: number) => {
      if (stopped) return;
      raf = requestAnimationFrame(tick);
      if (ts - last < 120) return; // ~8 decodes/second is plenty and easy on phones
      last = ts;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2 || !video.videoWidth) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      if (hit && hit.data) {
        stop();
        onResult(hit.data);
      }
    };

    (async () => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setError('Camera scanning is not available here (it needs a secure https connection). Type the code instead.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        video.setAttribute('playsinline', 'true'); // iOS: keep inline instead of fullscreen
        await video.play();
        raf = requestAnimationFrame(tick);
      } catch (e) {
        const name = (e as { name?: string })?.name;
        setError(
          name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access, or type the code instead.'
          : name === 'NotFoundError' ? 'No camera was found. Type the code instead.'
          : 'Could not start the camera. Type the code instead.',
        );
      }
    })();

    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-3">
      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</p>
      ) : (
        <div className="relative overflow-hidden rounded-xl bg-black aspect-square">
          <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
          <div className="pointer-events-none absolute inset-8 rounded-xl border-2 border-white/80" aria-hidden />
        </div>
      )}
      <canvas ref={canvasRef} className="hidden" />
      <button type="button" onClick={onClose} className="w-full rounded-xl border border-gray-300 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
        {error ? 'Close' : 'Cancel scanning'}
      </button>
    </div>
  );
}
