import { beforeEach, describe, expect, it, vi } from 'vitest';

const { callableInvoke, httpsCallableMock } = vi.hoisted(() => {
  const invoke = vi.fn();
  return {
    callableInvoke: invoke,
    httpsCallableMock: vi.fn(() => invoke),
  };
});

vi.mock('firebase/functions', () => ({ httpsCallable: httpsCallableMock }));
vi.mock('../lib/firebaseClient', () => ({ firebaseFunctions: {} }));

import {
  careerCoach,
  evaluateInterviewAnswer,
  evaluateInterviewSession,
  extractTextFromUrl,
  generateInterviewQuestions,
  generateProfessionalHeadshot,
  listJobApplicants,
} from '../services/aiClient';

const coachResult = { data: { reply: 'Keep going.' } };

beforeEach(() => {
  callableInvoke.mockReset().mockResolvedValue(coachResult);
  httpsCallableMock.mockClear();
});

describe('dedicated AI client request wiring', () => {
  it('shares one requestId for concurrent identical career coach turns', async () => {
    let resolveCall!: (value: typeof coachResult) => void;
    callableInvoke.mockImplementation(() => new Promise((resolve) => { resolveCall = resolve; }));
    const payload = {
      messages: [{ role: 'user' as const, content: 'How should I prepare?' }],
      role: 'candidate' as const,
    };

    const first = careerCoach(payload);
    const replay = careerCoach(payload);

    expect(httpsCallableMock).toHaveBeenCalledWith({}, 'careerCoach', { timeout: 190_000 });
    expect(callableInvoke).toHaveBeenCalledTimes(1);
    expect(callableInvoke).toHaveBeenCalledWith(expect.objectContaining({
      messages: payload.messages,
      requestId: expect.stringMatching(/^career_coach_[A-Za-z0-9._:-]{8,}$/),
    }));

    resolveCall(coachResult);
    await expect(Promise.all([first, replay])).resolves.toEqual(['Keep going.', 'Keep going.']);
  });

  it('shares one requestId for concurrent identical answer evaluations', async () => {
    const evaluationResult = {
      data: { score: 8, strengths: ['Clear'], improvements: ['Add metrics'], modelAnswer: 'Example' },
    };
    let resolveCall!: (value: typeof evaluationResult) => void;
    callableInvoke.mockImplementation(() => new Promise((resolve) => { resolveCall = resolve; }));

    const first = evaluateInterviewAnswer('Why this role?', 'I enjoy the work.', 'Build TypeScript systems.');
    const replay = evaluateInterviewAnswer('Why this role?', 'I enjoy the work.', 'Build TypeScript systems.');

    expect(callableInvoke).toHaveBeenCalledTimes(1);
    expect(callableInvoke).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'evaluate',
      question: 'Why this role?',
      requestId: expect.stringMatching(/^mock_interview_evaluate_[A-Za-z0-9._:-]{8,}$/),
    }));

    resolveCall(evaluationResult);
    await expect(Promise.all([first, replay])).resolves.toEqual([evaluationResult.data, evaluationResult.data]);
  });

  it('shares one requestId for concurrent identical session evaluations', async () => {
    const sessionResult = {
      data: {
        locked: false as const,
        overallScore: 8,
        verdict: 'Hire',
        summary: 'Solid interview.',
        strengths: ['Clear'],
        improvements: ['More detail'],
        perQuestion: [],
      },
    };
    let resolveCall!: (value: typeof sessionResult) => void;
    callableInvoke.mockImplementation(() => new Promise((resolve) => { resolveCall = resolve; }));
    const qa = [{ question: 'Tell me about yourself.', answer: 'I build web apps.' }];

    const first = evaluateInterviewSession(qa, 'Build TypeScript systems.', 'Experienced engineer.');
    const replay = evaluateInterviewSession(qa, 'Build TypeScript systems.', 'Experienced engineer.');

    expect(callableInvoke).toHaveBeenCalledTimes(1);
    expect(callableInvoke).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'evaluate_session',
      qa,
      requestId: expect.stringMatching(/^mock_interview_session_[A-Za-z0-9._:-]{8,}$/),
    }));

    resolveCall(sessionResult);
    await expect(Promise.all([first, replay])).resolves.toEqual([sessionResult.data, sessionResult.data]);
  });

  it('shares one requestId for concurrent extraction of the same URL', async () => {
    const extractionResult = { data: { extractedText: 'Page text' } };
    let resolveCall!: (value: typeof extractionResult) => void;
    callableInvoke.mockImplementation(() => new Promise((resolve) => { resolveCall = resolve; }));

    const first = extractTextFromUrl('https://example.com/job');
    const replay = extractTextFromUrl('https://example.com/job');

    expect(callableInvoke).toHaveBeenCalledTimes(1);
    expect(callableInvoke).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://example.com/job',
      requestId: expect.stringMatching(/^extract_url_[A-Za-z0-9._:-]{8,}$/),
    }));

    resolveCall(extractionResult);
    await expect(Promise.all([first, replay])).resolves.toEqual([extractionResult.data, extractionResult.data]);
  });

  it('shares one requestId for concurrent generation from the same headshot source', async () => {
    const headshotResult = { data: { images: [{ data: 'generated', mimeType: 'image/png' }] } };
    let resolveCall!: (value: typeof headshotResult) => void;
    callableInvoke.mockImplementation(() => new Promise((resolve) => { resolveCall = resolve; }));

    const first = generateProfessionalHeadshot('base64-source');
    const replay = generateProfessionalHeadshot('base64-source');

    expect(callableInvoke).toHaveBeenCalledTimes(1);
    expect(callableInvoke).toHaveBeenCalledWith(expect.objectContaining({
      imageBase64: 'base64-source',
      requestId: expect.stringMatching(/^headshot_[A-Za-z0-9._:-]{8,}$/),
    }));

    resolveCall(headshotResult);
    await expect(Promise.all([first, replay])).resolves.toEqual([headshotResult.data.images, headshotResult.data.images]);
  });

  it('keeps mock interview generation on one requestId per in-flight session', async () => {
    const questionsResult = { data: { questions: [{ question: 'Why us?', category: 'fit', tip: 'Be specific.' }] } };
    let resolveCall!: (value: typeof questionsResult) => void;
    callableInvoke.mockImplementation(() => new Promise((resolve) => { resolveCall = resolve; }));

    const first = generateInterviewQuestions('Resume', 'Job', 'Canada');
    const replay = generateInterviewQuestions('Resume', 'Job', 'Canada');

    expect(callableInvoke).toHaveBeenCalledTimes(1);
    expect(callableInvoke).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'generate',
      requestId: expect.stringMatching(/^mock_interview_[A-Za-z0-9._:-]{8,}$/),
    }));

    resolveCall(questionsResult);
    await expect(Promise.all([first, replay])).resolves.toEqual([questionsResult.data.questions, questionsResult.data.questions]);
  });

  it('keeps applicant analysis on one requestId per identical in-flight listing', async () => {
    const applicantsResult = { data: { applicants: [], total: 0 } };
    let resolveCall!: (value: typeof applicantsResult) => void;
    callableInvoke.mockImplementation(() => new Promise((resolve) => { resolveCall = resolve; }));

    const first = listJobApplicants('job-123', { includeAnalysis: true });
    const replay = listJobApplicants('job-123', { includeAnalysis: true });

    expect(callableInvoke).toHaveBeenCalledTimes(1);
    expect(callableInvoke).toHaveBeenCalledWith(expect.objectContaining({
      jobId: 'job-123',
      includeAnalysis: true,
      requestId: expect.stringMatching(/^list_job_applicants_[A-Za-z0-9._:-]{8,}$/),
    }));

    resolveCall(applicantsResult);
    await expect(Promise.all([first, replay])).resolves.toEqual([applicantsResult.data, applicantsResult.data]);
  });

  it('omits the model field entirely in platform-managed mode', async () => {
    // The callable encoder serializes undefined to null, and the hardened
    // mockInterview handler rejects a null model with invalid-argument —
    // which blocked every interview until the field was omitted instead.
    const questionsResult = { data: { questions: [] } };
    callableInvoke.mockResolvedValue(questionsResult);

    await generateInterviewQuestions('Resume text.', 'Job description.', 'Canada');

    expect(callableInvoke).toHaveBeenCalledTimes(1);
    const payload = callableInvoke.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.mode).toBe('generate');
    expect('model' in payload).toBe(false);

    callableInvoke.mockResolvedValue({ data: { text: 'Extracted.' } });
    await extractTextFromUrl('https://example.com/posting');
    const extractPayload = callableInvoke.mock.calls[1][0] as Record<string, unknown>;
    expect('model' in extractPayload).toBe(false);
  });
});
