
import React from 'react';
import { useLocalization } from '../../hooks/useLocalization';
import { ViewportAwareDialog } from '../ViewportAwareDialog';

interface CreditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm?: () => void;
  onNavigateToPricing?: () => void;
  cost: number;
  currentCredits: number;
}

const CreditModal: React.FC<CreditModalProps> = ({ isOpen, onClose, onConfirm, onNavigateToPricing, cost, currentCredits }) => {
  const { t } = useLocalization();
  const [confirmPricing, setConfirmPricing] = React.useState(false);

  React.useEffect(() => {
    if (!isOpen) setConfirmPricing(false);
  }, [isOpen]);

  if (!isOpen) return null;

  const hasEnoughCredits = currentCredits >= cost;

  const handleClose = () => {
    setConfirmPricing(false);
    onClose();
  };

  const handleNavigateToPricing = () => {
    if (!confirmPricing) {
      setConfirmPricing(true);
      return;
    }
    handleClose();
    onNavigateToPricing?.();
  };

  const handleBackFromPricingConfirm = () => {
    setConfirmPricing(false);
  };

  return (
    <ViewportAwareDialog open={isOpen} onClose={handleClose} closeOnBackdrop labelledBy="credit-modal-title" maxWidth={384} zIndex={90}>
      <div className="rounded-xl bg-white p-6 text-center shadow-2xl dark:bg-slate-800">
        <h3 id="credit-modal-title" className="text-xl font-bold text-gray-800 dark:text-gray-100">
          {hasEnoughCredits
            ? t('credit_modal_confirm_title').replace('{cost}', String(cost))
            : confirmPricing
              ? t('credit_modal_get_more_cta')
              : t('credit_modal_insufficient_title')}
        </h3>

        <div className="my-6">
          <p className="text-gray-600 dark:text-gray-300">
            {hasEnoughCredits
              ? t('credit_modal_confirm_body').replace('{cost}', String(cost)).replace('{remaining}', String(currentCredits - cost))
              : t('credit_modal_insufficient_body').replace('{cost}', String(cost)).replace('{current}', String(currentCredits))}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={confirmPricing ? handleBackFromPricingConfirm : handleClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:hover:bg-slate-600"
          >
            {t('credit_modal_cancel')}
          </button>
          {hasEnoughCredits ? (
            <button
              type="button"
              onClick={onConfirm}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            >
              {t('credit_modal_confirm_cta')}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleNavigateToPricing}
              className={`px-4 py-2 text-sm font-medium text-white border border-transparent rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
                confirmPricing
                  ? 'bg-blue-600 hover:bg-blue-700'
                  : 'bg-green-600 hover:bg-green-700'
              }`}
            >
              {t('credit_modal_get_more_cta')}
            </button>
          )}
        </div>
      </div>
    </ViewportAwareDialog>
  );
};

export default CreditModal;
