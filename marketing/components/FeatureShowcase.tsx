import React, { useEffect, useState } from 'react';
import { Check, Star, Bell, Timer, ChevronLeft, ChevronRight, UserRound } from 'lucide-react';
import { SiteButton } from './SiteButton';
import { ToolPanelChrome } from './ToolPanelChrome';
import { SITE_ROUTES } from '../../config/site';
import { SUPPORTED_MARKETS } from '../../config';

interface FeatureShowcaseProps {
  t: (key: string) => string;
}

interface PreviewSceneProps {
  t: (key: string) => string;
}

/**
 * Rotating "latest capabilities" showcase for the logged-out homepage.
 * Each slide pairs marketing copy with an illustrative product scene. The scene
 * data is an example only and must never be presented as a real customer result.
 */

const ROTATE_MS = 6500;

// ── Scene 1: the timed interview room (flagship) ──────────────────────────────
const InterviewScene: React.FC<PreviewSceneProps> = ({ t }) => (
  <ToolPanelChrome title={t('site_preview_interview_title')} subtitle={t('site_preview_interview_subtitle')}>
    <div className="flex items-start gap-4">
      <div className="relative shrink-0">
        <span className="absolute -inset-1 rounded-full border-2 border-blue-400/50 animate-pulse" aria-hidden="true" />
        <div
          role="img"
          aria-label={t('site_preview_interview_coach_alt')}
          className="grid h-16 w-16 place-items-center rounded-full bg-blue-50 text-blue-700 ring-2 ring-blue-500"
        >
          <UserRound className="h-8 w-8" aria-hidden="true" />
        </div>
        <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full bg-emerald-500 ring-2 ring-white" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700">
            <Timer className="h-3 w-3" /> {t('site_preview_interview_answer')}
          </span>
          <span className="font-mono text-sm font-bold tabular-nums">2:31</span>
          <span className="ml-auto h-1 w-16 rounded-full bg-slate-200 overflow-hidden">
            <span className="block h-full w-4/5 bg-blue-600 rounded-full" />
          </span>
        </div>
        <p className="text-sm font-medium leading-snug">
          {t('site_preview_interview_question')}
        </p>
      </div>
    </div>
    <div className="mt-4 flex items-center gap-3 rounded-lg border border-[var(--site-border)] bg-[var(--site-surface-muted)] p-3">
      <div
        className="grid h-12 w-12 shrink-0 place-items-center rounded-full p-1"
        style={{ background: 'conic-gradient(#10b981 86%, #e2e8f0 0)' }}
        aria-label={t('site_preview_interview_score_aria').replace('{score}', '86')}
      >
        <span className="grid h-full w-full place-items-center rounded-full bg-[var(--site-surface-muted)] text-sm font-bold">86</span>
      </div>
      <div className="min-w-0">
        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">
          {t('site_preview_interview_feedback_label')}
        </span>
        <p className="mt-1 text-xs text-[var(--site-text-muted)] truncate">
          {t('site_preview_interview_feedback')}
        </p>
      </div>
    </div>
  </ToolPanelChrome>
);

// ── Scene 2: job search + clearly labelled demo reviews ──────────────────────
const JobsScene: React.FC<PreviewSceneProps> = ({ t }) => (
  <ToolPanelChrome title={t('site_preview_jobs_title')} subtitle={t('site_preview_jobs_subtitle')}>
    <div className="rounded-lg border border-[var(--site-border)] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{t('site_preview_jobs_role')}</p>
          <p className="text-xs text-[var(--site-text-muted)]">{t('site_preview_jobs_company')}</p>
        </div>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 shrink-0">
          <Star className="h-3 w-3 fill-current" /> {t('site_preview_jobs_rating')}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
          {t('site_preview_jobs_salary')}
        </span>
        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600">{t('site_preview_jobs_mode')}</span>
        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600">{t('site_preview_jobs_skills')}</span>
      </div>
    </div>
    <div className="mt-3 rounded-lg border border-[var(--site-border)] bg-[var(--site-surface-muted)] p-3">
      <div className="flex items-center gap-1.5 mb-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <Star key={i} className={`h-3 w-3 ${i <= 4 ? 'text-amber-400 fill-current' : 'text-slate-300'}`} />
        ))}
        <span className="ml-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-100 text-emerald-700">
          {t('site_preview_jobs_review_label')}
        </span>
      </div>
      <p className="text-xs text-[var(--site-text-muted)] leading-relaxed">
        {t('site_preview_jobs_review')}
      </p>
    </div>
  </ToolPanelChrome>
);

