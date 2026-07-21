import React from 'react';

interface CheckoutRedirectNoticeProps {
  children: React.ReactNode;
  className?: string;
}

export const CheckoutRedirectNotice: React.FC<CheckoutRedirectNoticeProps> = ({ children, className = '' }) => (
  <div
    className={`rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-800/60 dark:bg-amber-900/25 dark:text-amber-100 ${className}`}
  >
    {children}
  </div>
);

export default CheckoutRedirectNotice;
