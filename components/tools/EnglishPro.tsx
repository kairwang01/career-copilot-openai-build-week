
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { BookOpen, FileText, Headphones, Languages, Loader2, Mic, Play, Sparkles, Square } from 'lucide-react';
import { data, type AppSession as Session } from '../../lib/data';
import { analyzeEnglishProficiency, analyzeSpokenEnglish, analyzeEnglishReading, evaluateReadingComprehension, analyzeEnglishListening, generateReadingPracticePassage, generateSpeakingTopics, generateVocabularyFlashcards } from '../../services/aiClient';
import type { EnglishProResult, SpokenEnglishAnalysisResult, EnglishReadingAnalysisResult, ReadingEvaluation, EnglishListeningAnalysisResult, ReadingPracticePassage, VocabularyFlashcard, UserProfile, VocabularyItem, ComprehensionQuestion } from '../../types';
import StagedLoader from '../StagedLoader';
import { useCancellableLoading } from '../../hooks/useCancellableLoading';
import ConfirmActionDialog from '../ConfirmActionDialog';
import { SavedResultBar, ToolError } from './ToolUtils';
import { useToolResults } from '../../contexts/ToolResultsContext';

const ENGLISH_PRO_TOPICS = [
    "Write an email to a colleague asking for an update on a project.",
    "Write an email to your manager requesting a day off for a personal appointment.",
    "Write an email to a potential client introducing yourself and your company's services.",
    "Write a follow-up email after a job interview, thanking the interviewer.",
];

const LISTENING_CLIPS = [
    { text: "Good morning, this is Sarah from the marketing department. I'm calling to follow up on the proposal we sent over last week. Do you have a few minutes to discuss it?", id: 1 },
    { text: "The project deadline has been moved up to this Friday. We'll need all hands on deck to ensure we meet the new target.", id: 2 },
    { text: "Please review the attached document and provide your feedback by the end of the day. Your input is crucial for the next phase.", id: 3 }
];

const SUPPORTED_LANGUAGES = ['Vietnamese', 'Japanese', 'Other'];
const IELTS_BANDS = ['5.0', '5.5', '6.0', '6.5', '7.0', '7.5', '8.0', '8.5', '9.0'];

const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
const isSpeechSupported = !!SpeechRecognition;
type PendingDiscardAction = 'hub' | 'reading-options';
type SpeechFallbackReason = 'unsupported' | 'not-allowed' | 'no-speech' | 'unavailable' | 'start-failed';
type EnglishProLoadingAction =
    | 'written-analysis'
    | 'spoken-analysis'
    | 'reading-analysis'
    | 'reading-practice'
    | 'reading-evaluation'
    | 'flashcards'
    | 'listening-analysis';

interface EnglishProProps {
    t: (key: string) => string;
    session: Session | null;
    profile: UserProfile | null;
    refreshProfile: () => void;
}

type EnglishProSavedResult =
    | {
        mode: 'written';
        targetIeltsBand: string;
        nativeLanguage: string;
        prompt: string;
        result: EnglishProResult;
    }
    | {
        mode: 'spoken';
        targetIeltsBand: string;
        topic?: string | null;
        transcript: string;
        result: SpokenEnglishAnalysisResult;
    }
    | {
        mode: 'reading';
        targetIeltsBand: string;
        sourceText: string;
        result: EnglishReadingAnalysisResult | ReadingPracticePassage;
        answers?: string[];
        evaluation?: ReadingEvaluation[] | null;
    }
    | {
        mode: 'listening';
        targetIeltsBand: string;
        clipId: number;
        clipText: string;
        transcription: string;
        result: EnglishListeningAnalysisResult;
    };

const isSameDay = (date1: Date, date2: Date) => {
    return date1.getFullYear() === date2.getFullYear() &&
           date1.getMonth() === date2.getMonth() &&
           date1.getDate() === date2.getDate();
};

const isYesterday = (date1: Date, date2: Date) => {
    const yesterday = new Date(date2);
    yesterday.setDate(yesterday.getDate() - 1);
    return isSameDay(date1, yesterday);
};

const shuffleArray = <T,>(array: T[]): T[] => [...array].sort(() => Math.random() - 0.5);

/** Prefer a clear English voice; voices load async so fall back gracefully. */
const pickEnglishVoice = (): SpeechSynthesisVoice | null => {
    try {
        const voices = window.speechSynthesis.getVoices();
        return voices.find((v) => v.lang === 'en-US') ?? voices.find((v) => v.lang.startsWith('en')) ?? null;
    } catch { return null; }
};

const speechErrorKey = (code?: string): string => {
    switch (code) {
        case 'not-allowed':
        case 'service-not-allowed':
            return 'tool_english_pro_speech_mic_blocked';
        case 'audio-capture':
            return 'tool_english_pro_speech_mic_unavailable';
        case 'no-speech':
            return 'tool_english_pro_no_speech';
        default:
            return 'tool_english_pro_speech_start_failed';
    }
};

