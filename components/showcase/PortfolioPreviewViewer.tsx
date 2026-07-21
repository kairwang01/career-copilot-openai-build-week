import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Code2, Download, ExternalLink, Eye, Rocket } from 'lucide-react';
import { useToast } from '../Toast';
import { PORTFOLIO_PREVIEW_SANDBOX, portfolioPreviewHtml } from '../../lib/portfolioPreview';

export const PORTFOLIO_TEMPLATES = [
  { key: 'sapphire', name: 'Sapphire', description: 'Professional & Corporate', colors: ['#2563eb', '#dbeafe', '#1e3a8a', '#93c5fd'] },
  { key: 'onyx', name: 'Onyx', description: 'Modern & Sleek Dark', colors: ['#3b82f6', '#111827', '#f3f4f6', '#374151'] },
  { key: 'quartz', name: 'Quartz', description: 'Clean & Minimalist Light', colors: ['#1f2937', '#ffffff', '#f9fafb', '#e5e7eb'] },
  { key: 'emerald', name: 'Emerald', description: 'Creative & Natural', colors: ['#10b981', '#f0fdf4', '#14532d', '#a7f3d0'] },
  { key: 'jasper', name: 'Jasper', description: 'Academic & Earthy', colors: ['#c2410c', '#fff7ed', '#7c2d12', '#fdba74'] },
];

export const THEME_VARS: Record<string, Record<string, string>> = {
  sapphire: { '--primary': '#2563eb', '--secondary': '#64748b', '--dark': '#1e293b', '--light': '#f8fafc', '--accent': '#f97316', '--surface-card': '#ffffff', '--header-bg': 'rgba(248, 250, 252, 0.9)' },
  onyx: { '--primary': '#3b82f6', '--secondary': '#9ca3af', '--dark': '#f3f4f6', '--light': '#111827', '--accent': '#60a5fa', '--surface-card': '#1f2937', '--header-bg': 'rgba(17, 24, 39, 0.9)' },
  quartz: { '--primary': '#1f2937', '--secondary': '#6b7280', '--dark': '#111827', '--light': '#ffffff', '--accent': '#4b5563', '--surface-card': '#f9fafb', '--header-bg': 'rgba(255, 255, 255, 0.9)' },
  emerald: { '--primary': '#10b981', '--secondary': '#065f46', '--dark': '#064e3b', '--light': '#f0fdf4', '--accent': '#059669', '--surface-card': '#ffffff', '--header-bg': 'rgba(240, 253, 244, 0.9)' },
  jasper: { '--primary': '#c2410c', '--secondary': '#7c2d12', '--dark': '#431407', '--light': '#fff7ed', '--accent': '#9a3412', '--surface-card': '#ffffff', '--header-bg': 'rgba(255, 247, 237, 0.9)' },
};

const PREVIEW_SIZES: Record<string, string> = { desktop: '100%', tablet: '768px', mobile: '375px' };

export const applyPortfolioTheme = (originalHtml: string, themeKey: string | null): string => {
  if (!themeKey || !THEME_VARS[themeKey]) return originalHtml;
  const variables = THEME_VARS[themeKey];
  const rootStyle = `:root { ${Object.entries(variables).map(([key, value]) => `${key}: ${value};`).join(' ')} --transition: all 0.3s ease; }`;
  return originalHtml.replace(/:root\s*{[^}]+}/s, rootStyle);
};

const sanitizeFilename = (value: string) =>
  value.trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'showcase';

const ResultActionCard: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  onClick: () => void;
  tone?: 'primary' | 'neutral';
}> = ({ icon: Icon, title, description, onClick, tone = 'neutral' }) => (
  <button
    type="button"
    onClick={onClick}
    className={`group flex min-h-[112px] w-full items-start gap-3 rounded-2xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950 ${
      tone === 'primary'
        ? 'border-blue-200 bg-blue-50 text-blue-950 hover:border-blue-300 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-100'
        : 'border-gray-200 bg-white text-gray-900 hover:border-blue-200 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100 dark:hover:border-blue-800'
    }`}
  >
    <span className={`mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
      tone === 'primary' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-blue-700 dark:bg-slate-800 dark:text-blue-300'
    }`}>
      <Icon className="h-5 w-5" />
    </span>
    <span className="min-w-0">
      <span className="block text-sm font-bold">{title}</span>
      <span className="mt-1 block text-xs leading-5 text-gray-600 dark:text-slate-400">{description}</span>
    </span>
  </button>
);

