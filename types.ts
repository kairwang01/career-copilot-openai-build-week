
export interface Improvement {
  area: string;
  suggestion: string;
}

export interface AnalysisResult {
  score: number;
  summary: string;
  strengths: string[];
  improvements: Improvement[];
  keywords: string[];
}

export interface ResumeImage {
  mimeType: string;
  data: string; // base64 encoded
}

/**
 * A weekly AI insight card (SCRUM-31). Generated server-side by the
 * generateWeeklyInsights scheduled Cloud Function and stored at
 * users/{uid}/weekly_insights/{week_start_date}. Read-only on the client.
 */
export interface WeeklyInsight {
  /** ISO "YYYY-MM-DD" of the week's Monday. */
  weekStartDate: string;
  /** Short reflection on the candidate's week (grounded in real activity). */
  summaryText: string;
  /** One specific, doable-this-week next step. May be empty. */
  actionableTip: string;
}

export interface FormattedResume {
  formattedText: string;
  targetMarket?: string;
  outputLanguage?: 'en' | 'local';
  /** Localization audit trail: one note per market-driven edit ("<change> — <market convention>"). */
  changeNotes?: string[];
}

export interface Opportunity {
  jobTitle: string;
  company: string;
  location: string;
  url: string;
  summary: string;
  isInternal?: boolean;
  compatibilityScore?: number;
}

export interface OpportunityResult {
    opportunities: Opportunity[];
    jobSearchStrategies: string[];
    groundingChunks: any[] | undefined;
    notice?: string;
}


export interface CoverLetter {
  letter: string;
}

export interface LinkedInOptimization {
  headline: string;
  summary: string;
  experienceSuggestions: {
    title: string;
    suggestion: string;
  }[];
}

export interface Plan {
  name: string;
  price: string;
  priceDescription: string;
  annualPrice?: string;
  features: string[];
  analysisLimit: number;
  creditsPerMonth: number;
}

export interface UserProfile {
  id: string;
  updated_at: string;
  full_name: string | null;
  birth_date?: string | null;
  avatar_url: string | null;
  subscription_status: string;
  role: 'employer' | 'candidate' | 'agency';
  company_name: string | null;
  company_website: string | null;
  company_description: string | null;
  company_logo_url: string | null;
  company_size?: string | null;
  industry?: string | null;
  founded_year?: string | null;
  resume_text: string | null;
  // Original uploaded resume file persisted to Firebase Storage (resumes/{uid}/…),
  // owner-read-only. resume_text remains the canonical text for AI/talent tools.
  resume_file_url?: string | null;
  resume_file_name?: string | null;
  resume_file_path?: string | null;
  resume_file_size?: number | null;
  resume_file_uploaded_at?: string | null;
  job_preferences?: {
    status: 'active' | 'open' | 'browsing' | 'not_looking';
    roles: string;
    locations: string;
    salaryMin: string;
    availability: string;
  } | null;
  preferred_language: string | null;
  wallet_address: string | null;
  nft_minted: boolean | null;
  nft_staked: boolean | null;
  nft_earnings: number | null;
  nft_token_id: number | null;
  english_pro_streak: number | null;
  english_pro_last_practice: string | null;
  credits: number | null;
}

export interface SkillGap {
  skill: string;
  reason: string;
}

export interface RoadmapActionableStep {
  type: 'course' | 'certification' | 'project' | 'networking' | 'self-study';
  description: string;
  resources?: string[]; // e.g., links to courses, book titles
}

export interface RoadmapPhase {
  phaseTitle: string;
  estimatedDuration: string;
  goal: string;
  actionableSteps: RoadmapActionableStep[];
  milestones: string[];
}

export interface BridgeRole {
  title: string;
  reason: string;
}

export interface CareerPathResult {
  summary: string;
  overallSkillGaps: SkillGap[];
  roadmap: RoadmapPhase[];
  bridgeRoles: BridgeRole[];
}


export interface PracticeQuestion {
  questionText: string;
  options: string[];
  correctAnswerIndex: number;
  explanation: string;
}

