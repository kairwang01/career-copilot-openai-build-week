import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ToolRunner, { ToolChunkFallback } from '../components/ToolRunner';

const t = (key: string) => ({
  tool_runner_loading_title: 'Opening tool',
  tool_runner_loading_desc: 'Preparing the workspace and saved results...',
  tool_runner_unavailable_title: 'This tool is not available in the current workspace.',
  tool_runner_unavailable_desc: 'Return to the toolkit and choose another action.',
  tool_runner_back_to_tools: 'Back to toolkit',
  tool_runner_error_title: 'Tool did not load',
  tool_runner_error_desc: 'The rest of your workspace is safe. Try reloading this tool or return to the toolkit.',
  tool_runner_retry: 'Reload tool',
}[key] ?? key);

describe('ToolRunner shell states', () => {
  it('renders a professional tool loading state instead of a bare spinner', () => {
    const markup = renderToStaticMarkup(React.createElement(ToolChunkFallback, { t }));

    expect(markup).toContain('data-qa="tool-loading-state"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('Opening tool');
    expect(markup).toContain('Preparing the workspace and saved results...');
    expect(markup).toContain('animate-pulse');
  });

  it('renders a recoverable unavailable-tool state with a route back to the toolkit', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ToolRunner, {
        tool: 'unknown-tool',
        resumeText: '',
        initialInput: '',
        onClose: () => {},
        openTool: () => {},
        market: 'Canada',
        session: null,
        profile: null,
        refreshProfile: () => {},
        t,
      }),
    );

    expect(markup).toContain('data-qa="tool-runner-unavailable"');
    expect(markup).toContain('This tool is not available in the current workspace.');
    expect(markup).toContain('Back to toolkit');
  });
});
