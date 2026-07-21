import React from 'react';
import {
  Award,
  BarChart3,
  BookOpenCheck,
  BriefcaseBusiness,
  CalendarDays,
  FileSearch,
  Languages,
  Mail,
  Mic,
  Network,
  PenLine,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

interface ToolLibraryProps {
  t: (key: string) => string;
}

const tools = [
  {
    key: 'resume_readiness',
    icon: FileSearch,
  },
  {
    key: 'cover_letter',
    icon: PenLine,
  },
  {
    key: 'resume_localizer',
    icon: Languages,
  },
  {
    key: 'opportunity_finder',
    icon: BriefcaseBusiness,
  },
  {
    key: 'mock_interview',
    icon: Mic,
  },
  {
    key: 'salary_negotiation',
    icon: Wallet,
  },
  {
    key: 'career_path',
    icon: TrendingUp,
  },
  {
    key: 'performance_review',
    icon: BarChart3,
  },
  {
    key: 'learning_plan',
    icon: BookOpenCheck,
  },
  {
    key: 'strategic_networking',
    icon: Network,
  },
  {
    key: 'professional_showcase',
    icon: Award,
  },
  {
    key: 'event_scout',
    icon: CalendarDays,
  },
  {
    key: 'agile_prep',
    icon: Award,
  },
  {
    key: 'email_drafting',
    icon: Mail,
  },
  {
    key: 'english_coach',
    icon: BookOpenCheck,
  },
];

const ToolMark: React.FC<{ icon: LucideIcon }> = ({ icon: Icon }) => (
  <div
    className="flex h-11 w-11 items-center justify-center rounded-[var(--site-radius)] border border-blue-100 bg-blue-50 text-blue-700"
    aria-hidden="true"
  >
    <Icon className="h-5 w-5" />
  </div>
);

export const ToolLibrary: React.FC<ToolLibraryProps> = ({ t }) => (
  <section id="toolkit-section" className="py-12 sm:py-[var(--site-section)]">
    <div className="max-w-6xl mx-auto px-4 sm:px-6">
      <div className="max-w-3xl mb-8">
        <p className="text-sm font-medium text-[var(--site-action)] mb-3">{t('site_tool_library_label')}</p>
        <h2 className="text-xl sm:text-2xl font-semibold">{t('site_tool_library_title')}</h2>
        <p className="mt-3 text-[var(--site-text-muted)]">
          {t('site_tool_library_desc')}
        </p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {tools.map((tool) => (
          <article
            key={tool.key}
            className="rounded-[var(--site-radius)] border border-[var(--site-border)] bg-[var(--site-surface)] p-5"
          >
            <div className="flex items-start gap-4">
              <ToolMark icon={tool.icon} />
              <div className="min-w-0">
                <h3 className="font-semibold leading-snug">{t(`site_tool_card_${tool.key}_name`)}</h3>
                <p className="mt-2 text-sm text-[var(--site-text-muted)] leading-relaxed">
                  {t(`site_tool_card_${tool.key}_desc`)}
                </p>
              </div>
            </div>
            <div className="mt-4 rounded-[var(--site-radius)] border border-[var(--site-border)] bg-[var(--site-surface-muted)] px-3 py-2 text-xs font-medium text-[var(--site-text-muted)]">
              {t(`site_tool_card_${tool.key}_result`)}
            </div>
          </article>
        ))}
      </div>
    </div>
  </section>
);
