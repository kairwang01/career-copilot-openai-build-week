import type { CareerPathResult, Opportunity, OpportunityResult } from '../types';
import type { InterviewSessionReport } from '../services/aiClient';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown): string => typeof value === 'string' ? value : '';
const asFiniteNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;
const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const normalizeDisplayText = (value: unknown): string =>
  asString(value)
    .trim()
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n');

export const normalizeOpportunityResult = (value: unknown): OpportunityResult => {
  const source = isRecord(value) ? value : {};
  const opportunities: Opportunity[] = Array.isArray(source.opportunities)
    ? source.opportunities.flatMap((item) => {
        if (!isRecord(item)) return [];
        const url = asString(item.url);
        if (!url) return [];
        return [{
          jobTitle: asString(item.jobTitle),
          company: asString(item.company),
          location: asString(item.location),
          url,
          summary: asString(item.summary),
          isInternal: item.isInternal === true || undefined,
          compatibilityScore: typeof item.compatibilityScore === 'number' && Number.isFinite(item.compatibilityScore)
            ? item.compatibilityScore
            : undefined,
        }];
      })
    : [];

  return {
    opportunities,
    jobSearchStrategies: asStringArray(source.jobSearchStrategies),
    groundingChunks: Array.isArray(source.groundingChunks) ? source.groundingChunks : undefined,
    notice: typeof source.notice === 'string' ? source.notice : undefined,
  };
};

const ACTION_TYPES = new Set(['course', 'certification', 'project', 'networking', 'self-study']);

export const normalizeCareerPathResult = (value: unknown): CareerPathResult => {
  const source = isRecord(value) ? value : {};
  const seenSkills = new Set<string>();
  const overallSkillGaps = Array.isArray(source.overallSkillGaps)
    ? source.overallSkillGaps.flatMap((item) => {
        if (!isRecord(item)) return [];
        const skill = normalizeDisplayText(item.skill);
        const reason = normalizeDisplayText(item.reason);
        const normalizedSkill = skill.toLocaleLowerCase();
        if (!skill || !reason || seenSkills.has(normalizedSkill)) return [];
        seenSkills.add(normalizedSkill);
        return [{ skill, reason }];
      })
    : [];
  return {
    summary: normalizeDisplayText(source.summary),
    overallSkillGaps,
    roadmap: Array.isArray(source.roadmap)
      ? source.roadmap.flatMap((item) => {
          if (!isRecord(item)) return [];
          return [{
            phaseTitle: asString(item.phaseTitle),
            estimatedDuration: asString(item.estimatedDuration),
            goal: asString(item.goal),
            actionableSteps: Array.isArray(item.actionableSteps)
              ? item.actionableSteps.flatMap((step) => {
                  if (!isRecord(step)) return [];
                  const rawType = asString(step.type);
                  const type = ACTION_TYPES.has(rawType) ? rawType : 'self-study';
                  return [{
                    type: type as CareerPathResult['roadmap'][number]['actionableSteps'][number]['type'],
                    description: asString(step.description),
                    resources: asStringArray(step.resources),
                  }];
                })
              : [],
            milestones: asStringArray(item.milestones),
          }];
        })
      : [],
    bridgeRoles: Array.isArray(source.bridgeRoles)
      ? source.bridgeRoles.flatMap((item) => isRecord(item) ? [{
          title: asString(item.title),
          reason: asString(item.reason),
        }] : [])
      : [],
  };
};

export const normalizeInterviewSessionReport = (value: unknown): InterviewSessionReport => {
  const source = isRecord(value) ? value : {};
  return {
    overallScore: asFiniteNumber(source.overallScore),
    verdict: asString(source.verdict),
    summary: asString(source.summary),
    strengths: asStringArray(source.strengths),
    improvements: asStringArray(source.improvements),
    perQuestion: Array.isArray(source.perQuestion)
      ? source.perQuestion.flatMap((item) => isRecord(item) ? [{
          question: asString(item.question),
          score: asFiniteNumber(item.score),
          feedback: asString(item.feedback),
        }] : [])
      : [],
  };
};
