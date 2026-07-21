import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import type { AppSession as Session } from '../lib/data';

interface CreditsContextType {
  credits: number;
  setCredits: (credits: number) => void;
  deductCredits: (amount: number, session: Session | null) => Promise<boolean>;
}

const CreditsContext = createContext<CreditsContextType | undefined>(undefined);

export const useCredits = () => {
  const context = useContext(CreditsContext);
  if (!context) {
    throw new Error('useCredits must be used within a CreditsProvider');
  }
  return context;
};

export const CreditsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [credits, setCredits] = useState(0);

  const deductCredits = useCallback(async (amount: number, session: Session | null) => {
    if (!session) {
      console.error('Deduct credits failed: No session provided.');
      return false;
    }

    const newCredits = credits - amount;
    if (newCredits < 0) return false;

    // Optimistic UI guard only. Cloud Functions perform authoritative deduction.
    setCredits(newCredits);
    return true;
  }, [credits]);

  return (
    <CreditsContext.Provider value={{ credits, setCredits, deductCredits }}>
      {children}
    </CreditsContext.Provider>
  );
};
