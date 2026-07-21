import React from 'react';

/** Shared light-theme primitives for the admin console (matches AdminAuthLayout). */

export const Card: React.FC<{ className?: string; children: React.ReactNode }> = ({
  className = '',
  children,
}) => (
  <div
    className={`bg-white border border-gray-200 rounded-lg shadow-sm ${className}`}
  >
    {children}
  </div>
);

export const SectionHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h2 className="inline-flex items-center gap-2 text-base font-semibold tracking-tight text-gray-950">
    <span className="h-4 w-1 rounded-full bg-blue-600" aria-hidden="true" />
    <span>{children}</span>
  </h2>
);

export const SubsectionHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="text-sm font-semibold text-gray-900">{children}</h3>
);

export const FieldLabel: React.FC<{ htmlFor?: string; children: React.ReactNode }> = ({
  htmlFor,
  children,
}) => (
  <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-700 mb-1.5">
    {children}
  </label>
);

export const textInput =
  'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 ' +
  'shadow-sm placeholder:text-gray-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20';

export const SaveButton: React.FC<{ onClick: () => void; loading?: boolean; label?: string }> = ({
  onClick,
  loading,
  label = 'Save',
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={loading}
    className="inline-flex items-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-800 disabled:opacity-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
  >
    {loading && (
      <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
    )}
    {label}
  </button>
);

export const PrimaryButton: React.FC<{
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}> = ({ onClick, children, className = '' }) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded-md bg-blue-700 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 ${className}`}
  >
    {children}
  </button>
);

export const EmptyState: React.FC<{ message: string }> = ({ message }) => (
  <p className="py-8 text-center text-sm text-gray-500">{message}</p>
);

const PLAN_COLORS: Record<string, string> = {
  free: 'bg-gray-100 text-gray-700',
  essentials: 'bg-blue-50 text-blue-800',
  accelerator: 'bg-indigo-50 text-indigo-800',
  executive: 'bg-violet-50 text-violet-800',
  starter: 'bg-sky-50 text-sky-800',
  growth: 'bg-emerald-50 text-emerald-800',
  pro: 'bg-purple-50 text-purple-800',
  single_post: 'bg-teal-50 text-teal-800',
  job_pack: 'bg-cyan-50 text-cyan-800',
};

export const PlanBadge: React.FC<{ plan: string | null }> = ({ plan }) => {
  if (!plan) return <span className="text-gray-400 text-xs">-</span>;
  const cls = PLAN_COLORS[plan] ?? 'bg-gray-100 text-gray-700';
  return (
    <span className={`inline-block text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded ${cls}`}>
      {plan.replace(/_/g, ' ')}
    </span>
  );
};

const ACTION_COLORS: Record<string, string> = {
  adjust_credits: 'bg-amber-50 text-amber-800',
  set_subscription: 'bg-blue-50 text-blue-800',
  set_admin: 'bg-violet-50 text-violet-800',
  update_llm_config: 'bg-indigo-50 text-indigo-800',
  update_quotas: 'bg-teal-50 text-teal-800',
};

export const ActionBadge: React.FC<{ action: string }> = ({ action }) => {
  const cls = ACTION_COLORS[action] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-block text-[10px] font-mono px-2 py-0.5 rounded whitespace-nowrap ${cls}`}>
      {action}
    </span>
  );
};

export const AuditDetails: React.FC<{ details: Record<string, unknown> }> = ({ details }) => {
  const pairs = Object.entries(details);
  if (pairs.length === 0) return <span className="text-gray-400">-</span>;
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5">
      {pairs.map(([k, v]) => (
        <span key={k}>
          <span className="text-gray-500">{k}:</span>{' '}
          <span className="text-gray-700">{String(v)}</span>
        </span>
      ))}
    </span>
  );
};

export const tableHead =
  'px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500';
export const tableRow = 'border-b border-gray-100 hover:bg-gray-50/80 transition-colors';
export const tableCell = 'px-5 py-3 text-sm text-gray-700';
