import React, { useState, useRef, useEffect } from 'react';
import { data } from '@/lib/data';
import AdminAuthLayout from './AdminAuthLayout';

type View = 'sign_in' | 'forgot_password';

function authErrorMessage(message: string): string {
  if (message.includes('invalid-credential') || message.includes('wrong-password') || message.includes('user-not-found')) {
    return 'The email or password you entered is incorrect.';
  }
  if (message.includes('invalid-email')) {
    return 'Enter a valid work email address.';
  }
  if (message.includes('too-many-requests')) {
    return 'Too many attempts. Wait a few minutes, then try again.';
  }
  if (message.includes('network-request-failed')) {
    return 'Unable to reach the authentication service. Check your connection.';
  }
  return 'Sign-in failed. Please try again or contact your administrator.';
}

const inputClass =
  'block w-full rounded-md border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 ' +
  'shadow-sm placeholder:text-gray-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20';

const AdminSignIn: React.FC = () => {
  const [view, setView] = useState<View>('sign_in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Ref latch: the `loading` state lags a render, so a fast double Enter/click would fire
  // two sign-in calls. mountedRef drops the tail setState — on success the auth-state
  // change swaps this form out for the console.
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const previousViewRef = useRef<View>(view);
  const signInEmailRef = useRef<HTMLInputElement>(null);
  const resetEmailRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (previousViewRef.current === view) return;
    previousViewRef.current = view;
    const target = view === 'sign_in' ? signInEmailRef.current : resetEmailRef.current;
    target?.focus();
  }, [view]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const { error: err } = await data.auth.signInWithPassword(email.trim(), password);
      if (!mountedRef.current) return;
      if (err) setError(authErrorMessage(err.message));
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const { error: err } = await data.auth.resetPassword(email.trim());
      if (!mountedRef.current) return;
      if (err) setError(authErrorMessage(err.message));
      else setMessage('If an account exists for this email, a reset link has been sent.');
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  };

  return (
    <AdminAuthLayout
      title={view === 'sign_in' ? 'Sign in' : 'Reset password'}
      subtitle={
        view === 'sign_in'
          ? 'Use your administrator credentials to access the console.'
          : 'Enter your email and we will send a password reset link.'
      }
    >
      {error && (
        <div
          id="admin-auth-error"
          role="alert"
          className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </div>
      )}
      {message && (
        <div
          id="admin-auth-status"
          role="status"
          className="mb-6 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800"
        >
          {message}
        </div>
      )}

      {view === 'sign_in' ? (
        <form
          onSubmit={handleSignIn}
          className="space-y-5"
          aria-busy={loading}
          noValidate
        >
          <div>
            <label htmlFor="admin-email" className="block text-sm font-medium text-gray-700 mb-1.5">
              Work email
            </label>
            <input
              ref={signInEmailRef}
              id="admin-email"
              name="email"
              type="email"
              autoComplete="username"
              required
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'admin-auth-error' : undefined}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              placeholder="name@company.com"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="admin-password" className="block text-sm font-medium text-gray-700">
                Password
              </label>
              <button
                type="button"
                onClick={() => {
                  setView('forgot_password');
                  setError(null);
                  setMessage(null);
                }}
                className="min-h-9 rounded-sm px-2 text-xs font-medium text-blue-700 hover:text-blue-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
              >
                Forgot password?
              </button>
            </div>
            <div className="relative">
              <input
                id="admin-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'admin-auth-error' : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${inputClass} pr-14`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-1 top-1/2 min-h-9 min-w-11 -translate-y-1/2 rounded px-2 text-xs font-medium text-gray-500 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 rounded-md bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {loading && (
              <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" aria-hidden />
            )}
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      ) : (
        <form
          onSubmit={handleReset}
          className="space-y-5"
          aria-busy={loading}
          noValidate
        >
          <div>
            <label htmlFor="admin-reset-email" className="block text-sm font-medium text-gray-700 mb-1.5">
              Work email
            </label>
            <input
              ref={resetEmailRef}
              id="admin-reset-email"
              name="email"
              type="email"
              autoComplete="username"
              required
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'admin-auth-error' : message ? 'admin-auth-status' : undefined}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              placeholder="name@company.com"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 transition-colors"
          >
            {loading ? 'Sending…' : 'Send reset link'}
          </button>
          <p className="text-center text-sm text-gray-600">
            <button
              type="button"
              onClick={() => {
                setView('sign_in');
                setError(null);
                setMessage(null);
              }}
              className="min-h-9 rounded-sm px-2 font-medium text-blue-700 hover:text-blue-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            >
              Back to sign in
            </button>
          </p>
        </form>
      )}

      <p className="mt-8 text-xs text-gray-500 leading-relaxed border-t border-gray-200 pt-6">
        Need access? Contact a platform owner to grant administrator privileges for your account.
      </p>
    </AdminAuthLayout>
  );
};

export default AdminSignIn;
