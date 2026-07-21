import React from 'react';
import { SiteLayout } from '../components/SiteLayout';
import { SiteButton } from '../components/SiteButton';
import { ProductScreenshot } from '../components/ProductScreenshot';
import { CaseSnapshots } from '../components/CaseSnapshots';
import { WorkflowSteps, workflowPreviewRow } from '../components/WorkflowSteps';
import { SITE_ROUTES } from '../../config/site';
import { useMarketingI18n } from '../hooks/useMarketingI18n';

const portalTaskKeys = [
  { key: 'site_emp_task_roles', severity: 'gap' as const },
  { key: 'site_emp_task_candidates', severity: 'ready' as const },
  { key: 'site_emp_task_listings', severity: 'risk' as const },
  { key: 'site_emp_task_waiting', severity: 'gap' as const },
];

const assistantKeys = [
  'site_emp_assistant_must_have',
  'site_emp_assistant_salary',
  'site_emp_assistant_inclusive',
  'site_emp_assistant_market',
  'site_emp_assistant_clarity',
];

export const EmployerLandingPage: React.FC = () => {
  const { t } = useMarketingI18n();

  return (
    <SiteLayout pageId="employer-landing">
      <section className="py-12 sm:py-[var(--site-section)]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-2xl mb-8 sm:mb-12">
            <h1 className="text-[clamp(1.75rem,4vw,3rem)] font-semibold leading-tight">
              {t('site_emp_hero_title')}
            </h1>
            <p className="mt-4 text-base sm:text-lg text-[var(--site-text-muted)]">{t('site_emp_hero_subtitle')}</p>
            <div className="mt-6 sm:mt-8 flex flex-col sm:flex-row flex-wrap gap-3">
              <SiteButton to={SITE_ROUTES.portal} className="w-full sm:w-auto justify-center">
                {t('site_cta_post_job')}
              </SiteButton>
              <SiteButton variant="secondary" to={`${SITE_ROUTES.pricing}?audience=employer`} className="w-full sm:w-auto justify-center">
                {t('site_cta_employer_pricing')}
              </SiteButton>
            </div>
          </div>
          <ProductScreenshot
            src="/product-screenshots/employer-candidate-match.png"
            alt={t('site_shot_match_alt')}
            caption={t('site_shot_disclaimer')}
          />
        </div>
      </section>

      <section id="workflow" className="py-12 sm:py-[var(--site-section)] bg-[var(--site-surface-muted)]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <h2 className="text-xl sm:text-2xl font-semibold mb-8">{t('site_emp_workflow_title')}</h2>
          <WorkflowSteps
            steps={[
              { title: t('site_emp_workflow_post_title'), description: t('site_emp_workflow_post_desc') },
              { title: t('site_emp_workflow_match_title'), description: t('site_emp_workflow_match_desc') },
              { title: t('site_emp_workflow_review_title'), description: t('site_emp_workflow_review_desc') },
              { title: t('site_emp_workflow_contact_title'), description: t('site_emp_workflow_contact_desc') },
            ]}
            previews={[
              {
                label: t('site_wf_emp_p1_label'),
                scoreLabel: t('site_wf_emp_p1_score'),
                score: 88,
                rows: [
                  workflowPreviewRow(t, 'site_wf_emp_p1_r1', 'good'),
                  workflowPreviewRow(t, 'site_wf_emp_p1_r2', 'bad'),
                  workflowPreviewRow(t, 'site_wf_emp_p1_r3', 'warn'),
                ],
              },
              {
                label: t('site_wf_emp_p2_label'),
                scoreLabel: t('site_wf_emp_p2_score'),
                score: 84,
                rows: [
                  workflowPreviewRow(t, 'site_wf_emp_p2_r1', 'good'),
                  workflowPreviewRow(t, 'site_wf_emp_p2_r2', 'warn'),
                  workflowPreviewRow(t, 'site_wf_emp_p2_r3', 'good'),
                ],
              },
              {
                label: t('site_wf_emp_p3_label'),
                scoreLabel: t('site_wf_emp_p3_score'),
                score: 62,
                rows: [
                  workflowPreviewRow(t, 'site_wf_emp_p3_r1', 'warn'),
                  workflowPreviewRow(t, 'site_wf_emp_p3_r2', 'good'),
                  workflowPreviewRow(t, 'site_wf_emp_p3_r3', 'good'),
                ],
              },
              {
                label: t('site_wf_emp_p4_label'),
                scoreLabel: t('site_wf_emp_p4_score'),
                score: 71,
                rows: [
                  workflowPreviewRow(t, 'site_wf_emp_p4_r1', 'good'),
                  workflowPreviewRow(t, 'site_wf_emp_p4_r2', 'warn'),
                  workflowPreviewRow(t, 'site_wf_emp_p4_r3', 'good'),
                ],
              },
            ]}
          />
        </div>
      </section>

      <section className="py-12 sm:py-[var(--site-section)]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 grid lg:grid-cols-2 gap-8 lg:gap-12">
          <div className="min-w-0">
            <h2 className="text-xl sm:text-2xl font-semibold mb-6">{t('site_emp_portal_tasks_title')}</h2>
            <div className="space-y-3">
              {portalTaskKeys.map((task) => (
                <div
                  key={task.key}
                  className="flex items-center justify-between gap-2 border border-[var(--site-border)] rounded-[var(--site-radius)] px-4 py-3 min-h-[44px]"
                >
                  <span className="font-medium text-sm">{t(task.key)}</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded shrink-0 ${
                      task.severity === 'ready'
                        ? 'bg-[var(--site-ready-bg)] text-[var(--site-ready)]'
                        : task.severity === 'risk'
                          ? 'bg-[var(--site-risk-bg)] text-[var(--site-risk)]'
                          : 'bg-[var(--site-gap-bg)] text-[var(--site-gap)]'
                    }`}
                  >
                    {t('site_task_action_label')}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="border border-[var(--site-border)] rounded-[var(--site-radius)] p-5 sm:p-6 bg-[var(--site-surface-muted)] min-w-0">
            <h3 className="font-semibold mb-4">{t('site_emp_post_job_assistant')}</h3>
            <ul className="space-y-3 text-sm text-[var(--site-text-muted)]">
              {assistantKeys.map((key) => (
                <li key={key}>· {t(key)}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <CaseSnapshots t={t} />

      <section className="py-12 text-center border-t border-[var(--site-border)] px-4">
        <p className="text-sm text-[var(--site-text-muted)] mb-4">{t('site_emp_trust_line')}</p>
        <SiteButton to={SITE_ROUTES.portal}>{t('site_cta_enter_portal')}</SiteButton>
      </section>
    </SiteLayout>
  );
};
