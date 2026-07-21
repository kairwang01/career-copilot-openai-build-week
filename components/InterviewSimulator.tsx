
import React, { useState, useEffect, useRef } from 'react';
import {
    MessageSquare,
    ClipboardCheck,
    ChevronDown,
    FileText,
    Building2,
    Timer,
    Mic,
    AlertTriangle,
    Award,
    Crown,
    Lock,
    Printer,
    History,
    PlayCircle,
    CheckCircle2,
    BarChart3,
    Send,
    X,
} from 'lucide-react';
import {
    generateInterviewQuestions,
    evaluateInterviewSession,
    unlockInterviewReport,
    type InterviewQuestion,
    type InterviewSessionReport,
    type LockedSessionReport,
} from '../services/aiClient';
import type { AppSession as Session } from '../lib/data';
import type { UserProfile } from '../types';
import StagedLoader from './StagedLoader';
import { useRecentApplications } from '../hooks/useRecentApplications';
import { listAllActiveJobPostings, type JobPosting } from '../lib/recruitingData';
import { saveInterviewSession, subscribeInterviewSessions, type InterviewSessionHistoryItem } from '../lib/interviewSessionHistory';
import { parseToolJobContext, parseToolInterviewSeed } from '../lib/toolPrefill';
import { normalizeInterviewSessionReport } from '../lib/aiResultGuards';
import InterviewerAvatar from './InterviewerAvatar';
import { DownloadButtons } from './tools/ToolUtils';
import { ViewportAwareDialog } from './ViewportAwareDialog';

interface InterviewSimulatorProps {
  resumeText: string;
  market: string;
  initialInput?: string;
  onClose: () => void;
  t: (key: string) => string;
  session: Session | null;
  profile: UserProfile | null;
  navigateToPricing?: () => void;
}

// Client-side mirror of the server's tierFromSubscription paid set — UX only;
// the real gate is enforced in the mockInterview callable (MI_PAID_ONLY).
const PAID_STATUSES = new Set(['essentials', 'accelerator', 'executive']);

// Check for SpeechRecognition API
const SpeechRecognition = typeof window !== 'undefined'
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : undefined;
const isSpeechSupported = !!SpeechRecognition;

// ── Real-interview pacing (per requirements) ──────────────────────────────────
const PREP_SECONDS = 15;
const ANSWER_SECONDS = 180;

// The interviewer's portrait (public/interviewer.jpg, 640px JPEG). The persona
// is female; when possible, pickVoice() keeps the selected locale and prefers a
// natural-sounding voice.
const INTERVIEWER_IMAGE = '/interviewer.jpg';

type SpeechLocale = 'auto' | 'en-US' | 'zh-CN' | 'zh-TW' | 'fr-FR' | 'de-DE' | 'ja-JP' | 'ko-KR' | 'vi-VN' | 'es-ES';

const SPEECH_LOCALE_OPTIONS: { value: SpeechLocale; labelKey: string }[] = [
    { value: 'auto', labelKey: 'mi_speech_auto' },
    { value: 'en-US', labelKey: 'resume_lang_english' },
    { value: 'zh-CN', labelKey: 'resume_lang_chinese' },
    { value: 'zh-TW', labelKey: 'mi_speech_traditional_chinese' },
    { value: 'fr-FR', labelKey: 'resume_lang_french' },
    { value: 'de-DE', labelKey: 'resume_lang_german' },
    { value: 'ja-JP', labelKey: 'resume_lang_japanese' },
    { value: 'ko-KR', labelKey: 'mi_speech_korean' },
    { value: 'vi-VN', labelKey: 'resume_lang_vietnamese' },
    { value: 'es-ES', labelKey: 'mi_speech_spanish' },
];

const detectSpeechLocale = (text: string, market = ''): Exclude<SpeechLocale, 'auto'> => {
    const source = `${text} ${market}`.toLowerCase();
    if (/[\u3040-\u30ff]/.test(source)) return 'ja-JP';
    if (/[\uac00-\ud7af]/.test(source)) return 'ko-KR';
    if (/[\u4e00-\u9fff]/.test(source)) return /taiwan|traditional|繁體|台湾|台灣/.test(source) ? 'zh-TW' : 'zh-CN';
    if (/\b(france|french|francais|français|canada french|quebec|québec)\b/.test(source)) return 'fr-FR';
    if (/\b(germany|german|deutsch|deutschland)\b/.test(source)) return 'de-DE';
    if (/\b(japan|japanese|nihongo|日本)\b/.test(source)) return 'ja-JP';
    if (/\b(korea|korean|한국)\b/.test(source)) return 'ko-KR';
    if (/\b(vietnam|vietnamese|tiếng việt)\b/.test(source)) return 'vi-VN';
    if (/\b(spain|spanish|español|latam)\b/.test(source)) return 'es-ES';
    return 'en-US';
};

const isCjkSpeechLocale = (locale: string): boolean => /^(zh|ja|ko)\b/i.test(locale);

const joinSpeechSegments = (segments: Array<string | null | undefined>, locale: string): string => {
    const clean = segments.map((segment) => (segment ?? '').trim()).filter(Boolean);
    return isCjkSpeechLocale(locale) ? clean.join('') : clean.join(' ');
};

const splitSpeechText = (text: string, locale = 'en-US'): string[] => {
    const sentences: string[] = [];
    let current = '';
    const cjk = isCjkSpeechLocale(locale);
    const hardBreaks = cjk ? '。！？.!?' : '.!?';
    const softBreaks = cjk ? '，、；;：:' : '';
    for (const char of text.replace(/\s+/g, ' ').trim()) {
        current += char;
        const shouldBreak = hardBreaks.includes(char) || (softBreaks.includes(char) && current.length >= 34);
        if (shouldBreak) {
            const sentence = current.trim();
            if (sentence) sentences.push(sentence);
            current = '';
        }
    }
    if (current.trim()) sentences.push(current.trim());
    const chunks: string[] = [];
    const maxLength = cjk ? 72 : 160;
    for (const sentence of sentences.length ? sentences : [text.trim()]) {
        if (sentence.length <= maxLength) {
            chunks.push(sentence);
            continue;
        }
        for (let i = 0; i < sentence.length; i += maxLength) {
            chunks.push(sentence.slice(i, i + maxLength));
        }
    }
    return chunks;
};

/** Prefer a locale-matched voice; voices load async in some browsers, so fall
 *  back gracefully to the default. */
const pickVoice = (locale: string): SpeechSynthesisVoice | null => {
    try {
        const voices = window.speechSynthesis.getVoices();
        const base = locale.split('-')[0];
        return (
            voices.find((v) => v.lang === locale && /female|samantha|victoria|zira|jenny|aria|karen|moira|tessa|ting-ting|mei-jia|kyoko|yuna/i.test(v.name)) ??
            voices.find((v) => v.lang === locale) ??
            voices.find((v) => v.lang.toLowerCase().startsWith(base.toLowerCase())) ??
            (base === 'en' ? voices.find((v) => v.lang === 'en-US') : null) ??
            null
        );
    } catch {
        return null;
    }
};

// ── Interview type ─────────────────────────────────────────────────────────────
type InterviewType = 'comprehensive' | 'technical' | 'behavioral' | 'hr';
const INTERVIEW_TYPES: { id: InterviewType; labelKey: string; descKey: string }[] = [
    { id: 'comprehensive', labelKey: 'mi_type_comprehensive', descKey: 'mi_type_comprehensive_desc' },
    { id: 'technical',     labelKey: 'mi_type_technical',     descKey: 'mi_type_technical_desc' },
    { id: 'behavioral',    labelKey: 'mi_type_behavioral',    descKey: 'mi_type_behavioral_desc' },
    { id: 'hr',            labelKey: 'mi_type_hr',            descKey: 'mi_type_hr_desc' },
];
const INTERVIEW_TYPE_DIRECTIVES: Record<InterviewType, string> = {
    comprehensive: 'Interview type: COMPREHENSIVE — mix technical depth, behavioral (STAR) and role-fit questions in realistic proportion.',
    technical:     'Interview type: TECHNICAL — focus on hands-on technical depth: concepts, system/solution design, debugging scenarios and trade-offs drawn from the role requirements.',
    behavioral:    'Interview type: BEHAVIORAL — STAR-format questions on teamwork, conflict, leadership, failure and delivery; evaluate structure and specificity of examples.',
    hr:            'Interview type: HR — motivation, culture fit, career plans, strengths/weaknesses, salary expectations and logistics.',
};

// ── Experience levels (工作年限) ───────────────────────────────────────────────
type Experience = 'new_grad' | 'y1_3' | 'y3_5' | 'y5_10' | 'y10p';
const EXPERIENCE_OPTIONS: { id: Experience; labelKey: string; directive: string }[] = [
    { id: 'new_grad', labelKey: 'mi_exp_new_grad', directive: 'New graduate / campus hire with 0 years of professional experience — calibrate to fundamentals, internships and projects.' },
    { id: 'y1_3',     labelKey: 'mi_exp_1_3',      directive: '1-3 years of professional experience.' },
    { id: 'y3_5',     labelKey: 'mi_exp_3_5',      directive: '3-5 years of professional experience.' },
    { id: 'y5_10',    labelKey: 'mi_exp_5_10',     directive: '5-10 years of professional experience — include ownership and mentoring angles.' },
    { id: 'y10p',     labelKey: 'mi_exp_10p',      directive: '10+ years of professional experience — include leadership, architecture and strategy angles.' },
];

// ── Company profile selects (optional 公司信息配置) ────────────────────────────
const COMPANY_TYPES: { id: string; labelKey: string }[] = [
    { id: 'bigtech',    labelKey: 'mi_ctype_bigtech' },
    { id: 'foreign',    labelKey: 'mi_ctype_foreign' },
    { id: 'soe',        labelKey: 'mi_ctype_soe' },
    { id: 'startup',    labelKey: 'mi_ctype_startup' },
    { id: 'consulting', labelKey: 'mi_ctype_consulting' },
    { id: 'finance',    labelKey: 'mi_ctype_finance' },
    { id: 'other',      labelKey: 'mi_ctype_other' },
];
const COMPANY_INDUSTRIES: { id: string; labelKey: string }[] = [
    { id: 'internet',      labelKey: 'mi_cind_internet' },
    { id: 'ai',            labelKey: 'mi_cind_ai' },
    { id: 'finance',       labelKey: 'mi_cind_finance' },
    { id: 'healthcare',    labelKey: 'mi_cind_healthcare' },
    { id: 'education',     labelKey: 'mi_cind_education' },
    { id: 'manufacturing', labelKey: 'mi_cind_manufacturing' },
    { id: 'retail',        labelKey: 'mi_cind_retail' },
    { id: 'gaming',        labelKey: 'mi_cind_gaming' },
    { id: 'other',         labelKey: 'mi_cind_other' },
];

