import { describe, expect, it } from 'vitest';
import {
  applicationMatchesFilter,
  buildApplicationPipelinePlan,
  getApplicationProgressGroupIndex,
  getApplicationStatusGroup,
  getApplicationStatusIndex,
  getApplicationStatusLabelKey,
  getApplicationTimelineStageState,
  getLaterApplicationPipelineStatuses,
  getNextApplicationPipelineStatus,
  getSkippedApplicationStatuses,
  isApplicationClosedStatus,
  isApplicationHiredStatus,
  isApplicationInterviewStatus,
  isApplicationRejectedStatus,
  isApplicationReviewEligible,
  normalizeApplicationStatus,
  normalizeSkippedApplicationStatuses,
} from '../lib/applicationPipeline';

describe('application status helpers', () => {
  it('normalizes statuses with a safe default', () => {
    expect(normalizeApplicationStatus('Group Interview')).toBe('Group Interview');
    expect(normalizeApplicationStatus('Rejected')).toBe('Rejected');
    expect(normalizeApplicationStatus('')).toBe('Applied');
    expect(normalizeApplicationStatus('not a real status')).toBe('Applied');
  });

  it('maps statuses to groups', () => {
    expect(getApplicationStatusGroup('Applied')).toBe('applied');
    expect(getApplicationStatusGroup('Group Interview')).toBe('interview');
    expect(getApplicationStatusGroup('Offer')).toBe('offer');
    expect(getApplicationStatusGroup('Signed')).toBe('hired');
    expect(getApplicationStatusGroup('Rejected')).toBe('rejected');
  });

  it('computes stage + progress-group indices', () => {
    expect(getApplicationStatusIndex('Applied')).toBe(0);
    expect(getApplicationStatusIndex('Rejected')).toBe(-1);
    expect(getApplicationProgressGroupIndex('Applied')).toBeGreaterThanOrEqual(0);
    expect(getApplicationProgressGroupIndex('Rejected')).toBe(-1);
  });

  it('walks the pipeline forward', () => {
    expect(getNextApplicationPipelineStatus('Applied')).toBe('Group Interview');
    expect(getNextApplicationPipelineStatus('Signed')).toBeNull();
    expect(getLaterApplicationPipelineStatuses('Applied', { includeNext: true })).toContain('Group Interview');
    expect(getSkippedApplicationStatuses('Applied', 'Second Interview')).toEqual(['Group Interview', 'First Interview']);
  });

  it('resolves label keys', () => {
    expect(getApplicationStatusLabelKey('Applied')).toBe('applications_status_applied');
    expect(getApplicationStatusLabelKey('Rejected')).toBe('applications_status_rejected');
  });

  it('classifies terminal / interview / review-eligible states', () => {
    expect(isApplicationRejectedStatus('Rejected')).toBe(true);
    expect(isApplicationRejectedStatus('Applied')).toBe(false);
    expect(isApplicationHiredStatus('Signed')).toBe(true);
    expect(isApplicationHiredStatus('Applied')).toBe(false);
    expect(isApplicationClosedStatus('Rejected')).toBe(true);
    expect(isApplicationClosedStatus('Signed')).toBe(true);
    expect(isApplicationClosedStatus('Applied')).toBe(false);
    expect(isApplicationInterviewStatus('Group Interview')).toBe(true);
    expect(isApplicationInterviewStatus('Applied')).toBe(false);
    expect(isApplicationReviewEligible('Group Interview')).toBe(true);
    expect(isApplicationReviewEligible('Offer')).toBe(true);
    expect(isApplicationReviewEligible('Applied')).toBe(false);
    expect(isApplicationReviewEligible('Rejected')).toBe(false);
  });

  it('matches filter groups', () => {
    expect(applicationMatchesFilter('Applied', 'All')).toBe(true);
    expect(applicationMatchesFilter('Group Interview', 'interview')).toBe(true);
    expect(applicationMatchesFilter('Applied', 'interview')).toBe(false);
  });
});

describe('application pipeline skipped stages', () => {
  it('normalizes skipped statuses in canonical pipeline order', () => {
    expect(normalizeSkippedApplicationStatuses([
      'first interview',
      'unknown stage',
      'Group Interview',
      'First Interview',
      'Rejected',
    ])).toEqual(['Group Interview', 'First Interview']);
  });

  it('renders explicitly skipped earlier stages as skipped instead of done', () => {
    expect(getApplicationTimelineStageState('Second Interview', 'Group Interview', ['Group Interview'])).toBe('skipped');
    expect(getApplicationTimelineStageState('Second Interview', 'First Interview', ['First Interview'])).toBe('skipped');
    expect(getApplicationTimelineStageState('Second Interview', 'Second Interview', ['Group Interview'])).toBe('current');
  });

  it('keeps legacy earlier stages as done when no skip record exists', () => {
    expect(getApplicationTimelineStageState('Second Interview', 'First Interview', [])).toBe('done');
  });

  it('marks final signed stages as done for the completed candidate view', () => {
    expect(getApplicationTimelineStageState('Signed', 'Signed', [])).toBe('done');
  });

  it('builds a single timeline plan for current, skipped, and pending stages', () => {
    const plan = buildApplicationPipelinePlan('Second Interview', ['Group Interview']);

    expect(plan.status).toBe('Second Interview');
    expect(plan.currentGroup.id).toBe('interview');
    expect(plan.progressPercent).toBe(45);
    expect(plan.groups.find((group) => group.group.id === 'interview')?.state).toBe('current');
    expect(plan.stages.find((stage) => stage.stage.status === 'Group Interview')?.state).toBe('skipped');
    expect(plan.stages.find((stage) => stage.stage.status === 'First Interview')?.state).toBe('done');
    expect(plan.stages.find((stage) => stage.stage.status === 'Second Interview')?.state).toBe('current');
    expect(plan.stages.find((stage) => stage.stage.status === 'Decision Maker Interview')?.state).toBe('pending');
  });

  it('marks a fully skipped macro group as skipped instead of completed', () => {
    const plan = buildApplicationPipelinePlan('Offer', [
      'Group Interview',
      'First Interview',
      'Second Interview',
      'Decision Maker Interview',
      'HR Interview',
    ]);

    const interviewGroup = plan.groups.find((group) => group.group.id === 'interview');
    expect(interviewGroup?.fullySkipped).toBe(true);
    expect(interviewGroup?.state).toBe('skipped');
    expect(interviewGroup?.connectorDone).toBe(false);
    expect(plan.currentGroup.id).toBe('offer');
  });

  it('handles terminal rejected and signed plans consistently', () => {
    const rejected = buildApplicationPipelinePlan('Rejected');
    expect(rejected.progressPercent).toBe(0);
    expect(rejected.groups.every((group) => group.state === 'closed')).toBe(true);

    const signed = buildApplicationPipelinePlan('Signed');
    expect(signed.progressPercent).toBe(100);
    expect(signed.isComplete).toBe(true);
    expect(signed.groups.at(-1)?.state).toBe('done');
  });
});
