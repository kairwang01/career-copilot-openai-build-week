/**
 * skillMatch — shared, deterministic (no AI) matching of a job's required skills
 * against a candidate's Talent-Profile skills. Used by BOTH the candidate's
 * pre-submit Apply Review ("you match N of M") and the employer's Applicant
 * Packet must-have checklist, so both sides see the SAME evidence signal.
 *
 * Conservative by design: a requirement counts as met only on a normalized exact
 * match (case / spacing / punctuation insensitive, but C++ and C# stay distinct).
 * Better a false "missing" the candidate can clarify than a false "met".
 */
import type { TalentProfile } from './talentProfile';

/** All candidate skills across every group, trimmed + de-duplicated (case-insensitive). */
export function collectCandidateSkills(profile: TalentProfile | null | undefined): string[] {
  if (!profile?.skills) return [];
  const out: string[] = [];
  for (const group of Object.values(profile.skills)) {
    if (!Array.isArray(group)) continue;
    for (const raw of group) {
      const v = typeof raw === 'string' ? raw.trim() : '';
      if (v && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
    }
  }
  return out;
}

// Normalize for comparison: lowercase, drop spacing/dots/slashes/hyphens/underscores;
// KEEP + and # so "C++"/"C#" don't collapse into "c".
const norm = (s: string): string => s.toLowerCase().replace(/[\s._/-]+/g, '');

export interface SkillMatch {
  matched: string[];
  missing: string[];
  /** matched.length */
  matchedCount: number;
  /** requiredSkills.length (deduped) */
  requiredCount: number;
}

/** Returns the REQUIRED-skill labels split into matched vs missing against the candidate's skills. */
export function matchSkills(candidateSkills: string[], requiredSkills: string[] | null | undefined): SkillMatch {
  const cand = new Set(candidateSkills.map(norm).filter(Boolean));
  const matched: string[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const req of requiredSkills ?? []) {
    const label = typeof req === 'string' ? req.trim() : '';
    const r = norm(label);
    if (!r || seen.has(r)) continue;
    seen.add(r);
    (cand.has(r) ? matched : missing).push(label);
  }
  return { matched, missing, matchedCount: matched.length, requiredCount: matched.length + missing.length };
}
