import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layoutSource = readFileSync(
  new URL('../components/admin/AdminAuthLayout.tsx', import.meta.url),
  'utf8',
);
const signInSource = readFileSync(
  new URL('../components/admin/AdminSignIn.tsx', import.meta.url),
  'utf8',
);

describe('admin authentication mobile UX', () => {
  it('collapses the promotional rail before the lg breakpoint', () => {
    expect(layoutSource).toContain(
      'px-6 py-5 sm:px-8 sm:py-6 lg:px-10 lg:py-12',
    );
    expect(layoutSource.match(/hidden lg:block/g)).toHaveLength(3);
    expect(layoutSource).toContain(
      'flex-1 flex items-start lg:items-center justify-center p-5 sm:p-8 lg:p-10',
    );
    expect(layoutSource).toContain('mb-6 sm:mb-8');
  });

  it('preserves visible keyboard focus on every secondary action', () => {
    expect(signInSource.match(/focus-visible:ring-2/g)?.length).toBeGreaterThanOrEqual(4);
    expect(layoutSource).toContain('focus-visible:ring-2');
    expect(signInSource).toContain('min-h-9 min-w-11');
  });

  it('moves focus when switching views and exposes async feedback', () => {
    expect(signInSource).toContain('const previousViewRef = useRef<View>(view);');
    expect(signInSource).toContain("target?.focus();");
    expect(signInSource).toContain('id="admin-auth-error"');
    expect(signInSource).toContain('role="alert"');
    expect(signInSource).toContain('id="admin-auth-status"');
    expect(signInSource).toContain('role="status"');
    expect(signInSource.match(/aria-busy=\{loading\}/g)).toHaveLength(2);
    expect(signInSource.match(/aria-invalid=\{Boolean\(error\)\}/g)).toHaveLength(3);
    expect(signInSource.match(/aria-describedby=/g)).toHaveLength(3);
  });
});
