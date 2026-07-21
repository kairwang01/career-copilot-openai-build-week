import React from 'react';

interface SiteCardProps {
  children: React.ReactNode;
  className?: string;
  muted?: boolean;
}

export const SiteCard: React.FC<SiteCardProps> = ({ children, className = '', muted }) => (
  <div
    className={`rounded-[var(--site-radius)] border border-[var(--site-border)] p-6 ${
      muted ? 'bg-[var(--site-surface-muted)]' : 'bg-[var(--site-surface)]'
    } ${className}`}
  >
    {children}
  </div>
);
