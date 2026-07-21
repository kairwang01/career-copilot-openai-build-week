import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, CalendarDays, Globe, Plus, Sparkles, Trash2 } from 'lucide-react';
import type { AppSession as Session } from '../lib/data';
import type { UserProfile } from '../types';
import {
  deleteSavedPortfolio,
  listSavedPortfolios,
  loadPortfolioHtml,
  type SavedPortfolio,
} from '../services/savedPortfolios';
import PortfolioPreviewViewer, { PORTFOLIO_TEMPLATES } from './showcase/PortfolioPreviewViewer';
import { useToast } from './Toast';
import { ViewportAwareDialog } from './ViewportAwareDialog';
import ConfirmActionDialog from './ConfirmActionDialog';

const PortfolioWebsiteBuilder = React.lazy(() => import('./tools/PortfolioWebsiteBuilder'));

interface ShowcasePageProps {
  resumeText: string;
  session: Session | null;
  profile: UserProfile | null;
  t: (key: string) => string;
  onUnsavedChange?: (hasUnsaved: boolean) => void;
}

type ShowcaseTab = 'mine' | 'build';

const formatDate = (millis: number) => new Date(millis).toLocaleDateString(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

const TemplateCover: React.FC<{ theme: string; title: string }> = ({ theme, title }) => {
  const template = PORTFOLIO_TEMPLATES.find((item) => item.key === theme) ?? PORTFOLIO_TEMPLATES[0];
  return (
    <div className="relative h-40 overflow-hidden rounded-t-xl" style={{ background: template.colors[1] }}>
      <div className="absolute inset-x-5 top-5 h-4 rounded-full" style={{ background: template.colors[0] }} />
      <div className="absolute left-5 top-14 h-16 w-16 rounded-full border-4 border-white" style={{ background: template.colors[3] }} />
      <div className="absolute left-28 right-5 top-16 space-y-2">
        <div className="h-3 rounded-full" style={{ background: template.colors[2] }} />
        <div className="h-3 w-2/3 rounded-full bg-white/80" />
      </div>
      <div className="absolute inset-x-5 bottom-5 grid grid-cols-3 gap-2">
        {[0, 1, 2].map((item) => (
          <div key={item} className="h-10 rounded-lg bg-white/85" />
        ))}
      </div>
      <span className="sr-only">{title}</span>
    </div>
  );
};

const ShowcasePage: React.FC<ShowcasePageProps> = ({ resumeText, session, profile, t, onUnsavedChange }) => {
  const { addToast } = useToast();
  const uid = session?.user?.id ?? null;
  const [tab, setTab] = useState<ShowcaseTab | null>(null);
  const [portfolios, setPortfolios] = useState<SavedPortfolio[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const [selected, setSelected] = useState<SavedPortfolio | null>(null);
  const [selectedHtml, setSelectedHtml] = useState('');
  const [selectedLoading, setSelectedLoading] = useState(false);
  const [revealedDeleteId, setRevealedDeleteId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SavedPortfolio | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingTab, setPendingTab] = useState<ShowcaseTab | null>(null);
  const initialTabRef = useRef<string | null>(null);

  const setUnsaved = useCallback((next: boolean) => {
    setHasUnsaved(next);
    onUnsavedChange?.(next);
  }, [onUnsavedChange]);

  const refreshPortfolios = useCallback(async () => {
    if (!uid) {
      setPortfolios([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const items = await listSavedPortfolios(uid);
      setPortfolios(items);
      if (initialTabRef.current !== uid) {
        initialTabRef.current = uid;
        setTab(items.length > 0 ? 'mine' : 'build');
      }
    } catch {
      setLoadError(t('showcase_list_load_failed'));
      if (initialTabRef.current !== uid) {
        initialTabRef.current = uid;
        setTab('build');
      }
    } finally {
      setLoading(false);
    }
  }, [t, uid]);

  useEffect(() => {
    void refreshPortfolios();
  }, [refreshPortfolios]);

  useEffect(() => {
    if (!hasUnsaved) return undefined;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [hasUnsaved]);

  const switchTab = (next: ShowcaseTab) => {
    if (tab === next) return;
    if (hasUnsaved) {
      setPendingTab(next);
      return;
    }
    setUnsaved(false);
    setSelected(null);
    setSelectedHtml('');
    setTab(next);
  };

  const confirmLeaveUnsaved = () => {
    if (!pendingTab) return;
    const next = pendingTab;
    setPendingTab(null);
    setUnsaved(false);
    setSelected(null);
    setSelectedHtml('');
    setTab(next);
  };

  const openPortfolio = async (portfolio: SavedPortfolio) => {
    setSelected(portfolio);
    setRevealedDeleteId(null);
    setSelectedHtml('');
    setSelectedLoading(true);
    try {
      setSelectedHtml(await loadPortfolioHtml(portfolio.html_path));
    } catch {
      setLoadError(t('showcase_detail_load_failed'));
    } finally {
      setSelectedLoading(false);
    }
  };

  const requestDelete = (portfolio: SavedPortfolio) => {
    setRevealedDeleteId(null);
    setDeleteTarget(portfolio);
  };

  const confirmDelete = async () => {
    if (!uid || !deleteTarget || deletingId) return;
    const target = deleteTarget;
    setDeletingId(target.id);
    try {
      await deleteSavedPortfolio(uid, target);
      setPortfolios((items) => items.filter((item) => item.id !== target.id));
      if (selected?.id === target.id) {
        setSelected(null);
        setSelectedHtml('');
      }
      setDeleteTarget(null);
      addToast(t('showcase_delete_success'), 'success');
      void refreshPortfolios();
    } catch {
      addToast(t('showcase_delete_failed'), 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const deleteButton = (portfolio: SavedPortfolio, className = '') => (
    <button
      type="button"
      data-qa="showcase-delete-button"
      onClick={(event) => {
        event.stopPropagation();
        requestDelete(portfolio);
      }}
      className={`inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700 shadow-sm transition hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-900/40 ${className}`}
      aria-label={t('showcase_delete_button')}
    >
      <Trash2 className="h-4 w-4" />
      <span>{t('showcase_delete_button')}</span>
    </button>
  );

  const deleteConfirmDialog = (
    <ViewportAwareDialog
      open={Boolean(deleteTarget)}
      onClose={() => {
        if (!deletingId) setDeleteTarget(null);
      }}
      closeOnBackdrop
      labelledBy="showcase-delete-title"
      describedBy="showcase-delete-desc"
      maxWidth={448}
      zIndex={100}
    >
      <div data-qa="showcase-delete-dialog" className="rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900">
        <div className="flex items-start gap-4">
          <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300">
            <Trash2 className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 id="showcase-delete-title" className="text-lg font-bold text-gray-950 dark:text-gray-100">{t('showcase_delete_confirm_title')}</h3>
            <p id="showcase-delete-desc" className="mt-2 text-sm leading-6 text-gray-600 dark:text-slate-400">
              {t('showcase_delete_confirm_desc').replace('{name}', deleteTarget?.name ?? '')}
            </p>
          </div>
        </div>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            data-qa="showcase-delete-cancel"
            onClick={() => setDeleteTarget(null)}
            disabled={Boolean(deletingId)}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 transition hover:bg-gray-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {t('showcase_delete_cancel')}
          </button>
          <button
            type="button"
            data-qa="showcase-delete-confirm"
            onClick={() => void confirmDelete()}
            disabled={Boolean(deletingId)}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white shadow-sm shadow-red-600/20 transition hover:bg-red-700 disabled:opacity-60"
          >
            <Trash2 className="h-4 w-4" />
            {deletingId ? t('showcase_deleting') : t('showcase_delete_confirm_button')}
          </button>
        </div>
      </div>
    </ViewportAwareDialog>
  );

  if (selected) {
    return (
      <div data-qa="showcase-detail-view" className="space-y-5">
        <button
          type="button"
          data-qa="showcase-back-to-list"
          onClick={() => { setSelected(null); setSelectedHtml(''); }}
          className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700 transition hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('showcase_back_to_list')}
        </button>
        {selectedLoading ? (
          <div data-qa="showcase-detail-loading" className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            {t('showcase_loading')}
          </div>
        ) : selectedHtml ? (
          <PortfolioPreviewViewer
            htmlContent={selectedHtml}
            theme={selected.theme}
            title={selected.name}
            hint={t('showcase_saved_hint').replace('{date}', formatDate(selected.created_at))}
            filename={selected.name}
            badges={[formatDate(selected.created_at)]}
            showActionCards={false}
            showThemePicker={false}
            headerActionSlot={deleteButton(selected)}
            t={t}
          />
        ) : (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
            {t('showcase_detail_load_failed')}
          </div>
        )}
        {deleteConfirmDialog}
      </div>
    );
  }

  const activeTab = tab ?? 'build';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-600 dark:text-blue-400">{t('ws_nav_portfolio')}</p>
          <h2 className="mt-1 text-2xl font-bold text-gray-950 dark:text-gray-100">{t('showcase_title')}</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">{t('showcase_subtitle')}</p>
        </div>
        <div className="grid rounded-2xl border border-gray-200 bg-gray-100 p-1 dark:border-slate-700 dark:bg-slate-800 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => switchTab('mine')}
            data-qa="showcase-tab-mine"
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition ${activeTab === 'mine' ? 'bg-white text-blue-700 shadow-sm dark:bg-slate-950 dark:text-blue-300' : 'text-gray-600 hover:text-gray-950 dark:text-slate-400 dark:hover:text-white'}`}
          >
            <Globe className="h-4 w-4" />
            {t('showcase_tab_mine')}
          </button>
          <button
            type="button"
            onClick={() => switchTab('build')}
            data-qa="showcase-tab-build"
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition ${activeTab === 'build' ? 'bg-white text-blue-700 shadow-sm dark:bg-slate-950 dark:text-blue-300' : 'text-gray-600 hover:text-gray-950 dark:text-slate-400 dark:hover:text-white'}`}
          >
            <Sparkles className="h-4 w-4" />
            {t('showcase_tab_build')}
          </button>
        </div>
      </div>

      {loadError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
          {loadError}
        </div>
      )}

      {activeTab === 'mine' ? (
        loading ? (
          <div data-qa="showcase-list-loading" className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            {t('showcase_loading')}
          </div>
        ) : portfolios.length > 0 ? (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {portfolios.map((portfolio) => (
              <div
                key={portfolio.id}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setRevealedDeleteId(portfolio.id);
                }}
                className="group relative overflow-hidden rounded-xl border border-gray-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-blue-800"
              >
                {revealedDeleteId === portfolio.id && deleteButton(portfolio, 'absolute right-3 top-3 z-10')}
                <button
                  type="button"
                  onClick={() => void openPortfolio(portfolio)}
                  data-qa="showcase-saved-card"
                  className="block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <TemplateCover theme={portfolio.theme} title={portfolio.name} />
                  <div className="p-4">
                    <h3 className="truncate text-base font-bold text-gray-950 dark:text-gray-100">{portfolio.name}</h3>
                    <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-slate-400">
                      <CalendarDays className="h-4 w-4" />
                      {t('showcase_saved_on').replace('{date}', formatDate(portfolio.created_at))}
                    </p>
                  </div>
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div data-qa="showcase-empty-state" className="rounded-3xl border border-dashed border-gray-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
            <h3 className="text-lg font-bold text-gray-950 dark:text-gray-100">{t('showcase_empty_title')}</h3>
            <p className="mx-auto mt-2 max-w-xl text-sm text-gray-600 dark:text-slate-400">{t('showcase_empty_desc')}</p>
            <button
              type="button"
              onClick={() => switchTab('build')}
              className="mt-5 inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              {t('showcase_tab_build')}
            </button>
          </div>
        )
      ) : (
        <Suspense fallback={<div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">{t('showcase_loading')}</div>}>
          <PortfolioWebsiteBuilder
            resumeText={resumeText}
            profile={profile}
            session={session}
            t={t}
            onUnsavedPortfolioChange={setUnsaved}
            onSavedPortfolio={() => {
              setUnsaved(false);
              void refreshPortfolios().then(() => setTab('mine'));
            }}
          />
        </Suspense>
      )}

      {deleteConfirmDialog}
      <ConfirmActionDialog
        open={Boolean(pendingTab)}
        title={t('showcase_unsaved_leave_title')}
        description={t('showcase_unsaved_leave_confirm')}
        dataQa="showcase-unsaved-leave-dialog"
        cancelLabel={t('showcase_delete_cancel')}
        confirmLabel={t('showcase_unsaved_leave_button')}
        tone="danger"
        onOpenChange={(open) => {
          if (!open) setPendingTab(null);
        }}
        onCancel={() => setPendingTab(null)}
        onConfirm={confirmLeaveUnsaved}
      />
    </div>
  );
};

export default ShowcasePage;
