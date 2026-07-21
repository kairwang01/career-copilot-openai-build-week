import React from 'react';
import { Link } from 'react-router-dom';

type Variant = 'primary' | 'secondary' | 'ghost';

const styles: Record<Variant, string> = {
  primary:
    'bg-[var(--site-action)] text-white hover:bg-[var(--site-action-hover)] border border-transparent',
  secondary:
    'bg-[var(--site-surface)] text-[var(--site-text)] border border-[var(--site-border)] hover:bg-[var(--site-surface-muted)]',
  ghost: 'bg-transparent text-[var(--site-action)] border border-transparent hover:bg-[var(--site-surface-muted)]',
};

interface SiteButtonProps {
  children: React.ReactNode;
  variant?: Variant;
  href?: string;
  to?: string;
  onClick?: () => void;
  className?: string;
}

export const SiteButton: React.FC<SiteButtonProps> = ({
  children,
  variant = 'primary',
  href,
  to,
  onClick,
  className = '',
}) => {
  const base = `inline-flex items-center justify-center rounded-[var(--site-radius)] px-6 py-2.5 text-sm font-medium transition-colors ${styles[variant]} ${className}`;

  if (to) {
    return (
      <Link to={to} className={base}>
        {children}
      </Link>
    );
  }
  if (href) {
    return (
      <a href={href} className={base} rel={href.startsWith('http') ? 'noopener noreferrer' : undefined}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={base}>
      {children}
    </button>
  );
};
