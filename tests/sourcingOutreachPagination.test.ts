import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  mergeCandidateOutreachBatches,
  SOURCING_ACTIONABLE_PAGE_SIZE,
  SOURCING_HISTORY_READ_LIMIT,
  type SourcingOutreach,
} from '../lib/sourcingOutreachData';

const makeOutreach = (
  id: string,
  status: SourcingOutreach['status'],
  createdAt: string,
  packetExpiresAtMs = 0,
): SourcingOutreach => ({
  id,
  employer_id: `employer-${id}`,
  candidate_id: 'candidate-1',
  job_id: '',
  job_title: 'Engineer',
  company_name: 'Example Co',
  message: 'A sufficiently detailed outreach message.',
  status,
  organization_verification: 'unverified_self_reported',
  packet_expires_at_ms: packetExpiresAtMs,
  created_at: createdAt,
  updated_at: createdAt,
  responded_at: '',
});

describe('candidate sourcing inbox pagination', () => {
  it('merges actionable rows that are outside the old 200-row history window', () => {
    const allRows = Array.from({ length: 205 }, (_, index) => (
      makeOutreach(
        `history-${index}`,
        'declined',
        new Date(Date.UTC(2026, 6, 13, 0, 0, 205 - index)).toISOString(),
      )
    ));
    const history = allRows.slice(0, SOURCING_HISTORY_READ_LIMIT);
    const pendingOutsideHistory = { ...allRows[203], status: 'requested' as const };
    const acceptedOutsideHistory = makeOutreach(
      allRows[204].id,
      'accepted',
      allRows[204].created_at,
      Date.now() + 86_400_000,
    );

    const merged = mergeCandidateOutreachBatches(
      history,
      [pendingOutsideHistory],
      [acceptedOutsideHistory, history[0]],
    );

    expect(merged).toHaveLength(SOURCING_HISTORY_READ_LIMIT + 2);
    expect(merged.map((row) => row.id)).toContain(pendingOutsideHistory.id);
    expect(merged.map((row) => row.id)).toContain(acceptedOutsideHistory.id);
    expect(merged.filter((row) => row.id === history[0].id)).toHaveLength(1);
  });

  it('cursor-pages every actionable row while keeping history fixed at 200', () => {
    const source = readFileSync(new URL('../lib/sourcingOutreachData.ts', import.meta.url), 'utf8');
    expect(SOURCING_ACTIONABLE_PAGE_SIZE).toBeGreaterThan(0);
    expect(SOURCING_HISTORY_READ_LIMIT).toBe(200);
    expect(source).toContain('startAfter(cursor)');
    expect(source).toContain("readAllCandidateActionablePages(uid, 'requested', nowMs)");
    expect(source).toContain("readAllCandidateActionablePages(uid, 'accepted', nowMs)");
    expect(source).toContain('do {');
    expect(source).toContain('} while (cursor);');
  });
});
