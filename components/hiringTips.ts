/**
 * Hiring / job-search "Did you know?" tips.
 *
 * Shown by StagedLoader as a rotating ticker during long AI generations to make
 * the wait feel productive. Keep each tip a single, broadly-accurate, encouraging
 * sentence WITHOUT the "Did you know?" prefix — StagedLoader adds that.
 */
export const HIRING_TIPS: string[] = [
  'recruiters spend an average of just 6–7 seconds on their first scan of a resume.',
  'tailoring your resume to each role can meaningfully increase your callback rate.',
  'most large companies use an applicant tracking system (ATS) to screen resumes before a human sees them.',
  'quantified achievements ("cut costs 20%") stand out far more than lists of duties.',
  'a keyword-rich LinkedIn headline is searchable — it helps recruiters find you.',
  'most roles are filled through networking and referrals, not job-board applications alone.',
  'referred candidates are several times more likely to get hired than cold applicants.',
  'clean, standard resume sections help your application parse correctly in an ATS.',
  'mirroring keywords from the job description can lift your resume’s match score.',
  'following up a few days after applying can keep your application top of mind.',
  'soft skills like communication and adaptability are among the most in-demand by employers.',
  'a concise one-to-two-page resume usually outperforms a longer one.',
  'naming specific tools and technologies helps both the ATS and the recruiter.',
  'cover letters are still read by many hiring managers for senior and niche roles.',
  'preparing 2–3 STAR stories (Situation, Task, Action, Result) covers most interview questions.',
  'researching the company before an interview is one of the strongest signals of genuine interest.',
  'salary is negotiable in most offers — it is normal and expected to ask.',
  'a simple, professional email address makes a better first impression than a playful one.',
  'strong action verbs ("led", "built", "shipped") show impact better than "responsible for".',
  'portfolios and work samples often matter more than credentials for creative and tech roles.',
  'practicing your answers out loud noticeably improves interview confidence and clarity.',
  'recruiters often check your online presence — keep your public profiles consistent with your resume.',
  'a thank-you note after an interview is remembered by a majority of hiring managers.',
  'applying within the first few days of a posting can improve your odds of being seen.',
];

/**
 * Returns a randomly-shuffled copy of the tips (Fisher–Yates). Called once per
 * loader mount so each generation surfaces tips in a fresh order.
 */
export function getShuffledHiringTips(): string[] {
  const a = [...HIRING_TIPS];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
