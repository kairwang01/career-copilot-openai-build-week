import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ToolResultsHydrationFallback } from '../contexts/ToolResultsContext';

describe('ToolResultsHydrationFallback', () => {
  it('renders a complete saved-result loading state for paid tool hydration', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ToolResultsHydrationFallback, {
        title: 'Checking saved result',
        description: 'Looking for your latest saved output before opening the tool.',
      }),
    );

    expect(markup).toContain('data-qa="tool-saved-result-loading"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('Checking saved result');
    expect(markup).toContain('Looking for your latest saved output before opening the tool.');
    expect(markup).toContain('animate-pulse');
  });
});
