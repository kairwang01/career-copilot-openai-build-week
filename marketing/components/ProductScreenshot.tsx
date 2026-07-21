import React from 'react';

/**
 * Framed real-product screenshot for the marketing site (SCRUM-33).
 *
 * The PNGs are captured from the actual app by scripts/capture-product-screenshots.mjs
 * (CI workflow "Product screenshots") at 1440x900 @2x with clearly-demo data, then
 * committed under public/product-screenshots/. The frame mimics a browser window so
 * the shots read as software, not illustration.
 */
export const ProductScreenshot: React.FC<{
  src: string;
  alt: string;
  /** Marketing caption under the frame; omit for hero placements. */
  caption?: string;
  className?: string;
}> = ({ src, alt, caption, className = '' }) => (
  <figure className={`min-w-0 ${className}`}>
    <div className="overflow-hidden rounded-[calc(var(--site-radius)*1.5)] border border-[var(--site-border)] bg-white shadow-[0_18px_48px_-24px_rgba(15,23,42,0.28)]">
      <div className="flex items-center gap-1.5 border-b border-[var(--site-border)] bg-[var(--site-surface-muted)] px-4 py-2.5" aria-hidden="true">
        <span className="h-2.5 w-2.5 rounded-full bg-[#f87171]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#fbbf24]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#34d399]" />
      </div>
      <img
        src={src}
        alt={alt}
        width={1440}
        height={900}
        loading="lazy"
        decoding="async"
        className="block h-auto w-full"
      />
    </div>
    {caption && (
      <figcaption className="mt-3 text-sm leading-6 text-[var(--site-text-muted)]">{caption}</figcaption>
    )}
  </figure>
);
