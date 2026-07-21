import React from 'react';
import { Check, X } from 'lucide-react';

interface WhyNotJobBoardProps {
  t: (key: string) => string;
}

/**
 * "Why us, not just a job board" — the differentiator section. Answers the
 * unspoken question every visitor has ("why wouldn't I just use a job site?")
 * in a plain, scannable side-by-side, framed around outcomes rather than
 * feature buzzwords. We contrast with "job boards" generically rather than
 * naming a competitor on our own homepage.
 */
const ROWS = [
  { board: 'site_why_row1_board', copilot: 'site_why_row1_copilot' },
  { board: 'site_why_row2_board', copilot: 'site_why_row2_copilot' },
  { board: 'site_why_row3_board', copilot: 'site_why_row3_copilot' },
  { board: 'site_why_row4_board', copilot: 'site_why_row4_copilot' },
];

export const WhyNotJobBoard: React.FC<WhyNotJobBoardProps> = ({ t }) => {
  return (
    <section className="py-14 sm:py-[var(--site-section)] bg-[var(--site-surface-muted)]">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--site-action)]">
            {t('site_why_eyebrow')}
          </p>
          <h2 className="mt-3 text-2xl sm:text-4xl font-bold tracking-[-0.035em] text-[var(--site-text)]">
            {t('site_why_title')}
          </h2>
          <p className="mt-4 text-base sm:text-lg leading-8 text-[var(--site-text-muted)]">
            {t('site_why_subtitle')}
          </p>
        </div>

        <div className="mt-9 grid gap-3 sm:grid-cols-2">
          {/* Job board column */}
          <div className="rounded-[calc(var(--site-radius)*1.5)] border border-[var(--site-border)] bg-[var(--site-surface)] p-5">
            <p className="text-sm font-semibold text-[var(--site-text-muted)]">{t('site_why_col_board')}</p>
            <ul className="mt-4 space-y-3">
              {ROWS.map((row) => (
                <li key={row.board} className="flex items-start gap-2.5 text-sm leading-6 text-[var(--site-text-muted)]">
                  <X className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  <span>{t(row.board)}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Career CoPilot column */}
          <div className="rounded-[calc(var(--site-radius)*1.5)] border-2 border-[var(--site-action)] bg-[var(--site-surface)] p-5 shadow-sm">
            <p className="text-sm font-bold text-[var(--site-action)]">{t('site_why_col_copilot')}</p>
            <ul className="mt-4 space-y-3">
              {ROWS.map((row) => (
                <li key={row.copilot} className="flex items-start gap-2.5 text-sm leading-6 text-[var(--site-text)]">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
                  <span className="font-medium">{t(row.copilot)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
};
