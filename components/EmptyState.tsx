import React from 'react';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}

// Shared placeholder for views that have nothing to show yet (e.g. before a
// résumé is uploaded). Keeps the "nothing here yet" message and styling
// consistent across the workspace instead of each view inventing its own.
const DefaultMark = () => (
  <div className="h-12 w-12 rounded-lg border border-blue-100 bg-blue-50 p-2" aria-hidden="true">
    <div className="flex h-full flex-col justify-between">
      <div className="h-1.5 rounded-full bg-blue-700" />
      <div className="space-y-1">
        <div className="h-1 rounded-full bg-blue-200" />
        <div className="h-1 w-2/3 rounded-full bg-blue-200" />
      </div>
    </div>
  </div>
);

const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, action }) => (
  <div className="flex flex-col items-center justify-center p-12 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 text-center animate-fade-in min-h-[60vh]">
    <div className="mb-4">{icon || <DefaultMark />}</div>
    <h3 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">{title}</h3>
    <p className="text-gray-600 dark:text-gray-400 max-w-md mx-auto mb-6">{description}</p>
    {action && (
      <button type="button"
        onClick={action.onClick}
        className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-6 rounded-lg shadow-sm transition-colors"
      >
        {action.label}
      </button>
    )}
  </div>
);

export default EmptyState;
