import React, { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Bookmark, Check, ChevronDown, Copy, Download, FileText, Loader2, Lock, Printer, RefreshCw, Trash2 } from 'lucide-react';
import { Packer, Document, Paragraph, TextRun, HeadingLevel, LevelFormat, AlignmentType } from 'docx';
import { useLocalization } from '../../hooks/useLocalization';
import type { ToolSaveState } from '../../contexts/ToolResultsContext';

/**
 * Toolbar shown above a tool's result. For PAID users it confirms the result is
 * saved (so it'll be here free next time) and offers "Try next" to re-run (uses
 * credits). For FREE users it shows an upgrade nudge instead of a save badge.
 */
export const SavedResultBar: React.FC<{
  t: (key: string) => string;
  onTryNext: () => void;
  canSave: boolean;
  /** True when the result on screen is the cloud-cached one (vs. a fresh run). */
  isSaved: boolean;
  savedAt?: number | null;
  saveState?: ToolSaveState;
  onUpgrade?: () => void;
  onClearSaved?: () => void;
}> = ({ t, onTryNext, canSave, isSaved, savedAt, saveState, onUpgrade, onClearSaved }) => {
  const dateStr = savedAt ? new Date(savedAt).toLocaleDateString() : '';
  const hasSavedResult = Boolean(savedAt);
  const effectiveSaveState = saveState ?? (hasSavedResult ? 'saved' : 'idle');
  const isSavingResult = canSave && effectiveSaveState === 'saving';
  const canRemoveSaved = canSave && hasSavedResult && !isSavingResult && Boolean(onClearSaved);
  const handleUpgrade = onUpgrade ?? (() => {
    if (typeof window !== 'undefined') window.location.assign('/pricing');
  });

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 dark:border-slate-700 dark:bg-slate-800/50">
      <div
        className="flex items-center gap-2 text-sm"
        data-qa="tool-save-status"
        data-save-state={effectiveSaveState}
        role="status"
        aria-live="polite"
        aria-busy={isSavingResult}
      >
        {canSave ? (
          <>
            {effectiveSaveState === 'saving' ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-600 dark:text-blue-400" aria-hidden="true" />
            ) : effectiveSaveState === 'failed' ? (
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />
            ) : (
              <Bookmark className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            )}
            <span className={`font-medium ${effectiveSaveState === 'failed' ? 'text-rose-700 dark:text-rose-300' : 'text-slate-700 dark:text-slate-200'}`}>
              {effectiveSaveState === 'saving'
                ? t('tool_saving_label')
                : effectiveSaveState === 'failed'
                  ? t('tool_save_failed')
                  : hasSavedResult
                    ? (isSaved
                      ? (dateStr ? t('tool_saved_on').replace('{date}', dateStr) : t('tool_saved_label'))
                      : t('tool_saved_just_now'))
                    : t('tool_saved_not_saved')}
            </span>
          </>
        ) : (
          <>
            <Lock className="h-4 w-4 shrink-0 text-slate-400" />
            <button
              type="button"
              onClick={handleUpgrade}
              className="font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              {t('tool_saved_upgrade_hint')}
            </button>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {canRemoveSaved && (
          <button
            type="button"
            onClick={() => onClearSaved?.()}
            data-qa="tool-remove-saved"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('tool_remove_saved')}
          </button>
        )}
        <button
          type="button"
          onClick={onTryNext}
          data-qa="tool-try-next"
          disabled={isSavingResult}
          title={isSavingResult ? t('tool_saving_label') : undefined}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300 disabled:hover:bg-blue-300 dark:disabled:bg-blue-900/50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t('tool_try_next')}
        </button>
      </div>
    </div>
  );
};

/** Shared error box so every tool surfaces failures with the same look. */
export const ToolError: React.FC<{
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  retryDisabled?: boolean;
}> = ({ message, onRetry, retryLabel = 'Try again', retryDisabled = false }) => (
  <div
    role="alert"
    data-qa="tool-error"
    className="animate-panel-expand rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800/50 dark:bg-red-900/20"
  >
    <div className="flex items-start gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-6 text-red-800 dark:text-red-200">{message}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={retryDisabled}
            className="mt-3 inline-flex min-h-9 items-center justify-center rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-700 dark:bg-red-950/30 dark:text-red-200 dark:hover:bg-red-900/30"
          >
            {retryLabel}
          </button>
        )}
      </div>
    </div>
  </div>
);

type CopyButtonStatus = 'idle' | 'copying' | 'copied' | 'failed';

