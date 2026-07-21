import React, { useState, useEffect, useMemo } from 'react';
import type { AppSession as Session } from '../../../lib/data';
import { data } from '../../../lib/data';
import type { UserProfile } from '../../../types';
import CompanyLogo from '../../CompanyLogo';
import { createPendingUploadTracker } from '../../../lib/storageObjectLifecycle';
import { deleteStorageObjectBestEffort } from '../../../services/storageObjects';
import { AlertCircle, Building2, CheckCircle2, ExternalLink, Loader2, RotateCcw, Save } from 'lucide-react';
import { PortalTopBar } from '../PortalTopBar';

interface PortalOrgProfileProps {
  session: Session;
  profile: UserProfile;
  darkMode: boolean;
  onSaved: () => Promise<void>;
  t: (key: string) => string;
}

const COMPANY_SIZE_OPTIONS = ['1-10', '11-50', '51-200', '201-500', '500+'] as const;
const DESCRIPTION_TARGET_LENGTH = 160;
const MIN_FOUNDED_YEAR = 1800;
const CURRENT_YEAR = new Date().getFullYear();

const toProfileValue = (value?: string | null) => value ?? '';

const normalizeWebsiteUrl = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.')) return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
};

const getFoundedYearError = (value: string, t: (key: string) => string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d{4}$/.test(trimmed)) {
    return t('portal_org_founded_error').replace('{year}', String(CURRENT_YEAR));
  }
  const year = Number(trimmed);
  if (year < MIN_FOUNDED_YEAR || year > CURRENT_YEAR) {
    return t('portal_org_founded_error').replace('{year}', String(CURRENT_YEAR));
  }
  return null;
};

