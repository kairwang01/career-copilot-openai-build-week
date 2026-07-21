import React, { useEffect, useState } from 'react';
import { Award } from 'lucide-react';
import { generateAgilePracticeTest } from '../../services/aiClient';
import type { AgilePracticeTestResult } from '../../types';
import StagedLoader from '../StagedLoader';
import { useCancellableLoading } from '../../hooks/useCancellableLoading';
import { SavedResultBar, ToolError } from './ToolUtils';
import { useToolResults } from '../../contexts/ToolResultsContext';

const AGILE_ROLES = [
    'Scrum Master', 'Product Owner', 'Developer / Engineer', 'Agile Coach', 'Cyber Security Analyst', 'Project / Program Manager', 'Business Analyst'
];
const AGILE_CERTIFICATIONS = [
    'PSM I (Professional Scrum Master)', 'CSM (Certified Scrum Master)', 'Disciplined Agile Scrum Master (DASM)',
    'PSPO I (Professional Scrum Product Owner)', 'CSPO (Certified Scrum Product Owner)', 'PSD (Professional Scrum Developer)',
    'CSD (Certified Scrum Developer)', 'SAFe 6 Agilist (SA)', 'PMI-ACP (Agile Certified Practitioner)', 'IIBA-AAC (Agile Analysis Certification)',
    'Certified DevSecOps Professional (CDP)', 'PMP (Project Management Professional)'
];

// (b) sample defaults
const SAMPLE_ROLE = 'Scrum Master';
const SAMPLE_CERT = 'PSM I (Professional Scrum Master)';

interface AgileCoachProps {
  onClose: () => void;
  t: (key: string) => string;
}

type SavedAgilePracticeTestResult = AgilePracticeTestResult & {
  agileRole?: string;
  certification?: string;
  generatedAt?: number;
  savedAnswers?: (number | null)[];
  savedQuestionIndex?: number;
  savedStage?: 'in_progress' | 'results';
};

