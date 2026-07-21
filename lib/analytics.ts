import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { firestoreDb } from './firebaseClient';
import type { Improvement } from '../types';

export async function logToolUsage(
  userId: string,
  toolKey: string,
  metadata: Record<string, unknown>,
): Promise<string | null> {
  try {
    const docRef = await addDoc(collection(firestoreDb, 'users', userId, 'tool_events'), {
      tool_key: toolKey,
      metadata,
      created_at: serverTimestamp(),
    });
    return docRef.id;
  } catch (err) {
    console.error('Error logging tool usage:', (err as Error).message);
    return null;
  }
}

export async function logResumeAnalysis(
  userId: string,
  eventId: string | null,
  analysis: {
    score: number;
    market_name: string;
    summary: string;
    strengths: string[];
    improvements: Improvement[];
    keywords: string[];
  },
): Promise<void> {
  try {
    await addDoc(collection(firestoreDb, 'users', userId, 'resume_analyses'), {
      event_id: eventId,
      score: analysis.score,
      market_name: analysis.market_name,
      summary: analysis.summary,
      strengths: analysis.strengths,
      improvements: analysis.improvements,
      keywords: analysis.keywords,
      created_at: serverTimestamp(),
    });
  } catch (err) {
    console.error('Error logging resume analysis:', (err as Error).message);
  }
}
