
import React, { useState, useEffect, useRef } from 'react';
import { Briefcase, ChevronRight, Hash, Paperclip, Send, Sparkles, X } from 'lucide-react';
import type { AppSession as Session } from '../lib/data';
import type { UserProfile } from '../types';
import { careerCoach } from '../services/aiClient';
import Avatar from './Avatar';
import { useModalBehavior } from '../hooks/useModalBehavior';

interface CareerCoachBotProps {
    isOpen: boolean;
    onClose: () => void;
    session: Session | null;
    profile: UserProfile | null;
    resumeText: string;
    t: (key: string) => string;
    /** Route the candidate to a workspace section (intent chips → the right tool). */
    onLaunchTool?: (target: 'jobs' | 'resume' | 'interview' | 'plan') => void;
}

type CoachTopic = 'jobs' | 'process';

const COACH_TOPICS: {
    id: CoachTopic;
    labelKey: string;
    questions: string[];
}[] = [
    {
        id: 'jobs',
        labelKey: 'coach_topic_jobs',
        questions: ['coach_prompt_job_fit', 'coach_prompt_product_role', 'coach_prompt_apply_count'],
    },
    {
        id: 'process',
        labelKey: 'coach_topic_process',
        questions: ['coach_prompt_hiring_process', 'coach_prompt_assessment', 'coach_prompt_next_stage'],
    },
];

interface Message {
    role: 'user' | 'model';
    content: string;
}

const renderFormattedMessage = (text: string) => {
    const lines = text.split('\n');
    const elements: React.ReactNode[] = [];
    let ulistItems: string[] = [];
    let olistItems: string[] = [];
    let paragraphLines: string[] = [];

    const renderInlineFormatting = (line: string): React.ReactNode => {
        const parts = line.split(/(\*\*.*?\*\*)/g).filter(Boolean);
        return parts.map((part, index) => {
            if (part.startsWith('**') && part.endsWith('**')) {
                return <strong key={index}>{part.slice(2, -2)}</strong>;
            }
            return part;
        });
    };
    
    const flushParagraph = () => {
        if (paragraphLines.length > 0) {
            elements.push(
                <p key={`p-${elements.length}`} className="mb-2 last:mb-0">
                    {paragraphLines.map((line, lineIndex) => (
                        <React.Fragment key={lineIndex}>
                            {renderInlineFormatting(line)}
                            {lineIndex < paragraphLines.length - 1 && <br />}
                        </React.Fragment>
                    ))}
                </p>
            );
            paragraphLines = [];
        }
    };

    const flushLists = () => {
        if (ulistItems.length > 0) {
            elements.push(
                <ul key={`ul-${elements.length}`} className="list-disc list-outside ml-5 my-2 space-y-1">
                    {ulistItems.map((item, index) => (
                        <li key={index}>{renderInlineFormatting(item)}</li>
                    ))}
                </ul>
            );
            ulistItems = [];
        }
        if (olistItems.length > 0) {
            elements.push(
                <ol key={`ol-${elements.length}`} className="list-decimal list-outside ml-5 my-2 space-y-1">
                    {olistItems.map((item, index) => (
                        <li key={index}>{renderInlineFormatting(item)}</li>
                    ))}
                </ol>
            );
            olistItems = [];
        }
    };

    const flushAll = () => {
        flushParagraph();
        flushLists();
    };

    lines.forEach((line) => {
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith('* ') || trimmedLine.startsWith('- ')) {
            flushParagraph();
            if (olistItems.length > 0) flushLists();
            ulistItems.push(trimmedLine.substring(2));
        } else if (trimmedLine.match(/^\d+\.\s/)) {
            flushParagraph();
            if (ulistItems.length > 0) flushLists();
            olistItems.push(trimmedLine.replace(/^\d+\.\s/, ''));
        } else if (trimmedLine === '') {
            flushAll();
        } else {
            flushLists();
            paragraphLines.push(line);
        }
    });

    flushAll();

    return elements.length > 0 ? elements : <p>{text}</p>;
};


