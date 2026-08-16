'use client';

import { useState, useRef, useCallback } from 'react';
import Image from 'next/image';

interface ImageMagnifierProps {
  src: string;
  alt: string;
  fill?: boolean;
  width?: number;
  height?: number;
  className?: string;
  sizes?: string;
  priority?: boolean;
  onError?: () => void;
  unoptimized?: boolean;
  magnifierSize?: number;
  zoomLevel?: number;
}

/**
 * ImageMagnifier — wraps a next/image with a circular magnifier lens that
 * follows the cursor and shows the underlying image at zoomLevel× magnification.
 * Works with fill=true images (object-cover) used in listing cards and galleries.
 */
export default function ImageMagnifier({
  src,
  alt,
  fill = false,
  width,
  height,
  className = '',
  sizes,
  priority,
  onError,
  unoptimized,
  magnifierSize = 130,
  zoomLevel = 2.5,
}: ImageMagnifierProps) {
  const [pos, setPos] = useState({ x: 50, y: 50 });
  const [active, setActive] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setPos({ x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) });
  }, []);

  const half = magnifierSize / 2;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full"
      style={{ cursor: active ? 'crosshair' : undefined }}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onMouseMove={handleMouseMove}
    >
      <Image
        src={src}
        alt={alt}
        fill={fill}
        width={!fill ? width : undefined}
        height={!fill ? height : undefined}
        className={className}
        sizes={sizes}
        priority={priority}
        onError={onError}
        unoptimized={unoptimized}
      />

      {active && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute rounded-full border-2 border-sky-400 shadow-2xl z-50 ring-1 ring-white/60"
          style={{
            width: `${magnifierSize}px`,
            height: `${magnifierSize}px`,
            left: `calc(${pos.x}% - ${half}px)`,
            top: `calc(${pos.y}% - ${half}px)`,
            backgroundImage: `url(${src})`,
            backgroundRepeat: 'no-repeat',
            backgroundSize: `${zoomLevel * 100}%`,
            backgroundPositionX: `${pos.x}%`,
            backgroundPositionY: `${pos.y}%`,
          }}
        />
      )}
    </div>
  );
}
