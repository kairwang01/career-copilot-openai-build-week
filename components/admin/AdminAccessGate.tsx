import React from 'react';
import { data } from '@/lib/data';
import AdminAuthLayout from './AdminAuthLayout';
export { resolveRoleWithFallback } from '../../lib/access/adminRoleFallback';

/** Shown while verifying admin claim after sign-in. */
export const AdminVerifying: React.FC = () => (
  <AdminAuthLayout title="Verifying access" subtitle="Checking your administrator permissions…">
    <div className="flex items-center gap-3 py-8 text-sm text-gray-600 dark:text-gray-400">
      <span
        className="w-5 h-5 border-2 border-gray-300 border-t-blue-700 rounded-full animate-spin"
        aria-hidden
      />
      <span role="status">Please wait</span>
    </div>
  </AdminAuthLayout>
);
/** Shown when signed in but not on the admin allowlist. */
export const AdminAccessDenied: React.FC = () => (
  <AdminAuthLayout
    title="Access denied"
    subtitle="Your account is signed in but does not have administrator privileges for this console."
  >
    <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-800 px-4 py-4 text-sm text-amber-900 dark:text-amber-200">
      <p className="font-medium">Insufficient permissions</p>
      <p className="mt-1 text-amber-800/90 dark:text-amber-300/90 leading-relaxed">
        Ask an existing platform owner to run the grant script for your email, then sign out and sign
        back in.
      </p>
    </div>
    <pre className="mt-4 rounded-md bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-3 py-2.5 text-[11px] text-gray-700 dark:text-gray-300 font-mono overflow-x-auto">
      cd functions && node scripts/grantAdmin.js your@email.com
    </pre>
    <button
      type="button"
      onClick={() => data.auth.signOut()}
      className="mt-6 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200 shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
    >
      Sign out
    </button>
  </AdminAuthLayout>
);