/** Copy-to-clipboard with inline confirmation and failure feedback. */
export const CopyButton: React.FC<{
  text: string;
  label?: string;
  copiedLabel?: string;
  failedLabel?: string;
  className?: string;
}> = ({
  text,
  label = 'Copy',
  copiedLabel = 'Copied',
  failedLabel,
  className = '',
}) => {
  const { t } = useLocalization();
  const [status, setStatus] = useState<CopyButtonStatus>('idle');
  const copyingRef = useRef(false);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyUnavailableLabel = failedLabel ?? (() => {
    const localized = t('tool_copy_failed');
    return localized === 'tool_copy_failed' ? 'Copy failed' : localized;
  })();

  useEffect(() => () => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
  }, []);

  const resetStatusAfter = (delayMs: number) => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => setStatus('idle'), delayMs);
  };

  const handleCopy = async () => {
    if (copyingRef.current) return;
    copyingRef.current = true;
    setStatus('copying');
    try {
      const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
      if (!clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await clipboard.writeText(text);
      setStatus('copied');
      resetStatusAfter(2000);
    } catch {
      setStatus('failed');
      resetStatusAfter(3200);
    } finally {
      copyingRef.current = false;
    }
  };

  const currentLabel = status === 'copied'
    ? copiedLabel
    : status === 'failed'
      ? copyUnavailableLabel
      : label;

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={status === 'copying'}
      aria-live="polite"
      aria-busy={status === 'copying'}
      aria-label={currentLabel}
      data-copy-state={status}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors ${
        status === 'copied'
          ? 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
          : status === 'failed'
            ? 'border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300'
          : 'border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:cursor-wait disabled:opacity-70'
      } ${className}`}
    >
      {status === 'copying' ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : status === 'copied' ? (
        <Check className="h-3.5 w-3.5" />
      ) : status === 'failed' ? (
        <AlertTriangle className="h-3.5 w-3.5" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {currentLabel}
    </button>
  );
};

const FORMATTED_HEADING_CLASSES: Record<number, string> = {
  1: 'mt-5 mb-2 text-base font-semibold leading-6 text-slate-950 dark:text-white',
  2: 'mt-4 mb-2 text-sm font-semibold uppercase tracking-[0.08em] text-slate-700 dark:text-slate-200',
  3: 'mt-3 mb-1.5 text-sm font-semibold leading-6 text-slate-800 dark:text-slate-100',
};

const formattedHeadingClass = (markdownLevel: number): string => (
  FORMATTED_HEADING_CLASSES[Math.min(markdownLevel, 3)] || FORMATTED_HEADING_CLASSES[3]
);

type MarkdownListKind = 'ordered' | 'unordered';

const ORDERED_NUMBERING_REFERENCE = 'career-copilot-ordered-list';

const parseMarkdownListItem = (line: string): { kind: MarkdownListKind; text: string } | null => {
  const trimmedLine = line.trim();
  const unorderedMatch = trimmedLine.match(/^[-*]\s+(.+)$/);
  if (unorderedMatch) return { kind: 'unordered', text: unorderedMatch[1] };

  const orderedMatch = trimmedLine.match(/^\d+[.)]\s+(.+)$/);
  if (orderedMatch) return { kind: 'ordered', text: orderedMatch[1] };

  return null;
};

export const renderFormattedText = (text: string) => {
    const lines = text.split('\n');
    const elements: React.ReactNode[] = [];
    let listItems: string[] = [];
    let listKind: MarkdownListKind | null = null;

    const renderInlineFormatting = (line: string): React.ReactNode => {
        const parts = line.split(/(\*\*.*?\*\*)/g).filter(Boolean);
        return parts.map((part, index) => {
            if (part.startsWith('**') && part.endsWith('**')) {
                return <strong key={index}>{part.slice(2, -2)}</strong>;
            }
            return part;
        });
    };

    const flushList = () => {
        if (listItems.length > 0) {
            const ListTag = listKind === 'ordered' ? 'ol' : 'ul';
            const listStyle = listKind === 'ordered' ? 'list-decimal' : 'list-disc';
            elements.push(
                <ListTag key={`${listKind ?? 'unordered'}-tool-${elements.length}`} className={`my-2 ml-5 list-outside ${listStyle} space-y-1 text-sm leading-6 text-slate-700 dark:text-slate-300`}>
                    {listItems.map((item, index) => (
                        <li key={index}>{renderInlineFormatting(item)}</li>
                    ))}
                </ListTag>
            );
            listItems = [];
            listKind = null;
        }
    };

    lines.forEach((line, index) => {
        const trimmedLine = line.trim();
        const listItem = parseMarkdownListItem(line);
        if (listItem) {
            if (listKind && listKind !== listItem.kind) flushList();
            listKind = listItem.kind;
            listItems.push(listItem.text);
        } else {
            flushList();
            if (line.match(/^#+\s/)) {
                const level = line.match(/^#+/)![0].length;
                const content = line.replace(/^#+\s/, '');
                const Tag = `h${Math.min(level + 2, 6)}` as React.ElementType;
                elements.push(<Tag key={index} className={formattedHeadingClass(level)}>{renderInlineFormatting(content)}</Tag>);
            } else if (trimmedLine !== '') {
                elements.push(<p key={index} className="mb-2 text-sm leading-6 text-slate-700 dark:text-slate-300">{renderInlineFormatting(line)}</p>);
            }
        }
    });

    flushList();

    return elements;
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const sanitizeFilename = (value: string) =>
  value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || 'career-copilot-export';

export const getDownloadMenuKeyboardOpenIndex = (key: string): number | null => {
  if (key === 'ArrowDown') return 0;
  if (key === 'ArrowUp') return 2;
  return null;
};

export const DownloadButtons: React.FC<{ textContent: string; baseFilename: string }> = ({ textContent, baseFilename }) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeExport, setActiveExport] = useState<'txt' | 'pdf' | 'docx' | null>(null);
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const mountedRef = useRef(true);
  const printTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeExportRef = useRef<typeof activeExport>(null);
  const pendingFocusIndexRef = useRef(0);
  const safeBaseFilename = sanitizeFilename(baseFilename);
  const { t } = useLocalization();
  const label = (key: string, fallback: string) => {
    const value = t(key);
    return value === key ? fallback : value;
  };
  const downloadLabel = label('tool_download_button', 'Download');

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (printTimerRef.current) clearTimeout(printTimerRef.current);
      if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isMenuOpen) return;

    focusTimerRef.current = setTimeout(() => {
      const items = menuItemRefs.current.filter(Boolean);
      const index = Math.max(0, Math.min(pendingFocusIndexRef.current, items.length - 1));
      items[index]?.focus();
    }, 0);

    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMenuOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMenuOpen]);

  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(null), 4000);
    return () => window.clearTimeout(timer);
  }, [status]);

  const beginExport = (kind: NonNullable<typeof activeExport>) => {
    if (activeExportRef.current) return false;
    activeExportRef.current = kind;
    setActiveExport(kind);
    return true;
  };

  const finishExport = () => {
    activeExportRef.current = null;
    if (mountedRef.current) setActiveExport(null);
  };

  const openMenu = (focusIndex = 0) => {
    pendingFocusIndexRef.current = focusIndex;
    setIsMenuOpen(true);
  };

  const closeMenu = (returnFocus = false) => {
    setIsMenuOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  const moveMenuFocus = (nextIndex: number) => {
    const items = menuItemRefs.current.filter(Boolean);
    if (items.length === 0) return;
    const normalized = (nextIndex + items.length) % items.length;
    items[normalized]?.focus();
  };

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const focusIndex = getDownloadMenuKeyboardOpenIndex(event.key);
    if (focusIndex !== null) {
      event.preventDefault();
      openMenu(focusIndex);
    }
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = menuItemRefs.current.filter(Boolean);
    const activeIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveMenuFocus(activeIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveMenuFocus(activeIndex - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      moveMenuFocus(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      moveMenuFocus(items.length - 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu(true);
    } else if (event.key === 'Tab') {
      closeMenu(false);
    }
  };

  const downloadTxt = () => {
    if (!beginExport('txt')) return;
    try {
      const cleanedText = textContent
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/^#+\s/gm, '')
        .replace(/(\r\n|\n|\r)/gm, "\r\n");
      const element = document.createElement("a");
      // Prepend BOM for UTF-8 compatibility, especially on Windows.
      const file = new Blob(['\uFEFF' + cleanedText], {type: 'text/plain;charset=utf-8'});
      const url = URL.createObjectURL(file);
      element.href = url;
      element.download = `${safeBaseFilename}.txt`;
      document.body.appendChild(element);
      element.click();
      element.remove();
      URL.revokeObjectURL(url);
      setStatus({ tone: 'success', message: label('tool_export_txt_success', 'TXT export started.') });
    } catch {
      setStatus({ tone: 'error', message: label('tool_export_txt_error', 'TXT export failed. Please try again.') });
    } finally {
      setIsMenuOpen(false);
      finishExport();
    }
  };

  const downloadPdf = () => {
    if (!beginExport('pdf')) return;
    const createHtmlFromText = (text: string): string => {
        const lines = text.split('\n');
        let html = '';
        let listKind: MarkdownListKind | null = null;

        const processLine = (line: string) =>
          escapeHtml(line).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        const closeList = () => {
          if (listKind) {
            html += `</${listKind === 'ordered' ? 'ol' : 'ul'}>`;
            listKind = null;
          }
        };

        lines.forEach(line => {
            const trimmedLine = line.trim();
            const listItem = parseMarkdownListItem(line);
            if (listItem) {
                if (listKind && listKind !== listItem.kind) closeList();
                if (!listKind) {
                    listKind = listItem.kind;
                    html += `<${listKind === 'ordered' ? 'ol' : 'ul'}>`;
                }
                html += `<li>${processLine(listItem.text)}</li>`;
            } else {
                closeList();
                if (line.match(/^#+\s/)) {
                    const level = line.match(/^#+/)![0].length;
                    const content = line.replace(/^#+\s/, '');
                    html += `<h${Math.min(level + 1, 6)}>${processLine(content)}</h${Math.min(level + 1, 6)}>`;
                } else if (trimmedLine !== '') {
                    html += `<p>${processLine(line)}</p>`;
                } else {
                    html += '<br />';
                }
            }
        });
        closeList();
        return html;
    };
    
    const htmlContent = createHtmlFromText(textContent);

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        setStatus({ tone: 'error', message: label('tool_export_pdf_blocked', 'PDF export was blocked. Allow pop-ups for this site and try again.') });
        setIsMenuOpen(false);
        finishExport();
      return;
    }

    // The print document is same-origin about:blank; detach it from the product
    // window before writing so exported content cannot retain a reverse-tabnabbing
    // handle if browser behavior changes.
    printWindow.opener = null;

    printWindow.document.open();
    printWindow.document.write(`
      <html>
        <head>
          <title>${escapeHtml(safeBaseFilename)}</title>
          <style>
            @media print {
              @page { size: A4; margin: 2cm; }
            }
            body { 
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
              font-size: 11pt; 
              line-height: 1.5;
            }
            h2, h3, h4, h5, h6 { margin: 1.5em 0 0.5em; font-weight: bold; }
            h2 { font-size: 18pt; border-bottom: 1px solid #ccc; padding-bottom: 0.2em; }
            h3 { font-size: 14pt; }
            p { margin: 0 0 0.5em; }
            ul, ol { margin: 0.5em 0; padding-left: 2em; }
            li { margin-bottom: 0.25em; }
            strong { font-weight: bold; }
          </style>
        </head>
        <body>${htmlContent}</body>
      </html>
    `);
    printWindow.document.close();

    if (printTimerRef.current) clearTimeout(printTimerRef.current);
    printTimerRef.current = setTimeout(() => {
        try {
            printWindow.focus();
            printWindow.print();
            printWindow.close();
            if (mountedRef.current) setStatus({ tone: 'success', message: label('tool_export_pdf_success', 'PDF print dialog opened.') });
        } catch (e) {
            console.error("Printing failed:", e);
            if (mountedRef.current) setStatus({ tone: 'error', message: label('tool_export_pdf_error', 'PDF export failed. Please try again.') });
            printWindow.close();
        } finally {
            finishExport();
        }
    }, 250);

    setIsMenuOpen(false);
  };

  const downloadDocx = async () => {
    if (!beginExport('docx')) return;
    setIsMenuOpen(false);

    try {
      const createTextRuns = (line: string) => line.split(/(\*\*.*?\*\*)/g).filter(Boolean).map(part => {
        const isBold = part.startsWith('**') && part.endsWith('**');
        const runText = isBold ? part.slice(2, -2) : part;
        // Use Arial for better unicode support.
        return new TextRun({ text: runText, bold: isBold, font: "Arial", size: 22 });
      });

      const paragraphs: Paragraph[] = textContent.split('\n').map(line => {
        if (line.startsWith('# ')) {
          return new Paragraph({ text: line.substring(2), heading: HeadingLevel.HEADING_1 });
        }
        if (line.startsWith('## ')) {
          return new Paragraph({ text: line.substring(3), heading: HeadingLevel.HEADING_2 });
        }
        const listItem = parseMarkdownListItem(line);
        if (listItem?.kind === 'unordered') {
          return new Paragraph({ children: createTextRuns(listItem.text), bullet: { level: 0 } });
        }
        if (listItem?.kind === 'ordered') {
          return new Paragraph({ children: createTextRuns(listItem.text), numbering: { reference: ORDERED_NUMBERING_REFERENCE, level: 0 } });
        }

        const children = createTextRuns(line);

        return new Paragraph({ children, spacing: { after: 100 } });
      });

      const doc = new Document({
        styles: {
          default: {
            document: {
              run: {
                font: "Arial",
                size: 22, // 11pt
              },
            },
          },
          paragraphStyles: [
            { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", run: { font: "Arial", size: 28, bold: true }, paragraph: { spacing: { before: 240, after: 120 } } },
            { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", run: { font: "Arial", size: 24, bold: true }, paragraph: { spacing: { before: 200, after: 100 } } },
          ],
        },
        numbering: {
          config: [
            {
              reference: ORDERED_NUMBERING_REFERENCE,
              levels: [
                {
                  level: 0,
                  format: LevelFormat.DECIMAL,
                  text: '%1.',
                  alignment: AlignmentType.LEFT,
                  style: {
                    paragraph: {
                      indent: { left: 720, hanging: 360 },
                    },
                  },
                },
              ],
            },
          ],
        },
        sections: [{ children: paragraphs }]
      });

      const blob = await Packer.toBlob(doc);
      if (!mountedRef.current) return;
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeBaseFilename}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      setStatus({ tone: 'success', message: label('tool_export_docx_success', 'DOCX export started.') });
    } catch {
      if (mountedRef.current) setStatus({ tone: 'error', message: label('tool_export_docx_error', 'DOCX export failed. Please try again.') });
    } finally {
      finishExport();
    }
  };

  const isExporting = activeExport !== null;
  const canDownload = Boolean(textContent.trim()) && !isExporting;

  return (
    <div className="relative inline-flex flex-col items-end gap-2" ref={menuRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (isMenuOpen ? closeMenu(false) : openMenu(0))}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="menu"
        aria-expanded={isMenuOpen}
        aria-controls={isMenuOpen ? menuId : undefined}
        aria-label={downloadLabel}
        aria-busy={isExporting}
        data-export-state={activeExport ?? 'idle'}
        disabled={!canDownload}
        className="inline-flex items-center gap-2 rounded-lg bg-gray-800 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-700 dark:hover:bg-slate-600"
      >
        {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {downloadLabel}
        <ChevronDown className={`h-4 w-4 transition-transform ${isMenuOpen ? 'rotate-180' : ''}`} />
      </button>
      {isMenuOpen && (
        <div
          id={menuId}
          role="menu"
          aria-label={downloadLabel}
          onKeyDown={handleMenuKeyDown}
          className="absolute right-0 top-full z-20 mt-2 w-48 overflow-hidden rounded-lg bg-white py-1 shadow-lg ring-1 ring-black/5 animate-fade-scale dark:bg-slate-800 dark:ring-white/10"
        >
          <button ref={(node) => { menuItemRefs.current[0] = node; }} type="button" role="menuitem" onClick={downloadTxt} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none dark:text-gray-200 dark:hover:bg-slate-700 dark:focus:bg-slate-700">
            <FileText className="h-4 w-4 text-gray-400" />
            {label('tool_export_txt', 'Export as TXT')}
          </button>
          <button ref={(node) => { menuItemRefs.current[1] = node; }} type="button" role="menuitem" onClick={downloadPdf} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none dark:text-gray-200 dark:hover:bg-slate-700 dark:focus:bg-slate-700">
            <Printer className="h-4 w-4 text-gray-400" />
            {label('tool_export_pdf', 'Print as PDF')}
          </button>
          <button ref={(node) => { menuItemRefs.current[2] = node; }} type="button" role="menuitem" onClick={downloadDocx} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none dark:text-gray-200 dark:hover:bg-slate-700 dark:focus:bg-slate-700">
            <Download className="h-4 w-4 text-gray-400" />
            {label('tool_export_docx', 'Export as DOCX')}
          </button>
        </div>
      )}
      {status && (
        <div
          role={status.tone === 'error' ? 'alert' : 'status'}
          className={`w-64 max-w-full rounded-lg border px-3 py-2 text-left text-xs shadow-sm animate-fade-scale ${
            status.tone === 'error'
              ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300'
          }`}
        >
          <span className="flex items-start gap-2">
            {status.tone === 'error' ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
            <span>{status.message}</span>
          </span>
        </div>
      )}
    </div>
  );
};