interface PortfolioPreviewViewerProps {
  htmlContent: string;
  theme: string;
  title: string;
  hint: string;
  filename?: string;
  badges?: string[];
  actionSlot?: React.ReactNode;
  headerActionSlot?: React.ReactNode;
  onThemeChange?: (theme: string) => void;
  showActionCards?: boolean;
  showThemePicker?: boolean;
  t: (key: string) => string;
}

const PortfolioPreviewViewer: React.FC<PortfolioPreviewViewerProps> = ({
  htmlContent,
  theme,
  title,
  hint,
  filename = 'showcase',
  badges = [],
  actionSlot,
  headerActionSlot,
  onThemeChange,
  showActionCards = true,
  showThemePicker = true,
  t,
}) => {
  const { addToast } = useToast();
  const [resultTab, setResultTab] = useState<'preview' | 'deploy' | 'code'>('preview');
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [previewTheme, setPreviewTheme] = useState(theme || 'sapphire');
  const themedHtmlContent = useMemo(() => applyPortfolioTheme(htmlContent, previewTheme), [htmlContent, previewTheme]);
  const previewHtmlContent = useMemo(() => portfolioPreviewHtml(themedHtmlContent), [themedHtmlContent]);
  const themeName = PORTFOLIO_TEMPLATES.find((item) => item.key === previewTheme)?.name ?? previewTheme;
  const previewFrameRef = useRef<HTMLIFrameElement>(null);
  const previewCleanupRef = useRef<(() => void) | null>(null);

  const wirePreviewInteractions = useCallback(() => {
    previewCleanupRef.current?.();
    previewCleanupRef.current = null;

    const frame = previewFrameRef.current;
    const doc = frame?.contentDocument;
    if (!frame || !doc) return;

    const cleanups: Array<() => void> = [];
    const listen = <K extends keyof HTMLElementEventMap>(
      element: HTMLElement,
      eventName: K,
      listener: (event: HTMLElementEventMap[K]) => void,
    ) => {
      element.addEventListener(eventName, listener as EventListener);
      cleanups.push(() => element.removeEventListener(eventName, listener as EventListener));
    };

    const menuButton = doc.querySelector<HTMLElement>('.menu-btn');
    const navLinks = doc.querySelector<HTMLElement>('.nav-links');
    if (menuButton && navLinks) {
      listen(menuButton, 'click', () => {
        const isOpen = navLinks.classList.toggle('active');
        menuButton.setAttribute('aria-expanded', String(isOpen));
      });
    }

    const filterButtons = Array.from(doc.querySelectorAll<HTMLElement>('.filter-btn'));
    const portfolioItems = Array.from(doc.querySelectorAll<HTMLElement>('.portfolio-item'));
    filterButtons.forEach((button) => {
      listen(button, 'click', () => {
        filterButtons.forEach((item) => {
          item.classList.remove('active');
          item.setAttribute('aria-pressed', 'false');
        });
        button.classList.add('active');
        button.setAttribute('aria-pressed', 'true');
        const selected = button.getAttribute('data-filter');
        portfolioItems.forEach((item) => {
          const category = item.getAttribute('data-category');
          item.style.display = selected === 'all' || category === selected ? 'block' : 'none';
        });
      });
    });

    Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')).forEach((anchor) => {
      listen(anchor, 'click', (event) => {
        const href = anchor.getAttribute('href');
        if (!href || href === '#') return;
        const target = doc.getElementById(href.slice(1));
        if (!target) return;
        event.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        navLinks?.classList.remove('active');
        menuButton?.setAttribute('aria-expanded', 'false');
      });
    });

    previewCleanupRef.current = () => cleanups.forEach((cleanup) => cleanup());
  }, []);

  useEffect(() => () => previewCleanupRef.current?.(), []);

  const downloadHtml = () => {
    const element = document.createElement('a');
    const file = new Blob([themedHtmlContent], { type: 'text/html' });
    const objectUrl = URL.createObjectURL(file);
    element.href = objectUrl;
    element.download = `${sanitizeFilename(filename)}.html`;
    document.body.appendChild(element);
    element.click();
    element.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  };

  const copyToClipboard = () => navigator.clipboard.writeText(themedHtmlContent).then(
    () => addToast(t('tool_portfolio_copy_code_success'), 'success'),
    () => addToast(t('tool_portfolio_copy_code_fail'), 'error'),
  );

  const selectTabClass = (tab: 'preview' | 'deploy' | 'code') => `inline-flex min-h-11 items-center justify-center rounded-xl px-3 py-2 text-sm font-bold transition-colors ${
    resultTab === tab
      ? 'bg-white text-blue-700 shadow-sm ring-1 ring-gray-200 dark:bg-slate-900 dark:text-blue-300 dark:ring-slate-700'
      : 'text-gray-600 hover:bg-white/70 hover:text-gray-900 dark:text-slate-400 dark:hover:bg-slate-900/70 dark:hover:text-slate-100'
  }`;

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-600 dark:text-blue-400">{t('showcase_next_actions')}</p>
            <h4 className="mt-2 text-2xl font-bold text-gray-950 dark:text-gray-100">{title}</h4>
            <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-slate-400">{hint}</p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold">
              <span className="rounded-full bg-gray-100 px-3 py-1.5 text-gray-700 dark:bg-slate-800 dark:text-slate-300">{themeName}</span>
              {badges.map((badge) => (
                <span key={badge} className="rounded-full bg-gray-100 px-3 py-1.5 text-gray-700 dark:bg-slate-800 dark:text-slate-300">{badge}</span>
              ))}
            </div>
          </div>
          {headerActionSlot && <div className="shrink-0 self-start">{headerActionSlot}</div>}
          {showActionCards && (
            <div className="grid w-full gap-3 sm:grid-cols-2 xl:max-w-3xl xl:grid-cols-4">
              <ResultActionCard icon={Eye} title={t('showcase_review_title')} description={t('showcase_review_desc')} onClick={() => setResultTab('preview')} tone="primary" />
              <ResultActionCard icon={Download} title={t('showcase_download_title')} description={t('showcase_download_desc')} onClick={downloadHtml} />
              <ResultActionCard icon={Rocket} title={t('tool_portfolio_tab_deploy')} description={t('showcase_deploy_desc')} onClick={() => setResultTab('deploy')} />
              <ResultActionCard icon={Code2} title={t('tool_portfolio_tab_code')} description={t('showcase_code_desc')} onClick={() => setResultTab('code')} />
            </div>
          )}
        </div>
        {actionSlot && <div className="mt-5 border-t border-gray-200 pt-5 dark:border-slate-700">{actionSlot}</div>}
      </section>

      <div className="rounded-2xl border border-gray-200 bg-gray-100 p-1 dark:border-slate-700 dark:bg-slate-800/80">
        <nav role="tablist" aria-label={t('tool_portfolio_results_title')} className="grid grid-cols-3 gap-1">
          <button type="button" role="tab" aria-selected={resultTab === 'preview'} onClick={() => setResultTab('preview')} className={selectTabClass('preview')}>{t('tool_portfolio_tab_preview')}</button>
          <button type="button" role="tab" aria-selected={resultTab === 'deploy'} onClick={() => setResultTab('deploy')} className={selectTabClass('deploy')}>{t('tool_portfolio_tab_deploy')}</button>
          <button type="button" role="tab" aria-selected={resultTab === 'code'} onClick={() => setResultTab('code')} className={selectTabClass('code')}>{t('tool_portfolio_tab_code')}</button>
        </nav>
      </div>

      {resultTab === 'preview' && (
        <div className="space-y-3">
          <div className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              {(['desktop', 'tablet', 'mobile'] as const).map((device) => (
                <button key={device} type="button" aria-pressed={previewDevice === device} onClick={() => setPreviewDevice(device)} className={`rounded-md p-2 transition-colors ${previewDevice === device ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-300 dark:text-slate-400 dark:hover:bg-slate-700'}`} title={t(`tool_portfolio_preview_device_${device}`)}>
                  <span className="sr-only">{t(`tool_portfolio_preview_device_${device}`)}</span>
                  <span className="block h-5 w-5 rounded border-2 border-current" />
                </button>
              ))}
            </div>
            {showThemePicker && (
              <div className="flex flex-wrap items-center gap-2">
                {PORTFOLIO_TEMPLATES.map((template) => (
                  <button key={template.key} type="button" aria-pressed={previewTheme === template.key} onClick={() => { setPreviewTheme(template.key); onThemeChange?.(template.key); }} className={`rounded-md border-2 p-1 ${previewTheme === template.key ? 'border-blue-500' : 'border-transparent'}`} title={template.name}>
                    <div className="flex -space-x-1">{template.colors.map((color) => <div key={color} className="h-4 w-4 rounded-full border border-white dark:border-slate-800" style={{ backgroundColor: color }} />)}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="mx-auto overflow-x-auto rounded-xl bg-gray-900 p-3 shadow-inner sm:p-4">
            <iframe
              ref={previewFrameRef}
              title="Showcase Preview"
              aria-label={t('tool_portfolio_tab_preview')}
              srcDoc={previewHtmlContent}
              sandbox={PORTFOLIO_PREVIEW_SANDBOX}
              referrerPolicy="no-referrer"
              onLoad={wirePreviewInteractions}
              className="block h-[60vh] min-h-[520px] w-full border-0 bg-white transition-all duration-500 ease-in-out"
              style={{ maxWidth: PREVIEW_SIZES[previewDevice], margin: '0 auto' }}
            />
          </div>
        </div>
      )}

      {resultTab === 'deploy' && (
        <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600 dark:text-blue-400">{t('showcase_deploy_checklist')}</p>
              <h5 className="mt-1 text-lg font-bold text-gray-950 dark:text-gray-100">{t('tool_portfolio_tab_deploy')}</h5>
            </div>
            <button type="button" onClick={downloadHtml} className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm shadow-blue-600/20 transition hover:bg-blue-700">
              <Download className="h-4 w-4" />
              {t('tool_portfolio_deploy_download_button')}
            </button>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
              <span className="text-xs font-bold uppercase tracking-[0.16em] text-gray-400">01</span>
              <h5 className="mt-2 font-bold text-gray-950 dark:text-gray-100">{t('tool_portfolio_deploy_step1_title')}</h5>
              <p className="mt-1 text-sm dark:text-slate-400">{t('tool_portfolio_deploy_step1_desc')}</p>
              <a href="https://app.netlify.com/drop" target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-sm font-bold text-blue-700 hover:underline dark:text-blue-300">
                {t('showcase_open_netlify')}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
              <span className="text-xs font-bold uppercase tracking-[0.16em] text-gray-400">02</span>
              <h5 className="mt-2 font-bold text-gray-950 dark:text-gray-100">{t('tool_portfolio_deploy_step2_title')}</h5>
              <p className="mt-1 text-sm dark:text-slate-400">{t('tool_portfolio_deploy_step2_desc')}</p>
              <a href="https://hub.caiot.co/" target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-sm font-bold text-blue-700 hover:underline dark:text-blue-300">
                {t('tool_portfolio_deploy_open_lab_button')}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
              <span className="text-xs font-bold uppercase tracking-[0.16em] text-gray-400">03</span>
              <h5 className="mt-2 font-bold text-gray-950 dark:text-gray-100">{t('tool_portfolio_deploy_step3_title')}</h5>
              <p className="mt-1 text-sm dark:text-slate-400">{t('tool_portfolio_deploy_step3_desc')}</p>
            </div>
          </div>
        </div>
      )}

      {resultTab === 'code' && (
        <div className="space-y-3">
          <div className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-6 text-gray-600 dark:text-slate-400">{t('showcase_code_hint')}</p>
            <button type="button" onClick={copyToClipboard} className="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-gray-800 dark:bg-slate-700 dark:hover:bg-slate-600">
              <Code2 className="h-4 w-4" />
              {t('tool_portfolio_copy_code_button')}
            </button>
          </div>
          <pre className="h-[60vh] max-w-full overflow-auto rounded-lg bg-gray-800 p-4 text-xs text-white scrollbar-thin scrollbar-thumb-gray-600"><code className="language-html">{themedHtmlContent}</code></pre>
        </div>
      )}
    </div>
  );
};

export default PortfolioPreviewViewer;
