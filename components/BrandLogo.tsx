import React from 'react';

type BrandLogoVariant = 'mark' | 'lockup';
type BrandLogoSurface = 'light' | 'dark';
type BrandLogoSize = 'sm' | 'md' | 'lg';

interface BrandLogoProps {
  variant?: BrandLogoVariant;
  surface?: BrandLogoSurface;
  size?: BrandLogoSize;
  subtitle?: string;
  className?: string;
  markClassName?: string;
}

const MARK_SIZE: Record<BrandLogoSize, string> = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-12 w-12',
};

const TEXT_SIZE: Record<BrandLogoSize, string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-xl',
};

export const BrandMark: React.FC<{ className?: string; surface?: BrandLogoSurface }> = ({
  className = 'h-10 w-10',
  surface = 'light',
}) => {
  const border = surface === 'dark' ? '#BFD7FF' : '#D8E1EA';
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="42" height="42" rx="12" fill="#FFFFFF" stroke={border} strokeWidth="1.5" />
      <path
        d="M15 11.5h13.3L36 19.2v17.3a3 3 0 0 1-3 3H15a3 3 0 0 1-3-3v-22a3 3 0 0 1 3-3Z"
        fill="#F8FAFC"
        stroke="#0F2744"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M28 12v7.5h7.5" stroke="#0F2744" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17.5 22h9M17.5 26h6" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M17.5 32.5c4.5-4.4 8.4-2.2 12.6-8.5"
        stroke="#14B8A6"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path d="m30.1 24 2.7.2-.6 2.6" stroke="#14B8A6" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="33.5" cy="33.5" r="6.3" fill="#DBEAFE" stroke="#2563EB" strokeWidth="2" />
      <path d="m30.8 33.6 1.9 1.9 3.8-4.1" stroke="#2563EB" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

const BrandLogo: React.FC<BrandLogoProps> = ({
  variant = 'lockup',
  surface = 'light',
  size = 'md',
  subtitle,
  className = '',
  markClassName,
}) => {
  const textColor = surface === 'dark' ? 'text-white' : 'text-slate-900';
  const mutedColor = surface === 'dark' ? 'text-blue-100/70' : 'text-slate-500';
  const accentColor = surface === 'dark' ? 'text-blue-200' : 'text-blue-700';
  const markSize = markClassName ?? MARK_SIZE[size];

  if (variant === 'mark') {
    return <BrandMark surface={surface} className={`${markSize} ${className}`} />;
  }

  return (
    <span className={`inline-flex min-w-0 items-center gap-2.5 ${className}`}>
      <BrandMark surface={surface} className={`${markSize} shrink-0`} />
      <span className="min-w-0">
        <span className={`block truncate font-bold ${TEXT_SIZE[size]} ${textColor}`}>
          Career <span className={accentColor}>CoPilot</span>
        </span>
        {subtitle && (
          <span className={`block truncate text-[10px] font-semibold uppercase ${mutedColor}`}>
            {subtitle}
          </span>
        )}
      </span>
    </span>
  );
};

export default BrandLogo;
