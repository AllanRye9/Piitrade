// Builds Next's image-optimizer URLs by hand, for plain <img> elements that cannot use <Image> (e.g. a logo whose
// aspect ratio is unknown). `w` must be one of Next's configured sizes (16…384 and the device sizes 640…3840).

/** True for URLs the optimizer can handle: not data/blob, not SVG/GIF (it would flatten animation / refuse SVG). */
export function canOptimize(src: string): boolean {
  if (!src || /^(data|blob):/i.test(src)) return false;
  const path = src.split(/[?#]/)[0].toLowerCase();
  return !/\.(svg|gif)$/.test(path);
}

export function optimizedUrl(src: string, width: number, quality = 80): string {
  return `/_next/image?url=${encodeURIComponent(src)}&w=${width}&q=${quality}`;
}
