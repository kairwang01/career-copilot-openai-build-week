import React, { useId } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { ViewportAwareDialog } from './ViewportAwareDialog';

type ConfirmTone = 'primary' | 'danger';

interface ConfirmActionDialogProps {
  open: boolean;
  title: string;
  description: string;
  detail?: string;
  dataQa?: string;
  cancelLabel: string;
  confirmLabel: string;
  loadingLabel?: string;
  loading?: boolean;
  tone?: ConfirmTone;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

const toneClass: Record<ConfirmTone, string> = {
  primary: 'bg-blue-700 hover:bg-blue-800 focus:ring-blue-400/40',
  danger: 'bg-rose-700 hover:bg-rose-800 focus:ring-rose-400/40',
};

export const ConfirmActionDialog: React.FC<ConfirmActionDialogProps> = ({
  open,
  title,
  description,
  detail,
  dataQa,
  cancelLabel,
  confirmLabel,
  loadingLabel,
  loading = false,
  tone = 'primary',
  onOpenChange,
  onCancel,
  onConfirm,
}) => {
  const titleId = useId();
  const descriptionId = useId();
  const requestClose = () => {
    if (!loading) onOpenChange(false);
  };

  return (
    <ViewportAwareDialog
      open={open}
      onClose={requestClose}
      closeOnBackdrop={!loading}
      closeOnEscape={!loading}
      labelledBy={titleId}
      describedBy={descriptionId}
      maxWidth={500}
      zIndex={110}
    >
      <div data-qa={dataQa} className="relative rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-800 sm:p-7">
        <button
          type="button"
          onClick={requestClose}
          disabled={loading}
          className="absolute right-4 top-4 rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-400/40 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-slate-700 dark:hover:text-slate-200"
        >
          <X className="h-5 w-5" aria-hidden="true" />
          <span className="sr-only">{cancelLabel}</span>
        </button>

        <div className="text-left">
          <h2 id={titleId} className="flex items-center gap-2 pr-10 text-2xl font-semibold text-gray-900 dark:text-white">
          {tone === 'danger' && <AlertTriangle className="h-5 w-5 text-rose-600" aria-hidden="true" />}
          {title}
          </h2>
          <p id={descriptionId} className="pt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
          {description}
          </p>
        </div>

        {detail && (
          <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold leading-6 text-slate-800 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-100">
            {detail}
          </div>
        )}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            data-qa={dataQa ? `${dataQa}-cancel` : undefined}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-400/40 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            data-qa={dataQa ? `${dataQa}-confirm` : undefined}
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${toneClass[tone]}`}
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {loading ? (loadingLabel ?? confirmLabel) : confirmLabel}
          </button>
        </div>
      </div>
    </ViewportAwareDialog>
  );
};

export default ConfirmActionDialog;
