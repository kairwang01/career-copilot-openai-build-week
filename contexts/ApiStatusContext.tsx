
import React, { createContext, useState, useContext, ReactNode } from 'react';

export type ApiStatus = 'online' | 'degraded' | 'offline';

interface ApiStatusContextType {
  apiStatus: ApiStatus;
  setApiStatus: (status: ApiStatus) => void;
  lastError: string | null;
  setLastError: (error: string | null) => void;
}

const ApiStatusContext = createContext<ApiStatusContextType | undefined>(undefined);

export const useApiStatus = () => {
  const context = useContext(ApiStatusContext);
  if (!context) {
    throw new Error('useApiStatus must be used within an ApiStatusProvider');
  }
  return context;
};

export const ApiStatusProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [apiStatus, setApiStatus] = useState<ApiStatus>('online');
  const [lastError, setLastError] = useState<string | null>(null);

  return (
    <ApiStatusContext.Provider value={{ apiStatus, setApiStatus, lastError, setLastError }}>
      {children}
    </ApiStatusContext.Provider>
  );
};