const AgileCoach: React.FC<AgileCoachProps> = ({ onClose, t }) => {
  const { loading, begin, end, cancel } = useCancellableLoading();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SavedAgilePracticeTestResult | null>(null);
  const { canSave, saved, saveState, persist, clear } = useToolResults<SavedAgilePracticeTestResult>();
  const [fromSaved, setFromSaved] = useState(false);
  const [selectedAgileRole, setSelectedAgileRole] = useState<string>(AGILE_ROLES[0]);
  const [selectedCertification, setSelectedCertification] = useState<string>(AGILE_CERTIFICATIONS[0]);
  const [testStage, setTestStage] = useState<'setup' | 'in_progress' | 'results'>('setup');
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState<(number | null)[]>([]);
  const userAnswersRef = React.useRef<(number | null)[]>([]);

  useEffect(() => {
    if (!saved || result || !saved.result?.practiceQuestions?.length) return;
    const questionCount = saved.result.practiceQuestions.length;
    const restoredAnswers = Array.from({ length: questionCount }, (_, index) => {
      const answer = saved.result.savedAnswers?.[index];
      return typeof answer === 'number' ? answer : null;
    });
    const restoredIndex = Math.min(
      Math.max(saved.result.savedQuestionIndex ?? 0, 0),
      Math.max(questionCount - 1, 0),
    );
    setResult(saved.result);
    setFromSaved(true);
    setSelectedAgileRole(saved.result.agileRole || AGILE_ROLES[0]);
    setSelectedCertification(saved.result.certification || AGILE_CERTIFICATIONS[0]);
    userAnswersRef.current = restoredAnswers;
    setUserAnswers(restoredAnswers);
    setCurrentQuestionIndex(restoredIndex);
    setTestStage(saved.result.savedStage === 'results' ? 'results' : 'in_progress');
  }, [saved, result]);

  const persistProgress = (
    nextResult: SavedAgilePracticeTestResult,
    nextAnswers: (number | null)[],
    nextQuestionIndex: number,
    nextStage: 'in_progress' | 'results',
  ) => {
    persist({
      ...nextResult,
      savedAnswers: nextAnswers,
      savedQuestionIndex: nextQuestionIndex,
      savedStage: nextStage,
    });
  };

  const runTool = async (role: string, certification: string) => {
    const alive = begin();
    setError(null);
    setFromSaved(false);
    try {
      const apiResult = await generateAgilePracticeTest(role, certification);
      if (!alive()) return;
      // An empty question set is truthy — guard it so we don't render question[0]
      // (undefined) or divide by zero in the score. Route to the existing error path.
      if (!apiResult?.practiceQuestions?.length) {
        throw new Error(t('tool_agile_coach_no_questions_error'));
      }
      const nextResult: SavedAgilePracticeTestResult = {
        ...apiResult,
        agileRole: role,
        certification,
        generatedAt: Date.now(),
        savedAnswers: new Array(apiResult.practiceQuestions.length).fill(null),
        savedQuestionIndex: 0,
        savedStage: 'in_progress',
      };
      setResult(nextResult);
      const nextAnswers = new Array(nextResult.practiceQuestions.length).fill(null);
      userAnswersRef.current = nextAnswers;
      setUserAnswers(nextAnswers);
      setCurrentQuestionIndex(0);
      setTestStage('in_progress');
      persist(nextResult);
    } catch (err) {
      if (alive()) {
        setError(err instanceof Error ? err.message : t('unexpected_error'));
        setTestStage('setup');
      }
    } finally {
      if (alive()) end();
    }
  };

  const resetResult = () => {
    setResult(null);
    setFromSaved(false);
    setError(null);
    userAnswersRef.current = [];
    setUserAnswers([]);
    setCurrentQuestionIndex(0);
    setTestStage('setup');
  };

  const handleStartTest = () => runTool(selectedAgileRole, selectedCertification);
  const handleAnswerSelect = (optionIndex: number) => {
    if (!result) return;
    const nextAnswers = userAnswersRef.current.map((ans, i) => i === currentQuestionIndex ? optionIndex : ans);
    userAnswersRef.current = nextAnswers;
    setUserAnswers(nextAnswers);
    persistProgress(result, nextAnswers, currentQuestionIndex, testStage === 'results' ? 'results' : 'in_progress');
  };
  const handleNextQuestion = () => {
    if (result && currentQuestionIndex < result.practiceQuestions.length - 1) {
      const nextIndex = currentQuestionIndex + 1;
      setCurrentQuestionIndex(nextIndex);
      persistProgress(result, userAnswersRef.current, nextIndex, 'in_progress');
    }
  };
  const handlePreviousQuestion = () => {
    if (result && currentQuestionIndex > 0) {
      const nextIndex = currentQuestionIndex - 1;
      setCurrentQuestionIndex(nextIndex);
      persistProgress(result, userAnswersRef.current, nextIndex, 'in_progress');
    }
  };
  const handleSubmitTest = () => {
    if (result) persistProgress(result, userAnswersRef.current, currentQuestionIndex, 'results');
    setTestStage('results');
  };
  const handleRetakeTest = () => runTool(selectedAgileRole, selectedCertification);

  const renderSetup = () => (
    <div data-qa="agile-coach-tool" data-qa-tool-state="setup" className="space-y-4">
      {/* (a) INTRO CARD */}
      <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 px-4 py-3 text-sm text-slate-600 dark:text-slate-300 space-y-0.5">
        <p className="font-semibold text-slate-800 dark:text-slate-100">{t('tool_agile_coach_intro_title')}</p>
        <p>{t('tool_agile_coach_intro_desc')}</p>
      </div>

      {/* (b) SAMPLE FILL */}
      <div className="text-right">
        <button
          type="button"
          onClick={() => {
            setSelectedAgileRole(SAMPLE_ROLE);
            setSelectedCertification(SAMPLE_CERT);
          }}
          data-qa="agile-coach-try-example"
          className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
        >
          {t('tool_try_example')}
        </button>
      </div>

      <div>
        <label htmlFor="agile-role" className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('tool_agile_coach_role_label')}</label>
        <select id="agile-role" data-qa="agile-coach-role" value={selectedAgileRole} onChange={e => setSelectedAgileRole(e.target.value)} className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md">
          {AGILE_ROLES.map(role => <option key={role}>{role}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="agile-cert" className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('tool_agile_coach_cert_label')}</label>
        <select id="agile-cert" data-qa="agile-coach-cert" value={selectedCertification} onChange={e => setSelectedCertification(e.target.value)} className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md">
          {AGILE_CERTIFICATIONS.map(cert => <option key={cert}>{cert}</option>)}
        </select>
      </div>
      <button type="button" onClick={handleStartTest} data-qa="agile-coach-generate" disabled={loading} className="w-full bg-blue-700 hover:bg-blue-800 disabled:bg-blue-400 text-white font-bold py-2.5 px-4 rounded-lg">
        {loading ? t('tool_agile_coach_generating_button') : t('tool_agile_coach_start_button')}
      </button>
    </div>
  );

  const renderTestInProgress = () => {
    if (!result) return null;
    const currentQuestion = result.practiceQuestions[currentQuestionIndex];
    const answeredCount = userAnswers.filter(answer => answer !== null).length;
    const allQuestionsAnswered = answeredCount === result.practiceQuestions.length;
    const progress = Math.round(((currentQuestionIndex + 1) / result.practiceQuestions.length) * 100);
    return (
      <div data-qa="agile-coach-tool" data-qa-tool-state="in-progress" className="animate-fade-in space-y-5">
        <SavedResultBar
          t={t}
          canSave={canSave}
          isSaved={fromSaved}
          savedAt={saved?.savedAt ?? null}
            saveState={saveState}
          onTryNext={resetResult}
          onClearSaved={() => { clear(); setFromSaved(false); }}
        />
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/80">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 className="text-lg font-semibold leading-6 text-slate-950 dark:text-slate-100">{result.examTitle}</h4>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {t('tool_agile_coach_question_of').replace('{current}', String(currentQuestionIndex + 1)).replace('{total}', String(result.practiceQuestions.length))}
              </p>
            </div>
            <span className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-700 dark:border-orange-800/60 dark:bg-orange-900/20 dark:text-orange-300">
              {t('tool_agile_coach_answered').replace('{answered}', String(answeredCount)).replace('{total}', String(result.practiceQuestions.length))}
            </span>
          </div>
          <div className="mt-4 h-2 rounded-full bg-slate-100 dark:bg-slate-800" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label={t('tool_agile_coach_progress_label')}>
            <div className="h-full rounded-full bg-orange-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
          <p className="text-base font-semibold leading-7 text-slate-950 dark:text-slate-100">{currentQuestion.questionText}</p>
        </div>
        <div className="space-y-3">
          {currentQuestion.options.map((option, index) => (
            <button
              key={index}
              type="button"
              onClick={() => handleAnswerSelect(index)}
              data-qa={`agile-coach-option-${index}`}
              aria-pressed={userAnswers[currentQuestionIndex] === index}
              className={`flex min-h-14 w-full items-start rounded-xl border p-3 text-left text-sm leading-6 transition ${
                userAnswers[currentQuestionIndex] === index
                  ? 'border-blue-500 bg-blue-50 text-slate-950 shadow-sm ring-2 ring-blue-500/10 dark:border-blue-400 dark:bg-blue-950/40 dark:text-slate-100'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800'
              }`}
            >
              <span className={`mr-3 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                userAnswers[currentQuestionIndex] === index
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
              }`}>{String.fromCharCode(65 + index)}</span>
              <span>{option}</span>
            </button>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={handlePreviousQuestion}
            data-qa="agile-coach-previous"
            disabled={currentQuestionIndex === 0}
            className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {t('tool_agile_coach_previous_button')}
          </button>
          {!allQuestionsAnswered && currentQuestionIndex === result.practiceQuestions.length - 1 && (
            <span className="text-sm text-slate-500 dark:text-slate-400">{t('tool_agile_coach_complete_hint')}</span>
          )}
          {currentQuestionIndex < result.practiceQuestions.length - 1 ? (
            <button type="button" onClick={handleNextQuestion} data-qa="agile-coach-next" className="inline-flex min-h-10 items-center justify-center rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800">{t('tool_agile_coach_next_button')}</button>
          ) : (
            <button
              type="button"
              onClick={handleSubmitTest}
              data-qa="agile-coach-submit"
              disabled={!allQuestionsAnswered}
              className="inline-flex min-h-10 items-center justify-center rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-800 disabled:cursor-not-allowed disabled:bg-green-300 disabled:text-white/90 dark:disabled:bg-green-900/60"
            >
              {t('tool_agile_coach_submit_button')}
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderResults = () => {
    if (!result) return null;
    const correctAnswers = userAnswers.filter((answer, index) => answer === result.practiceQuestions[index].correctAnswerIndex).length;
    const total = result.practiceQuestions.length;
    const score = total > 0 ? (correctAnswers / total) * 100 : 0;
    return (
      <div data-qa="agile-coach-tool" data-qa-tool-state="results" className="animate-fade-in space-y-6">
        <SavedResultBar
          t={t}
          canSave={canSave}
          isSaved={fromSaved}
          savedAt={saved?.savedAt ?? null}
            saveState={saveState}
          onTryNext={resetResult}
          onClearSaved={() => { clear(); setFromSaved(false); }}
        />
        <div>
          <h4 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('tool_agile_coach_results_title')}</h4>
          <p data-qa="agile-coach-score" className="text-2xl font-semibold" style={{ color: score >= 70 ? '#16a34a' : '#dc2626' }}>{t('tool_agile_coach_score').replace('{score}', score.toFixed(0)).replace('{correct}', String(correctAnswers)).replace('{total}', String(result.practiceQuestions.length))}</p>
        </div>
        <div className="space-y-4">
          <h5 className="font-bold text-lg dark:text-gray-100">{t('tool_agile_coach_review_answers')}</h5>
          {result.practiceQuestions.map((q, index) => {
            const userAnswer = userAnswers[index];
            const isCorrect = userAnswer === q.correctAnswerIndex;
            return (
              <div key={index} className={`p-4 rounded-lg border ${isCorrect ? 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20' : 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20'}`}>
                <p className="font-semibold text-gray-800 dark:text-gray-100 mb-2">{index + 1}. {q.questionText}</p>
                <p className="text-sm dark:text-gray-300"><span className="font-bold">{t('tool_agile_coach_your_answer')}:</span> {userAnswer !== null ? q.options[userAnswer] : t('tool_agile_coach_not_answered')}</p>
                {!isCorrect && <p className="text-sm dark:text-gray-300"><span className="font-bold">{t('tool_agile_coach_correct_answer')}:</span> {q.options[q.correctAnswerIndex]}</p>}
                <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 p-2 bg-gray-100 dark:bg-slate-700 rounded-md"><span className="font-semibold">{t('tool_agile_coach_explanation')}:</span> {q.explanation}</p>
              </div>
            );
          })}
        </div>
        <div className="space-y-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/40 rounded-lg">
          <h5 className="font-bold text-lg text-blue-900 dark:text-blue-300">{t('tool_agile_coach_exam_tips')}</h5>
          <ul className="list-disc list-inside space-y-2 text-blue-800 dark:text-blue-300">
            {result.examTips.map((tip, i) => <li key={i}>{tip}</li>)}
          </ul>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button type="button" onClick={onClose} className="inline-flex min-h-10 w-full items-center justify-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">{t('tool_agile_coach_close_button')}</button>
          <button type="button" onClick={handleRetakeTest} data-qa="agile-coach-retake" className="inline-flex min-h-10 w-full items-center justify-center rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800">{t('tool_agile_coach_retake_button')}</button>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <StagedLoader
        title={t('tool_agile_coach_loader_title')}
        steps={[
          t('tool_agile_coach_loader_step1'),
          t('tool_agile_coach_loader_step2'),
          t('tool_agile_coach_loader_step3'),
        ]}
        onCancel={cancel}
        icon={<Award />}
        accent="orange"
      />
    );
  }

  if (error) {
    return (
      <ToolError
        message={error}
        onRetry={() => runTool(selectedAgileRole, selectedCertification)}
        retryLabel={t('tool_try_again')}
      />
    );
  }

  switch (testStage) {
    case 'in_progress': return renderTestInProgress();
    case 'results': return renderResults();
    case 'setup':
    default: return renderSetup();
  }
};

export default AgileCoach;