const CareerCoachBot: React.FC<CareerCoachBotProps> = ({ isOpen, onClose, session, profile, resumeText, t, onLaunchTool }) => {
    // Two presentation modes with different a11y semantics: on mobile the panel
    // covers the page (a true modal — lock scroll, aria-modal), while on desktop
    // it docks in the corner and the page stays usable (non-modal — page scroll
    // must NOT be hijacked). sm breakpoint mirrors the Tailwind classes below.
    const [isDesktopDock, setIsDesktopDock] = useState(
        () => typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches,
    );
    useEffect(() => {
        const mq = window.matchMedia('(min-width: 640px)');
        const onChange = (e: MediaQueryListEvent) => setIsDesktopDock(e.matches);
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, []);
    const panelRef = useRef<HTMLElement | null>(null);
    useModalBehavior(onClose, isOpen, !isDesktopDock, isDesktopDock ? undefined : panelRef);
    const [messages, setMessages] = useState<Message[]>([]);
    const [userInput, setUserInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [activeTopic, setActiveTopic] = useState<CoachTopic>('jobs');
    const messagesEndRef = useRef<HTMLDivElement>(null);
    // Drop a late reply if the assistant unmounted (e.g. the user signed out) while it
    // was in flight — otherwise a reply built from the pre-sign-out profile lands in state.
    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    useEffect(() => {
        if (isOpen) {
            setMessages([]);
            setUserInput('');
            setActiveTopic('jobs');
        }
    }, [isOpen]);

    useEffect(() => {
        if (messages.length > 0 || isLoading) {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }
    }, [messages, isLoading]);

    const sendMessage = async (text: string) => {
        const cleanText = text.trim();
        if (!cleanText || isLoading) return;

        const userMessage: Message = { role: 'user', content: cleanText };
        if (!session) {
            setMessages([...messages, userMessage, { role: 'model', content: t('coach_login_required') }]);
            setUserInput('');
            return;
        }

        const history = [...messages, userMessage];
        setMessages(history);
        setUserInput('');
        setIsLoading(true);

        try {
            const reply = await careerCoach({
                messages: history,
                role: profile?.role === 'employer' ? 'employer' : profile?.role === 'candidate' ? 'candidate' : null,
                resumeText,
                companyName: profile?.company_name,
                companyWebsite: profile?.company_website,
                companyDescription: profile?.company_description,
            });
            if (!mountedRef.current) return;
            setMessages(prev => [...prev, { role: 'model', content: reply }]);
        } catch {
            if (!mountedRef.current) return;
            setMessages(prev => [...prev, { role: 'model', content: t('coach_error') }]);
        } finally {
            if (mountedRef.current) setIsLoading(false);
        }
    };

    const handleSendMessage = (e: React.FormEvent) => {
        e.preventDefault();
        void sendMessage(userInput);
    };

    if (!isOpen) return null;

    const activeTopicConfig = COACH_TOPICS.find((topic) => topic.id === activeTopic) ?? COACH_TOPICS[0];
    const showWelcomePanel = messages.length === 0 && !isLoading;

    return (
        <div className="fixed inset-0 z-[90] flex h-[100dvh] justify-center p-0 sm:left-auto sm:right-6 sm:bottom-6 sm:top-auto sm:block sm:h-auto">
            <section
                ref={panelRef}
                tabIndex={-1}
                className="flex h-full w-full flex-col overflow-hidden border border-white/80 bg-gradient-to-b from-sky-50 via-cyan-50 to-blue-50 shadow-2xl shadow-blue-950/20 ring-1 ring-blue-100/70 dark:border-slate-700 dark:from-slate-950 dark:via-slate-900 dark:to-blue-950 sm:h-[calc(100dvh-3rem)] sm:max-h-[760px] sm:w-[440px] sm:rounded-[28px]"
                role="dialog"
                aria-modal={isDesktopDock ? 'false' : 'true'}
                aria-label={t('coach_title')}
                data-qa="career-coach-panel"
            >
                <div className="relative flex shrink-0 items-center justify-between px-5 pb-4 pt-5">
                    <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-blue-700 shadow-sm ring-1 ring-blue-100 dark:bg-slate-800 dark:text-blue-300 dark:ring-slate-700">
                            <Sparkles className="h-5 w-5" aria-hidden="true" />
                        </div>
                        <h3 className="truncate text-xl font-bold text-slate-950 dark:text-slate-50">{t('coach_title')}</h3>
                    </div>
                    <button type="button"
                        onClick={onClose}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-blue-700 transition hover:bg-white/80 hover:text-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-blue-300 dark:hover:bg-slate-800"
                        aria-label={t('coach_close_label')}
                    >
                        <X className="h-6 w-6" aria-hidden="true" />
                    </button>
                </div>

                {showWelcomePanel && (
                    <div className="relative shrink-0 px-5">
                        <div className="pointer-events-none absolute right-7 top-2 hidden h-20 w-28 -rotate-6 rounded-[22px] border border-blue-100 bg-white/80 p-3 opacity-80 shadow-lg shadow-blue-200/40 dark:border-slate-700 dark:bg-slate-800/80 md:block">
                            <div className="flex items-center gap-2">
                                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-white">
                                    <Briefcase className="h-4 w-4" aria-hidden="true" />
                                </div>
                                <div className="space-y-1">
                                    <div className="h-2 w-14 rounded-full bg-slate-900/80 dark:bg-slate-100/80" />
                                    <div className="h-2 w-10 rounded-full bg-blue-200 dark:bg-blue-900" />
                                </div>
                            </div>
                            <div className="mt-3 h-2 w-full rounded-full bg-cyan-100 dark:bg-slate-700" />
                            <div className="mt-2 h-2 w-20 rounded-full bg-cyan-100 dark:bg-slate-700" />
                        </div>

                        <div className="mt-6 rounded-[28px] border border-white/90 bg-white/55 p-5 shadow-sm ring-1 ring-white/60 backdrop-blur dark:border-slate-700 dark:bg-slate-900/70 dark:ring-slate-800 sm:mt-8">
                            <h4 className="max-w-[270px] whitespace-pre-line text-[26px] font-bold leading-tight tracking-normal text-slate-950 dark:text-slate-50 sm:text-[28px]">
                                {t('coach_panel_hero')}
                            </h4>

                            <div className="mt-6 flex flex-wrap gap-3">
                                {COACH_TOPICS.map((topic) => (
                                    <button
                                        key={topic.id}
                                        type="button"
                                        onClick={() => setActiveTopic(topic.id)}
                                        className={`rounded-full px-5 py-2.5 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                                            activeTopic === topic.id
                                                ? 'border border-blue-600 bg-white text-blue-700 shadow-sm dark:border-blue-400 dark:bg-slate-950 dark:text-blue-300'
                                                : 'border border-transparent bg-white/80 text-slate-800 hover:bg-white dark:bg-slate-800 dark:text-slate-200'
                                        }`}
                                    >
                                        {t(topic.labelKey)}
                                    </button>
                                ))}
                            </div>

                            {onLaunchTool && (
                                <div className="mt-4 grid grid-cols-2 gap-2">
                                    {([
                                        ['jobs', 'ws_nav_jobs'],
                                        ['resume', 'ws_nav_resume'],
                                        ['interview', 'ws_nav_interview'],
                                        ['plan', 'ws_nav_plan'],
                                    ] as const).map(([target, labelKey]) => (
                                        <button
                                            key={target}
                                            type="button"
                                            onClick={() => onLaunchTool(target)}
                                            className="group flex min-h-10 items-center justify-between rounded-full border border-blue-100 bg-white/80 px-3 py-2 text-left text-xs font-semibold text-slate-800 transition hover:-translate-y-0.5 hover:border-blue-200 hover:bg-white hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                                        >
                                            <span className="truncate">{t(labelKey)}</span>
                                            <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:text-blue-500 dark:text-slate-500" aria-hidden="true" />
                                        </button>
                                    ))}
                                </div>
                            )}

                            <div className="mt-5 space-y-3">
                                {activeTopicConfig.questions.map((questionKey) => (
                                    <button
                                        key={questionKey}
                                        type="button"
                                        onClick={() => void sendMessage(t(questionKey))}
                                        className="group flex w-full items-center gap-3 rounded-full bg-white px-4 py-4 text-left text-sm font-semibold text-slate-900 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:text-slate-100"
                                    >
                                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-700 text-white">
                                            <Hash className="h-4 w-4" aria-hidden="true" />
                                        </span>
                                        <span className="min-w-0 flex-1">{t(questionKey)}</span>
                                        <ChevronRight className="h-5 w-5 shrink-0 text-slate-200 transition group-hover:text-blue-400 dark:text-slate-600" aria-hidden="true" />
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                <div className={`min-h-0 flex-1 overflow-y-auto px-5 ${showWelcomePanel ? 'py-4' : 'py-5'}`}>
                    {!showWelcomePanel && (
                        <div className="space-y-4">
                            {messages.map((msg, index) => (
                                <div key={index} className={`flex items-end gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    {msg.role === 'model' && (
                                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-blue-700 shadow-sm ring-1 ring-blue-100 dark:bg-slate-800 dark:text-blue-300 dark:ring-slate-700">
                                            <Sparkles className="h-4 w-4" aria-hidden="true" />
                                        </div>
                                    )}
                                    <div className={`max-w-[82%] break-words rounded-[22px] px-4 py-3 text-sm leading-6 shadow-sm ${
                                        msg.role === 'user'
                                            ? 'rounded-br-md bg-blue-600 text-white'
                                            : 'rounded-bl-md border border-white/80 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'
                                    }`}>
                                        {msg.role === 'model' ? renderFormattedMessage(msg.content) : msg.content}
                                    </div>
                                    {msg.role === 'user' && (
                                        <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full">
                                            <Avatar url={profile?.avatar_url} size={32} />
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                    {isLoading && messages[messages.length - 1]?.role !== 'model' && (
                        <div className="mt-4 flex items-end gap-3 justify-start">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-blue-700 shadow-sm ring-1 ring-blue-100 dark:bg-slate-800 dark:text-blue-300 dark:ring-slate-700">
                                <Sparkles className="h-4 w-4" aria-hidden="true" />
                            </div>
                            <div className="rounded-[22px] rounded-bl-md border border-white/80 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
                                <div className="flex items-center justify-center space-x-1">
                                    <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:-0.3s]"></div>
                                    <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:-0.15s]"></div>
                                    <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400"></div>
                                </div>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                <footer className="shrink-0 px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-2">
                    <button
                        type="button"
                        onClick={() => void sendMessage(t('coach_feedback_prompt'))}
                        className="mb-3 inline-flex items-center rounded-full border border-blue-100 bg-white px-4 py-2 text-sm font-semibold text-blue-700 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-blue-300"
                    >
                        {t('coach_feedback_chip')}
                    </button>
                    <form onSubmit={handleSendMessage} className="flex min-h-16 items-center gap-3 rounded-[24px] bg-white px-4 py-3 shadow-lg shadow-blue-200/30 ring-1 ring-blue-100/80 dark:bg-slate-900 dark:shadow-none dark:ring-slate-700">
                        <Paperclip className="h-6 w-6 shrink-0 text-slate-400" aria-hidden="true" />
                        <input
                            type="text"
                            value={userInput}
                            onChange={(e) => setUserInput(e.target.value)}
                            placeholder={t('coach_input_placeholder')}
                            aria-label={t('coach_input_placeholder')}
                            className="min-w-0 flex-1 bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed dark:text-slate-100 dark:placeholder:text-slate-500"
                            disabled={isLoading}
                        />
                        <button
                            type="submit"
                            disabled={isLoading || !userInput.trim()}
                            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-blue-200 disabled:text-white dark:disabled:bg-blue-950"
                            aria-label={t('coach_send_label')}
                        >
                            <Send className="h-5 w-5" aria-hidden="true" />
                        </button>
                    </form>
                </footer>
            </section>
        </div>
    );
};

export default CareerCoachBot;