export function PortalOrgProfile({ session, profile, darkMode, onSaved, t }: PortalOrgProfileProps) {
  const dm = darkMode;
  const [companyName, setCompanyName] = useState('');
  const [website, setWebsite] = useState('');
  const [description, setDescription] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [companySize, setCompanySize] = useState('');
  const [industry, setIndustry] = useState('');
  const [foundedYear, setFoundedYear] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const pendingLogoTracker = useMemo(
    () => createPendingUploadTracker(deleteStorageObjectBestEffort),
    [],
  );

  const initialValues = useMemo(() => ({
    companyName: toProfileValue(profile.company_name),
    website: toProfileValue(profile.company_website),
    description: toProfileValue(profile.company_description),
    logoUrl: profile.company_logo_url || null,
    companySize: toProfileValue(profile.company_size),
    industry: toProfileValue(profile.industry),
    foundedYear: toProfileValue(profile.founded_year),
  }), [
    profile.company_name,
    profile.company_website,
    profile.company_description,
    profile.company_logo_url,
    profile.company_size,
    profile.industry,
    profile.founded_year,
  ]);

  useEffect(() => {
    // A server refresh supersedes any unsaved local upload.
    void pendingLogoTracker.discard();
    setCompanyName(initialValues.companyName);
    setWebsite(initialValues.website);
    setDescription(initialValues.description);
    setLogoUrl(initialValues.logoUrl);
    setCompanySize(initialValues.companySize);
    setIndustry(initialValues.industry);
    setFoundedYear(initialValues.foundedYear);
  }, [initialValues, pendingLogoTracker]);

  useEffect(() => () => {
    // Navigating away without saving must not leave a random UUID object behind.
    void pendingLogoTracker.discard();
  }, [pendingLogoTracker]);

  const currentValues = useMemo(() => ({
    companyName,
    website,
    description,
    logoUrl,
    companySize,
    industry,
    foundedYear,
  }), [companyName, website, description, logoUrl, companySize, industry, foundedYear]);

  const isDirty = JSON.stringify(currentValues) !== JSON.stringify(initialValues);
  const normalizedWebsitePreview = normalizeWebsiteUrl(website);
  const websiteError = website.trim().length > 0 && normalizedWebsitePreview === null
    ? t('portal_org_website_error')
    : null;
  const foundedYearError = getFoundedYearError(foundedYear, t);
  const validationError = websiteError || foundedYearError;
  const completionItems = [
    { label: t('portal_org_name'), complete: companyName.trim().length > 0 },
    { label: t('portal_org_logo'), complete: Boolean(logoUrl) },
    { label: t('portal_org_website'), complete: website.trim().length > 0 && !websiteError },
    { label: t('org_company_size'), complete: companySize.trim().length > 0 },
    { label: t('org_industry'), complete: industry.trim().length > 0 },
    { label: t('org_founded_year'), complete: foundedYear.trim().length > 0 && !foundedYearError },
    { label: t('portal_org_desc'), complete: description.trim().length > 0 },
  ];
  const completedFields = completionItems.filter((item) => item.complete).length;
  const completionPercent = Math.round((completedFields / completionItems.length) * 100);
  const canSave = isDirty && companyName.trim().length > 0 && !saving && !validationError;
  const missingItem = completionItems.find((item) => !item.complete);
  const descriptionCount = description.trim().length;

  const resetForm = () => {
    void pendingLogoTracker.discard();
    setCompanyName(initialValues.companyName);
    setWebsite(initialValues.website);
    setDescription(initialValues.description);
    setLogoUrl(initialValues.logoUrl);
    setCompanySize(initialValues.companySize);
    setIndustry(initialValues.industry);
    setFoundedYear(initialValues.foundedYear);
    setMessage(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (validationError) {
      setMessage({ type: 'error', text: validationError });
      return;
    }
    if (!canSave) return;
    setSaving(true);
    setMessage(null);

    const normalized = {
      companyName: companyName.trim(),
      website: normalizedWebsitePreview || '',
      description: description.trim(),
      logoUrl,
      companySize: companySize.trim(),
      industry: industry.trim(),
      foundedYear: foundedYear.trim(),
    };

    try {
      const { error } = await data.profiles.update(session.user.id, {
        company_name: normalized.companyName,
        company_website: normalized.website,
        company_description: normalized.description,
        company_logo_url: normalized.logoUrl,
        company_size: normalized.companySize || null,
        industry: normalized.industry || null,
        founded_year: normalized.foundedYear || null,
      });

      if (error) throw error;
      await pendingLogoTracker.commit(
        initialValues.logoUrl,
        `company-logos/${session.user.id}`,
      );
      try {
        await onSaved();
      } catch (refreshError) {
        // The profile write already succeeded. A refresh failure should not be
        // reported as a failed save or trigger cleanup of the committed logo.
        console.error('Company profile refresh failed after save:', refreshError);
      }
      setMessage({ type: 'success', text: t('portal_org_saved') });
    } catch (err) {
      setMessage({ type: 'error', text: (err as Error).message || t('portal_org_save_failed') });
    } finally {
      setSaving(false);
    }
  };

  const card = `rounded-xl border p-6 ${dm ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`;
  const input = `w-full rounded-lg border px-4 py-2.5 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[#1d4ed8] focus:border-transparent ${
    dm ? 'border-gray-600 bg-gray-700 text-white placeholder:text-gray-500' : 'border-gray-300 bg-white text-gray-900 placeholder:text-gray-400'
  }`;
  const label = `block text-sm font-semibold mb-2 ${dm ? 'text-gray-300' : 'text-gray-700'}`;
  const muted = dm ? 'text-gray-400' : 'text-gray-600';

  return (
    <>
      <PortalTopBar title={t('portal_nav_org_profile')} darkMode={dm} />
      <div className="max-w-[1088px] mx-auto p-4 sm:p-6 lg:p-8 animate-view-fade">
        <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className={`text-2xl font-semibold ${dm ? 'text-white' : 'text-gray-900'}`}>{t('portal_nav_org_profile')}</h1>
            <p className={`mt-2 max-w-2xl text-sm leading-6 ${muted}`}>
              {t('portal_org_subtitle')}
            </p>
          </div>
          <div className={`rounded-xl border px-4 py-3 ${dm ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'}`}>
            <div className="flex items-center justify-between gap-4">
              <span className={`text-sm font-semibold ${dm ? 'text-gray-200' : 'text-gray-800'}`}>{t('portal_org_completion_label')}</span>
              <span className={`text-sm font-bold ${dm ? 'text-blue-300' : 'text-[#1d4ed8]'}`}>
                {t('portal_org_completion_value')
                  .replace('{completed}', String(completedFields))
                  .replace('{total}', String(completionItems.length))}
              </span>
            </div>
            <div className={`mt-3 h-2 w-56 overflow-hidden rounded-full ${dm ? 'bg-gray-700' : 'bg-gray-100'}`}>
              <div className="h-full rounded-full bg-[#1d4ed8] transition-all duration-500" style={{ width: `${completionPercent}%` }} />
            </div>
          </div>
        </div>

        <form onSubmit={handleSave} className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <div className={card}>
              <div className="flex items-center gap-2">
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${dm ? 'bg-gray-700' : 'bg-blue-50'}`}>
                  <Building2 className="h-5 w-5 text-[#1d4ed8]" aria-hidden="true" />
                </div>
                <div>
                  <h2 className={`text-base font-semibold ${dm ? 'text-white' : 'text-gray-900'}`}>{t('portal_org_brand_card_title')}</h2>
                  <p className={`text-xs ${muted}`}>{t('portal_org_brand_card_desc')}</p>
                </div>
              </div>

              <div className="mt-6 flex justify-center">
                <CompanyLogo
                  url={logoUrl}
                  size={112}
                  onUpload={async (upload) => {
                    await pendingLogoTracker.replace(upload);
                    setLogoUrl(upload.url);
                    setMessage(null);
                  }}
                  altText={t('portal_org_logo_alt')}
                  uploadLabel={t('portal_org_logo_upload')}
                  uploadingLabel={t('portal_org_logo_uploading')}
                  signInRequiredMessage={t('portal_org_logo_sign_in_required')}
                  maxSizeMessage={t('account_avatar_size_error')}
                  timeoutMessage={t('account_avatar_timeout_error')}
                />
              </div>

              <div className={`mt-6 rounded-lg border p-4 ${dm ? 'border-gray-700 bg-gray-900/60' : 'border-gray-200 bg-gray-50'}`}>
                <p className={`text-sm font-semibold ${dm ? 'text-white' : 'text-gray-900'}`}>
                  {companyName.trim() || t('portal_org_name_ph')}
                </p>
                <p className={`mt-1 text-xs ${muted}`}>
                  {[industry, companySize].filter(Boolean).join(' · ') || t('portal_org_profile_preview')}
                </p>
                {normalizedWebsitePreview && (
                  <p className={`mt-2 flex items-center gap-1 text-xs ${dm ? 'text-blue-300' : 'text-blue-700'}`}>
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    <span className="truncate">{normalizedWebsitePreview.replace(/^https?:\/\//, '')}</span>
                  </p>
                )}
                <div className={`mt-4 rounded-lg border px-3 py-2 text-xs leading-5 ${dm ? 'border-gray-700 bg-gray-950/60 text-gray-300' : 'border-gray-200 bg-white text-gray-600'}`}>
                  <p className={`font-semibold ${dm ? 'text-gray-100' : 'text-gray-900'}`}>
                    {t('portal_org_candidate_view_title')}
                  </p>
                  <p className="mt-1">
                    {missingItem
                      ? t('portal_org_next_step').replace('{field}', missingItem.label)
                      : t('portal_org_ready_for_candidates')}
                  </p>
                </div>
              </div>

              <div className="mt-5 space-y-2">
                {completionItems.map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-3">
                    <span className={`text-xs ${muted}`}>{item.label}</span>
                    {item.complete
                      ? <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" />
                      : <span className={`h-4 w-4 rounded-full border ${dm ? 'border-gray-600' : 'border-gray-300'}`} aria-hidden="true" />}
                  </div>
                ))}
              </div>
            </div>

            {isDirty && (
              <div className={`animate-panel-expand rounded-xl border p-4 text-sm ${dm ? 'border-amber-800 bg-amber-950/20 text-amber-200' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
                  <span>{t('portal_org_unsaved_changes')}</span>
                </div>
              </div>
            )}
          </aside>

          <div className={card}>
            <div className="mb-6">
              <h2 className={`text-xl font-semibold ${dm ? 'text-white' : 'text-gray-900'}`}>
                {t('portal_org_info_title')}
              </h2>
              <p className={`mt-1 text-sm ${muted}`}>{t('portal_org_required_note')}</p>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="portal-org-name" className={label}>
                  {t('portal_org_name')} <span className="text-red-500">*</span>
                </label>
                <input
                  id="portal-org-name"
                  type="text"
                  value={companyName}
                  onChange={(e) => {
                    setCompanyName(e.target.value);
                    setMessage(null);
                  }}
                  required
                  placeholder={t('portal_org_name_ph')}
                  className={input}
                />
              </div>

              <div>
                <label htmlFor="portal-org-website" className={label}>{t('portal_org_website')}</label>
                <input
                  id="portal-org-website"
                  type="text"
                  inputMode="url"
                  value={website}
                  onChange={(e) => {
                    setWebsite(e.target.value);
                    setMessage(null);
                  }}
                  onBlur={() => {
                    if (normalizedWebsitePreview) {
                      setWebsite(normalizedWebsitePreview);
                    }
                  }}
                  placeholder="https://www.example.com"
                  className={`${input} ${websiteError ? 'border-red-400 focus:ring-red-400' : ''}`}
                  aria-invalid={Boolean(websiteError)}
                  aria-describedby="portal-org-website-help"
                />
                <p
                  id="portal-org-website-help"
                  className={`mt-1 text-xs ${websiteError ? 'text-red-600 dark:text-red-400' : muted}`}
                >
                  {websiteError || t('portal_org_website_hint')}
                </p>
              </div>

              <div>
                <label htmlFor="portal-org-size" className={label}>{t('org_company_size')}</label>
                <select
                  id="portal-org-size"
                  value={companySize}
                  onChange={(e) => {
                    setCompanySize(e.target.value);
                    setMessage(null);
                  }}
                  className={`${input} appearance-none`}
                >
                  <option value="">—</option>
                  {COMPANY_SIZE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="portal-org-industry" className={label}>{t('org_industry')}</label>
                <input
                  id="portal-org-industry"
                  type="text"
                  value={industry}
                  onChange={(e) => {
                    setIndustry(e.target.value);
                    setMessage(null);
                  }}
                  placeholder={t('org_industry_ph')}
                  className={input}
                />
              </div>

              <div>
                <label htmlFor="portal-org-founded-year" className={label}>{t('org_founded_year')}</label>
                <input
                  id="portal-org-founded-year"
                  type="text"
                  inputMode="numeric"
                  pattern="\d{4}"
                  maxLength={4}
                  value={foundedYear}
                  onChange={(e) => {
                    setFoundedYear(e.target.value);
                    setMessage(null);
                  }}
                  placeholder={t('portal_org_founded_ph')}
                  className={`${input} ${foundedYearError ? 'border-red-400 focus:ring-red-400' : ''}`}
                  aria-invalid={Boolean(foundedYearError)}
                  aria-describedby="portal-org-founded-help"
                />
                <p
                  id="portal-org-founded-help"
                  className={`mt-1 text-xs ${foundedYearError ? 'text-red-600 dark:text-red-400' : muted}`}
                >
                  {foundedYearError || t('portal_org_founded_hint').replace('{year}', String(CURRENT_YEAR))}
                </p>
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="portal-org-description" className={label}>{t('portal_org_desc')}</label>
                <textarea
                  id="portal-org-description"
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    setMessage(null);
                  }}
                  placeholder={t('portal_org_desc_ph')}
                  rows={6}
                  aria-describedby="portal-org-description-help"
                  className={`${input} resize-y leading-6`}
                />
                <div
                  id="portal-org-description-help"
                  className={`mt-1 flex flex-col gap-1 text-xs sm:flex-row sm:items-center sm:justify-between ${muted}`}
                >
                  <span>{t('portal_org_description_hint')}</span>
                  <span className={descriptionCount >= DESCRIPTION_TARGET_LENGTH ? 'text-emerald-600 dark:text-emerald-400' : ''}>
                    {t('portal_org_description_count')
                      .replace('{count}', String(descriptionCount))
                      .replace('{target}', String(DESCRIPTION_TARGET_LENGTH))}
                  </span>
                </div>
              </div>
            </div>

            {message && (
              <div
                role={message.type === 'error' ? 'alert' : 'status'}
                aria-live={message.type === 'error' ? 'assertive' : 'polite'}
                className={`mt-5 animate-panel-expand rounded-lg border px-4 py-3 text-sm ${
                  message.type === 'success'
                    ? dm ? 'border-emerald-800 bg-emerald-950/20 text-emerald-200' : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : dm ? 'border-red-900 bg-red-950/20 text-red-200' : 'border-red-200 bg-red-50 text-red-700'
                }`}
              >
                {message.text}
              </div>
            )}

            <div className="mt-6 flex flex-col gap-3 border-t pt-5 sm:flex-row sm:justify-end sm:border-gray-200 dark:border-gray-700">
              <button
                type="button"
                onClick={resetForm}
                disabled={!isDirty || saving}
                className={`inline-flex items-center justify-center gap-2 rounded-lg border px-5 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  dm ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                {t('portal_org_cancel')}
              </button>
              <button
                type="submit"
                disabled={!canSave}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#1d4ed8] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1a45c9] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving
                  ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  : <Save className="h-4 w-4" aria-hidden="true" />}
                {saving ? t('portal_org_saving') : isDirty ? t('portal_org_save') : t('portal_org_no_changes')}
              </button>
            </div>
          </div>
        </form>
      </div>
    </>
  );
}
