
import React from 'react';
import { useApiStatus } from '../contexts/ApiStatusContext';
import { useLocalization } from '../hooks/useLocalization';

const ApiStatusBanner: React.FC = () => {
  const { apiStatus, lastError } = useApiStatus();
  const { t } = useLocalization();

  if (apiStatus === 'online') {
    return null;
  }

  const isDegraded = apiStatus === 'degraded';
  const bgColor = isDegraded ? 'bg-yellow-500' : 'bg-red-600';
  const statusLabel = t(isDegraded ? 'ai_status_limited_label' : 'ai_status_offline_label');
  const message = lastError || t(isDegraded ? 'ai_error_busy' : 'ai_error_network');

  return (
    <div
      className={`w-full px-4 py-2 text-center text-sm font-medium text-white ${bgColor}`}
      role={isDegraded ? 'status' : 'alert'}
      aria-live={isDegraded ? 'polite' : 'assertive'}
    >
      <p>
        <strong>{statusLabel}: </strong>
        <span>{message}</span>
      </p>
    </div>
  );
};

export default ApiStatusBanner;
