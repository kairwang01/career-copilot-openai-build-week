/** Semantic design tokens for the public site. See marketing/Design.md. */

export const colors = {
  action: '#1D4ED8',
  actionHover: '#1E40AF',
  surface: '#FFFFFF',
  surfaceMuted: '#F8FAFC',
  textPrimary: '#0F172A',
  textMuted: '#64748B',
  border: '#E2E8F0',
  ready: '#16A34A',
  readyBg: '#F0FDF4',
  gap: '#EA580C',
  gapBg: '#FFF7ED',
  risk: '#DC2626',
  riskBg: '#FEF2F2',
} as const;

export const spacing = {
  1: 8,
  2: 16,
  3: 24,
  4: 32,
  6: 48,
  8: 64,
  section: 'clamp(80px, 12vw, 160px)',
} as const;

export const radius = {
  sm: 6,
  md: 8,
  lg: 12,
} as const;

export const typography = {
  fontFamily:
    'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  display: 'clamp(2rem, 4vw, 3rem)',
  heading: '1.375rem',
  body: '1rem',
  small: '0.875rem',
} as const;
