import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from './input';

/**
 * Password input with a show/hide toggle, built on the design-system Input so
 * the business auth modals get the same affordance as the candidate sign-in.
 * The toggle stays keyboard-reachable with an aria-pressed label; the eye glyph
 * is decorative. aria-labels fall back to English when a locale hasn't
 * translated the key, so a raw i18n key never reaches a screen reader.
 */
export const PasswordInput = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<'input'> & { t?: (key: string) => string }
>(({ t, ...props }, ref) => {
  const [visible, setVisible] = React.useState(false);
  const label = (key: string, fallback: string) => {
    const v = t ? t(key) : key;
    return v === key ? fallback : v;
  };
  return (
    <div className="relative">
      <Input ref={ref} {...props} type={visible ? 'text' : 'password'} className="pr-10" />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? label('auth_hide_password', 'Hide password') : label('auth_show_password', 'Show password')}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 transition-colors hover:text-gray-600 focus:outline-none focus-visible:text-blue-600 dark:hover:text-gray-200 dark:focus-visible:text-blue-400"
      >
        {visible ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
      </button>
    </div>
  );
});
PasswordInput.displayName = 'PasswordInput';
