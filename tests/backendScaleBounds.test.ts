import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { boundedRuntimeInteger } from '../functions/src/utils/runtimeLimits';

const root = new URL('../', import.meta.url);
const reviewSource = readFileSync(
  new URL('functions/src/handlers/companyReviews.ts', root),
  'utf8',
);
const monthlyGrantSource = readFileSync(
  new URL('functions/src/handlers/grantMonthlyCredits.ts', root),
  'utf8',
);
const reviewClientSource = readFileSync(new URL('lib/companyReviewsData.ts', root), 'utf8');
const firestoreIndexes = JSON.parse(
  readFileSync(new URL('firestore.indexes.json', root), 'utf8'),
) as {
  indexes: Array<{
    collectionGroup: string;
    fields: Array<{ fieldPath: string; order: string }>;
  }>;
};

describe('backend scale bounds', () => {
  it('keeps operator-provided limits inside tested safety bounds', () => {
    expect(boundedRuntimeInteger(undefined, 100, 10, 250)).toBe(100);
    expect(boundedRuntimeInteger('', 100, 10, 250)).toBe(100);
    expect(boundedRuntimeInteger('not-a-number', 100, 10, 250)).toBe(100);
    expect(boundedRuntimeInteger(undefined, 999, 10, 250)).toBe(250);
    expect(boundedRuntimeInteger('9', 100, 10, 250)).toBe(10);
    expect(boundedRuntimeInteger('251', 100, 10, 250)).toBe(250);
    expect(boundedRuntimeInteger('25', 100, 10, 250)).toBe(25);
  });

  it('uses stable, hard-bounded, identity-safe company-review pages', () => {
    expect(reviewSource).toContain('COMPANY_REVIEW_PAGE_SIZE_MAX');
    expect(reviewSource).toContain('COMPANY_REVIEW_MAX_PAGES');
    expect(reviewSource).toContain('.orderBy("created_at", "desc")');
    expect(reviewSource).toContain('.orderBy(FieldPath.documentId(), "desc")');
    expect(reviewSource).toContain('.offset(offset)');
    expect(reviewSource).toContain('.limit(pageSize + 1)');
    expect(reviewSource).toContain('has_more: hasMore');
    expect(reviewSource).toContain('next_page: nextPage');
    expect(reviewSource).toContain('truncated: truncated');
    expect(reviewSource).not.toContain('author_uid: r.author_uid');
    expect(reviewSource).not.toContain('id: d.id');
    expect(reviewClientSource).toContain('export async function listCompanyReviewsPage');
    expect(reviewClientSource).toContain('hasMore: result.data?.has_more === true');
    expect(reviewClientSource).toContain("truncated: result.data?.truncated === true");
    expect(reviewClientSource).toContain('Compatibility wrapper: returns only the bounded first review page.');
    expect(reviewClientSource).not.toContain('Fetches all reviews');
  });

  it('computes an exact server-side review aggregate without loading every review', () => {
    expect(reviewSource).toContain('AggregateField.average("rating")');
    expect(reviewSource).toContain('AggregateField.count()');
    expect(reviewSource).toContain('is_truncated: false');
    expect(reviewSource).toContain('aggregation_scope: "all_reviews"');
    expect(reviewSource).not.toContain('const ratings = snap.docs');
  });

  it('declares the review ordering index without dropping the API usage index', () => {
    const reviewIndex = firestoreIndexes.indexes.find(
      (index) => index.collectionGroup === 'company_reviews',
    );
    expect(reviewIndex?.fields).toEqual([
      { fieldPath: 'employer_id', order: 'ASCENDING' },
      { fieldPath: 'created_at', order: 'DESCENDING' },
    ]);
    expect(
      firestoreIndexes.indexes.some((index) => index.collectionGroup === 'api_usage_logs'),
    ).toBe(true);
  });

  it('paginates monthly grants with a hard run cap and bounded concurrency', () => {
    expect(monthlyGrantSource).toContain('MONTHLY_CREDIT_PAGE_SIZE');
    expect(monthlyGrantSource).toContain('MONTHLY_CREDIT_MAX_USERS_PER_RUN');
    expect(monthlyGrantSource).toContain('MONTHLY_CREDIT_CONCURRENCY');
    expect(monthlyGrantSource).toContain('.orderBy(FieldPath.documentId())');
    expect(monthlyGrantSource).toContain('.startAfter(cursor)');
    expect(monthlyGrantSource).toContain('.limit(pageSize)');
    expect(monthlyGrantSource).toContain('mapSettledWithConcurrency');
    expect(monthlyGrantSource).toContain('schedule: "10 0 * * *"');
    expect(monthlyGrantSource).toContain('advanceRunCursor');
    expect(monthlyGrantSource).toContain('cursor_uid: cursor');
    expect(monthlyGrantSource).toContain('run_limit_reached: runLimitReached');
  });
});
