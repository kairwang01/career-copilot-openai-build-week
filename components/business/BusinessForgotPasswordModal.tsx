
import React, { useState } from 'react';
import { data } from '@/lib/data';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Button } from '../ui/button';

interface Props {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSwitchToSignIn: () => void;
  t: (key: string) => string;
}

export default function BusinessForgotPasswordModal({ isOpen, onOpenChange, onSwitchToSignIn, t }: Props) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    const { error: authError } = await data.auth.resetPassword(email);
    if (authError) {
      setError(authError.message);
    } else {
      setMessage(t('auth_message_reset_link_sent'));
    }
    setLoading(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent maxWidth="sm">
        <DialogHeader>
          <DialogTitle>{t('auth_reset_password_title')}</DialogTitle>
          <DialogDescription>{t('auth_reset_password_desc')}</DialogDescription>
        </DialogHeader>

        {error && (
          <div role="alert" className="bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded-md text-sm mt-4 dark:bg-red-900/20 dark:border-red-800/50 dark:text-red-300">
            {error}
          </div>
        )}
        {message && (
          <div role="status" className="bg-green-50 border border-green-300 text-green-700 px-4 py-3 rounded-md text-sm mt-4 dark:bg-green-900/20 dark:border-green-800/50 dark:text-green-300">
            {message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 mt-6">
          <Input
            type="email"
            placeholder={t('auth_placeholder_email_business')}
            aria-label={t('auth_placeholder_email_business')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? t('auth_sending_link') : t('auth_send_reset_link')}
          </Button>
        </form>

        <p className="text-center text-sm text-gray-600 dark:text-gray-400 mt-3">
          {t('auth_remembered_password')}{' '}
          <button
            type="button"
            onClick={onSwitchToSignIn}
            className="font-medium text-blue-600 hover:text-blue-700"
          >
            {t('auth_signin_link')}
          </button>
        </p>
      </DialogContent>
    </Dialog>
  );
}