export interface AgilePracticeTestResult {
  examTitle: string;
  practiceQuestions: PracticeQuestion[];
  examTips: string[];
}

export interface SalaryNegotiationResult {
  marketAnalysisSummary: string;
  recommendedRange: {
    baseMin: number;
    baseMax: number;
    currency: string;
    explanation: string;
  };
  keyStrengths: string[];
  negotiationStrategy: string[];
  counterOfferEmailDraft: string;
  objectionHandlers: {
    objection: string;
    response: string;
  }[];
}

export interface EnglishImprovementArea {
  category: string; // 'Grammar', 'Vocabulary', 'Punctuation', 'Tone', etc.
  originalText: string;
  suggestion: string;
  explanation: string;
}

export interface EnglishProResult {
  overallBand: {
    level: string; // e.g., 'B1', 'C2'
    description: string;
  };
  summary: string;
  strengths: string[];
  improvementAreas: EnglishImprovementArea[];
  correctedEmail: string;
  culturalTip?: string;
}

export interface SpokenEnglishAnalysisResult {
  transcript: string;
  clarityScore: number; // 0-100
  pacingWPM: number; // Words Per Minute
  fillerWords: {
    word: string;
    count: number;
  }[];
  feedbackSummary: string;
  improvementSuggestions: string[];
}

export interface VocabularyItem {
  word: string;
  definition: string;
  example: string;
}

export interface ComprehensionQuestion {
  question: string;
  answer: string;
}

export interface EnglishReadingAnalysisResult {
  summary: string;
  vocabularyList: VocabularyItem[];
  comprehensionQuestions: ComprehensionQuestion[];
}

export interface ReadingPracticePassage {
  passage: string;
  comprehensionQuestions: ComprehensionQuestion[];
}

export interface ReadingEvaluation {
  isCorrect: boolean;
  feedback: string;
}

export interface EnglishListeningAnalysisResult {
    similarityScore: number;
    diffView: string; // The user's transcript with markdown for errors
    feedbackOnCommonErrors: string[];
    originalTranscript: string;
}


export interface ProfessionalEmailResult {
  subject: string;
  body: string;
}

export interface PortfolioSkill {
  icon: string;
  category: string;
  description: string;
}

export interface PortfolioExperience {
  date: string;
  title: string;
  company: string;
  description: string;
}

export interface PortfolioProjectContent {
  title: string;
  description: string;
  url: string;
  category: string;
}

export interface PortfolioContent {
  fullName: string;
  firstName: string;
  lastName: string;
  contactEmail: string;
  contactPhone: string;
  contactLocation: string;
  socials: {
    linkedin?: string;
    github?: string;
    twitter?: string;
  };
  skills: PortfolioSkill[];
  experience: PortfolioExperience[];
  projects: PortfolioProjectContent[];
}

export interface PortfolioWebsiteResult {
  htmlContent: string;
}

export interface InclusivitySuggestion {
    originalText: string;
    suggestion: string;
    explanation: string;
}

export interface CandidateMatchAnalysis {
  score: number;
  summary: string;
  strengths: string[];
  potentialGaps: string[];
  suggestedQuestions: string[];
}

export interface NetworkingStrategyResult {
  strategySummary: string;
  contactSuggestions: {
    contactType: string;
    reason: string;
    outreachMessage: string;
  }[];
}

export interface SkillBridgeProject {
  projectTitle: string;
  objective: string;
  keyFeatures: string[];
  suggestedTechStack: string[];
  showcaseChallenge: string;
}

export interface PerformanceReviewResult {
  summary: string;
  strengthsToHighlight: string[];
  talkingPoints: {
    accomplishment: string;
    starMethodPoint: string;
  }[];
  growthAreaDiscussionPoints: string[];
}

export interface LearningPlanPhase {
  phaseTitle: string;
  duration: string;
  keyActivities: string[];
  milestone: string;
}

export interface LearningPlanResult {
  skill: string;
  summary: string;
  learningPhases: LearningPlanPhase[];
  suggestedProjects: string[];
}

export interface IndustryEvent {
  eventName: string;
  date: string;
  location: string;
  url: string;
  summary: string;
  eventType: 'conference' | 'meetup' | 'job_fair' | 'other';
}