// ── Scene 3: country-specific resume localization ─────────────────────────────
const LocalizeScene: React.FC<PreviewSceneProps> = ({ t }) => (
  <ToolPanelChrome title={t('site_preview_localize_title')} subtitle={t('site_preview_localize_subtitle')}>
    <div className="grid grid-cols-2 gap-3 items-stretch">
      <div className="rounded-lg border border-[var(--site-border)] p-2.5">
        <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--site-text-muted)] mb-1.5">{t('site_preview_localize_source')}</p>
        <div className="space-y-1.5">
          <div className="h-2 w-3/4 rounded bg-slate-300" />
          <div className="h-1.5 w-full rounded bg-slate-200" />
          <div className="h-1.5 w-5/6 rounded bg-slate-200" />
          <div className="h-1.5 w-full rounded bg-slate-200" />
        </div>
        <span className="mt-2 inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold bg-blue-50 text-blue-700">
          {t('site_preview_localize_source_format')}
        </span>
      </div>
      <div className="rounded-lg border border-[var(--site-border)] p-2.5">
        <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--site-text-muted)] mb-1.5">{t('site_preview_localize_target')}</p>
        <div className="space-y-1.5">
          <div className="h-1.5 w-full rounded bg-slate-200" />
          <div className="h-1.5 w-5/6 rounded bg-slate-200" />
          <div className="h-1.5 w-full rounded bg-slate-200" />
        </div>
        <span className="mt-2 inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold bg-blue-50 text-blue-700">
          {t('site_preview_localize_target_fields')}
        </span>
      </div>
    </div>
    <p className="mt-3 text-xs text-[var(--site-text-muted)]">
      {t('site_preview_localize_market_count').replace('{count}', String(SUPPORTED_MARKETS.length))}
    </p>
  </ToolPanelChrome>
);

// ── Scene 4: application tracking + status notifications ─────────────────────
const TrackingScene: React.FC<PreviewSceneProps> = ({ t }) => (
  <ToolPanelChrome title={t('site_preview_tracking_title')} subtitle={t('site_preview_tracking_subtitle')}>
    <div className="rounded-lg border border-[var(--site-border)] p-3">
      <p className="text-sm font-semibold mb-3">{t('site_preview_tracking_role')}</p>
      <div className="flex items-center">
        {[
          { label: t('site_preview_tracking_applied'), state: 'done' },
          { label: t('site_preview_tracking_interviewing'), state: 'active' },
          { label: t('site_preview_tracking_decision'), state: 'todo' },
        ].map((s, i) => (
          <React.Fragment key={s.label}>
            {i > 0 && <span className={`h-0.5 flex-1 ${s.state === 'todo' ? 'bg-slate-200' : 'bg-blue-500'}`} />}
            <span className="flex flex-col items-center gap-1 px-1">
              <span
                className={`h-4 w-4 rounded-full flex items-center justify-center ${
                  s.state === 'done'
                    ? 'bg-blue-600'
                    : s.state === 'active'
                      ? 'bg-blue-600 ring-4 ring-blue-100 animate-pulse'
                      : 'bg-slate-200'
                }`}
              >
                {s.state === 'done' && <Check className="h-2.5 w-2.5 text-white" />}
              </span>
              <span className={`text-[9px] font-semibold ${s.state === 'todo' ? 'text-slate-400' : 'text-blue-700'}`}>
                {s.label}
              </span>
            </span>
          </React.Fragment>
        ))}
      </div>
    </div>
    <div className="mt-3 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
      <Bell className="h-4 w-4 text-blue-600 shrink-0" />
      <p className="text-xs text-blue-800">
        <span className="font-semibold">{t('site_preview_tracking_update_label')}</span>{' '}
        {t('site_preview_tracking_update_body')}
      </p>
    </div>
  </ToolPanelChrome>
);

// ── Carousel ───────────────────────────────────────────────────────────────────
const SLIDES = [
  { id: 'interview', tagKey: 'site_fs1_tag', titleKey: 'site_fs1_title', descKey: 'site_fs1_desc', bullets: ['site_fs1_b1', 'site_fs1_b2', 'site_fs1_b3'], Scene: InterviewScene },
  { id: 'jobs',      tagKey: 'site_fs2_tag', titleKey: 'site_fs2_title', descKey: 'site_fs2_desc', bullets: ['site_fs2_b1', 'site_fs2_b2', 'site_fs2_b3'], Scene: JobsScene },
  { id: 'localize',  tagKey: 'site_fs3_tag', titleKey: 'site_fs3_title', descKey: 'site_fs3_desc', bullets: ['site_fs3_b1', 'site_fs3_b2', 'site_fs3_b3'], Scene: LocalizeScene },
  { id: 'tracking',  tagKey: 'site_fs4_tag', titleKey: 'site_fs4_title', descKey: 'site_fs4_desc', bullets: ['site_fs4_b1', 'site_fs4_b2', 'site_fs4_b3'], Scene: TrackingScene },
];

