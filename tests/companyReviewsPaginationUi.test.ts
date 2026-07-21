import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);
const browseJobsSource = readFileSync(
  new URL('components/BrowseJobs.tsx', root),
  'utf8',
);

describe('company review pagination UI', () => {
  it('loads bounded identity-safe pages and keeps the complete page metadata', () => {
    expect(browseJobsSource).toContain('listCompanyReviewsPage');
    expect(browseJobsSource).not.toMatch(/\blistCompanyReviews,?\s*$/m);
    expect(browseJobsSource).not.toContain('aggregateRating');
    expect(browseJobsSource).toContain('const COMPANY_REVIEW_PAGE_SIZE = 10');
    expect(browseJobsSource).toContain('pageSize: COMPANY_REVIEW_PAGE_SIZE');
    expect(browseJobsSource).toContain('hasMore: page.hasMore');
    expect(browseJobsSource).toContain('nextPage: page.nextPage');
    expect(browseJobsSource).toContain('truncated: page.truncated');
    expect(browseJobsSource).not.toContain('author_uid');
  });

  it('preserves loaded reviews across retryable failures and blocks duplicate requests', () => {
    expect(browseJobsSource).toContain("status: 'error'");
    expect(browseJobsSource).toContain('failedPage: pageNumber');
    expect(browseJobsSource).toContain('fetchingReviews.current.has(eid)');
    expect(browseJobsSource).toContain('if (!reviewsMountedRef.current) return');
    expect(browseJobsSource).toContain("t('action_retry')");
    expect(browseJobsSource).not.toContain('silently skip; card just won\'t show a rating chip');
  });

  it('renders every loaded review and reports loaded versus exact aggregate total', () => {
    expect(browseJobsSource).not.toContain('.reviews.slice(0, 3)');
    expect(browseJobsSource).toContain('employerReviews.reviews.map');
    expect(browseJobsSource).toContain('employerReviews.reviews.length} / {employerRating.count');
    expect(browseJobsSource).toContain("t('portal_listings_show_more').replace('{n}'");
    expect(browseJobsSource).toContain("t('app_loading')");
    expect(browseJobsSource).toContain('employerRating.avg.toFixed(1)');
    expect(browseJobsSource).toContain('employerRating.count');
  });
});
