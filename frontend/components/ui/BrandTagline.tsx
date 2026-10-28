'use client';

import BrandLogo from '@/components/ui/BrandLogo';

/**
 * BrandTagline
 *
 * Renders the "Shop Smart. Shop Trusted." tagline that sits under the Piitrade
 * logo in the header, footer, and welcome popup. If an admin has uploaded an
 * image via Site Media Manager → "Site Logo", that image
 * is shown instead, sized to fit the exact same slot the text used to occupy.
 * Falls back to the original text whenever no image has been uploaded.
 */

interface BrandTaglineProps {
  /** Classes applied to the fallback text (used only when no logo image exists). */
  className?: string;
  /** Classes applied to the <img> when a logo image exists. */
  imgClassName?: string;
  /** Height in px for the rendered logo image, so it fits the same slot as the text. */
  imgHeight?: number;
}

export default function BrandTagline({ className = '', imgClassName = '', imgHeight = 14 }: BrandTaglineProps) {
  return (
    <BrandLogo
      imgHeight={imgHeight}
      imgClassName={imgClassName}
      alt="Piitrade — Shop Smart. Shop Trusted."
      fallback={<span className={className}>Shop Smart. Shop Trusted.</span>}
    />
  );
}
