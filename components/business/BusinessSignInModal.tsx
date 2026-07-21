
import React, { useState, useRef, useEffect } from 'react';
import { data } from '@/lib/data';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { PasswordInput } from '../ui/PasswordInput';
import { Button } from '../ui/button';

interface Props {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSwitchToSignUp: () => void;
  onSwitchToForgotPassword: () => void;
  t: (key: string) => string;
}

export default function BusinessSignInModal({
  isOpen,
  onOpenChange,
  onSwitchToSignUp,
  onSwitchToForgotPassword,
  t,
}: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ref latch (state lags a render → a double Enter could fire two sign-in calls).
  const submittingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const { error: authError } = await data.auth.signInWithPassword(email, password);
      if (!mountedRef.current) return;
      if (authError) {
        setError(authError.message);
        setLoading(false);
      }
      // On success the auth state change in App.tsx closes the modal naturally
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent maxWidth="sm">
        <DialogHeader>
          <DialogTitle>{t('auth_welcome_back')}</DialogTitle>
          <DialogDescription>{t('auth_business_signin_desc')}</DialogDescription>
        </DialogHeader>

        {error && (
          <div role="alert" className="bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded-md text-sm mt-4 dark:bg-red-900/20 dark:border-red-800/50 dark:text-red-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6 mt-6">
          <Input
            type="email"
            placeholder={t('auth_placeholder_email_business')}
            aria-label={t('auth_placeholder_email_business')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
          <PasswordInput
            t={t}
            placeholder={t('auth_placeholder_password_signin')}
            aria-label={t('auth_placeholder_password_signin')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? t('auth_signing_in') : t('auth_signin_link')}
          </Button>
        </form>

        <div className="text-center mt-3">
          <button
            type="button"
            onClick={onSwitchToForgotPassword}
            className="text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            {t('auth_forgot_password_link')}
          </button>
        </div>

        <p className="text-center text-sm text-gray-600 dark:text-gray-400 mt-2">
          {t('auth_no_employer_account')}{' '}
          <button
            type="button"
            onClick={onSwitchToSignUp}
            className="font-medium text-blue-600 hover:text-blue-700"
          >
            {t('auth_signup_link')}
          </button>
        </p>
      </DialogContent>
    </Dialog>
  );
}