// ── Difficulty levels ──────────────────────────────────────────────────────────
type Difficulty = 'entry' | 'advanced' | 'challenge';
const DIFFICULTY_DIRECTIVES: Record<Difficulty, string> = {
    entry:
        '[Interview difficulty: ENTRY. Ask foundational, beginner-friendly questions. Be encouraging in evaluations and weight fundamentals over depth.]',
    advanced:
        '[Interview difficulty: ADVANCED. Ask standard professional-level questions with realistic depth and one follow-up angle per topic.]',
    challenge:
        '[Interview difficulty: CHALLENGE. Ask demanding senior-level questions with high-pressure follow-ups, edge cases, and trade-off probing. Evaluate against a strong-hire bar.]',
};
const DIFFICULTY_OPTIONS: { id: Difficulty; labelKey: string }[] = [
    { id: 'entry',     labelKey: 'mi_difficulty_entry' },
    { id: 'advanced',  labelKey: 'mi_difficulty_advanced' },
    { id: 'challenge', labelKey: 'mi_difficulty_challenge' },
];

// ── Verdict display map (AI returns the English verdict string) ───────────────
const VERDICT_META: Record<string, { labelKey: string; cls: string }> = {
    'strong hire':      { labelKey: 'mi_verdict_strong_hire', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
    'hire':             { labelKey: 'mi_verdict_hire',        cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
    'leaning hire':     { labelKey: 'mi_verdict_leaning_hire', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' },
    'leaning no hire':  { labelKey: 'mi_verdict_leaning_no',  cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
    'no hire':          { labelKey: 'mi_verdict_no',          cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
};

const SAMPLE_COMPANY_NAME = 'Amazon';

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const historyTitle = (item: InterviewSessionHistoryItem, fallback: string): string => {
    const match = item.job_description.match(/^Job Title:\s*(.+)$/im);
    return (match?.[1] ?? '').trim() || fallback;
};

const historyDate = (iso: string): string => {
    if (!iso) return '';
    try {
        const locale = typeof document !== 'undefined' ? document.documentElement.lang || undefined : undefined;
        return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date(iso));
    } catch {
        return '';
    }
};

const MiniTimerRing: React.FC<{
    value: number;
    max: number;
    label: string;
    tone?: 'blue' | 'amber' | 'red' | 'emerald';
}> = ({ value, max, label, tone = 'blue' }) => {
    const pct = max > 0 ? (value / max) * 100 : 0;
    const color =
        tone === 'red' ? '#f87171' :
        tone === 'amber' ? '#fbbf24' :
        tone === 'emerald' ? '#34d399' :
        '#60a5fa';
    return (
        <div
            role="timer"
            aria-label={`${label}: ${fmtTime(value)}`}
            className="grid h-24 w-24 shrink-0 place-items-center rounded-full p-1.5"
            style={{ background: `conic-gradient(${color} ${Math.max(0, Math.min(100, pct))}%, rgba(148, 163, 184, 0.22) 0)` }}
        >
            <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-white text-center dark:bg-slate-900">
                <span className="font-mono text-xl font-bold tabular-nums text-slate-950 dark:text-white">{fmtTime(value)}</span>
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-white/45">{label}</span>
            </div>
        </div>
    );
};

const ScoreRing: React.FC<{ value: number; color: string; label: string; className?: string }> = ({ value, color, label, className = 'h-28 w-28' }) => {
    const pct = Math.max(0, Math.min(100, value));
    return (
        <div
            role="img"
            aria-label={`${label}: ${Math.round(value)}/100`}
            className={`grid shrink-0 place-items-center rounded-full p-2 ${className}`}
            style={{ background: `conic-gradient(${color} ${pct}%, rgba(148, 163, 184, 0.22) 0)` }}
        >
            <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-white text-center dark:bg-slate-800">
                <span className="text-3xl font-bold text-gray-800 dark:text-gray-100">{Math.round(value)}</span>
                <span className="text-[10px] text-gray-400 dark:text-slate-500">/100</span>
            </div>
        </div>
    );
};

const AudioWave: React.FC<{ active?: boolean }> = ({ active }) => (
    <div className="flex h-8 items-end gap-1" aria-hidden="true">
        {Array.from({ length: 18 }).map((_, index) => (
            <span
                key={index}
                className={`w-1 rounded-full ${active ? 'bg-blue-500' : 'bg-slate-300 dark:bg-slate-600'}`}
                style={{
                    height: `${8 + ((index * 7) % 20)}px`,
                    opacity: active ? 0.55 + ((index % 4) * 0.12) : 0.45,
                    animation: active ? `mi-wave 900ms ${index * 35}ms ease-in-out infinite alternate` : undefined,
                }}
            />
        ))}
    </div>
);

const InterviewSimulator: React.FC<InterviewSimulatorProps> = ({ resumeText, market, initialInput = '', onClose, t, session, profile, navigateToPricing }) => {
    const isPaid = PAID_STATUSES.has(profile?.subscription_status ?? '');
    const sessionUserId = session?.user?.id ?? null;
    const [stage, setStage] = useState<'setup' | 'loading' | 'interviewing' | 'evaluating' | 'report'>('setup');
    const [showDisclaimer, setShowDisclaimer] = useState(false);
    const [disclaimerChecked, setDisclaimerChecked] = useState(false);

    // ── Section 1: interview type ──
    const [interviewType, setInterviewType] = useState<InterviewType>('comprehensive');
    // ── Section 2: target role ──
    const [jobTitle, setJobTitle] = useState('');
    const [jobDescription, setJobDescription] = useState('');
    const [jobResponsibilities, setJobResponsibilities] = useState('');
    const [jobRequirements, setJobRequirements] = useState('');
    // ── Section 3: profile ──
    const [experience, setExperience] = useState<Experience>('new_grad');
    // ── Section 4: settings ──
    const [difficulty, setDifficulty] = useState<Difficulty>('advanced');
    const [companyOpen, setCompanyOpen] = useState(false);
    const [companyName, setCompanyName] = useState('');
    const [companyType, setCompanyType] = useState('');
    const [companyIndustry, setCompanyIndustry] = useState('');
    // ── Timed interview state ──
    const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
    // Questions handed in from the Interview Prep tool (via initialInput). When
    // present we skip server generation and interview on these evidence-ranked
    // questions instead — the prep brief IS the question set.
    const [seedQuestions, setSeedQuestions] = useState<InterviewQuestion[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [phase, setPhase] = useState<'prep' | 'answer'>('prep');
    const [prepLeft, setPrepLeft] = useState(PREP_SECONDS);
    // The 15s prep clock only begins once the question has finished being read
    // aloud — otherwise a long question gets cut off by the timer.
    const [prepArmed, setPrepArmed] = useState(true);
    const [answerLeft, setAnswerLeft] = useState(ANSWER_SECONDS);
    const [answerDraft, setAnswerDraft] = useState('');
    const answersRef = useRef<string[]>([]);
    const submittingRef = useRef(false);
    const evaluatingRef = useRef(false);
    const consumedInitialInputRef = useRef('');
    // False once unmounted — guards setState after the long (≤190s) AI awaits below
    // (question generation / evaluation / unlock), so a late resolve never touches a
    // component the user has already closed.
    const mountedRef = useRef(true);
    // Generation token: Cancel bumps it so an in-flight question generation that
    // resolves afterwards is discarded, instead of forcing the user into the interview
    // they just cancelled (mountedRef can't catch a cancel-while-still-mounted).
    const genTokenRef = useRef(0);
    const [avatarSpeaking, setAvatarSpeaking] = useState(false);
    const [report, setReport] = useState<InterviewSessionReport | null>(null);
    const [lockedReport, setLockedReport] = useState<LockedSessionReport | null>(null);
    const [unlocking, setUnlocking] = useState(false);
    const unlockingRef = useRef(false);
    const [unlockConfirmOpen, setUnlockConfirmOpen] = useState(false);
    const [openBreakdown, setOpenBreakdown] = useState<number | null>(null);
    const [historyItems, setHistoryItems] = useState<InterviewSessionHistoryItem[]>([]);
    const [historyLoadFailed, setHistoryLoadFailed] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(true);
    const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
    const savedReportKeyRef = useRef<string | null>(null);
    const [upgradePromptOpen, setUpgradePromptOpen] = useState(false);

    const [error, setError] = useState<string | null>(null);
    const [isListening, setIsListening] = useState(false);
    const [confirmEndEarly, setConfirmEndEarly] = useState(false);
    const [speechLocale, setSpeechLocale] = useState<SpeechLocale>('auto');
    const recognitionRef = useRef<any>(null);
    const speechRunRef = useRef(0);
    const dictationBaseRef = useRef('');
    const dictationFinalRef = useRef('');
    const dictationInterimRef = useRef('');
    const answerBoxRef = useRef<HTMLTextAreaElement>(null);

    // Job sources: recent applications + platform postings (one fetch on mount)
    const { applications } = useRecentApplications(session);
    const [postings, setPostings] = useState<JobPosting[]>([]);
    useEffect(() => {
        const value = initialInput.trim();
        if (!value || consumedInitialInputRef.current === value || stage !== 'setup') return;
        const context = parseToolJobContext(value);
        if (!context.jobTitle && !context.summary && !context.company) return;

        consumedInitialInputRef.current = value;
        if (context.jobTitle) setJobTitle(context.jobTitle);
        if (context.summary) setJobDescription(context.summary);
        if (context.responsibilities) setJobResponsibilities(context.responsibilities);
        if (context.requiredQualifications) setJobRequirements(context.requiredQualifications);
        if (context.company) {
            setCompanyName(context.company);
            setCompanyOpen(true);
        }
        // Interview Prep hands its evidence-ranked questions through the same
        // payload; when present, interview on them instead of generating fresh.
        const seeds = parseToolInterviewSeed(value);
        setSeedQuestions(seeds.map((s) => ({ question: s.question, category: s.category || '', tip: '' })));
        setError(null);
    }, [initialInput, stage]);

    useEffect(() => {
        let cancelled = false;
        listAllActiveJobPostings()
            .then((rows) => { if (!cancelled) setPostings(rows); })
            .catch(() => { /* signed-out or rules — selector just hides */ });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (!sessionUserId) {
            setHistoryItems([]);
            setHistoryLoadFailed(false);
            setSelectedHistoryId(null);
            return;
        }
        setHistoryLoadFailed(false);
        return subscribeInterviewSessions(
            sessionUserId,
            (items) => {
                setHistoryItems(items);
                setHistoryLoadFailed(false);
            },
            () => setHistoryLoadFailed(true),
        );
    }, [sessionUserId]);

    useEffect(() => {
        if (selectedHistoryId && !historyItems.some((item) => item.id === selectedHistoryId)) {
            setSelectedHistoryId(null);
        }
    }, [historyItems, selectedHistoryId]);

    const selectedHistoryItem = selectedHistoryId
        ? historyItems.find((item) => item.id === selectedHistoryId) ?? null
        : null;

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            unlockingRef.current = false;
        };
    }, []);

    const companyNameSuggestions = Array.from(
        new Set(postings.map((p) => p.company_name).filter((n): n is string => !!n)),
    );
    const currentQuestionText = questions[currentIndex]?.question ?? '';
    const activeSpeechLocale = speechLocale === 'auto'
        ? detectSpeechLocale(`${currentQuestionText} ${jobTitle} ${jobDescription}`, market)
        : speechLocale;
    const activeSpeechOption = SPEECH_LOCALE_OPTIONS.find((option) => option.value === activeSpeechLocale);
    const activeSpeechLabel = activeSpeechOption ? t(activeSpeechOption.labelKey) : activeSpeechLocale;

    // ── TTS: the avatar "speaks" each question (approximate mouth animation is
    //    driven by these lifecycle events — see InterviewerAvatar for the
    //    lip-sync design note) ──
    // ── TTS hardening ───────────────────────────────────────────────────────
    // The Web Speech API has two cold-start glitches that made the FIRST question
    // "tear"/stutter while later ones were fine:
    //   1. cancel() called synchronously right before speak() clips the next
    //      utterance in Chromium — so we only cancel when audio is actually
    //      playing, and let the engine reset before the next speak.
    //   2. getVoices() is empty until the async 'voiceschanged' event fires, so
    //      the first utterance fell back to a different default voice — we
    //      pre-load voices on mount and warm the engine up on the start gesture.

    // Pre-load voices so pickVoice() has data before the first question speaks.
    useEffect(() => {
        const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
        if (!synth) return;
        synth.getVoices();
        const onVoices = () => { synth.getVoices(); };
        synth.addEventListener?.('voiceschanged', onVoices);
        return () => synth.removeEventListener?.('voiceschanged', onVoices);
    }, []);

    // Prime the cold TTS engine with a silent utterance from inside the start
    // gesture, so the first real question doesn't stutter on a cold start.
    const warmUpTts = () => {
        try {
            const synth = window.speechSynthesis;
            if (!synth) return;
            synth.cancel();
            const warm = new SpeechSynthesisUtterance(' ');
            warm.volume = 0;
            synth.speak(warm);
        } catch { /* noop */ }
    };

    const speak = (text: string, onDone?: () => void) => {
        const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
        if (!synth) { onDone?.(); return; } // no TTS → don't block the prep timer
        const runId = ++speechRunRef.current;
        const finish = () => {
            if (speechRunRef.current !== runId) return;
            setAvatarSpeaking(false);
            onDone?.();
        };
        try {
            const start = () => {
                if (speechRunRef.current !== runId) return;
                const chunks = splitSpeechText(text, activeSpeechLocale);
                const voice = pickVoice(activeSpeechLocale);
                const speakChunk = (index: number) => {
                    if (speechRunRef.current !== runId) return;
                    if (index >= chunks.length) { finish(); return; }
                    const u = new SpeechSynthesisUtterance(chunks[index]);
                    u.lang = activeSpeechLocale;
                    u.rate = activeSpeechLocale.startsWith('zh') || activeSpeechLocale === 'ja-JP' || activeSpeechLocale === 'ko-KR' ? 0.92 : 1;
                    if (voice) u.voice = voice;
                    u.onstart = () => {
                        if (speechRunRef.current === runId) setAvatarSpeaking(true);
                    };
                    // onDone fires when the whole question has finished being read aloud,
                    // which is when the 15s prep clock should start.
                    u.onend = () => speakChunk(index + 1);
                    u.onerror = (event) => {
                        if (speechRunRef.current !== runId) return;
                        const error = (event as SpeechSynthesisErrorEvent).error;
                        if (error === 'canceled' || error === 'interrupted') return;
                        // Some browser voices fail on a single long or mixed-script
                        // chunk. Skip only that chunk so the prep timer is not stuck
                        // and later chunks can still be read.
                        speakChunk(index + 1);
                    };
                    synth.speak(u);
                };
                speakChunk(0);
            };
            if (synth.speaking || synth.pending) {
                // Cancel, then start only after the engine has reset — a
                // synchronous cancel()+speak() clips/tears the next utterance.
                synth.cancel();
                window.setTimeout(start, 120);
            } else {
                start();
            }
        } catch { finish(); /* TTS unsupported — don't block the prep timer */ }
    };
    const cancelSpeech = () => {
        speechRunRef.current += 1;
        try { window.speechSynthesis.cancel(); } catch { /* noop */ }
        setAvatarSpeaking(false);
    };
    useEffect(() => () => {
        cancelSpeech();
        // Release the mic too, so it is never left live after the room unmounts.
        try { recognitionRef.current?.stop?.(); } catch { /* noop */ }
    }, [activeSpeechLocale]);

    const handleJobSourcePick = (value: string) => {
        if (!value) return;
        if (value.startsWith('job:')) {
            const posting = postings.find((p) => p.id === value.slice(4));
            if (!posting) return;
            // The user is choosing a different job context, so any prep-brief seed
            // no longer matches — drop it and generate fresh for the new context.
            setSeedQuestions([]);
            setJobTitle(posting.title);
            if (posting.description) setJobDescription(posting.description);
            if (posting.company_name) setCompanyName(posting.company_name);
        } else if (value.startsWith('app:')) {
            const app = applications.find((a) => a.id === value.slice(4));
            if (!app) return;
            setSeedQuestions([]);
            setJobTitle(app.job_title);
            if (app.description) setJobDescription(app.description);
            if (app.responsibilities) setJobResponsibilities(app.responsibilities);
            if (app.required_qualifications) setJobRequirements(app.required_qualifications);
            if (app.company_name) {
                setCompanyName(app.company_name);
                setCompanyOpen(true);
            }
        }
    };

    const fillSample = () => {
        // Loading the worked example replaces the setup context, so a prior
        // prep-brief seed should no longer drive the interview.
        setSeedQuestions([]);
        setInterviewType('technical');
        setJobTitle(t('mi_sample_title'));
        setJobDescription(t('mi_sample_description'));
        setJobResponsibilities(t('mi_sample_responsibilities'));
        setJobRequirements(t('mi_sample_requirements'));
        setExperience('y1_3');
        setCompanyName(SAMPLE_COMPANY_NAME);
        setCompanyType('bigtech');
        setCompanyIndustry('internet');
        setCompanyOpen(true);
    };

    /** Assemble the structured setup into the context consumed by generation AND the final report. */
    const assembleContext = (): string => {
        const lines: string[] = [];
        lines.push(INTERVIEW_TYPE_DIRECTIVES[interviewType]);
        lines.push(`Job Title: ${jobTitle.trim()}`);
        const exp = EXPERIENCE_OPTIONS.find((e) => e.id === experience);
        if (exp) lines.push(`Candidate experience level: ${exp.directive}`);
        if (companyName.trim() || companyType || companyIndustry) {
            const typeLabel = COMPANY_TYPES.find((c) => c.id === companyType);
            const indLabel = COMPANY_INDUSTRIES.find((c) => c.id === companyIndustry);
            lines.push(
                `Company: ${companyName.trim() || 'unspecified'}` +
                (typeLabel ? ` | type: ${typeLabel.id}` : '') +
                (indLabel ? ` | industry: ${indLabel.id}` : ''),
            );
        }
        if (jobDescription.trim()) lines.push(`Job Description:\n${jobDescription.trim()}`);
        if (jobResponsibilities.trim()) lines.push(`Responsibilities:\n${jobResponsibilities.trim()}`);
        if (jobRequirements.trim()) lines.push(`Requirements:\n${jobRequirements.trim()}`);
        lines.push(DIFFICULTY_DIRECTIVES[difficulty]);
        return lines.join('\n\n');
    };

    // ── Speech recognition (answers can be dictated) ──
    useEffect(() => {
        if (!isSpeechSupported) return;

        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.continuous = true;
        recognitionRef.current.interimResults = true;
        recognitionRef.current.lang = activeSpeechLocale;

        const renderDictation = () => {
            const committed = joinSpeechSegments(
                [dictationBaseRef.current, dictationFinalRef.current],
                activeSpeechLocale,
            );
            return joinSpeechSegments([committed, dictationInterimRef.current], activeSpeechLocale);
        };

        recognitionRef.current.onresult = (event: any) => {
            const finalSegments: string[] = [];
            const interimSegments: string[] = [];
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                const transcript = event.results[i][0].transcript.trim();
                if (!transcript) continue;
                if (event.results[i].isFinal) {
                    finalSegments.push(transcript);
                } else {
                    interimSegments.push(transcript);
                }
            }
            if (finalSegments.length) {
                dictationFinalRef.current = joinSpeechSegments(
                    [dictationFinalRef.current, joinSpeechSegments(finalSegments, activeSpeechLocale)],
                    activeSpeechLocale,
                );
            }
            dictationInterimRef.current = joinSpeechSegments(interimSegments, activeSpeechLocale);
            setAnswerDraft(renderDictation());
        };

        recognitionRef.current.onerror = (event: any) => {
            const code = String(event.error ?? '');
            if (code === 'aborted') return;
            console.error('Speech recognition error:', code);
            const key = code === 'not-allowed' || code === 'service-not-allowed'
                ? 'mi_speech_error_permission'
                : code === 'no-speech'
                    ? 'mi_speech_error_no_speech'
                    : code === 'network'
                        ? 'mi_speech_error_network'
                        : 'mi_speech_error_unavailable';
            setError(t(key));
            setIsListening(false);
        };

        // The engine can stop on its own (silence/network/timeout); reset the
        // mic indicator so it never shows a live mic after dictation stopped.
        recognitionRef.current.onend = () => {
            if (dictationInterimRef.current) {
                dictationFinalRef.current = joinSpeechSegments(
                    [dictationFinalRef.current, dictationInterimRef.current],
                    activeSpeechLocale,
                );
                dictationInterimRef.current = '';
                setAnswerDraft(renderDictation());
            }
            setIsListening(false);
        };

        return () => {
            try { recognitionRef.current?.abort?.(); } catch { /* noop */ }
        };
    }, [activeSpeechLocale, t]);

    const stopListening = () => {
        if (isListening) {
            try { recognitionRef.current?.stop(); } catch { /* noop */ }
            setIsListening(false);
        }
    };
    const toggleListening = () => {
        if (!isSpeechSupported) {
            setError(t('mi_speech_error_unavailable'));
            return;
        }
        if (isListening) {
            stopListening();
        } else {
            try {
                dictationBaseRef.current = answerDraft.trimEnd();
                dictationFinalRef.current = '';
                dictationInterimRef.current = '';
                if (recognitionRef.current) recognitionRef.current.lang = activeSpeechLocale;
                setError(null);
                recognitionRef.current?.start?.();
                setIsListening(true);
            } catch (err) {
                console.error('Speech recognition start failed:', err);
                setIsListening(false);
                setError(t('tool_mock_interview_speech_start_failed'));
            }
        }
    };

    // ── Flow: setup → disclaimer → generate → timed questions → session report ──
    const handleStartClicked = (e: React.FormEvent) => {
        e.preventDefault();
        // When questions are seeded from Interview Prep, the prep brief IS the
        // content: the job title rides in on the seed and a full job description
        // is optional, so the from-scratch setup requirements don't apply. Without
        // this, the headline Prep → Mock Interview handoff dead-ends here whenever
        // no job description was entered (the common standalone case).
        if (seedQuestions.length === 0) {
            if (!jobTitle.trim()) { setError(t('mi_error_title_required')); return; }
            if (!jobDescription.trim() && !jobResponsibilities.trim() && !jobRequirements.trim()) {
                setError(t('mi_error_context_required')); return;
            }
        }
        if (!session) { setError(t('error_login_required_interview')); return; }
        setError(null);
        setDisclaimerChecked(false);
        setShowDisclaimer(true);
    };

    const beginInterview = async () => {
        setShowDisclaimer(false);
        warmUpTts(); // prime TTS now so the engine is warm by the time Q1 is spoken
        setStage('loading');
        setError(null);
        savedReportKeyRef.current = null;
        const myToken = ++genTokenRef.current;
        try {
            // Prefer the evidence-ranked questions handed in from Interview Prep;
            // fall back to fresh server generation when there is no seed.
            const generated = seedQuestions.length > 0
                ? seedQuestions.slice(0, 8)
                : await generateInterviewQuestions(resumeText, assembleContext(), market);
            // Bail if the user cancelled/restarted while we were generating — otherwise
            // a cancelled generation would still yank them into the interview.
            if (!mountedRef.current || myToken !== genTokenRef.current) return;
            if (!generated.length) throw new Error(t('mi_error_no_questions_generated'));
            answersRef.current = [];
            submittingRef.current = false;
            setQuestions(generated);
            setCurrentIndex(0);
            setAnswerDraft('');
            setPhase('prep');
            setPrepLeft(PREP_SECONDS);
            setPrepArmed(false);
            setStage('interviewing');
            speak(generated[0].question, () => setPrepArmed(true));
        } catch (err) {
            if (!mountedRef.current || myToken !== genTokenRef.current) return;
            setError(err instanceof Error ? err.message : t('mi_error_start_failed'));
            setStage('setup');
        }
    };

    // Prep countdown → auto-start answering. Held until the question has been
    // fully read aloud (prepArmed), so long questions are never cut off.
    useEffect(() => {
        if (stage !== 'interviewing' || phase !== 'prep') return;
        if (!prepArmed) return;
        if (prepLeft <= 0) {
            setPhase('answer');
            setAnswerLeft(ANSWER_SECONDS);
            setTimeout(() => answerBoxRef.current?.focus(), 50);
            return;
        }
        const id = setTimeout(() => setPrepLeft((s) => s - 1), 1000);
        return () => clearTimeout(id);
    }, [stage, phase, prepLeft, prepArmed]);

    // Safety net: speechSynthesis occasionally never fires onend (a known
    // Chromium quirk). Arm the prep clock anyway after a generous read-time
    // estimate so the interview can never stall waiting for the voice. Cleared
    // the moment the question is actually read or we advance, so it can't leak
    // across questions.
    useEffect(() => {
        if (stage !== 'interviewing' || phase !== 'prep' || prepArmed) return;
        const text = questions[currentIndex]?.question ?? '';
        const estMs = Math.min(45000, 6000 + text.length * 120);
        const id = setTimeout(() => setPrepArmed(true), estMs);
        return () => clearTimeout(id);
    }, [stage, phase, prepArmed, currentIndex, questions]);

    // Answer countdown → auto-submit
    useEffect(() => {
        if (stage !== 'interviewing' || phase !== 'answer') return;
        if (answerLeft <= 0) {
            submitAnswer();
            return;
        }
        const id = setTimeout(() => setAnswerLeft((s) => s - 1), 1000);
        return () => clearTimeout(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stage, phase, answerLeft]);

    const startAnsweringNow = () => {
        cancelSpeech();
        setPhase('answer');
        setAnswerLeft(ANSWER_SECONDS);
        setTimeout(() => answerBoxRef.current?.focus(), 50);
    };

    const persistInterviewHistory = (rep: InterviewSessionReport) => {
        if (!sessionUserId) return;
        const reportKey = `${jobTitle}|${rep.overallScore}|${rep.summary.slice(0, 120)}|${answersRef.current.join('|').slice(0, 400)}`;
        if (savedReportKeyRef.current === reportKey) return;
        savedReportKeyRef.current = reportKey;
        const exchanges = rep.perQuestion.map((pq, i) => ({
            question: pq.question,
            answer: answersRef.current[i] ?? '',
            score: pq.score,
            feedback: pq.feedback,
        }));
        void saveInterviewSession(sessionUserId, {
            jobDescription: assembleContext(),
            marketName: market,
            overallSummary: rep.summary,
            exchanges,
        }).catch(() => {
            if (savedReportKeyRef.current === reportKey) savedReportKeyRef.current = null;
            if (mountedRef.current) setError(t('mi_history_save_failed'));
        });
    };

    const finishAndEvaluate = async (qa: { question: string; answer: string }[]) => {
        if (evaluatingRef.current) return;
        evaluatingRef.current = true;
        setStage('evaluating');
        try {
            const res = await evaluateInterviewSession(qa, assembleContext(), resumeText);
            if (!mountedRef.current) return;
            if (res.locked) {
                setLockedReport(res);
                setReport(null);
            } else {
                const rep = normalizeInterviewSessionReport(res);
                setReport(rep);
                persistInterviewHistory(rep);
                setLockedReport(null);
            }
            setStage('report');
        } catch (err) {
            if (mountedRef.current) {
                setError(err instanceof Error ? err.message : t('mi_error_evaluate_failed'));
                setReport(null);
                setLockedReport(null);
                setStage('report'); // report stage renders the error + retry
            }
        } finally {
            evaluatingRef.current = false;
        }
    };

    const handleUnlock = async () => {
        if (!lockedReport || unlocking || unlockingRef.current) return;
        unlockingRef.current = true;
        setUnlockConfirmOpen(false);
        setUnlocking(true);
        setError(null);
        try {
            const res = await unlockInterviewReport(lockedReport.reportId);
            if (!mountedRef.current) return;
            const rep = normalizeInterviewSessionReport(res);
            setReport(rep);
            persistInterviewHistory(rep);
            setLockedReport(null);
        } catch (err) {
            if (mountedRef.current) setError(err instanceof Error ? err.message : t('mi_error_unlock_failed'));
        } finally {
            unlockingRef.current = false;
            if (mountedRef.current) setUnlocking(false);
        }
    };

    const openUpgradePrompt = () => {
        setUpgradePromptOpen(true);
    };

    const openUnlockConfirm = () => {
        if (!lockedReport || unlocking) return;
        setUnlockConfirmOpen(true);
    };

    const confirmUpgradeNavigation = () => {
        setUpgradePromptOpen(false);
        if (navigateToPricing) {
            navigateToPricing();
            return;
        }
        onClose();
    };

    const upgradePromptDialog = upgradePromptOpen ? (
        <ViewportAwareDialog
            open
            onClose={() => setUpgradePromptOpen(false)}
            closeOnBackdrop
            labelledBy="mock-interview-upgrade-title"
            maxWidth={448}
            zIndex={95}
        >
            <div className="rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
                <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                        <Crown className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div>
                        <h3 id="mock-interview-upgrade-title" className="text-lg font-bold text-slate-950 dark:text-slate-50">
                            {t('mi_paid_only_title')}
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                            {t('mi_paid_only_desc')}
                        </p>
                    </div>
                </div>
                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    <button
                        type="button"
                        onClick={() => setUpgradePromptOpen(false)}
                        className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                        {t('action_cancel')}
                    </button>
                    <button
                        type="button"
                        onClick={confirmUpgradeNavigation}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                    >
                        <Crown className="h-4 w-4" aria-hidden="true" />
                        {t('mi_paid_only_cta')}
                    </button>
                </div>
            </div>
        </ViewportAwareDialog>
    ) : null;

    const unlockConfirmDialog = unlockConfirmOpen && lockedReport ? (
        <ViewportAwareDialog
            open
            onClose={() => setUnlockConfirmOpen(false)}
            closeOnBackdrop
            labelledBy="mock-interview-unlock-title"
            maxWidth={448}
            zIndex={96}
        >
            <div className="rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
                <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
                        <Lock className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div>
                        <h3 id="mock-interview-unlock-title" className="text-lg font-bold text-slate-950 dark:text-slate-50">
                            {t('credit_modal_confirm_title').replace('{cost}', String(lockedReport.unlockCredits))}
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                            {t('mi_locked_desc').replace('{n}', String(lockedReport.preview.perQuestionCount))}
                        </p>
                    </div>
                </div>
                <div className="mt-5 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm leading-6 text-violet-900 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-100">
                    {t('mi_unlock_button').replace('{n}', String(lockedReport.unlockCredits))}
                </div>
                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    <button
                        type="button"
                        onClick={() => setUnlockConfirmOpen(false)}
                        disabled={unlocking}
                        className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                        {t('credit_modal_cancel')}
                    </button>
                    <button
                        type="button"
                        onClick={handleUnlock}
                        disabled={unlocking}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-violet-800 focus:outline-none focus:ring-2 focus:ring-violet-500/40 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {unlocking ? t('mi_unlocking') : t('credit_modal_confirm_cta')}
                    </button>
                </div>
            </div>
        </ViewportAwareDialog>
    ) : null;

    /** Dependency-free PDF: open a minimal printable document and trigger the
     *  browser's print-to-PDF. Only reachable from the full (entitled/unlocked)
     *  report view. */
    const exportPdf = (rep: InterviewSessionReport) => {
        const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const verdictMeta = VERDICT_META[rep.verdict?.toLowerCase?.() ?? ''];
        const verdictLabel = verdictMeta ? t(verdictMeta.labelKey) : rep.verdict;
        const documentLanguage = document.documentElement.lang || 'en';
        const documentDirection = document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr';
        const html = `<!doctype html><html lang="${esc(documentLanguage)}" dir="${documentDirection}"><head><meta charset="utf-8"><title>${esc(t('mi_report_title'))}</title>
<style>body{font-family:-apple-system,'Segoe UI',sans-serif;color:#1e293b;max-width:760px;margin:32px auto;padding:0 24px;line-height:1.55}
h1{font-size:22px}h2{font-size:15px;margin-top:24px;border-bottom:1px solid #e2e8f0;padding-bottom:4px}
.score{font-size:40px;font-weight:800}.verdict{display:inline-block;padding:4px 12px;border-radius:999px;background:#eef2ff;font-weight:700}
.q{margin:14px 0;padding:10px 14px;border-inline-start:3px solid #6366f1;background:#f8fafc}.muted{color:#64748b;font-size:13px}</style></head><body>
<h1>${esc(t('mi_report_title'))} — ${esc(jobTitle)}</h1>
<p><span class="score">${Math.round(rep.overallScore)}</span><span class="muted">/100</span>&nbsp;&nbsp;<span class="verdict">${esc(verdictLabel)}</span></p>
<h2>${esc(t('mi_report_summary_h'))}</h2><p>${esc(rep.summary)}</p>
<h2>${esc(t('mi_report_strengths'))}</h2><ul>${rep.strengths.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
<h2>${esc(t('mi_report_improvements'))}</h2><ul>${rep.improvements.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
<h2>${esc(t('mi_report_breakdown'))}</h2>
${rep.perQuestion.map((pq, i) => `<div class="q"><strong>${esc(t('mi_question_short'))}${i + 1} (${Math.round(pq.score)}/100):</strong> ${esc(pq.question)}<br/><span class="muted">${esc(t('mi_report_your_answer'))}: ${esc(answersRef.current[i]?.trim() || t('mi_no_answer'))}</span><br/><span class="muted">${esc(t('mi_report_feedback'))}:</span> ${esc(pq.feedback)}</div>`).join('')}
<p class="muted">${esc(t('mi_disclaimer_p2'))}</p>
</body></html>`;
        const w = window.open('', '_blank');
        if (!w) {
            setError(t('mi_export_popup_blocked'));
            return;
        }
        try {
            w.opener = null;
            w.document.write(html);
            w.document.close();
            window.setTimeout(() => {
                if (!w.closed) {
                    w.focus();
                    w.print();
                }
            }, 200);
            setError(null);
        } catch {
            w.close();
            setError(t('mi_export_popup_blocked'));
        }
    };

    const submitAnswer = () => {
        if (submittingRef.current) return;
        submittingRef.current = true;
        setConfirmEndEarly(false);
        stopListening();
        cancelSpeech();

        answersRef.current = [...answersRef.current, answerDraft.trim()];
        const next = currentIndex + 1;
        if (next < questions.length) {
            setAnswerDraft('');
            setCurrentIndex(next);
            setPhase('prep');
            setPrepLeft(PREP_SECONDS);
            setPrepArmed(false);
            speak(questions[next].question, () => setPrepArmed(true));
            submittingRef.current = false;
        } else {
            const qa = questions.map((q, i) => ({ question: q.question, answer: answersRef.current[i] ?? '' }));
            finishAndEvaluate(qa);
        }
    };

    const endInterviewEarly = () => {
        setConfirmEndEarly(false);
        stopListening();
        cancelSpeech();
        // Count the current draft, mark the rest unanswered, evaluate what we have.
        const answered = [...answersRef.current];
        answered[currentIndex] = answerDraft.trim();
        const qa = questions.map((q, i) => ({ question: q.question, answer: answered[i] ?? '' }));
        finishAndEvaluate(qa);
    };

    const handleRestart = () => {
        cancelSpeech();
        stopListening();
        setStage('setup');
        setQuestions([]);
        setCurrentIndex(0);
        setAnswerDraft('');
        answersRef.current = [];
        submittingRef.current = false;
        setReport(null);
        setLockedReport(null);
        savedReportKeyRef.current = null;
        setOpenBreakdown(null);
        setError(null);
        setConfirmEndEarly(false);
    };

    const formatReportForDownload = (rep: InterviewSessionReport): string => {
        const verdictMeta = VERDICT_META[rep.verdict?.toLowerCase?.() ?? ''];
        const verdictLabel = verdictMeta ? t(verdictMeta.labelKey) : rep.verdict;
        let s = `# ${t('mi_report_title')} — ${jobTitle}\n\n`;
        s += `${t('mi_overall_score')}: ${rep.overallScore}/100\n${t('mi_verdict_label')}: ${verdictLabel}\n\n## ${t('mi_report_summary_h')}\n${rep.summary}\n\n`;
        s += `## ${t('mi_report_strengths')}\n${rep.strengths.map((x) => `* ${x}`).join('\n')}\n\n`;
        s += `## ${t('mi_report_improvements')}\n${rep.improvements.map((x) => `* ${x}`).join('\n')}\n\n## ${t('mi_report_breakdown')}\n`;
        rep.perQuestion.forEach((pq, i) => {
            s += `\n### ${t('mi_question_short')}${i + 1} (${pq.score}/100): ${pq.question}\n${t('mi_report_your_answer')}: ${answersRef.current[i] || t('mi_no_answer')}\n${t('mi_report_feedback')}: ${pq.feedback}\n`;
        });
        return s;
    };

    if (stage === 'loading') {
        return (
            <div data-qa="interview-simulator" data-qa-interview-stage="loading">
                <StagedLoader
                    title={t('tool_mock_interview_starting_button')}
                    steps={[
                        t('tool_mock_interview_loader_step1'),
                        t('tool_mock_interview_loader_step2'),
                        t('tool_mock_interview_loader_step3'),
                    ]}
                    onCancel={() => { genTokenRef.current += 1; setStage('setup'); }}
                    icon={<MessageSquare />}
                    accent="violet"
                />
            </div>
        );
    }

    if (stage === 'evaluating') {
        return (
            <div data-qa="interview-simulator" data-qa-interview-stage="evaluating">
                <StagedLoader
                    title={t('mi_report_title')}
                    steps={[t('mi_eval_step1'), t('mi_eval_step2'), t('mi_eval_step3')]}
                    icon={<ClipboardCheck />}
                    accent="violet"
                />
            </div>
        );
    }

    // ── Timed interview room ──────────────────────────────────────────────────
    if (stage === 'interviewing') {
        const q = questions[currentIndex];
        const isLast = currentIndex === questions.length - 1;
        const timeLeft = phase === 'prep' ? prepLeft : answerLeft;
        const timeMax = phase === 'prep' ? PREP_SECONDS : ANSWER_SECONDS;
        const urgent = phase === 'answer' && answerLeft <= 30;
        const progressPct = questions.length ? ((currentIndex + 1) / questions.length) * 100 : 0;
        const timerTone = urgent ? 'red' : phase === 'prep' ? 'amber' : 'blue';
        return (
            <div data-qa="interview-simulator" data-qa-interview-stage="interviewing" className="flex h-full w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-950 shadow-xl animate-fade-in dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50">
                <header className="flex flex-col gap-4 border-b border-slate-200 bg-white p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between dark:border-slate-700 dark:bg-slate-900">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                            <MessageSquare className="h-4 w-4 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                            {t('mi_room_label')}
                        </div>
                        <h3 className="mt-2 break-words text-xl font-bold tracking-tight sm:truncate sm:text-2xl">{jobTitle || t('mi_history_default_title')}</h3>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                            {t('mi_q_progress').replace('{n}', String(currentIndex + 1)).replace('{total}', String(questions.length))}
                        </span>
                        <span role="status" aria-live="polite" className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${
                            phase === 'prep'
                                ? 'border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/25 dark:text-amber-200'
                                : urgent
                                    ? 'border border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-900/25 dark:text-red-200'
                                    : 'border border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/50 dark:bg-blue-900/25 dark:text-blue-200'
                        }`}>
                            <Timer className="h-3.5 w-3.5" aria-hidden="true" />
                            {phase === 'prep' ? t('mi_phase_prep') : t('mi_phase_answer')}
                        </span>
                    </div>
                </header>

                <div className="h-1 bg-slate-100 dark:bg-slate-800">
                    <div
                        role="progressbar"
                        aria-label={t('mi_progress_label')}
                        aria-valuemin={0}
                        aria-valuemax={questions.length}
                        aria-valuenow={currentIndex + 1}
                        className="h-full rounded-e-full bg-blue-600 transition-all duration-500"
                        style={{ width: `${progressPct}%` }}
                    />
                </div>

                <main className="grid flex-1 gap-4 overflow-y-auto bg-slate-50 p-4 sm:p-5 xl:grid-cols-[260px_minmax(0,1fr)_260px] dark:bg-slate-950">
                    <aside className="order-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm xl:order-1 dark:border-slate-700 dark:bg-slate-900">
                        <InterviewerAvatar
                            speaking={avatarSpeaking}
                            imageUrl={INTERVIEWER_IMAGE}
                            name={t('mi_avatar_name')}
                            roleLabel={t('mi_avatar_role')}
                        />
                        <div className="mt-4 grid grid-cols-2 gap-2 text-center">
                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{t('mi_mode_label')}</p>
                                <p className="mt-1 truncate text-xs font-bold text-slate-900 dark:text-slate-100">
                                    {t(INTERVIEW_TYPES.find((it) => it.id === interviewType)?.labelKey ?? 'mi_type_comprehensive')}
                                </p>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{t('mi_level_label')}</p>
                                <p className="mt-1 truncate text-xs font-bold text-slate-900 dark:text-slate-100">
                                    {t(DIFFICULTY_OPTIONS.find((opt) => opt.id === difficulty)?.labelKey ?? 'mi_difficulty_advanced')}
                                </p>
                            </div>
                        </div>
                        <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-3 dark:border-blue-900/40 dark:bg-blue-950/30">
                            <p className="text-xs font-bold text-blue-900 dark:text-blue-200">{t('mi_real_pacing_title')}</p>
                            <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-400">{t('mi_real_pacing_desc')}</p>
                        </div>
                    </aside>

                    <section className="order-1 flex min-h-[420px] flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:min-h-[520px] sm:p-5 xl:order-2 dark:border-slate-700 dark:bg-slate-900">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-800/70">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200">
                                    {q?.category || t('mi_question_category_default')}
                                </span>
                                <span className="text-xs font-semibold text-slate-500">
                                    {currentIndex + 1} / {questions.length}
                                </span>
                            </div>
                            <h4 data-qa="mock-interview-question" aria-live="polite" className="mt-4 text-2xl font-semibold leading-tight text-slate-950 lg:text-3xl dark:text-slate-50">
                                {q?.question}
                            </h4>
                        </div>

                        {phase === 'prep' ? (
                            <div className="mt-4 flex flex-1 flex-col items-center justify-center gap-5 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center dark:border-amber-900/50 dark:bg-amber-950/25">
                                <MiniTimerRing value={timeLeft} max={timeMax} label={t('mi_timer_prep_short')} tone={timerTone} />
                                <div>
                                    <p className="text-base font-bold text-amber-950 dark:text-amber-100">{t('mi_prep_hint')}</p>
                                    <p className="mt-2 max-w-md text-sm leading-6 text-amber-900/70 dark:text-amber-100/70">{t('mi_prep_coaching_tip')}</p>
                                </div>
                                <button
                                    type="button"
                                    data-qa="mock-interview-start-answering"
                                    onClick={startAnsweringNow}
                                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-700 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-800"
                                >
                                    <PlayCircle className="h-4 w-4" />
                                    {t('mi_start_now')}
                                </button>
                            </div>
                        ) : (
                            <div className="mt-4 flex flex-1 flex-col gap-4">
                                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                                        {isSpeechSupported && (
                                            <button
                                                type="button"
                                                onClick={toggleListening}
                                                aria-pressed={isListening}
                                                aria-label={isListening ? t('mi_mic_stop') : t('mi_mic_start')}
                                                className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition ${
                                                    isListening
                                                        ? 'bg-red-500 text-white animate-pulse-mic'
                                                        : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                                                }`}
                                                title={isListening ? t('mi_mic_stop') : t('mi_mic_start')}
                                            >
                                                <Mic className="h-5 w-5" />
                                            </button>
                                        )}
                                        <div className="flex min-w-0 flex-1 items-center gap-3">
                                            <AudioWave active={isListening} />
                                            <span className="hidden text-xs font-semibold text-slate-600 sm:inline dark:text-slate-300">
                                                {isListening
                                                    ? `${t('mi_speech_listening')} · ${activeSpeechLabel}`
                                                    : `${t('mi_speech_voice')} · ${activeSpeechLabel}`}
                                            </span>
                                        </div>
                                        <label className="flex w-full items-center justify-between gap-2 text-xs font-semibold text-slate-600 sm:w-auto sm:shrink-0 dark:text-slate-300">
                                            <span>{t('mi_speech_label')}</span>
                                            <select
                                                value={speechLocale}
                                                onChange={(event) => {
                                                    stopListening();
                                                    setSpeechLocale(event.target.value as SpeechLocale);
                                                }}
                                                className="h-9 min-w-0 max-w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                            >
                                                {SPEECH_LOCALE_OPTIONS.map((option) => (
                                                    <option key={option.value} value={option.value}>
                                                        {t(option.labelKey)}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                    </div>
                                    {speechLocale === 'auto' && (
                                        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                            {t('mi_speech_auto_using')} {activeSpeechLabel}
                                        </p>
                                    )}
                                </div>
                                <label htmlFor="mi-answer" className="sr-only">{t('mi_answer_placeholder')}</label>
                                <textarea
                                    id="mi-answer"
                                    aria-describedby="mi-answer-note"
                                    data-qa="mock-interview-answer"
                                    ref={answerBoxRef}
                                    value={answerDraft}
                                    onChange={(e) => setAnswerDraft(e.target.value)}
                                    placeholder={t('mi_answer_placeholder')}
                                    className="min-h-[190px] flex-1 resize-none rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-900 shadow-inner outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                                />
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <p id="mi-answer-note" className="text-xs text-slate-500">{t('mi_autosubmit_note')}</p>
                                    <button
                                        type="button"
                                        data-qa="mock-interview-submit-answer"
                                        onClick={submitAnswer}
                                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-700 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-800"
                                    >
                                        <Send className="h-4 w-4" />
                                        {isLast ? t('mi_submit_last') : t('mi_submit_answer')}
                                    </button>
                                </div>
                            </div>
                        )}

                        {error && (
                            <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">{error}</p>
                        )}
                    </section>

                    <aside className="order-3 space-y-4">
                        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{t('mi_timer_label')}</p>
                                    <p className={`mt-1 font-mono text-3xl font-bold tabular-nums ${urgent ? 'text-red-600 animate-pulse dark:text-red-300' : 'text-slate-950 dark:text-white'}`}>{fmtTime(timeLeft)}</p>
                                </div>
                                <MiniTimerRing value={timeLeft} max={timeMax} label={phase === 'prep' ? t('mi_timer_prep_short') : t('mi_timer_answer_short')} tone={timerTone} />
                            </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                            <p className="text-sm font-bold text-slate-950 dark:text-white">{t('mi_answer_focus_title')}</p>
                            <div className="mt-3 flex flex-wrap gap-2">
                                {['mi_answer_focus_context', 'mi_answer_focus_action', 'mi_answer_focus_result', 'mi_answer_focus_learning'].map((key) => (
                                    <span key={key} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">{t(key)}</span>
                                ))}
                            </div>
                        </div>

                        {!confirmEndEarly ? (
                            <button
                                type="button"
                                onClick={() => setConfirmEndEarly(true)}
                                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-sm transition hover:border-red-200 hover:bg-red-50 hover:text-red-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-red-900 dark:hover:bg-red-950/30"
                            >
                                <X className="h-4 w-4" />
                                {t('mi_end_interview')}
                            </button>
                        ) : (
                            <div className="space-y-3 rounded-2xl border border-red-200 bg-red-50 p-4 animate-panel-expand dark:border-red-900/50 dark:bg-red-950/30">
                                <p className="text-xs leading-5 text-red-700 dark:text-red-200">{t('mi_end_confirm')}</p>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={endInterviewEarly}
                                        className="rounded-xl bg-red-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-red-700"
                                    >
                                        {t('mi_end_interview')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setConfirmEndEarly(false)}
                                        className="rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700 transition hover:bg-red-100 dark:border-red-900/50 dark:bg-slate-900 dark:text-red-200 dark:hover:bg-red-950/40"
                                    >
                                        {t('action_cancel')}
                                    </button>
                                </div>
                            </div>
                        )}
                    </aside>
                </main>
            </div>
        );
    }

    // ── Final report ──────────────────────────────────────────────────────────
    if (stage === 'report') {
        // LOCKED teaser (non-included tier): score visible, everything else
        // behind the unlock — with the upgrade CTA framed as the better deal.
        if (lockedReport) {
            return (
                <>
                <div data-qa="interview-simulator" data-qa-interview-stage="report" className="bg-white dark:bg-slate-800/50 rounded-xl shadow-2xl w-full p-6 sm:p-8 animate-fade-in space-y-6">
                    <div className="flex flex-col items-center text-center gap-3">
                        <ScoreRing value={lockedReport.preview.overallScore} color="#8b5cf6" label={t('mi_overall_score')} />
                        <h3 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('mi_locked_title')}</h3>
                        {lockedReport.preview.firstStrength && (
                            <p className="inline-flex max-w-md items-start gap-2 rounded-lg bg-emerald-50 px-4 py-2 text-start text-sm text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
                                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                                <span>{lockedReport.preview.firstStrength}</span>
                            </p>
                        )}
                        <p className="text-sm text-gray-500 dark:text-slate-400 max-w-md">
                            {t('mi_locked_desc').replace('{n}', String(lockedReport.preview.perQuestionCount))}
                        </p>
                    </div>

                    {/* blurred fake content under a lock */}
                    <div className="relative">
                        <div className="space-y-3 blur-sm select-none pointer-events-none" aria-hidden="true">
                            <div className="h-16 rounded-xl bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800/40" />
                            <div className="h-24 rounded-xl bg-gray-100 dark:bg-slate-700/40" />
                            <div className="h-16 rounded-xl bg-violet-50 dark:bg-violet-900/15" />
                        </div>
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                            <Lock className="h-8 w-8 text-gray-400 dark:text-slate-500" />
                            <button
                                type="button"
                                onClick={openUnlockConfirm}
                                disabled={unlocking}
                                className="px-6 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:bg-violet-400 text-white font-bold rounded-lg shadow-lg"
                            >
                                {unlocking ? t('mi_unlocking') : t('mi_unlock_button').replace('{n}', String(lockedReport.unlockCredits))}
                            </button>
                            <button
                                type="button"
                                onClick={openUpgradePrompt}
                                className="inline-flex items-center gap-1.5 text-sm font-semibold text-amber-600 dark:text-amber-400 hover:underline"
                            >
                                <Crown className="h-4 w-4" />
                                {t('mi_locked_upgrade_cta')}
                            </button>
                        </div>
                    </div>

                    {error && <p role="alert" className="text-center text-sm text-red-600 dark:text-red-400">{error}</p>}

                    <div className="flex justify-center">
                        <button type="button" onClick={handleRestart} className="text-sm text-gray-400 dark:text-slate-500 hover:underline">
                            {t('mi_practice_again')}
                        </button>
                    </div>
                </div>
                {unlockConfirmDialog}
                {upgradePromptDialog}
                </>
            );
        }
        if (!report) {
            return (
                <div data-qa="interview-simulator" data-qa-interview-stage="report" className="bg-white dark:bg-slate-800/50 rounded-xl shadow-2xl w-full p-8 animate-fade-in text-center space-y-4">
                    <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto" />
                    <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error || t('mi_error_evaluate_failed')}</p>
                    <div className="flex justify-center gap-3">
                        <button
                            type="button"
                            onClick={() => finishAndEvaluate(questions.map((q, i) => ({ question: q.question, answer: answersRef.current[i] ?? '' })))}
                            className="px-5 py-2 bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold rounded-lg"
                        >
                            {t('tool_mock_interview_retry')}
                        </button>
                        <button type="button" onClick={handleRestart} className="px-5 py-2 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 text-sm font-semibold rounded-lg">
                            {t('mi_practice_again')}
                        </button>
                    </div>
                </div>
            );
        }
        const verdictMeta = VERDICT_META[report.verdict?.toLowerCase?.() ?? ''] ?? VERDICT_META['leaning hire'];
        return (
            <div data-qa="interview-simulator" data-qa-interview-stage="report" className="bg-white dark:bg-slate-800/50 rounded-xl shadow-2xl w-full p-6 sm:p-8 animate-fade-in space-y-6 overflow-y-auto">
                <div className="flex flex-col sm:flex-row items-center gap-6">
                    {/* score ring */}
                    <ScoreRing
                        value={report.overallScore}
                        color={report.overallScore >= 75 ? '#10b981' : report.overallScore >= 50 ? '#f59e0b' : '#ef4444'}
                        label={t('mi_overall_score')}
                    />
                    <div className="flex-1 text-center sm:text-start">
                        <h3 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex items-center justify-center sm:justify-start gap-2">
                            <Award className="h-5 w-5 text-violet-500" />
                            {t('mi_report_title')}
                        </h3>
                        <div className="mt-2 flex items-center justify-center sm:justify-start gap-2">
                            <span className="text-xs text-gray-500 dark:text-slate-400">{t('mi_verdict_label')}:</span>
                            <span className={`px-3 py-1 rounded-full text-sm font-bold ${verdictMeta.cls}`}>
                                {t(verdictMeta.labelKey)}
                            </span>
                        </div>
                        <p data-qa="mock-interview-report-summary" className="mt-3 text-sm text-gray-600 dark:text-slate-300 leading-relaxed">{report.summary}</p>
                    </div>
                </div>

                {error && (
                    <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                        {error}
                    </p>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/15 border border-emerald-200 dark:border-emerald-800/40 p-4">
                        <h5 className="font-bold text-emerald-800 dark:text-emerald-300 text-sm mb-2">{t('mi_report_strengths')}</h5>
                        <ul className="list-disc list-inside space-y-1 text-sm text-emerald-900/80 dark:text-emerald-200/80">
                            {(report.strengths ?? []).map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                    </div>
                    <div className="rounded-xl bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800/40 p-4">
                        <h5 className="font-bold text-amber-800 dark:text-amber-300 text-sm mb-2">{t('mi_report_improvements')}</h5>
                        <ul className="list-disc list-inside space-y-1 text-sm text-amber-900/80 dark:text-amber-200/80">
                            {(report.improvements ?? []).map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                    </div>
                </div>

                <div>
                    <h5 className="font-bold text-gray-800 dark:text-gray-100 text-sm mb-2">{t('mi_report_breakdown')}</h5>
                    <div data-qa="mock-interview-report-breakdown" className="divide-y divide-gray-100 dark:divide-slate-700 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
                        {(report.perQuestion ?? []).map((pq, i) => (
                            <div key={i} className="bg-white dark:bg-slate-800">
                                <button
                                    type="button"
                                    onClick={() => setOpenBreakdown(openBreakdown === i ? null : i)}
                                    aria-expanded={openBreakdown === i}
                                    aria-controls={`mi-breakdown-${i}`}
                                    className="flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-gray-50 dark:hover:bg-slate-700/40"
                                >
                                    <span className={`shrink-0 inline-flex items-center justify-center h-8 w-10 rounded-md text-xs font-bold ${
                                        pq.score >= 75 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                                        : pq.score >= 50 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                                        : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'}`}>
                                        {Math.round(pq.score)}
                                    </span>
                                    <span className="flex-1 text-sm text-gray-700 dark:text-gray-200 line-clamp-2">{pq.question}</span>
                                    <ChevronDown className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${openBreakdown === i ? 'rotate-180' : ''}`} />
                                </button>
                                {openBreakdown === i && (
                                    <div id={`mi-breakdown-${i}`} className="space-y-2 px-4 pb-4 text-sm">
                                        <p className="text-gray-500 dark:text-slate-400">
                                            <span className="font-semibold text-gray-600 dark:text-slate-300">{t('mi_report_your_answer')}: </span>
                                            {answersRef.current[i]?.trim() ? answersRef.current[i] : <em>{t('mi_no_answer')}</em>}
                                        </p>
                                        <p className="text-gray-700 dark:text-gray-200 bg-violet-50 dark:bg-violet-900/15 border border-violet-100 dark:border-violet-800/30 rounded-lg p-3">{pq.feedback}</p>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                    <button
                        type="button"
                        onClick={() => exportPdf(report)}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-lg"
                    >
                        <Printer className="h-4 w-4" />
                        {t('mi_export_pdf')}
                    </button>
                    <DownloadButtons textContent={formatReportForDownload(report)} baseFilename={`interview_report_${jobTitle.replace(/\s+/g, '_') || 'session'}`} />
                    <button
                        type="button"
                        onClick={handleRestart}
                        className="px-6 py-2 border-2 border-dashed border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 font-semibold rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700"
                    >
                        {t('mi_practice_again')}
                    </button>
                    <button type="button" onClick={onClose} className="px-6 py-2 bg-blue-700 text-white font-semibold rounded-lg hover:bg-blue-800">
                        {t('tool_mock_interview_close_button')}
                    </button>
                </div>
            </div>
        );
    }

    // ── Setup stage ───────────────────────────────────────────────────────────
    return (
        <div data-qa="interview-simulator" data-qa-interview-stage="setup" className="relative w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl animate-fade-in dark:border-slate-700 dark:bg-slate-900">
            {showDisclaimer && (
                <ViewportAwareDialog
                    open
                    onClose={() => setShowDisclaimer(false)}
                    labelledBy="mi-disclaimer-title"
                    describedBy="mi-disclaimer-description"
                    maxWidth={544}
                    zIndex={97}
                >
                    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6 dark:border-slate-700 dark:bg-slate-900">
                        <h4 id="mi-disclaimer-title" className="flex items-center gap-2 text-lg font-bold text-slate-950 dark:text-slate-50">
                            <AlertTriangle className="h-5 w-5 text-amber-500" aria-hidden="true" />
                            {t('mi_disclaimer_title')}
                        </h4>
                        <ul id="mi-disclaimer-description" className="mt-4 space-y-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                            <li>{t('mi_disclaimer_p1')}</li>
                            <li>{t('mi_disclaimer_p2')}</li>
                            <li>{t('mi_disclaimer_p3')}</li>
                            <li>{t('mi_disclaimer_p4')}</li>
                        </ul>
                        <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                            <input
                                data-qa="mock-interview-disclaimer-checkbox"
                                type="checkbox"
                                checked={disclaimerChecked}
                                onChange={(e) => setDisclaimerChecked(e.target.checked)}
                                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-700 focus:ring-blue-500"
                            />
                            <span>{t('mi_disclaimer_check')}</span>
                        </label>
                        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                            <button
                                type="button"
                                onClick={() => setShowDisclaimer(false)}
                                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                            >
                                {t('mi_disclaimer_cancel')}
                            </button>
                            <button
                                type="button"
                                disabled={!disclaimerChecked}
                                data-qa="mock-interview-disclaimer-accept"
                                onClick={beginInterview}
                                className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-blue-300 dark:disabled:bg-blue-900/50"
                            >
                                {t('mi_disclaimer_accept')}
                            </button>
                        </div>
                    </div>
                </ViewportAwareDialog>
            )}

            <div className="border-b border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900 sm:p-6">
                <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
                    <div className="max-w-3xl">
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-700 dark:text-blue-400">{t('tool_mock_interview_title')}</p>
                        <h3 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 dark:text-slate-50 sm:text-3xl">
                            {t('tool_mock_interview_intro_title')}
                        </h3>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
                            {t('tool_mock_interview_intro_desc')}
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <span role="status" className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${resumeText ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900/50' : 'bg-amber-50 text-amber-700 ring-1 ring-amber-100 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/50'}`}>
                            {resumeText ? <CheckCircle2 className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                            {resumeText ? t('mi_resume_ready') : t('mi_resume_missing')}
                        </span>
                        <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{t('mi_prep_duration_badge')}</span>
                        <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{t('mi_answer_duration_badge')}</span>
                        <button
                            type="button"
                            data-qa="mock-interview-try-example"
                            onClick={fillSample}
                            className="inline-flex items-center justify-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                            {t('tool_mock_interview_try_example')}
                        </button>
                    </div>
                </div>
            </div>

            <form onSubmit={handleStartClicked} className="grid gap-5 bg-slate-50 p-4 text-slate-950 dark:bg-slate-950 dark:text-slate-50 sm:p-6">
                <div className="grid min-w-0 gap-5 2xl:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
                    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 xl:p-5">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{t('mi_setup_step')}</p>
                        <h4 className="mt-1 text-xl font-bold">{t('mi_setup_heading')}</h4>
                    </div>

                    <div>
                        <label htmlFor="mi-job-title" className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{t('mi_job_title_label')}</label>
                        <input
                            data-qa="mock-interview-job-title"
                            id="mi-job-title"
                            type="text"
                            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-950 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
                            placeholder={t('mi_job_title_placeholder')}
                            value={jobTitle}
                            onChange={(e) => setJobTitle(e.target.value)}
                        />
                        {(postings.length > 0 || applications.length > 0) && (
                            <select
                                data-qa="mock-interview-job-source"
                                defaultValue=""
                                onChange={(e) => handleJobSourcePick(e.target.value)}
                                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                                aria-label={t('mi_job_source_label')}
                            >
                                <option value="" disabled>{t('mi_job_source_placeholder')}</option>
                                {applications.length > 0 && (
                                    <optgroup label={t('mi_job_group_applied')}>
                                        {applications.map((app) => (
                                            <option key={`app-${app.id}`} value={`app:${app.id}`}>
                                                {app.job_title}{app.status ? ` — ${app.status}` : ''}
                                            </option>
                                        ))}
                                    </optgroup>
                                )}
                                {postings.length > 0 && (
                                    <optgroup label={t('mi_job_group_platform')}>
                                        {postings.map((p) => (
                                            <option key={`job-${p.id}`} value={`job:${p.id}`}>
                                                {p.title}{p.company_name ? ` · ${p.company_name}` : ''}
                                            </option>
                                        ))}
                                    </optgroup>
                                )}
                            </select>
                        )}
                    </div>

                    <fieldset>
                        <legend className="sr-only">{t('mi_section_1_title')}</legend>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {INTERVIEW_TYPES.map((it) => (
                                <button
                                    key={it.id}
                                    type="button"
                                    onClick={() => setInterviewType(it.id)}
                                    aria-pressed={interviewType === it.id}
                                    className={`min-h-[76px] min-w-0 rounded-xl border px-3 py-3 text-start transition ${
                                        interviewType === it.id
                                            ? 'border-blue-500 bg-blue-50 text-blue-900 dark:border-blue-500 dark:bg-blue-950/30 dark:text-blue-100'
                                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                                    }`}
                                >
                                    <span className="block break-words text-sm font-bold">{t(it.labelKey)}</span>
                                    <span className="mt-1 block text-[11px] leading-4 text-slate-500 sm:line-clamp-2">{t(it.descKey)}</span>
                                </button>
                            ))}
                        </div>
                    </fieldset>

                    <details className="group rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/70">
                        <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-bold">
                            <span>{t('mi_role_brief_label')} <span className="font-medium text-slate-400">{t('mi_optional_tag')}</span></span>
                            <ChevronDown className="h-4 w-4 text-slate-400 transition group-open:rotate-180" />
                        </summary>
                        <div className="mt-3 space-y-2">
                            <textarea
                                data-qa="mock-interview-job-description"
                                rows={3}
                                className="w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                                placeholder={t('mi_job_desc_placeholder')}
                                value={jobDescription}
                                onChange={(e) => setJobDescription(e.target.value)}
                                aria-label={t('mi_job_desc_label')}
                            />
                            <div className="grid gap-2">
                                <textarea
                                    data-qa="mock-interview-job-responsibilities"
                                    rows={2}
                                    className="w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                                    placeholder={t('mi_job_resp_placeholder')}
                                    value={jobResponsibilities}
                                    onChange={(e) => setJobResponsibilities(e.target.value)}
                                    aria-label={t('mi_job_resp_label')}
                                />
                                <textarea
                                    data-qa="mock-interview-job-requirements"
                                    rows={2}
                                    className="w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                                    placeholder={t('mi_job_req_placeholder')}
                                    value={jobRequirements}
                                    onChange={(e) => setJobRequirements(e.target.value)}
                                    aria-label={t('mi_job_req_label')}
                                />
                            </div>
                        </div>
                    </details>

                    <div className="grid gap-3">
                        <div>
                            <label htmlFor="mi-experience" className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{t('mi_experience_label')}</label>
                            <select
                                id="mi-experience"
                                value={experience}
                                onChange={(e) => setExperience(e.target.value as Experience)}
                                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                            >
                                {EXPERIENCE_OPTIONS.map((opt) => (
                                    <option key={opt.id} value={opt.id}>{t(opt.labelKey)}</option>
                                ))}
                            </select>
                        </div>
                        <fieldset>
                            <legend className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{t('mi_difficulty_label')}</legend>
                            <div className="mt-2 grid grid-cols-1 rounded-xl border border-slate-300 bg-white p-1 sm:grid-cols-3 dark:border-slate-700 dark:bg-slate-950">
                                {DIFFICULTY_OPTIONS.map((opt) => (
                                    <button
                                        key={opt.id}
                                        type="button"
                                        onClick={() => setDifficulty(opt.id)}
                                        aria-pressed={difficulty === opt.id}
                                        className={`min-h-9 min-w-0 rounded-lg px-2 py-2 text-center text-xs font-bold leading-tight transition ${
                                            difficulty === opt.id ? 'bg-blue-700 text-white' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                                        }`}
                                    >
                                        {t(opt.labelKey)}
                                    </button>
                                ))}
                            </div>
                        </fieldset>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                        <button
                            type="button"
                            onClick={() => setCompanyOpen((v) => !v)}
                            aria-expanded={companyOpen}
                            aria-controls="mi-company-context"
                            className="flex w-full items-center justify-between text-sm font-bold text-slate-800 dark:text-slate-100"
                        >
                            <span className="inline-flex items-center gap-2">
                                <Building2 className="h-4 w-4 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                                {t('mi_company_section')}
                            </span>
                            <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${companyOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {companyOpen && (
                            <div id="mi-company-context" className="mt-3 grid gap-2">
                                <label htmlFor="mi-company-name" className="sr-only">{t('mi_company_name_label')}</label>
                                <input
                                    id="mi-company-name"
                                    data-qa="mock-interview-company-name"
                                    type="text"
                                    list="mi-company-names"
                                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                                    placeholder={t('mi_company_name_ph')}
                                    value={companyName}
                                    onChange={(e) => setCompanyName(e.target.value)}
                                />
                                <datalist id="mi-company-names">
                                    {companyNameSuggestions.map((n) => <option key={n} value={n} />)}
                                </datalist>
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                    <label htmlFor="mi-company-type" className="sr-only">{t('mi_company_type_label')}</label>
                                    <select id="mi-company-type" value={companyType} onChange={(e) => setCompanyType(e.target.value)} className="min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
                                        <option value="">{t('mi_company_type_ph')}</option>
                                        {COMPANY_TYPES.map((c) => <option key={c.id} value={c.id}>{t(c.labelKey)}</option>)}
                                    </select>
                                    <label htmlFor="mi-company-industry" className="sr-only">{t('mi_company_industry_label')}</label>
                                    <select id="mi-company-industry" value={companyIndustry} onChange={(e) => setCompanyIndustry(e.target.value)} className="min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
                                        <option value="">{t('mi_company_industry_ph')}</option>
                                        {COMPANY_INDUSTRIES.map((c) => <option key={c.id} value={c.id}>{t(c.labelKey)}</option>)}
                                    </select>
                                </div>
                            </div>
                        )}
                    </div>

                    {error && (
                        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                            {error}
                        </div>
                    )}
                </section>

                    <section className="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm xl:min-h-[560px] xl:p-6 dark:border-slate-700 dark:bg-slate-900">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{t('mi_preview_step')}</p>
                            <h3 className="mt-1 break-words text-2xl font-bold tracking-tight">{jobTitle.trim() || t('mi_preview_default_title')}</h3>
                        </div>
                        <span className="shrink-0 rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-800 dark:bg-blue-950/30 dark:text-blue-200">
                            {INTERVIEW_TYPES.find((it) => it.id === interviewType) ? t(INTERVIEW_TYPES.find((it) => it.id === interviewType)!.labelKey) : t('mi_question_category_default')}
                        </span>
                    </div>

                    <div className="mt-5 grid flex-1 gap-4">
                        <div className="grid gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70 sm:grid-cols-[140px_minmax(0,1fr)] sm:items-center">
                            <InterviewerAvatar
                                speaking={false}
                                imageUrl={INTERVIEWER_IMAGE}
                                name={t('mi_avatar_name')}
                                roleLabel={t('mi_avatar_role')}
                                compact
                            />
                            <div className="min-w-0">
                                <div className="grid grid-cols-2 gap-2 text-center">
                                    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                                        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{t('mi_timer_prep_short')}</p>
                                        <p className="mt-1 font-mono text-lg font-bold">0:15</p>
                                    </div>
                                    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                                        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{t('mi_timer_answer_short')}</p>
                                        <p className="mt-1 font-mono text-lg font-bold">3:00</p>
                                    </div>
                                </div>
                                <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-slate-400">
                                    {t('mi_preview_pacing_note')}
                                </p>
                            </div>
                        </div>

                        <div className="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-800/70">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700">
                                    {t(DIFFICULTY_OPTIONS.find((opt) => opt.id === difficulty)?.labelKey ?? 'mi_difficulty_advanced')}
                                </span>
                                <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700">
                                    {t('mi_voice_or_typed')}
                                </span>
                            </div>

                            <div className="my-auto py-8">
                                <p className="max-w-3xl text-3xl font-semibold leading-tight tracking-tight text-slate-950 dark:text-slate-50 lg:text-[34px]">
                                    {t('mi_preview_sample_question')}
                                </p>
                                <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
                                    {t('mi_preview_sample_desc')}
                                </p>
                            </div>

                            <div className="mt-auto rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                                    <div className="min-w-0 flex-1 overflow-hidden"><AudioWave /></div>
                                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{t('mi_mic_typing_supported')}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="mt-5 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between dark:border-slate-700 dark:bg-slate-900">
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                            <Timer className="h-4 w-4 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                            <span>{t('mi_flow_note')}</span>
                        </div>
                        {isPaid ? (
                            <button data-qa="mock-interview-start" type="submit" className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-700 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-800">
                                <PlayCircle className="h-4 w-4" />
                                {t('tool_mock_interview_start_button')}
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={openUpgradePrompt}
                                className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-amber-600"
                            >
                                <Crown className="h-4 w-4" />
                                {t('mi_paid_only_cta')}
                            </button>
                        )}
                    </div>
                </section>
                </div>

                <aside className="grid gap-4 lg:grid-cols-3">
                    {sessionUserId && (
                        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 xl:p-5">
                            <button
                                type="button"
                                onClick={() => setHistoryOpen((v) => !v)}
                                aria-expanded={historyOpen}
                                aria-controls="mi-history-content"
                                className="flex w-full items-center justify-between gap-3 text-start"
                            >
                                <span className="inline-flex items-center gap-2">
                                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">
                                        <History className="h-4 w-4" />
                                    </span>
                                    <span>
                                        <span className="block text-sm font-bold text-slate-950 dark:text-white">{t('mi_history_title')}</span>
                                        <span className="block text-xs text-slate-500 dark:text-slate-400">
                                            {t('mi_history_count').replace('{n}', String(historyItems.length))}
                                        </span>
                                    </span>
                                </span>
                                <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${historyOpen ? 'rotate-180' : ''}`} />
                            </button>
                            {historyOpen && (
                                <div id="mi-history-content" className="mt-4 space-y-2">
                                    {historyLoadFailed ? (
                                        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                                            {t('mi_history_load_error')}
                                        </div>
                                    ) : historyItems.length === 0 ? (
                                        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
                                            {t('mi_history_empty')}
                                        </div>
                                    ) : (
                                        historyItems.slice(0, 4).map((item) => (
                                            <button
                                                key={item.id}
                                                type="button"
                                                onClick={() => setSelectedHistoryId((current) => current === item.id ? null : item.id)}
                                                aria-pressed={selectedHistoryId === item.id}
                                                data-qa="mock-interview-history-item"
                                                data-qa-selected={selectedHistoryId === item.id ? 'true' : 'false'}
                                                className={`w-full rounded-xl border p-3 text-start transition ${
                                                    selectedHistoryId === item.id
                                                        ? 'border-blue-300 bg-blue-50 shadow-sm ring-2 ring-blue-500/10 dark:border-blue-800/70 dark:bg-blue-950/30'
                                                        : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white dark:border-slate-700 dark:bg-slate-800/70 dark:hover:border-slate-600 dark:hover:bg-slate-800'
                                                }`}
                                            >
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <p className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">{historyTitle(item, t('mi_history_default_title'))}</p>
                                                        <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                                            {historyDate(item.started_at) || t('mi_history_recent')}
                                                            {item.market_name ? ` · ${item.market_name}` : ''}
                                                        </p>
                                                    </div>
                                                    <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[11px] font-bold text-slate-500 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
                                                        {t('mi_history_question_count').replace('{n}', String(item.exchanges.length))}
                                                    </span>
                                                </div>
                                                {item.overall_summary && (
                                                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600 dark:text-slate-300">{item.overall_summary}</p>
                                                )}
                                            </button>
                                        ))
                                    )}
                                    {selectedHistoryItem && (
                                        <div
                                            data-qa="mock-interview-history-detail"
                                            className="mt-4 rounded-2xl border border-blue-100 bg-white p-4 shadow-sm animate-panel-expand dark:border-blue-900/50 dark:bg-slate-950"
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-600 dark:text-blue-300">
                                                        {t('mi_report_title')}
                                                    </p>
                                                    <h4 className="mt-1 truncate text-sm font-bold text-slate-950 dark:text-white">
                                                        {historyTitle(selectedHistoryItem, t('mi_history_default_title'))}
                                                    </h4>
                                                    <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                                        {historyDate(selectedHistoryItem.started_at) || t('mi_history_recent')}
                                                        {selectedHistoryItem.market_name ? ` · ${selectedHistoryItem.market_name}` : ''}
                                                    </p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedHistoryId(null)}
                                                    aria-label={t('tool_mock_interview_close_button')}
                                                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                                                >
                                                    <X className="h-4 w-4" aria-hidden="true" />
                                                </button>
                                            </div>
                                            {selectedHistoryItem.overall_summary && (
                                                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/70">
                                                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                                        {t('mi_report_summary_h')}
                                                    </p>
                                                    <p data-qa="mock-interview-history-summary" className="mt-1 text-xs leading-5 text-slate-700 dark:text-slate-300">
                                                        {selectedHistoryItem.overall_summary}
                                                    </p>
                                                </div>
                                            )}
                                            <div className="mt-3 space-y-2">
                                                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                                    {t('mi_report_breakdown')}
                                                </p>
                                                <div className="max-h-64 space-y-2 overflow-y-auto pe-1">
                                                    {selectedHistoryItem.exchanges.map((exchange, index) => (
                                                        <div
                                                            key={`${selectedHistoryItem.id}-${index}`}
                                                            data-qa="mock-interview-history-exchange"
                                                            className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 dark:border-slate-800 dark:bg-slate-900/70"
                                                        >
                                                            <div className="flex items-start gap-2">
                                                                <span className="inline-flex h-6 min-w-8 shrink-0 items-center justify-center rounded-md bg-white px-2 text-[11px] font-bold text-slate-600 ring-1 ring-slate-200 dark:bg-slate-950 dark:text-slate-300 dark:ring-slate-700">
                                                                    {typeof exchange.score === 'number' ? Math.round(exchange.score) : `${t('mi_question_short')}${index + 1}`}
                                                                </span>
                                                                <p className="font-semibold text-slate-800 dark:text-slate-100">{exchange.question}</p>
                                                            </div>
                                                            <p className="mt-2 text-slate-500 dark:text-slate-400">
                                                                <span className="font-semibold text-slate-700 dark:text-slate-200">{t('mi_report_your_answer')}:</span>{' '}
                                                                {exchange.answer?.trim() || t('mi_no_answer')}
                                                            </p>
                                                            {exchange.feedback && (
                                                                <p className="mt-2 rounded-lg bg-white p-2 text-slate-600 ring-1 ring-slate-200 dark:bg-slate-950 dark:text-slate-300 dark:ring-slate-800">
                                                                    {exchange.feedback}
                                                                </p>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 xl:p-5">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{t('mi_report_title')}</p>
                                <h3 className="mt-1 text-xl font-bold">{t('mi_report_preview_heading')}</h3>
                            </div>
                            <BarChart3 className="h-5 w-5 text-blue-700 dark:text-blue-400" />
                        </div>
                        <div className="mt-5 space-y-3">
                            {[
                                ['mi_report_dimension_structure', 'mi_report_dimension_star'],
                                ['mi_report_dimension_evidence', 'mi_report_dimension_specificity'],
                                ['mi_report_dimension_delivery', 'mi_report_dimension_clarity'],
                            ].map(([labelKey, valueKey]) => (
                                <div key={labelKey} className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/70">
                                    <p className="text-xs font-semibold text-slate-500">{t(labelKey)}</p>
                                    <p className="mt-1 text-sm font-bold text-slate-950 dark:text-slate-100">{t(valueKey)}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                        <p className="text-sm font-bold text-slate-950 dark:text-white">{t('mi_coaching_title')}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                            {['mi_coaching_star', 'mi_coaching_metric', 'mi_coaching_role_fit', 'mi_coaching_followup'].map((key) => (
                                <span key={key} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">{t(key)}</span>
                            ))}
                        </div>
                    </div>

                    {!isPaid && (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/25">
                            <p className="flex items-center gap-2 text-sm font-bold text-amber-900 dark:text-amber-100">
                                <Crown className="h-4 w-4" />
                                {t('mi_paid_only_title')}
                            </p>
                            <p className="mt-2 text-xs leading-5 text-amber-800/80 dark:text-amber-100/80">{t('mi_paid_only_desc')}</p>
                        </div>
                    )}
                </aside>
            </form>
            {upgradePromptDialog}
        </div>
    );
};

export default InterviewSimulator;
