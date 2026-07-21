import React from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';

interface PlanChangeConfirmDialogProps {
  open: boolean;
  title: string;
  planLabel: string;
  description: string;
  cancelLabel: string;
  confirmLabel: string;
  loadingLabel: string;
  loading?: boolean;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export const PlanChangeConfirmDialog: React.FC<PlanChangeConfirmDialogProps> = ({
  open,
  title,
  planLabel,
  description,
  cancelLabel,
  confirmLabel,
  loadingLabel,
  loading = false,
  onOpenChange,
  onCancel,
  onConfirm,
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent maxWidth="sm" className="p-6 sm:p-7">
      <DialogHeader className="text-left">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="not-sr-only pt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
          {planLabel}
        </DialogDescription>
      </DialogHeader>

      <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900 dark:border-amber-800/50 dark:bg-amber-900/30 dark:text-amber-100">
        {description}
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-400/40 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={loading}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-400/40 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {loading ? loadingLabel : confirmLabel}
        </button>
      </div>
    </DialogContent>
  </Dialog>
);

export default PlanChangeConfirmDialog;