const EnglishPro: React.FC<EnglishProProps> = ({ t, session, profile, refreshProfile }) => {
    const { loading, begin, end, cancel } = useCancellableLoading();
    const { canSave, saved, saveState, persist, clear } = useToolResults<EnglishProSavedResult>();
    const [error, setError] = useState<string | null>(null);
    const [loadingAction, setLoadingAction] = useState<EnglishProLoadingAction | null>(null);
    const [practiceMode, setPracticeMode] = useState<'hub' | 'written' | 'spoken' | 'reading' | 'listening'>('hub');
    const [pendingDiscardAction, setPendingDiscardAction] = useState<PendingDiscardAction | null>(null);
    const [fromSaved, setFromSaved] = useState(false);
    
    // Gamification State
    const [streakData, setStreakData] = useState({ count: 0, lastPracticeDate: '' });
    const [dailyGoalComplete, setDailyGoalComplete] = useState(false);

    // Goal Setting
    const [targetIeltsBand, setTargetIeltsBand] = useState('6.5');
    
    // Written Mode
    const [writtenResult, setWrittenResult] = useState<EnglishProResult | null>(null);
    const [writtenInput, setWrittenInput] = useState('');
    const [nativeLanguage, setNativeLanguage] = useState(SUPPORTED_LANGUAGES[0]);
    const [originalWrittenInput, setOriginalWrittenInput] = useState('');

    // Spoken Mode
    const [isListening, setIsListening] = useState(false);
    const [transcript, setTranscript] = useState('');
    const [manualTranscript, setManualTranscript] = useState('');
    const [speechFallbackReason, setSpeechFallbackReason] = useState<SpeechFallbackReason | null>(
        isSpeechSupported ? null : 'unsupported',
    );
    const [spokenResult, setSpokenResult] = useState<SpokenEnglishAnalysisResult | null>(null);
    const recognitionRef = useRef<any>(null);
    const recordingStartTime = useRef<number | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    // Mirrors of state read inside the speech-recognition onend handler (which is
    // bound once and cannot see fresh state directly).
    const isListeningRef = useRef(false);
    const transcriptRef = useRef('');
    const runSpokenAnalysisRef = useRef<(finalTranscript: string, duration: number) => void>(() => {});
    const [speakingTopics, setSpeakingTopics] = useState<string[]>([]);
    const [currentTopic, setCurrentTopic] = useState<string | null>(null);
    const [isFetchingTopic, setIsFetchingTopic] = useState(false);

    // Reading Mode
    const [readingSubMode, setReadingSubMode] = useState<'select' | 'comprehension' | 'flashcards'>('select');
    const [readingComprehensionResult, setReadingComprehensionResult] = useState<EnglishReadingAnalysisResult | ReadingPracticePassage | null>(null);
    const [readingUserInput, setReadingUserInput] = useState('');
    const [userAnswers, setUserAnswers] = useState<string[]>([]);
    const [readingEvaluation, setReadingEvaluation] = useState<ReadingEvaluation[] | null>(null);
    const [flashcards, setFlashcards] = useState<VocabularyFlashcard[]>([]);
    const [currentCardIndex, setCurrentCardIndex] = useState(0);
    const [flashcardScore, setFlashcardScore] = useState(0);
    const [selectedFlashcardAnswer, setSelectedFlashcardAnswer] = useState<string | null>(null);
    const [isFlashcardAnswered, setIsFlashcardAnswered] = useState(false);

    // Listening Mode
    const [listeningResult, setListeningResult] = useState<EnglishListeningAnalysisResult | null>(null);
    const [currentClip, setCurrentClip] = useState(LISTENING_CLIPS[0]);
    const [userTranscription, setUserTranscription] = useState('');

    const beginLoading = useCallback((action: EnglishProLoadingAction) => {
        setLoadingAction(action);
        return begin();
    }, [begin]);

    const endLoading = useCallback(() => {
        setLoadingAction(null);
        end();
    }, [end]);

    const cancelLoading = useCallback(() => {
        setLoadingAction(null);
        cancel();
    }, [cancel]);

    const hasPracticeResult = Boolean(
        writtenResult ||
        spokenResult ||
        readingComprehensionResult ||
        flashcards.length > 0 ||
        listeningResult
    );

    useEffect(() => {
        if (!saved || hasPracticeResult) return;
        const snapshot = saved.result;
        setFromSaved(true);
        setError(null);
        if (snapshot.targetIeltsBand) setTargetIeltsBand(snapshot.targetIeltsBand);

        if (snapshot.mode === 'written') {
            setPracticeMode('written');
            setNativeLanguage(snapshot.nativeLanguage || SUPPORTED_LANGUAGES[0]);
            setWrittenInput(snapshot.prompt || '');
            setOriginalWrittenInput(snapshot.prompt || '');
            setWrittenResult(snapshot.result);
            return;
        }

        if (snapshot.mode === 'spoken') {
            setPracticeMode('spoken');
            setCurrentTopic(snapshot.topic ?? null);
            setTranscript(snapshot.transcript || snapshot.result.transcript || '');
            setSpokenResult(snapshot.result);
            return;
        }

        if (snapshot.mode === 'reading') {
            setPracticeMode('reading');
            setReadingSubMode('comprehension');
            setReadingUserInput(snapshot.sourceText || '');
            setReadingComprehensionResult(snapshot.result);
            setUserAnswers(snapshot.answers ?? []);
            setReadingEvaluation(snapshot.evaluation ?? null);
            return;
        }

        if (snapshot.mode === 'listening') {
            setPracticeMode('listening');
            setCurrentClip(LISTENING_CLIPS.find((clip) => clip.id === snapshot.clipId) ?? {
                id: snapshot.clipId,
                text: snapshot.clipText,
            });
            setUserTranscription(snapshot.transcription || '');
            setListeningResult(snapshot.result);
        }
    }, [hasPracticeResult, saved]);
    
    // --- Gamification Logic ---
    useEffect(() => {
        if (profile) {
            const today = new Date();
            const lastPracticeDateStr = profile.english_pro_last_practice;
            const currentStreak = profile.english_pro_streak || 0;

            if (lastPracticeDateStr) {
                const lastDate = new Date(lastPracticeDateStr);
                
                if (isSameDay(lastDate, today)) {
                    setStreakData({ count: currentStreak, lastPracticeDate: lastPracticeDateStr });
                    setDailyGoalComplete(true);
                } else if (isYesterday(lastDate, today)) {
                    setStreakData({ count: currentStreak, lastPracticeDate: lastPracticeDateStr });
                    setDailyGoalComplete(false);
                } else {
                    // Streak broken, UI will show 0 until next practice.
                    setStreakData({ count: 0, lastPracticeDate: '' });
                    setDailyGoalComplete(false);
                }
            } else {
                // No practice history in DB
                setStreakData({ count: 0, lastPracticeDate: '' });
                setDailyGoalComplete(false);
            }
        }
    }, [profile]);

    // FIX 5: accept an optional alive guard so that a cancelled run cannot pop
    // a streak/error update after the component has already moved on.
    const handlePracticeCompletion = useCallback(async (alive?: () => boolean) => {
        if (!session?.user || !profile) return;

        // Prevent updating streak if goal is already complete for the day
        if (dailyGoalComplete) return;

        // Guard: if the caller was cancelled before we reach state updates, bail.
        if (alive && !alive()) return;

        setDailyGoalComplete(true);
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];

        const lastPracticeDateStr = profile.english_pro_last_practice;
        const currentStreak = profile.english_pro_streak || 0;

        let newStreak = 1; // Default to 1 for a new or broken streak

        if (lastPracticeDateStr) {
            const lastDate = new Date(lastPracticeDateStr);
            if (isYesterday(lastDate, today)) {
                newStreak = currentStreak + 1;
            }
            // If it's not yesterday, the streak is broken, so it resets to 1 (the default).
            // If it's the same day, we wouldn't have reached here due to the initial check.
        }

        try {
            const { error } = await data.profiles.update(session.user.id, {
                english_pro_streak: newStreak,
                english_pro_last_practice: todayStr,
            });

            if (error) throw error;

            // Refresh the profile data in the app to reflect the change
            await refreshProfile();
        } catch (dbError) {
            console.error("Failed to update streak in database:", dbError);
            // Only surface the error if the run was not cancelled.
            if (!alive || alive()) setError(t('tool_english_pro_streak_save_error'));
        }
    }, [session, profile, refreshProfile, dailyGoalComplete]);


    const resetReadingState = useCallback(() => {
        setReadingSubMode('select');
        setReadingComprehensionResult(null);
        setReadingEvaluation(null);
        setUserAnswers([]);
        setReadingUserInput('');
        setFlashcards([]);
        setCurrentCardIndex(0);
        setFlashcardScore(0);
        setSelectedFlashcardAnswer(null);
        setIsFlashcardAnswered(false);
        setFromSaved(false);
    }, []);

    const hasDiscardableReadingProgress = useCallback(() => {
        if (practiceMode !== 'reading' || readingSubMode === 'select') return false;
        const hasAnswerDraft = userAnswers.some((answer) => answer.trim().length > 0);
        const hasFlashcardProgress = flashcards.length > 0 && (currentCardIndex > 0 || isFlashcardAnswered || selectedFlashcardAnswer !== null || flashcardScore > 0);
        return Boolean(
            readingUserInput.trim() ||
            readingComprehensionResult ||
            readingEvaluation ||
            hasAnswerDraft ||
            hasFlashcardProgress
        );
    }, [
        currentCardIndex,
        flashcardScore,
        flashcards.length,
        isFlashcardAnswered,
        practiceMode,
        readingComprehensionResult,
        readingEvaluation,
        readingSubMode,
        readingUserInput,
        selectedFlashcardAnswer,
        userAnswers,
    ]);

    const handleStartNewPractice = () => {
        setPendingDiscardAction(null);
        cancelLoading();
        // Stop any live mic + narration before returning to the hub. Disarm onend
        // first so stop()'s 'end' event doesn't fire a paid analysis on the way out.
        isListeningRef.current = false;
        try { recognitionRef.current?.stop?.(); } catch { /* noop */ }
        try { window.speechSynthesis.cancel(); } catch { /* noop */ }
        setIsListening(false);
        setIsPlaying(false);
        recordingStartTime.current = null;
        transcriptRef.current = '';
        setTranscript('');
        setManualTranscript('');
        setSpeechFallbackReason(isSpeechSupported ? null : 'unsupported');
        setError(null);
        setPracticeMode('hub');
        // Reset all sub-modes and results
        resetReadingState();
        setWrittenResult(null);
        setSpokenResult(null);
        setListeningResult(null);
        setFromSaved(false);
    };

    const requestStartNewPractice = () => {
        if (hasDiscardableReadingProgress()) {
            setPendingDiscardAction('hub');
            return;
        }
        handleStartNewPractice();
    };

    const requestReadingOptions = () => {
        if (hasDiscardableReadingProgress()) {
            setPendingDiscardAction('reading-options');
            return;
        }
        resetReadingState();
    };

    const confirmDiscardProgress = () => {
        const action = pendingDiscardAction;
        setPendingDiscardAction(null);
        if (action === 'hub') handleStartNewPractice();
        if (action === 'reading-options') resetReadingState();
    };

    const persistEnglishProResult = useCallback((snapshot: EnglishProSavedResult) => {
        setFromSaved(false);
        persist(snapshot);
    }, [persist]);

    const handleClearSavedResult = useCallback(() => {
        clear();
        setFromSaved(false);
    }, [clear]);

    const renderSavedResultBar = (onTryNext: () => void) => (
        <SavedResultBar
            t={t}
            canSave={canSave}
            isSaved={fromSaved}
            savedAt={saved?.savedAt ?? null}
            saveState={saveState}
            onTryNext={onTryNext}
            onClearSaved={handleClearSavedResult}
        />
    );
    
    // --- Tool API Calls ---
    
    // Written
    const runWrittenTool = async () => {
        if (!writtenInput.trim()) { setError(t('tool_english_pro_error_required')); return; }
        const alive = beginLoading('written-analysis'); setError(null); setOriginalWrittenInput(writtenInput);
        try {
            const res = await analyzeEnglishProficiency(writtenInput, nativeLanguage, targetIeltsBand);
            if (!alive()) return;
            setWrittenResult(res);
            persistEnglishProResult({
                mode: 'written',
                targetIeltsBand,
                nativeLanguage,
                prompt: writtenInput,
                result: res,
            });
            void handlePracticeCompletion(alive);
        } catch (err) { if (alive()) setError(err instanceof Error ? err.message : t('unexpected_error')); }
        finally { if (alive()) endLoading(); }
    };
    
    // Spoken
    const runSpokenAnalysis = useCallback(async (finalTranscript: string, duration: number) => {
        if (!finalTranscript.trim()) {
            setError(t('tool_english_pro_no_speech'));
            setSpeechFallbackReason('no-speech');
            return;
        }
        const alive = beginLoading('spoken-analysis'); setError(null); setTranscript(finalTranscript);
        try {
            const res = await analyzeSpokenEnglish(finalTranscript, duration, targetIeltsBand);
            if (!alive()) return;
            setSpokenResult(res);
            persistEnglishProResult({
                mode: 'spoken',
                targetIeltsBand,
                topic: currentTopic,
                transcript: finalTranscript,
                result: res,
            });
            void handlePracticeCompletion(alive);
        } catch (err) { if (alive()) setError(err instanceof Error ? err.message : t('unexpected_error')); }
        finally { if (alive()) endLoading(); }
    }, [targetIeltsBand, currentTopic, persistEnglishProResult, handlePracticeCompletion, beginLoading, endLoading, t]);

    // Speech recognition setup
    useEffect(() => {
        if (isSpeechSupported) {
            recognitionRef.current = new SpeechRecognition();
            const recognition = recognitionRef.current;
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.lang = 'en-US';

            recognition.onresult = (event: any) => {
                let nextTranscript = '';
                for (let i = 0; i < event.results.length; i++) {
                    nextTranscript += event.results[i][0].transcript;
                }
                // Keep the event-handler ref current synchronously. Some engines
                // emit `end` before React has committed the state update.
                transcriptRef.current = nextTranscript;
                setTranscript(nextTranscript);
            };
            
            recognition.onerror = (event: any) => {
                console.error("Speech recognition error:", event.error);
                // Disarm onend synchronously (the ref otherwise only flips on the
                // next render's effect) so the stop()-triggered 'end' event can't
                // spend a credit analysing a no-speech/abort error.
                isListeningRef.current = false;
                try { recognition.stop(); } catch { /* noop */ }
                setError(t(speechErrorKey(event.error)));
                setSpeechFallbackReason(
                    event.error === 'not-allowed' || event.error === 'service-not-allowed'
                        ? 'not-allowed'
                        : event.error === 'no-speech'
                            ? 'no-speech'
                            : 'unavailable',
                );
                setIsListening(false);
                recordingStartTime.current = null;
            };

            recognition.onend = () => {
                // The engine can stop on its own (silence gap / network blip /
                // ~60s timeout even with continuous=true). If we still think we're
                // recording, finalize: flip the UI off so the mic never gets stuck
                // on "Recording…", and analyse whatever speech was captured.
                if (!isListeningRef.current) return;
                setIsListening(false);
                const t0 = recordingStartTime.current;
                const duration = t0 ? (Date.now() - t0) / 1000 : 0;
                recordingStartTime.current = null;
                const finalT = transcriptRef.current;
                if (finalT.trim()) {
                    runSpokenAnalysisRef.current(finalT, duration);
                } else {
                    setError(t('tool_english_pro_no_speech'));
                    setSpeechFallbackReason('no-speech');
                }
            };
        }
    }, [t]);

    // Keep the refs the onend handler reads in sync with current state.
    useEffect(() => { isListeningRef.current = isListening; }, [isListening]);
    useEffect(() => { transcriptRef.current = transcript; }, [transcript]);
    useEffect(() => { runSpokenAnalysisRef.current = runSpokenAnalysis; }, [runSpokenAnalysis]);

    // Pre-load TTS voices so the first listening clip uses the intended voice
    // instead of a glitchy default (getVoices() is empty until voiceschanged).
    useEffect(() => {
        const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
        if (!synth) return;
        synth.getVoices();
        const onVoices = () => { synth.getVoices(); };
        synth.addEventListener?.('voiceschanged', onVoices);
        return () => synth.removeEventListener?.('voiceschanged', onVoices);
    }, []);

    // Tear down the mic and any narration when the tool unmounts, so the
    // microphone never stays live and audio never keeps playing after leaving.
    useEffect(() => () => {
        // Disarm the onend guard BEFORE aborting — abort() fires the recognition
        // 'end' event, and onend would otherwise dispatch a paid analysis (and run
        // setState) on a component the user has already left.
        isListeningRef.current = false;
        recordingStartTime.current = null;
        try { recognitionRef.current?.abort?.(); } catch { /* noop */ }
        try { window.speechSynthesis.cancel(); } catch { /* noop */ }
    }, []);

    const toggleListening = useCallback(() => {
        if (!isSpeechSupported) {
            setError(t('tool_english_pro_not_supported'));
            setSpeechFallbackReason('unsupported');
            return;
        }
        if (isListening) {
            // Disarm onend synchronously (the ref otherwise only flips on the next
            // render's effect) so stop()'s 'end' event can't fire a SECOND paid
            // analysis on top of the explicit one below.
            isListeningRef.current = false;
            try { recognitionRef.current?.stop?.(); } catch { /* noop */ }
            setIsListening(false);
            if (recordingStartTime.current) {
                const duration = (Date.now() - recordingStartTime.current) / 1000;
                recordingStartTime.current = null;
                const finalTranscript = transcriptRef.current || transcript;
                if (finalTranscript.trim()) {
                    runSpokenAnalysis(finalTranscript, duration);
                } else {
                    setError(t('tool_english_pro_no_speech'));
                    setSpeechFallbackReason('no-speech');
                }
            }
        } else {
            setSpokenResult(null);
            setTranscript('');
            transcriptRef.current = '';
            setError(null);
            setSpeechFallbackReason(null);
            try {
                recognitionRef.current?.start?.();
                setIsListening(true);
                recordingStartTime.current = Date.now();
            } catch (err) {
                console.error('Speech recognition start failed:', err);
                setIsListening(false);
                recordingStartTime.current = null;
                setError(t('tool_english_pro_speech_start_failed'));
                setSpeechFallbackReason('start-failed');
            }
        }
    }, [isListening, transcript, runSpokenAnalysis, t]);

    const analyzeManualTranscript = useCallback(() => {
        const normalizedTranscript = manualTranscript.trim();
        if (!normalizedTranscript) {
            setError(t('tool_english_pro_no_speech'));
            return;
        }
        const wordCount = normalizedTranscript.split(/\s+/).length;
        const estimatedDuration = Math.max(1, Math.round((wordCount / 130) * 60));
        void runSpokenAnalysis(normalizedTranscript, estimatedDuration);
    }, [manualTranscript, runSpokenAnalysis, t]);
    
    const fetchNewSpeakingTopic = async () => {
        setIsFetchingTopic(true);
        try {
            const { topics } = await generateSpeakingTopics(targetIeltsBand);
            setSpeakingTopics(topics);
            setCurrentTopic(topics[0] || t('tool_english_pro_default_speaking_topic'));
        } catch (e) {
            setError(t('tool_english_pro_topic_fetch_error'));
            setCurrentTopic(t('tool_english_pro_default_speaking_topic'));
        } finally {
            setIsFetchingTopic(false);
        }
    };

    // Reading
    const runReadingAnalysis = async () => {
        if (!readingUserInput.trim()) { setError(t('tool_english_pro_paste_required')); return; }
        const alive = beginLoading('reading-analysis'); setError(null); setReadingEvaluation(null); setUserAnswers([]);
        try {
            const res = await analyzeEnglishReading(readingUserInput, targetIeltsBand);
            if (!alive()) return;
            setReadingComprehensionResult(res);
            setReadingSubMode('comprehension');
            persistEnglishProResult({
                mode: 'reading',
                targetIeltsBand,
                sourceText: readingUserInput,
                result: res,
                answers: [],
                evaluation: null,
            });
            void handlePracticeCompletion(alive);
        } catch(err) { if (alive()) setError(err instanceof Error ? err.message : t('unexpected_error')); }
        finally { if (alive()) endLoading(); }
    };

    const generateReadingPractice = async () => {
        const alive = beginLoading('reading-practice'); setError(null); setReadingEvaluation(null); setUserAnswers([]);
        try {
            const res = await generateReadingPracticePassage(targetIeltsBand);
            if (!alive()) return;
            setReadingComprehensionResult(res);
            setReadingSubMode('comprehension');
            persistEnglishProResult({
                mode: 'reading',
                targetIeltsBand,
                sourceText: '',
                result: res,
                answers: [],
                evaluation: null,
            });
        } catch(err) { if (alive()) setError(err instanceof Error ? err.message : t('unexpected_error')); }
        finally { if (alive()) endLoading(); }
    };

    const checkReadingAnswers = async () => {
        const res = readingComprehensionResult as EnglishReadingAnalysisResult;
        const textToUse = (res as any).passage || readingUserInput;
        if (!res || !res.comprehensionQuestions?.length) {
            setError(t('tool_english_pro_reading_no_questions'));
            return;
        }
        const normalizedAnswers = res.comprehensionQuestions.map((_, index) => userAnswers[index]?.trim() ?? '');
        const alive = beginLoading('reading-evaluation'); setError(null);
        try {
            const evaluation = await evaluateReadingComprehension(textToUse, res.comprehensionQuestions, normalizedAnswers);
            if (!alive()) return;
            setReadingEvaluation(evaluation);
            persistEnglishProResult({
                mode: 'reading',
                targetIeltsBand,
                sourceText: readingUserInput,
                result: res,
                answers: normalizedAnswers,
                evaluation,
            });
            void handlePracticeCompletion(alive);
        } catch(err) { if (alive()) setError(err instanceof Error ? err.message : t('unexpected_error')); }
        finally { if (alive()) endLoading(); }
    };

    const generateFlashcards = async () => {
        const alive = beginLoading('flashcards'); setError(null); setFlashcards([]);
        try {
            const { cards } = await generateVocabularyFlashcards(targetIeltsBand);
            if (!alive()) return;
            setFlashcards(cards.map(c => ({...c, distractors: shuffleArray([...c.distractors, c.definition])})));
            setCurrentCardIndex(0);
            setFlashcardScore(0);
            setReadingSubMode('flashcards');
        } catch(err) { if (alive()) setError(err instanceof Error ? err.message : t('unexpected_error')); }
        finally { if (alive()) endLoading(); }
    };

    // Listening
    const runListeningAnalysis = async () => {
        if (!userTranscription.trim()) { setError(t('tool_english_pro_type_heard_required')); return; }
        const alive = beginLoading('listening-analysis'); setError(null);
        try {
            const res = await analyzeEnglishListening(currentClip.text, userTranscription, targetIeltsBand);
            if (!alive()) return;
            setListeningResult(res);
            persistEnglishProResult({
                mode: 'listening',
                targetIeltsBand,
                clipId: currentClip.id,
                clipText: currentClip.text,
                transcription: userTranscription,
                result: res,
            });
            void handlePracticeCompletion(alive);
        } catch(err) { if (alive()) setError(err instanceof Error ? err.message : t('unexpected_error')); }
        finally { if (alive()) endLoading(); }
    };
    
    // UI Renderers
    const renderResultCard = (title: string, content: React.ReactNode) => (
        <div className="p-4 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800">
            <h5 className="font-bold text-gray-800 dark:text-gray-100">{title}</h5>
            <div className="mt-2 text-sm text-gray-700 dark:text-gray-300">{content}</div>
        </div>
    );

    const renderModeCard = ({
        title,
        description,
        icon,
        onClick,
        dataQa,
        disabled = false,
        children,
    }: {
        title: string;
        description: string;
        icon: React.ReactNode;
        onClick: () => void;
        dataQa: string;
        disabled?: boolean;
        children?: React.ReactNode;
    }) => (
        <button type="button"
            onClick={onClick}
            data-qa={dataQa}
            disabled={disabled}
            className="group min-h-[132px] rounded-lg border border-gray-200 bg-white p-5 text-left transition duration-150 hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-blue-500 dark:focus:ring-offset-slate-900"
        >
            <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700 transition-colors group-hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:group-hover:bg-blue-900/50">
                {icon}
            </span>
            <span className="block text-base font-semibold text-gray-900 dark:text-gray-100">{title}</span>
            <span className="mt-1 block text-sm leading-6 text-gray-600 dark:text-gray-300">{description}</span>
            {children}
        </button>
    );
    
    const renderPracticeHub = () => (
        <div className="space-y-6">
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-6 text-center dark:border-blue-800/60 dark:bg-blue-900/20">
                 <div className="flex flex-col items-center justify-center gap-4 sm:flex-row sm:text-left">
                    <div
                        aria-label={`${streakData.count} ${t('tool_english_pro_streak_title')}`}
                        className="relative h-16 w-16 shrink-0 rounded-full bg-[conic-gradient(#f59e0b_var(--streak-angle),#e5e7eb_0deg)] dark:bg-[conic-gradient(#fbbf24_var(--streak-angle),#334155_0deg)]"
                        style={{ '--streak-angle': `${(Math.min(Math.max(streakData.count, 0), 7) / 7) * 360}deg` } as React.CSSProperties}
                    >
                        <div className="absolute inset-2 flex items-center justify-center rounded-full bg-blue-50 dark:bg-slate-900">
                            <span className="text-3xl font-bold text-amber-600 dark:text-amber-300">{streakData.count}</span>
                        </div>
                    </div>
                    <div>
                        <h3 className="text-2xl font-bold text-gray-800 dark:text-gray-100">{t('tool_english_pro_streak_title')}</h3>
                        <p className="text-gray-600 dark:text-gray-300">{t('tool_english_pro_streak_desc')}</p>
                    </div>
                </div>
                {dailyGoalComplete && <p className="text-green-600 font-semibold mt-3">{t('tool_english_pro_daily_complete')}</p>}
            </div>

            <div className="space-y-3">
                 <label htmlFor="ielts-band" className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('tool_english_pro_goal_setting_title')}</label>
                 <p className="text-xs text-gray-500 dark:text-gray-400">{t('tool_english_pro_goal_setting_desc')}</p>
                 <select id="ielts-band" value={targetIeltsBand} onChange={e => setTargetIeltsBand(e.target.value)} className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md">
                    {IELTS_BANDS.map(band => <option key={band} value={band}>{band}</option>)}
                 </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {renderModeCard({
                    title: t('tool_english_pro_written_title'),
                    description: t('tool_english_pro_written_desc'),
                    icon: <FileText className="h-5 w-5" aria-hidden="true" />,
                    onClick: () => setPracticeMode('written'),
                    dataQa: 'english-pro-mode-written',
                })}
                {renderModeCard({
                    title: t('tool_english_pro_spoken_title'),
                    description: t('tool_english_pro_spoken_desc'),
                    icon: <Mic className="h-5 w-5" aria-hidden="true" />,
                    onClick: () => setPracticeMode('spoken'),
                    dataQa: 'english-pro-mode-spoken',
                })}
                {renderModeCard({
                    title: t('tool_english_pro_reading_title'),
                    description: t('tool_english_pro_reading_desc'),
                    icon: <BookOpen className="h-5 w-5" aria-hidden="true" />,
                    onClick: () => setPracticeMode('reading'),
                    dataQa: 'english-pro-mode-reading',
                })}
                {renderModeCard({
                    title: t('tool_english_pro_listening_title'),
                    description: t('tool_english_pro_listening_desc'),
                    icon: <Headphones className="h-5 w-5" aria-hidden="true" />,
                    onClick: () => setPracticeMode('listening'),
                    dataQa: 'english-pro-mode-listening',
                })}
            </div>
        </div>
    );

    const renderWrittenMode = () => (
        <div className="space-y-4">
            {!writtenResult ? (
                <>
                    <div>
                        <label htmlFor="native-language" className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('tool_english_pro_lang_label')}</label>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{t('tool_english_pro_lang_desc')}</p>
                        <select id="native-language" value={nativeLanguage} onChange={e => setNativeLanguage(e.target.value)} className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md">
                            {SUPPORTED_LANGUAGES.map(lang => <option key={lang}>{lang}</option>)}
                        </select>
                    </div>
                     <div>
                        <label htmlFor="email-text" className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('tool_english_pro_prompt_label')}</label>
                         <p className="text-xs text-gray-500 dark:text-gray-400">{t('tool_english_pro_prompt_desc')}</p>
                        <div className="flex flex-wrap gap-2 my-2">{ENGLISH_PRO_TOPICS.map((topic, i) => <button type="button" key={i} data-qa={`english-pro-written-topic-${i + 1}`} onClick={() => setWrittenInput(t(`tool_english_pro_topic_${i + 1}`))} className="text-xs bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-800 dark:text-gray-200 p-2 rounded-md">{t(`tool_english_pro_topic_${i + 1}`)}</button>)}</div>
                        <textarea id="email-text" data-qa="english-pro-written-input" value={writtenInput} onChange={e => setWrittenInput(e.target.value)} rows={8} className="w-full border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 rounded-md shadow-sm" placeholder={t('tool_english_pro_placeholder')} />
                    </div>
                    <button type="button" onClick={runWrittenTool} data-qa="english-pro-written-analyze" disabled={loading} className="w-full bg-blue-700 hover:bg-blue-800 disabled:bg-blue-400 text-white font-bold py-2.5 px-4 rounded-lg">{loading ? t('tool_english_pro_analyzing_button') : t('tool_english_pro_analyze_button')}</button>
                </>
            ) : (
                <div data-qa="english-pro-written-result" className="space-y-4">
                    <h4 className="font-bold text-lg text-center text-gray-900 dark:text-gray-100">{t('tool_english_pro_results_title')}</h4>
                    {renderSavedResultBar(() => {
                        setWrittenResult(null);
                        setFromSaved(false);
                    })}
                    {renderResultCard(t('tool_english_pro_cefr_label'), <p className="font-bold text-blue-600 dark:text-blue-400 text-xl">{writtenResult.overallBand.level} <span className="text-sm font-normal text-gray-600 dark:text-gray-400">- {writtenResult.overallBand.description}</span></p>)}
                    {writtenResult.culturalTip && renderResultCard(t('tool_english_pro_cultural_tip'), <p>{writtenResult.culturalTip}</p>)}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {renderResultCard(t('tool_english_pro_original_label'), <p className="whitespace-pre-wrap">{originalWrittenInput}</p>)}
                        {renderResultCard(t('tool_english_pro_corrected_label'), <p className="whitespace-pre-wrap">{writtenResult.correctedEmail}</p>)}
                    </div>
                    {renderResultCard(t('tool_english_pro_feedback_label'), (
                        <ul className="space-y-3">{writtenResult.improvementAreas.map((area, i) => <li key={i}><strong>{area.category}:</strong> <span className="line-through text-red-600">{area.originalText}</span> &rarr; <span className="text-green-600">{area.suggestion}</span><br/><em className="text-xs text-gray-500 dark:text-gray-400">{area.explanation}</em></li>)}</ul>
                    ))}
                    <button type="button" onClick={() => { setWrittenResult(null); setFromSaved(false); }} className="w-full text-sm py-2 px-4 border-2 border-dashed dark:border-slate-600 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-300">{t('tool_english_pro_practice_again_button')}</button>
                </div>
            )}
            <button type="button" onClick={requestStartNewPractice} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">{t('tool_english_pro_back_to_hub')}</button>
        </div>
    );
    
    // --- Spoken Mode ---
    const renderSpokenMode = () => (
        <div className="space-y-4">
            {!spokenResult ? (
                <>
                    {/* Topic card */}
                    <div className="p-4 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800">
                        <h4 className="font-bold text-gray-800 dark:text-gray-100 mb-2">{t('tool_english_pro_speaking_topic')}</h4>
                        {currentTopic ? (
                            <p className="text-gray-700 dark:text-gray-300 text-sm italic">"{currentTopic}"</p>
                        ) : (
                            <p className="text-gray-500 dark:text-gray-400 text-sm">{t('tool_english_pro_speaking_get_topic_hint')}</p>
                        )}
                        <button type="button"
                            onClick={fetchNewSpeakingTopic}
                            disabled={isFetchingTopic}
                            className="mt-3 text-sm bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-800 dark:text-gray-200 py-1.5 px-3 rounded-md disabled:opacity-50 flex items-center gap-2"
                        >
                            {isFetchingTopic && (
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" aria-hidden="true" />
                            )}
                            {currentTopic ? t('tool_english_pro_spoken_new_topic') : t('tool_english_pro_spoken_get_topic')}
                        </button>
                    </div>

                    {/* Mic section */}
                    {!isSpeechSupported ? (
                        <div className="p-4 border border-yellow-400 dark:border-yellow-600 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg text-sm text-yellow-800 dark:text-yellow-300">
                            {t('tool_english_pro_spoken_not_supported')}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-4 py-4">
                            <button type="button"
                                onClick={toggleListening}
                                className={`w-20 h-20 rounded-full font-bold text-white text-sm flex flex-col items-center justify-center gap-1 transition-all shadow-lg focus:outline-none focus:ring-4 ${
                                    isListening
                                        ? 'bg-red-600 hover:bg-red-700 focus:ring-red-300 animate-pulse'
                                        : 'bg-blue-700 hover:bg-blue-800 focus:ring-blue-300'
                                }`}
                            >
                                <Mic className="h-7 w-7" aria-hidden="true" />
                                <span className="text-xs">{isListening ? t('tool_english_pro_spoken_stop_mic') : t('tool_english_pro_spoken_start_mic')}</span>
                            </button>
                            {isListening && (
                                <p className="text-xs text-red-600 dark:text-red-400 font-medium animate-pulse">{t('tool_english_pro_recording_hint')}</p>
                            )}
                        </div>
                    )}

                    {speechFallbackReason && (
                        <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/60 dark:bg-blue-950/30">
                            <div>
                                <label htmlFor="english-pro-spoken-manual" className="block text-sm font-bold text-blue-950 dark:text-blue-100">
                                    {t('tool_english_pro_spoken_manual_title')}
                                </label>
                                <p className="mt-1 text-xs leading-5 text-blue-800 dark:text-blue-200">
                                    {t('tool_english_pro_spoken_manual_desc')}
                                </p>
                            </div>
                            <textarea
                                id="english-pro-spoken-manual"
                                data-qa="english-pro-spoken-manual"
                                value={manualTranscript}
                                onChange={(event) => setManualTranscript(event.target.value)}
                                rows={5}
                                className="w-full rounded-md border-gray-300 bg-white text-gray-900 shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100"
                                placeholder={t('tool_english_pro_spoken_manual_placeholder')}
                            />
                            <p className="text-xs leading-5 text-blue-700 dark:text-blue-300">
                                {t('tool_english_pro_spoken_manual_pacing_note')}
                            </p>
                            <button
                                type="button"
                                onClick={analyzeManualTranscript}
                                disabled={loading || !manualTranscript.trim()}
                                data-qa="english-pro-spoken-manual-analyze"
                                className="w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-blue-400"
                            >
                                {t('tool_english_pro_spoken_manual_analyze')}
                            </button>
                        </div>
                    )}

                    {/* Live transcript */}
                    {(transcript || isListening) && (
                        <div className="p-4 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800">
                            <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">{t('tool_english_pro_spoken_live_transcript')}</h5>
                            <p className="text-sm text-gray-700 dark:text-gray-300 min-h-[3rem]">{transcript || <span className="italic text-gray-400">{t('tool_english_pro_spoken_listening_placeholder')}</span>}</p>
                        </div>
                    )}
                </>
            ) : (
                <div className="space-y-4">
                    <h4 className="font-bold text-lg text-center text-gray-900 dark:text-gray-100">{t('tool_english_pro_spoken_results_title')}</h4>
                    {renderSavedResultBar(() => {
                        setSpokenResult(null);
                        transcriptRef.current = '';
                        setTranscript('');
                        setManualTranscript('');
                        setSpeechFallbackReason(isSpeechSupported ? null : 'unsupported');
                        setFromSaved(false);
                    })}

                    {/* Scores row */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {renderResultCard(t('tool_english_pro_spoken_clarity_score'), (
                            <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">
                                {spokenResult.clarityScore}<span className="text-base font-normal text-gray-500 dark:text-gray-400">/100</span>
                            </p>
                        ))}
                        {renderResultCard(t('tool_english_pro_spoken_pacing'), (
                            <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">
                                {spokenResult.pacingWPM}<span className="text-base font-normal text-gray-500 dark:text-gray-400"> {t('tool_english_pro_spoken_wpm')}</span>
                            </p>
                        ))}
                    </div>

                    {/* Filler words */}
                    {spokenResult.fillerWords.length > 0 && renderResultCard(t('tool_english_pro_spoken_filler_words'), (
                        <div className="flex flex-wrap gap-2 mt-1">
                            {spokenResult.fillerWords.map((fw, i) => (
                                <span key={i} className="inline-flex items-center gap-1 bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 text-xs font-medium px-2.5 py-1 rounded-full">
                                    "{fw.word}" <span className="font-bold">×{fw.count}</span>
                                </span>
                            ))}
                        </div>
                    ))}

                    {/* Feedback & suggestions */}
                    {renderResultCard(t('tool_english_pro_spoken_feedback'), <p>{spokenResult.feedbackSummary}</p>)}
                    {spokenResult.improvementSuggestions.length > 0 && renderResultCard(t('tool_english_pro_spoken_suggestions'), (
                        <ul className="space-y-1 list-disc list-inside">
                            {spokenResult.improvementSuggestions.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                    ))}

                    <button type="button"
                        onClick={() => {
                            setSpokenResult(null);
                            transcriptRef.current = '';
                            setTranscript('');
                            setManualTranscript('');
                            setSpeechFallbackReason(isSpeechSupported ? null : 'unsupported');
                            setFromSaved(false);
                        }}
                        className="w-full text-sm py-2 px-4 border-2 border-dashed dark:border-slate-600 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-300"
                    >
                        {t('tool_english_pro_practice_again_button')}
                    </button>
                </div>
            )}
            <button type="button" onClick={requestStartNewPractice} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">{t('tool_english_pro_back_to_hub')}</button>
        </div>
    );

    // --- Reading Mode ---
    const renderReadingMode = () => {
        const practiceResult = readingComprehensionResult as (EnglishReadingAnalysisResult & { passage?: string }) | null;
        const questions: ComprehensionQuestion[] = practiceResult?.comprehensionQuestions ?? [];

        const renderComprehensionSubMode = () => (
            <div className="space-y-4">
                {!readingComprehensionResult ? (
                    <>
                        {/* Generate or paste */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="p-4 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 space-y-3">
                                <h5 className="font-bold text-gray-800 dark:text-gray-100">{t('tool_english_pro_reading_generate_practice')}</h5>
                                <p className="text-xs text-gray-500 dark:text-gray-400">{t('tool_english_pro_reading_generate_desc')}</p>
                                <button type="button"
                                    onClick={generateReadingPractice}
                                    disabled={loading}
                                    className="w-full bg-blue-700 hover:bg-blue-800 disabled:bg-blue-400 text-white font-bold py-2 px-4 rounded-lg text-sm"
                                >
                                    {loading ? t('tool_english_pro_generating_button') : t('tool_english_pro_reading_generate_button')}
                                </button>
                            </div>
                            <div className="p-4 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 space-y-3">
                                <label htmlFor="english-pro-reading-input" className="block font-bold text-gray-800 dark:text-gray-100">
                                    {t('tool_english_pro_reading_paste_text')}
                                </label>
                                <textarea
                                    id="english-pro-reading-input"
                                    data-qa="english-pro-reading-input"
                                    value={readingUserInput}
                                    onChange={e => setReadingUserInput(e.target.value)}
                                    rows={4}
                                    className="w-full border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 rounded-md shadow-sm text-sm"
                                    placeholder={t('tool_english_pro_reading_placeholder')}
                                />
                                <button type="button"
                                    onClick={runReadingAnalysis}
                                    disabled={loading || !readingUserInput.trim()}
                                    data-qa="english-pro-reading-analyze"
                                    className="w-full bg-blue-700 hover:bg-blue-800 disabled:bg-blue-400 text-white font-bold py-2 px-4 rounded-lg text-sm"
                                >
                                    {loading ? t('tool_english_pro_analyzing_button') : t('tool_english_pro_reading_analyze_button')}
                                </button>
                            </div>
                        </div>
                    </>
                ) : (
                    <div data-qa="english-pro-reading-result" className="space-y-4">
                        {renderSavedResultBar(() => {
                            setReadingComprehensionResult(null);
                            setReadingEvaluation(null);
                            setUserAnswers([]);
                            setFromSaved(false);
                        })}
                        {/* Passage */}
                        {renderResultCard(t('tool_english_pro_reading_passage'), (
                            <p data-qa="english-pro-reading-passage" className="whitespace-pre-wrap text-sm leading-relaxed">
                                {practiceResult?.passage ?? readingUserInput}
                            </p>
                        ))}

                        {/* Vocabulary list (only on analyzed user text) */}
                        {!practiceResult?.passage && (practiceResult as EnglishReadingAnalysisResult | null)?.vocabularyList?.length ? renderResultCard(t('tool_english_pro_key_vocabulary'), (
                            <div className="overflow-x-auto">
                            <table className="min-w-[640px] w-full text-xs">
                                <thead><tr className="text-left text-gray-500 dark:text-gray-400 border-b dark:border-slate-600"><th className="pb-1 pr-2">{t('tool_english_pro_vocab_word')}</th><th className="pb-1 pr-2">{t('tool_english_pro_vocab_definition')}</th><th className="pb-1">{t('tool_english_pro_vocab_example')}</th></tr></thead>
                                <tbody>
                                    {(practiceResult as EnglishReadingAnalysisResult).vocabularyList.map((v, i) => (
                                        <tr key={i} className="border-b dark:border-slate-700 last:border-0">
                                            <td className="py-1 pr-2 font-semibold text-blue-600 dark:text-blue-400">{v.word}</td>
                                            <td className="py-1 pr-2">{v.definition}</td>
                                            <td className="py-1 italic text-gray-500 dark:text-gray-400">{v.example}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            </div>
                        )) : null}

                        {/* Summary (analyzed text only) */}
                        {!practiceResult?.passage && (practiceResult as EnglishReadingAnalysisResult | null)?.summary
                            ? renderResultCard(t('tool_english_pro_summary'), <p data-qa="english-pro-reading-summary">{(practiceResult as EnglishReadingAnalysisResult).summary}</p>)
                            : null
                        }

                        {/* Questions */}
                        {questions.length > 0 && renderResultCard(t('tool_english_pro_reading_questions'), (
                            <ol className="space-y-4 mt-1">
                                {questions.map((q, i) => (
                                    <li key={i} className="space-y-1">
                                        {!readingEvaluation ? (
                                            <>
                                                <label
                                                    htmlFor={`english-pro-reading-answer-${i + 1}`}
                                                    className="block font-medium text-gray-800 dark:text-gray-100"
                                                >
                                                    {i + 1}. {q.question}
                                                </label>
                                                <input
                                                    id={`english-pro-reading-answer-${i + 1}`}
                                                    data-qa={`english-pro-reading-answer-${i + 1}`}
                                                    type="text"
                                                    value={userAnswers[i] ?? ''}
                                                    onChange={e => {
                                                        const next = [...userAnswers];
                                                        next[i] = e.target.value;
                                                        setUserAnswers(next);
                                                    }}
                                                    placeholder={t('tool_english_pro_reading_your_answer')}
                                                    className="w-full border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 rounded-md shadow-sm text-sm px-3 py-1.5"
                                                />
                                            </>
                                        ) : (
                                            <div>
                                                <p className="font-medium text-gray-800 dark:text-gray-100">{i + 1}. {q.question}</p>
                                                <div data-qa={`english-pro-reading-evaluation-${i + 1}`} className={`mt-1 p-3 rounded-md text-sm ${readingEvaluation[i]?.isCorrect ? 'bg-green-50 dark:bg-green-900/20 border border-green-300 dark:border-green-700' : 'bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700'}`}>
                                                <p className="font-semibold">{readingEvaluation[i]?.isCorrect ? t('tool_english_pro_correct') : t('tool_english_pro_incorrect')}</p>
                                                <p className="text-gray-600 dark:text-gray-300">{readingEvaluation[i]?.feedback}</p>
                                                {!readingEvaluation[i]?.isCorrect && (
                                                    <p className="mt-1"><span className="font-medium">{t('tool_english_pro_reading_correct_answer')}:</span> {q.answer}</p>
                                                )}
                                                </div>
                                            </div>
                                        )}
                                    </li>
                                ))}
                            </ol>
                        ))}
                        {questions.length === 0 && (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-100">
                                {t('tool_english_pro_reading_no_questions')}
                            </div>
                        )}

                        {/* Check / practice again */}
                        {!readingEvaluation && questions.length > 0 ? (
                            <button type="button"
                                onClick={checkReadingAnswers}
                                disabled={loading}
                                data-qa="english-pro-reading-check"
                                className="w-full bg-blue-700 hover:bg-blue-800 disabled:bg-blue-400 text-white font-bold py-2.5 px-4 rounded-lg"
                            >
                                {loading ? t('tool_english_pro_checking_button') : t('tool_english_pro_reading_check_answers')}
                            </button>
                        ) : (
                            <>
                                {readingEvaluation && (
                                    <p data-qa="english-pro-reading-evaluation-summary" className="text-center text-sm text-gray-600 dark:text-gray-300">
                                        {t('tool_english_pro_reading_results_summary')
                                            .replace('{correct}', String(readingEvaluation.filter(e => e.isCorrect).length))
                                            .replace('{total}', String(readingEvaluation.length))}
                                    </p>
                                )}
                                <button type="button"
                                    onClick={() => { setReadingComprehensionResult(null); setReadingEvaluation(null); setUserAnswers([]); setReadingUserInput(''); setFromSaved(false); }}
                                    data-qa="english-pro-reading-practice-again"
                                    className="w-full text-sm py-2 px-4 border-2 border-dashed dark:border-slate-600 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-300"
                                >
                                    {t('tool_english_pro_reading_practice_again')}
                                </button>
                            </>
                        )}
                    </div>
                )}
            </div>
        );

        const renderFlashcardsSubMode = () => {
            if (flashcards.length === 0) {
                return <p className="text-center text-sm text-gray-500 dark:text-gray-400 py-8">{t('tool_english_pro_no_flashcards')}</p>;
            }

            const isComplete = currentCardIndex >= flashcards.length;

            if (isComplete) {
                return (
                    <div className="p-6 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-center space-y-3">
                        <h4 className="font-bold text-xl text-gray-900 dark:text-gray-100">{t('tool_english_pro_flashcard_complete')}</h4>
                        <p className="text-gray-600 dark:text-gray-300">
                            {t('tool_english_pro_flashcard_final_score')
                                .replace('{score}', String(flashcardScore))
                                .replace('{total}', String(flashcards.length))}
                        </p>
                        <button type="button"
                            onClick={() => { setFlashcards([]); setCurrentCardIndex(0); setFlashcardScore(0); setReadingSubMode('select'); }}
                            className="w-full text-sm py-2 px-4 border-2 border-dashed dark:border-slate-600 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-300"
                        >
                            {t('tool_english_pro_reading_practice_again')}
                        </button>
                    </div>
                );
            }

            const card = flashcards[currentCardIndex];
            // distractors already shuffled by generateFlashcards (includes definition as one option)
            const options = card.distractors;

            return (
                <div className="space-y-4">
                    {/* Score */}
                    <div className="flex justify-between items-center text-sm text-gray-500 dark:text-gray-400">
                        <span>{t('tool_english_pro_flashcard_score')}: <strong className="text-gray-800 dark:text-gray-100">{flashcardScore}</strong></span>
                        <span>{currentCardIndex + 1} / {flashcards.length}</span>
                    </div>

                    {/* Card */}
                    <div className="p-6 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-center">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">{t('tool_english_pro_flashcard_question')}</p>
                        <h4 className="text-3xl font-bold text-blue-600 dark:text-blue-400">{card.word}</h4>
                    </div>

                    {/* Options */}
                    <div className="space-y-2">
                        {options.map((opt, i) => {
                            const isSelected = selectedFlashcardAnswer === opt;
                            const isCorrect = opt === card.definition;
                            let btnClass = 'w-full text-left py-3 px-4 rounded-lg border text-sm font-medium transition-colors ';
                            if (!isFlashcardAnswered) {
                                btnClass += 'border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-slate-700 text-gray-800 dark:text-gray-200';
                            } else if (isCorrect) {
                                btnClass += 'border-green-500 bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-300';
                            } else if (isSelected && !isCorrect) {
                                btnClass += 'border-red-500 bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-300';
                            } else {
                                btnClass += 'border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-500 dark:text-gray-400 opacity-60';
                            }
                            return (
                                <button type="button"
                                    key={i}
                                    disabled={isFlashcardAnswered}
                                    onClick={() => {
                                        setSelectedFlashcardAnswer(opt);
                                        setIsFlashcardAnswered(true);
                                        if (opt === card.definition) setFlashcardScore(s => s + 1);
                                    }}
                                    className={btnClass}
                                >
                                    {opt}
                                </button>
                            );
                        })}
                    </div>

                    {/* Next */}
                    {isFlashcardAnswered && (
                        <button type="button"
                            onClick={() => { setCurrentCardIndex(i => i + 1); setSelectedFlashcardAnswer(null); setIsFlashcardAnswered(false); }}
                            className="w-full bg-blue-700 hover:bg-blue-800 text-white font-bold py-2.5 px-4 rounded-lg"
                        >
                            {t('tool_english_pro_flashcard_next')}
                        </button>
                    )}
                </div>
            );
        };

        return (
            <div className="space-y-4">
                {readingSubMode === 'select' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {renderModeCard({
                            title: t('tool_english_pro_reading_comprehension_title'),
                            description: t('tool_english_pro_reading_comprehension_desc'),
                            icon: <BookOpen className="h-5 w-5" aria-hidden="true" />,
                            onClick: () => setReadingSubMode('comprehension'),
                            dataQa: 'english-pro-reading-comprehension',
                        })}
                        {renderModeCard({
                            title: t('tool_english_pro_reading_flashcards_title'),
                            description: t('tool_english_pro_reading_flashcards_desc'),
                            icon: <Sparkles className="h-5 w-5" aria-hidden="true" />,
                            onClick: generateFlashcards,
                            dataQa: 'english-pro-reading-flashcards',
                            disabled: loading,
                        })}
                    </div>
                )}
                {readingSubMode === 'comprehension' && renderComprehensionSubMode()}
                {readingSubMode === 'flashcards' && renderFlashcardsSubMode()}

                {readingSubMode !== 'select' && (
                    <button type="button"
                        onClick={requestReadingOptions}
                        data-qa="english-pro-reading-back-options"
                        className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                    >
                        {t('tool_english_pro_back_to_reading')}
                    </button>
                )}
                <button type="button" onClick={requestStartNewPractice} data-qa="english-pro-reading-back-hub" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">{t('tool_english_pro_back_to_hub')}</button>
            </div>
        );
    };

    // --- Listening Mode ---
    const stopClip = () => {
        try { window.speechSynthesis.cancel(); } catch { /* noop */ }
        setIsPlaying(false);
    };
    const playClip = () => {
        const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
        if (!synth) return;
        try {
            const start = () => {
                const u = new SpeechSynthesisUtterance(currentClip.text);
                u.lang = 'en-US';
                u.rate = 0.95;
                const v = pickEnglishVoice();
                if (v) u.voice = v;
                u.onstart = () => setIsPlaying(true);
                u.onend = () => setIsPlaying(false);
                u.onerror = () => setIsPlaying(false);
                synth.speak(u);
            };
            // Avoid the synchronous cancel()→speak() race that tears the first clip.
            if (synth.speaking || synth.pending) { synth.cancel(); window.setTimeout(start, 120); }
            else start();
        } catch { setIsPlaying(false); }
    };

    const renderListeningMode = () => {
        const clipIndex = LISTENING_CLIPS.findIndex(c => c.id === currentClip.id);
        const isSpeechSynthesisSupported = 'speechSynthesis' in window;

        return (
            <div className="space-y-4">
                {/* Clip indicator */}
                <div className="flex items-center justify-between p-4 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        {t('tool_english_pro_listening_clip_label')} {clipIndex + 1} {t('tool_english_pro_listening_of')} {LISTENING_CLIPS.length}
                    </span>
                    {!listeningResult && (
                        <button type="button"
                            onClick={() => {
                                stopClip(); // cancel any in-flight narration + reset isPlaying
                                const nextIndex = (clipIndex + 1) % LISTENING_CLIPS.length;
                                setCurrentClip(LISTENING_CLIPS[nextIndex]);
                                setUserTranscription('');
                                setListeningResult(null);
                            }}
                            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                        >
                            {t('tool_english_pro_listening_try_another')}
                        </button>
                    )}
                </div>

                {!listeningResult ? (
                    <>
                        {/* Play button */}
                        <div className="flex justify-center">
                            <button type="button"
                                onClick={isPlaying ? stopClip : playClip}
                                disabled={!isSpeechSynthesisSupported}
                                title={isSpeechSynthesisSupported ? undefined : t('tool_english_pro_tts_not_supported')}
                                className={`flex items-center gap-2 ${isPlaying ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-700 hover:bg-blue-800'} disabled:bg-gray-400 text-white font-bold py-3 px-6 rounded-full shadow-lg transition-colors`}
                            >
                                {isPlaying ? (
                                    <Square className="h-5 w-5 fill-current" aria-hidden="true" />
                                ) : (
                                    <Play className="h-5 w-5 fill-current" aria-hidden="true" />
                                )}
                                {isPlaying ? t('tool_english_pro_listening_stop') : t('tool_english_pro_listening_play_audio')}
                            </button>
                        </div>
                        {!isSpeechSynthesisSupported && (
                            <p className="text-xs text-center text-yellow-700 dark:text-yellow-400">{t('tool_english_pro_audio_unsupported')}</p>
                        )}

                        {/* Transcription input */}
                        <div>
                            <label htmlFor="english-pro-listening-transcription" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('tool_english_pro_listening_desc')}</label>
                            <textarea
                                id="english-pro-listening-transcription"
                                data-qa="english-pro-listening-transcription"
                                value={userTranscription}
                                onChange={e => setUserTranscription(e.target.value)}
                                rows={4}
                                className="w-full border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 rounded-md shadow-sm"
                                placeholder={t('tool_english_pro_listening_placeholder')}
                            />
                        </div>

                        <button type="button"
                            onClick={runListeningAnalysis}
                            disabled={loading || !userTranscription.trim()}
                            data-qa="english-pro-listening-check"
                            className="w-full bg-blue-700 hover:bg-blue-800 disabled:bg-blue-400 text-white font-bold py-2.5 px-4 rounded-lg"
                        >
                            {loading ? t('tool_english_pro_analyzing_button') : t('tool_english_pro_listening_check_button')}
                        </button>
                    </>
                ) : (
                    <div data-qa="english-pro-listening-result" className="space-y-4">
                        <h4 className="font-bold text-lg text-center text-gray-900 dark:text-gray-100">{t('tool_english_pro_listening_results_title')}</h4>
                        {renderSavedResultBar(() => {
                            setUserTranscription('');
                            setListeningResult(null);
                            setFromSaved(false);
                        })}

                        {/* Similarity score */}
                        {renderResultCard(t('tool_english_pro_listening_similarity_score'), (
                            <p data-qa="english-pro-listening-score" className="text-4xl font-bold text-blue-600 dark:text-blue-400">
                                {listeningResult.similarityScore}<span className="text-base font-normal text-gray-500 dark:text-gray-400">%</span>
                            </p>
                        ))}

                        {/* Side-by-side versions */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {renderResultCard(t('tool_english_pro_listening_your_version'), (
                                <p data-qa="english-pro-listening-diff" className="whitespace-pre-wrap text-sm">{listeningResult.diffView}</p>
                            ))}
                            {renderResultCard(t('tool_english_pro_listening_correct_version'), (
                                <p data-qa="english-pro-listening-original" className="whitespace-pre-wrap text-sm">{listeningResult.originalTranscript}</p>
                            ))}
                        </div>

                        {/* Feedback on common errors */}
                        {listeningResult.feedbackOnCommonErrors.length > 0 && renderResultCard(t('tool_english_pro_listening_feedback'), (
                            <ul className="space-y-1 list-disc list-inside">
                                {listeningResult.feedbackOnCommonErrors.map((fb, i) => <li key={i}>{fb}</li>)}
                            </ul>
                        ))}

                        <button type="button"
                            onClick={() => {
                                stopClip(); // cancel any in-flight narration + reset isPlaying
                                const nextIndex = (clipIndex + 1) % LISTENING_CLIPS.length;
                                setCurrentClip(LISTENING_CLIPS[nextIndex]);
                                setUserTranscription('');
                                setListeningResult(null);
                                setFromSaved(false);
                            }}
                            data-qa="english-pro-listening-try-another"
                            className="w-full text-sm py-2 px-4 border-2 border-dashed dark:border-slate-600 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-300"
                        >
                            {t('tool_english_pro_listening_try_another')}
                        </button>
                    </div>
                )}
                <button type="button" onClick={requestStartNewPractice} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">{t('tool_english_pro_back_to_hub')}</button>
            </div>
        );
    };

    const loadingPresentation = useMemo(() => {
        switch (loadingAction) {
            case 'spoken-analysis':
                return {
                    title: t('tool_english_pro_spoken_results_title'),
                    steps: [
                        t('tool_english_pro_spoken_live_transcript'),
                        t('tool_english_pro_spoken_clarity_score'),
                        t('tool_english_pro_spoken_feedback'),
                    ],
                };
            case 'reading-analysis':
                return {
                    title: t('tool_english_pro_reading_title'),
                    steps: [
                        t('tool_english_pro_reading_passage'),
                        t('tool_english_pro_key_vocabulary'),
                        t('tool_english_pro_summary'),
                    ],
                };
            case 'reading-practice':
                return {
                    title: t('tool_english_pro_reading_generate_practice'),
                    steps: [
                        t('tool_english_pro_reading_generate_desc'),
                        t('tool_english_pro_reading_passage'),
                        t('tool_english_pro_reading_questions'),
                    ],
                };
            case 'reading-evaluation':
                return {
                    title: t('tool_english_pro_reading_check_answers'),
                    steps: [
                        t('tool_english_pro_reading_questions'),
                        t('tool_english_pro_correct'),
                        t('tool_english_pro_summary'),
                    ],
                };
            case 'flashcards':
                return {
                    title: t('tool_english_pro_reading_flashcards_title'),
                    steps: [
                        t('tool_english_pro_reading_flashcards_desc'),
                        t('tool_english_pro_key_vocabulary'),
                        t('tool_english_pro_flashcard_question'),
                    ],
                };
            case 'listening-analysis':
                return {
                    title: t('tool_english_pro_listening_results_title'),
                    steps: [
                        t('tool_english_pro_listening_your_version'),
                        t('tool_english_pro_listening_correct_version'),
                        t('tool_english_pro_listening_feedback'),
                    ],
                };
            case 'written-analysis':
            default:
                return {
                    title: t('tool_english_pro_analyzing_title'),
                    steps: [
                        t('tool_english_pro_loader_step1'),
                        t('tool_english_pro_loader_step2'),
                        t('tool_english_pro_loader_step3'),
                        t('tool_english_pro_loader_step4'),
                    ],
                };
        }
    }, [loadingAction, t]);

    // Main component return
    return (
        <div data-qa="english-pro-tool" data-qa-english-mode={practiceMode} className="p-4 bg-gray-50 dark:bg-slate-900 rounded-lg animate-fade-in">
            {error && <div className="mb-4"><ToolError message={error} /></div>}
            {loading ? (
                <StagedLoader
                    icon={<Languages />}
                    accent="purple"
                    title={loadingPresentation.title}
                    steps={loadingPresentation.steps}
                    onCancel={cancelLoading}
                    cancelLabel={t('tool_loader_hide_button')}
                    cancelHint={t('tool_loader_hide_hint')}
                />
            ) : (
                <>
                    {practiceMode === 'hub' && renderPracticeHub()}
                    {practiceMode === 'written' && renderWrittenMode()}
                    {practiceMode === 'spoken' && renderSpokenMode()}
                    {practiceMode === 'reading' && renderReadingMode()}
                    {practiceMode === 'listening' && renderListeningMode()}
                </>
            )}
            <ConfirmActionDialog
                open={pendingDiscardAction !== null}
                dataQa="english-pro-discard-confirm"
                title={t('tool_english_pro_discard_title')}
                description={t('tool_english_pro_discard_desc')}
                cancelLabel={t('tool_english_pro_discard_cancel')}
                confirmLabel={t('tool_english_pro_discard_confirm')}
                tone="danger"
                onOpenChange={(open) => { if (!open) setPendingDiscardAction(null); }}
                onCancel={() => setPendingDiscardAction(null)}
                onConfirm={confirmDiscardProgress}
            />
        </div>
    );
};

export default EnglishPro;