export interface EventScoutResult {
    events: IndustryEvent[];
    groundingChunks: any[] | undefined;
}

export interface VocabularyFlashcard {
  word: string;
  definition: string;
  distractors: string[]; // 2 or 3 incorrect definitions
}

// How well a predicted question / chain is grounded in real evidence. This is
// the core honesty signal that separates an evidence-driven prep brief from a
// generic AI-invented question bank: "source-backed" requires a real provided
// source (interview report / job posting), "inferred" is a reasoned guess from
// the resume + role, "weak" is a low-confidence stretch.
export type PrepEvidenceLevel = 'source-backed' | 'inferred' | 'weak';

export interface PrepResumeAnchor {
  /** Short label for the project / role / accomplishment, e.g. "RAG search pipeline". */
  label: string;
  /** What in the resume backs this anchor (the evidence the candidate can point to). */
  evidence: string;
  /** Why it matters for the target role — the hook the candidate should lead with. */
  relevance: string;
}

export interface PrepRankedQuestion {
  question: string;
  /** Behavioural | Technical | System Design | Domain | Culture-fit | … (free text, normalized in UI). */
  category: string;
  /** Why this question is likely for THIS role + resume. */
  rationale: string;
  /** Best-effort frequency signal — how often this comes up for the role. */
  frequency: 'high' | 'medium' | 'low';
  /** Best-effort timeliness signal — recent loops vs. evergreen vs. dated. */
  recency: 'recent' | 'evergreen' | 'older';
  evidenceLevel: PrepEvidenceLevel;
  /** Optional tie back to a PrepResumeAnchor.label when the question targets a project. */
  anchorLabel?: string;
}

export interface PrepFollowUpChain {
  /** The resume project / skill being drilled into. */
  anchor: string;
  /** Root question first, then progressively deeper follow-ups an interviewer would ask. */
  questions: string[];
  /** What a sharp interviewer is really probing for down this chain. */
  watchFor: string;
}

export interface PrepGapRisk {
  /** The under-evidenced skill / requirement. */
  area: string;
  /** How this gap could hurt in the interview. */
  risk: string;
  /** A concrete, honest recovery — bridge to adjacent experience or a realistic learning step. */
  mitigation: string;
  severity: 'high' | 'medium' | 'low';
}

export interface PrepSourceRef {
  label: string;
  kind: 'job-description' | 'user-note' | 'resume' | 'inferred';
  detail?: string;
}

// Shared by the agency Candidate Prep Kit (AgencyHub — flat arrays only) and the
// candidate-facing Interview Prep tool (the evidence-driven layer below). The
// three flat arrays stay required so existing agency rendering and any saved
// kits keep working; the richer fields are optional and only populated for the
// candidate flow.
export interface CandidatePrepKit {
    weakSpots: string[];
    keyProjects: string[];
    predictedQuestions: string[];
    // ---- Evidence-driven candidate-facing layer (optional) ----
    targetRole?: string;
    targetCompany?: string;
    /** Honest one-line note on how grounded this kit is (e.g. "Mostly inferred — add interview reports for stronger prep"). */
    sourceCoverage?: string;
    resumeAnchors?: PrepResumeAnchor[];
    rankedQuestions?: PrepRankedQuestion[];
    followUpChains?: PrepFollowUpChain[];
    gapRisks?: PrepGapRisk[];
    practicePlan?: string[];
    sourceRefs?: PrepSourceRef[];
}

export interface BulkAnalysisItem {
    id: string;
    fileName: string;
    status: 'queued' | 'parsing' | 'analyzing' | 'complete' | 'error';
    text?: string;
    result?: AnalysisResult;
    error?: string;
    // Agency Hub Fields
    isAnonymizing?: boolean;
    blindResumeText?: string;
    matchScore?: number;
    matchSummary?: string;
    candidateName?: string;
    isPitching?: boolean;
    pitchEmail?: { subject: string; body: string };
    isPrepping?: boolean;
    prepKit?: CandidatePrepKit;
}
