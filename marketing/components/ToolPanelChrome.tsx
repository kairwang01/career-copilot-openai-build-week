import React from 'react';

interface ToolPanelChromeProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}

/** App-window chrome so marketing previews read as product UI, not documentation cards. */
export const ToolPanelChrome: React.FC<ToolPanelChromeProps> = ({
  title,
  subtitle,
  children,
  className = '',
}) => (
  <div
    className={`rounded-[var(--site-radius)] border border-[var(--site-border)] bg-[var(--site-surface)] overflow-hidden shadow-sm ${className}`}
  >
    <div className="flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 border-b border-[var(--site-border)] bg-[var(--site-surface-muted)]">
      <span className="w-2.5 h-2.5 rounded-full bg-[#FCA5A5]" />
      <span className="w-2.5 h-2.5 rounded-full bg-[#FCD34D]" />
      <span className="w-2.5 h-2.5 rounded-full bg-[#86EFAC]" />
      <div className="ml-2 sm:ml-3 min-w-0">
        <p className="text-xs font-medium text-[var(--site-text)] truncate">{title}</p>
        {subtitle && (
          <p className="text-[10px] text-[var(--site-text-muted)] truncate">{subtitle}</p>
        )}
      </div>
    </div>
    <div className="p-3.5 sm:p-5">{children}</div>
  </div>
);
