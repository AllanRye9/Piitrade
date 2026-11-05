/**
 * Shrinks a photo ON THE PHONE before it is uploaded.
 *
 * A modern phone photo is 3–8 MB; on a weak or expensive mobile connection that is minutes of waiting,
 * a lot of data, and the main reason uploads fail. Resizing to a 1600 px long edge at ~80 % quality gives
 * 200–400 KB with no visible loss on a listing page, so uploads are roughly 10x faster and cheaper.
 *
 * Safe by design: this NEVER throws and never makes things worse. Anything it cannot handle (GIF, a
 * browser without canvas encoding, an already small file, a result that is not clearly smaller) is
 * returned unchanged, so the upload proceeds exactly as it did before.
 */
const MAX_EDGE = 1600;
const QUALITY = 0.8;
const SKIP_BELOW_BYTES = 250 * 1024;
const MIN_SAVING = 0.9; // keep the result only if it is at least 10 % smaller

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void } | null> {
  try {
    if (typeof createImageBitmap === 'function') {
      // imageOrientation: honour the EXIF rotation so portrait phone photos are not saved sideways.
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    }
  } catch { /* fall through to <img> */ }
  try {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('decode')); img.src = url; });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    return null;
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try { canvas.toBlob((b) => resolve(b), type, quality); } catch { resolve(null); }
  });
}

export async function compressImage(file: File): Promise<File> {
  try {
    if (typeof document === 'undefined') return file;
    if (!/^image\/(jpe?g|png|webp)$/i.test(file.type)) return file; // GIF/SVG/etc. are left alone
    if (file.size <= SKIP_BELOW_BYTES) return file;

    const decoded = await decode(file);
    if (!decoded) return file;
    const { source, width, height, close } = decoded;
    try {
      if (!width || !height) return file;
      const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
      const w = Math.max(1, Math.round(width * scale));
      const h = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return file;

      const isPng = /png/i.test(file.type);
      let blob: Blob | null;
      let outType: string;
      if (isPng) {
        // PNGs may have transparency, which JPEG would turn black: use WebP (keeps alpha) or leave as is.
        ctx.drawImage(source, 0, 0, w, h);
        blob = await toBlob(canvas, 'image/webp', QUALITY);
        if (!blob || blob.type !== 'image/webp') return file; // this browser cannot encode WebP
        outType = 'image/webp';
      } else {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(source, 0, 0, w, h);
        blob = await toBlob(canvas, 'image/jpeg', QUALITY);
        if (!blob || blob.type !== 'image/jpeg') return file;
        outType = 'image/jpeg';
      }
      if (blob.size >= file.size * MIN_SAVING) return file;

      const base = file.name.replace(/\.[^.]+$/, '') || 'photo';
      const ext = outType === 'image/webp' ? 'webp' : 'jpg';
      return new File([blob], `${base}.${ext}`, { type: outType, lastModified: file.lastModified });
    } finally {
      close();
    }
  } catch {
    return file;
  }
}

/** Compresses photos one at a time (a few large bitmaps at once can exhaust memory on cheap phones). */
export async function compressImages(files: File[]): Promise<File[]> {
  const out: File[] = [];
  for (const f of files) out.push(await compressImage(f));
  return out;
}
