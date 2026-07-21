/**
 * application-messages client — send via the server-only callable, read the thread
 * live via Firestore (rules allow each party to read their own application's thread).
 */
import { httpsCallable } from 'firebase/functions';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { firebaseFunctions, firestoreDb } from '../lib/firebaseClient';
import { normalizeApplicationMessage, type ApplicationMessage, type MessageTemplateKey } from '../lib/applicationMessageNormalize';

export type { ApplicationMessage, MessageTemplateKey } from '../lib/applicationMessageNormalize';

const sendCallable = httpsCallable<
  { applicationId: string; body: string; templateKey?: string },
  { messageId: string; senderRole: 'employer' | 'candidate' }
>(firebaseFunctions, 'sendApplicationMessage');

export async function sendApplicationMessage(
  applicationId: string,
  body: string,
  templateKey?: MessageTemplateKey,
): Promise<{ messageId: string; senderRole: 'employer' | 'candidate' }> {
  const { data } = await sendCallable({ applicationId, body, templateKey });
  return data;
}

/** Live subscription to an application's message thread (oldest → newest). */
export function subscribeApplicationMessages(
  applicationId: string,
  viewer: { role: 'employer' | 'candidate'; uid: string },
  onMessages: (messages: ApplicationMessage[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  const participantField = viewer.role === 'employer' ? 'employer_id' : 'candidate_id';
  const q = query(
    collection(firestoreDb, 'application_messages'),
    where('application_id', '==', applicationId),
    where(participantField, '==', viewer.uid),
    orderBy('created_at', 'asc'),
  );
  return onSnapshot(
    q,
    (snap) => onMessages(snap.docs.map((d) => normalizeApplicationMessage(d.id, d.data()))),
    (error) => onError?.(error),
  );
}
