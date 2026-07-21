import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CopyButton, DownloadButtons, getDownloadMenuKeyboardOpenIndex, renderFormattedText, SavedResultBar, ToolError } from '../components/tools/ToolUtils';

const renderFormattedMarkup = (text: string) => (
  renderToStaticMarkup(React.createElement(React.Fragment, null, renderFormattedText(text)))
);

describe('renderFormattedText', () => {
  it('renders markdown headings with scan-friendly hierarchy', () => {
    const markup = renderFormattedMarkup('# Summary\n## Evidence\n### Detail\nBuilt hiring workflows.');

    expect(markup).toContain('<h3');
    expect(markup).toContain('text-base');
    expect(markup).toContain('<h4');
    expect(markup).toContain('uppercase');
    expect(markup).toContain('<h5');
    expect(markup).toContain('Built hiring workflows.');
  });

  it('keeps bullets and inline bold formatting readable', () => {
    const markup = renderFormattedMarkup('- Led **workflow** rollout\n- Reduced review time');

    expect(markup).toContain('<ul');
    expect(markup).toContain('text-sm');
    expect(markup).toContain('<strong>workflow</strong>');
    expect(markup).toContain('Reduced review time');
  });

  it('renders numbered tool output as a real ordered list', () => {
    const markup = renderFormattedMarkup('1. Target recruiter list\n2. Send **follow-up** draft');

    expect(markup).toContain('<ol');
    expect(markup).toContain('list-decimal');
    expect(markup).toContain('Target recruiter list');
    expect(markup).toContain('<strong>follow-up</strong>');
    expect(markup).not.toContain('<p class="mb-2 text-sm leading-6 text-slate-700 dark:text-slate-300">1.');
  });

  it('keeps ordered and unordered lists visually separate', () => {
    const markup = renderFormattedMarkup('1. Prepare resume\n2. Pick roles\n- Draft outreach\n- Track replies');

    expect(markup).toContain('<ol');
    expect(markup).toContain('<ul');
    expect(markup.indexOf('<ol')).toBeLessThan(markup.indexOf('<ul'));
  });
});

describe('DownloadButtons', () => {
  it('keeps trigger key handling to arrow-menu navigation only', () => {
    expect(getDownloadMenuKeyboardOpenIndex('ArrowDown')).toBe(0);
    expect(getDownloadMenuKeyboardOpenIndex('ArrowUp')).toBe(2);
    expect(getDownloadMenuKeyboardOpenIndex('Enter')).toBeNull();
    expect(getDownloadMenuKeyboardOpenIndex(' ')).toBeNull();
  });

  it('renders a human fallback label before localization has loaded', () => {
    const markup = renderToStaticMarkup(
      React.createElement(DownloadButtons, {
        textContent: 'Candidate-ready result',
        baseFilename: 'candidate_result',
      }),
    );

    expect(markup).toContain('Download');
    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-busy="false"');
    expect(markup).toContain('data-export-state="idle"');
    expect(markup).toContain('aria-label="Download"');
    expect(markup).not.toContain('tool_download_button');
  });

  it('disables export when there is no result text to download', () => {
    const markup = renderToStaticMarkup(
      React.createElement(DownloadButtons, {
        textContent: '   ',
        baseFilename: 'empty_result',
      }),
    );

    expect(markup).toContain('disabled=""');
    expect(markup).toContain('data-export-state="idle"');
    expect(markup).not.toContain('role="menu"');
  });
});

describe('ToolError', () => {
  it('renders a shared alert without forcing a retry action', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ToolError, {
        message: 'Could not load this tool state.',
      }),
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('data-qa="tool-error"');
    expect(markup).toContain('lucide-triangle-alert');
    expect(markup).toContain('Could not load this tool state.');
    expect(markup).not.toContain('<button');
  });

  it('renders the shared retry action and supports a disabled retry state', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ToolError, {
        message: 'This tool needs more detail before it can run.',
        onRetry: () => {},
        retryLabel: 'Try again',
        retryDisabled: true,
      }),
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('This tool needs more detail before it can run.');
    expect(markup).toContain('Try again');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('disabled:cursor-not-allowed');
  });
});

describe('CopyButton', () => {
  it('renders a stable idle state before copy feedback changes', () => {
    const markup = renderToStaticMarkup(
      React.createElement(CopyButton, {
        text: 'Candidate-ready result',
        label: 'Copy draft',
        copiedLabel: 'Draft copied',
        failedLabel: 'Copy unavailable',
      }),
    );

    expect(markup).toContain('data-copy-state="idle"');
    expect(markup).toContain('aria-label="Copy draft"');
    expect(markup).toContain('Copy draft');
    expect(markup).not.toContain('Draft copied');
    expect(markup).not.toContain('Copy unavailable');
  });
});

describe('SavedResultBar', () => {
  const t = (key: string) => ({
    tool_saved_label: 'Saved result',
    tool_saved_on: 'Saved {date}',
    tool_saved_just_now: 'Saved to your account',
    tool_saved_upgrade_hint: 'Upgrade to save & revisit results',
    tool_saved_not_saved: 'Not saved for next visit',
    tool_saving_label: 'Saving result...',
    tool_save_failed: 'Save failed. This result stays on screen.',
    tool_remove_saved: 'Remove saved',
    tool_try_next: 'Try next',
  }[key] ?? key);

  it('shows a remove action when a paid user has a saved result', () => {
    const markup = renderToStaticMarkup(
      React.createElement(SavedResultBar, {
        t,
        canSave: true,
        isSaved: false,
        savedAt: Date.now(),
        onTryNext: () => {},
        onClearSaved: () => {},
      }),
    );

    expect(markup).toContain('Saved to your account');
    expect(markup).toContain('Remove saved');
    expect(markup).toContain('Try next');
  });

  it('does not claim the visible result is saved after the saved copy is removed', () => {
    const markup = renderToStaticMarkup(
      React.createElement(SavedResultBar, {
        t,
        canSave: true,
        isSaved: false,
        savedAt: null,
        onTryNext: () => {},
        onClearSaved: () => {},
      }),
    );

    expect(markup).toContain('Not saved for next visit');
    expect(markup).not.toContain('Remove saved');
    expect(markup).toContain('Try next');
  });

  it('shows an in-progress save state without exposing the remove action early', () => {
    const markup = renderToStaticMarkup(
      React.createElement(SavedResultBar, {
        t,
        canSave: true,
        isSaved: false,
        savedAt: Date.now(),
        saveState: 'saving',
        onTryNext: () => {},
        onClearSaved: () => {},
      }),
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain('data-save-state="saving"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('Saving result...');
    expect(markup).not.toContain('Remove saved');
    expect(markup).toContain('data-qa="tool-try-next"');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('disabled:cursor-not-allowed');
  });

  it('shows a clear failed-save state while keeping the visible result available', () => {
    const markup = renderToStaticMarkup(
      React.createElement(SavedResultBar, {
        t,
        canSave: true,
        isSaved: false,
        savedAt: null,
        saveState: 'failed',
        onTryNext: () => {},
        onClearSaved: () => {},
      }),
    );

    expect(markup).toContain('Save failed. This result stays on screen.');
    expect(markup).not.toContain('Saved to your account');
    expect(markup).toContain('Try next');
  });
});