export const FeatureShowcase: React.FC<FeatureShowcaseProps> = ({ t }) => {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % SLIDES.length), ROTATE_MS);
    return () => clearInterval(id);
  }, [paused]);

  const slide = SLIDES[idx];
  const Scene = slide.Scene;

  return (
    <section
      className="py-14 sm:py-[var(--site-section)] border-t border-[var(--site-border)]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
      onTouchEnd={() => setPaused(false)}
      onTouchCancel={() => setPaused(false)}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8 grid gap-3 lg:grid-cols-[0.7fr_1fr] lg:items-end">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--site-action)]">
            {t('site_fs_kicker')}
          </p>
          <h2 className="text-2xl sm:text-4xl font-bold tracking-[-0.035em] text-[var(--site-text)]">
            {t('site_fs_title')}
          </h2>
        </div>

        {/* tab navigation */}
        <div className="mb-8 flex flex-wrap gap-2" role="tablist" aria-label={t('site_fs_title')}>
          {SLIDES.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={i === idx}
              onClick={() => setIdx(i)}
              className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${
                i === idx
                  ? 'bg-[var(--site-action)] text-white shadow-sm'
                  : 'bg-[var(--site-surface-muted)] text-[var(--site-text-muted)] hover:text-[var(--site-text)] border border-[var(--site-border)]'
              }`}
            >
              {t(s.tagKey)}
            </button>
          ))}
        </div>

        <div key={slide.id} className="grid lg:grid-cols-2 gap-8 lg:gap-14 items-center animate-fade-in">
          <div className="min-w-0 order-2 lg:order-1">
            <h3 className="text-xl sm:text-2xl font-bold tracking-[-0.02em] text-[var(--site-text)]">
              {t(slide.titleKey)}
            </h3>
            <p className="mt-3 text-sm sm:text-base leading-7 text-[var(--site-text-muted)]">
              {t(slide.descKey)}
            </p>
            <ul className="mt-5 space-y-2.5">
              {slide.bullets.map((bk) => (
                <li key={bk} className="flex items-start gap-2.5 text-sm text-[var(--site-text)]">
                  <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                    <Check className="h-3 w-3 text-emerald-600" />
                  </span>
                  {t(bk)}
                </li>
              ))}
            </ul>
            <div className="mt-7">
              <SiteButton href={SITE_ROUTES.workspace} className="px-6 py-2.5 font-semibold">
                {t('site_fs_cta')}
              </SiteButton>
            </div>
          </div>
          <div className="min-w-0 order-1 lg:order-2">
            <Scene t={t} />
          </div>
        </div>

        {/* dots + arrows — hit areas are ≥24px (WCAG 2.5.8) while the visual dots stay
            small via an inner span; the row sits in 36px-tall tap targets for mobile. */}
        <div className="mt-8 flex items-center justify-center gap-1">
          <button
            type="button"
            aria-label={t('site_preview_previous')}
            onClick={() => setIdx((i) => (i - 1 + SLIDES.length) % SLIDES.length)}
            className="grid h-9 w-9 place-items-center rounded-full text-[var(--site-text-muted)] transition-colors hover:bg-black/5 hover:text-[var(--site-text)]"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          {SLIDES.map((s, i) => (
            <button
              key={s.id}
              type="button"
              aria-label={t(s.tagKey)}
              aria-current={i === idx}
              onClick={() => setIdx(i)}
              className="grid h-9 place-items-center px-2 rounded-full"
            >
              <span
                className={`block h-2 rounded-full transition-all ${
                  i === idx ? 'w-6 bg-[var(--site-action)]' : 'w-2 bg-slate-300'
                }`}
              />
            </button>
          ))}
          <button
            type="button"
            aria-label={t('site_preview_next')}
            onClick={() => setIdx((i) => (i + 1) % SLIDES.length)}
            className="grid h-9 w-9 place-items-center rounded-full text-[var(--site-text-muted)] transition-colors hover:bg-black/5 hover:text-[var(--site-text)]"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>
  );
};
