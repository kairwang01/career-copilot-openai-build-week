/**
 * CompanyReviewModal — 5-star rating + text review submission modal.
 *
 * Props:
 *   employerId   — Firestore employer uid
 *   companyLabel — display name (may be a generic fallback)
 *   t            — translation function
 *   onClose      — called when user dismisses the modal
 *   onSubmitted  — called after a successful submission
 *
 * Verification errors (failed-precondition) surface as an inline message;
 * other errors fall back to a generic toast.
 */

import React, { useState, useRef, useEffect } from "react";
import { Star, X } from "lucide-react";
import { useToast } from "./Toast";
import { ViewportAwareDialog } from "./ViewportAwareDialog";
import { submitCompanyReview } from "../lib/companyReviewsData";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface CompanyReviewModalProps {
  employerId: string;
  companyLabel: string;
  t: (key: string) => string;
  onClose: () => void;
  onSubmitted: () => void;
}

// ─── Star picker ───────────────────────────────────────────────────────────────

interface StarPickerProps {
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
  optionLabel: string;
}

const StarPicker: React.FC<StarPickerProps> = ({ value, onChange, disabled, optionLabel }) => {
  const [hovered, setHovered] = useState(0);

  return (
    <div
      className="flex items-center gap-1"
      onMouseLeave={() => setHovered(0)}
    >
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= (hovered || value);
        return (
          <label
            key={star}
            onMouseEnter={() => setHovered(star)}
            className={`rounded p-0.5 transition-colors ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
          >
            <input
              type="radio"
              name="company-review-rating"
              value={star}
              checked={value === star}
              onChange={() => onChange(star)}
              disabled={disabled}
              required
              className="peer sr-only"
            />
            <Star
              aria-hidden="true"
              className={`h-7 w-7 transition-colors ${
                filled
                  ? "fill-yellow-400 text-yellow-400"
                  : "fill-none text-gray-300 dark:text-slate-600"
              } peer-focus-visible:rounded peer-focus-visible:ring-2 peer-focus-visible:ring-yellow-400 peer-focus-visible:ring-offset-2`}
            />
            <span className="sr-only">{optionLabel.replace("{n}", String(star))}</span>
          </label>
        );
      })}
    </div>
  );
};

// ─── Modal ─────────────────────────────────────────────────────────────────────

const CompanyReviewModal: React.FC<CompanyReviewModalProps> = ({
  employerId,
  companyLabel,
  t,
  onClose,
  onSubmitted,
}) => {
  const { addToast } = useToast();
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [verifyError, setVerifyError] = useState(false);
  // Ref latch: the `submitting` state lags a render, so a fast double-submit could post
  // two reviews. mountedRef drops the tail setState if the parent closes the modal mid-submit.
  const submittingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const charCount = text.trim().length;
  const canSubmit = rating >= 1 && charCount >= 20 && charCount <= 2000 && !submitting;
  const titleId = "company-review-modal-title";
  const textId = "company-review-text";
  const textRequirementsId = "company-review-text-requirements";
  const textCountId = "company-review-text-count";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    if (submittingRef.current) return; // already posting — block synchronous double-submit
    submittingRef.current = true;

    setSubmitting(true);
    setVerifyError(false);

    try {
      await submitCompanyReview(employerId, rating, text.trim());
      addToast(t("review_submit_success"), "success");
      onSubmitted();
      onClose();
    } catch (err: unknown) {
      if (!mountedRef.current) return; // modal closed mid-submit — nothing to show
      // Firebase callable errors carry a `code` field on the inner error.
      const code =
        (err as { code?: string })?.code ??
        ((err as { details?: { code?: string } })?.details?.code ?? "");
      if (code === "failed-precondition" || String(err).includes("failed-precondition")) {
        setVerifyError(true);
      } else {
        addToast(t("review_submit_error"), "error");
      }
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setSubmitting(false);
    }
  };

  return (
    <ViewportAwareDialog
      open
      onClose={onClose}
      closeOnBackdrop
      labelledBy={titleId}
      maxWidth={448}
      zIndex={50}
    >
      <div className="relative flex min-w-0 flex-col rounded-2xl border border-gray-100 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100 dark:border-slate-700">
          <h2 id={titleId} className="min-w-0 font-bold text-base text-gray-900 dark:text-gray-100 leading-snug">
            {t("review_modal_title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full p-1 text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            aria-label={t("review_cancel")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          {/* Company name */}
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            {companyLabel}
          </p>

          {/* Verified-employee note */}
          <p className="text-xs text-gray-500 dark:text-slate-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/50 rounded-lg px-3 py-2">
            {t("review_verified_note")}
          </p>

          {/* Star picker */}
          <fieldset className="min-w-0 space-y-1">
            <legend className="text-xs font-semibold text-gray-600 dark:text-slate-400 uppercase tracking-wide">
              {t("review_rating_label")}
            </legend>
            <StarPicker
              value={rating}
              onChange={setRating}
              disabled={submitting}
              optionLabel={t("review_star_option")}
            />
          </fieldset>

          {/* Text area */}
          <div className="space-y-1">
            <label htmlFor={textId} className="text-xs font-semibold text-gray-600 dark:text-slate-400 uppercase tracking-wide">
              {t("review_text_label")}
            </label>
            <textarea
              id={textId}
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={submitting}
              rows={5}
              required
              minLength={20}
              maxLength={2000}
              aria-invalid={charCount > 0 && charCount < 20}
              aria-describedby={`${textRequirementsId} ${textCountId}`}
              placeholder={t("review_text_ph")}
              className="w-full rounded-xl border border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-900 px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-slate-500 outline-none focus:border-blue-400 dark:focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40 transition resize-none disabled:opacity-60"
            />
            <span id={textRequirementsId} className="sr-only">{t("review_text_ph")}</span>
            {/* Char counter */}
            <div className="flex justify-end">
              <span
                id={textCountId}
                className={`text-[11px] tabular-nums ${
                  charCount > 2000
                    ? "text-red-500"
                    : charCount < 20 && charCount > 0
                    ? "text-amber-500 dark:text-amber-400"
                    : "text-gray-400 dark:text-slate-500"
                }`}
              >
                {charCount} / 2000
              </span>
            </div>
          </div>

          {/* Verification error */}
          {verifyError && (
            <div role="alert" className="rounded-lg border border-amber-200 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              {t("review_not_verified")}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-lg px-4 py-2 text-sm font-semibold text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors sm:w-auto"
            >
              {t("review_cancel")}
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              aria-busy={submitting}
              className="w-full rounded-lg px-4 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed sm:w-auto"
            >
              {submitting ? t("review_submitting") : t("review_submit")}
            </button>
          </div>
        </form>
      </div>
    </ViewportAwareDialog>
  );
};

export default CompanyReviewModal;
