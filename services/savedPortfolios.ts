/**
 * savedPortfolios - user-owned saved Showcase websites.
 * HTML lives in Storage so large generated pages do not hit Firestore's 1 MiB limit.
 */
import { collection, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadString } from 'firebase/storage';
import { firestoreDb, firebaseStorage } from '../lib/firebaseClient';
import { createSecureRandomToken } from '../lib/secureRandomId';

export interface SavedPortfolio {
  id: string;
  name: string;
  theme: string;
  html_path: string;
  resume_fingerprint: string;
  created_at: number;
  updated_at: number;
}

export interface SavePortfolioInput {
  name: string;
  theme: string;
  htmlContent: string;
  resumeFingerprint: string;
}

const MAX_HTML_BYTES = 9 * 1024 * 1024;

const toMillis = (value: unknown): number => {
  const ts = value as { toMillis?: () => number } | null | undefined;
  try {
    if (ts && typeof ts.toMillis === 'function') return ts.toMillis();
  } catch {
    /* ignore */
  }
  return Date.now();
};

const cleanName = (name: string): string => name.trim().replace(/\s+/g, ' ').slice(0, 160);

export const defaultPortfolioName = (date = new Date()): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `Portfolio - ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export async function listSavedPortfolios(uid: string): Promise<SavedPortfolio[]> {
  const snap = await getDocs(query(collection(firestoreDb, 'users', uid, 'portfolios'), orderBy('created_at', 'desc')));
  return snap.docs.map((item) => {
    const data = item.data();
    return {
      id: item.id,
      name: typeof data.name === 'string' ? data.name : defaultPortfolioName(),
      theme: typeof data.theme === 'string' ? data.theme : 'sapphire',
      html_path: typeof data.html_path === 'string' ? data.html_path : '',
      resume_fingerprint: typeof data.resume_fingerprint === 'string' ? data.resume_fingerprint : '',
      created_at: toMillis(data.created_at),
      updated_at: toMillis(data.updated_at),
    };
  }).filter((item) => item.html_path);
}

export async function savePortfolio(uid: string, input: SavePortfolioInput): Promise<SavedPortfolio> {
  if (!uid) throw new Error('A signed-in user is required.');
  const name = cleanName(input.name) || defaultPortfolioName();
  const size = new Blob([input.htmlContent]).size;
  if (!input.htmlContent.trim() || size > MAX_HTML_BYTES) {
    throw new Error('Portfolio HTML is too large to save.');
  }

  const id = createSecureRandomToken();
  const htmlPath = `portfolio-sites/${uid}/${id}/showcase.html`;
  const storageRef = ref(firebaseStorage, htmlPath);

  await uploadString(storageRef, input.htmlContent, 'raw', { contentType: 'text/html; charset=utf-8' });
  try {
    await setDoc(doc(firestoreDb, 'users', uid, 'portfolios', id), {
      version: 1,
      name,
      theme: input.theme || 'sapphire',
      html_path: htmlPath,
      resume_fingerprint: input.resumeFingerprint.slice(0, 80),
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });
  } catch (err) {
    await deleteObject(storageRef).catch(() => undefined);
    throw err;
  }

  const now = Date.now();
  return {
    id,
    name,
    theme: input.theme || 'sapphire',
    html_path: htmlPath,
    resume_fingerprint: input.resumeFingerprint.slice(0, 80),
    created_at: now,
    updated_at: now,
  };
}

export async function loadPortfolioHtml(htmlPath: string): Promise<string> {
  const url = await getDownloadURL(ref(firebaseStorage, htmlPath));
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) throw new Error('Could not load saved portfolio.');
  return response.text();
}

export async function deleteSavedPortfolio(uid: string, portfolio: SavedPortfolio): Promise<void> {
  if (!uid) return;
  await deleteDoc(doc(firestoreDb, 'users', uid, 'portfolios', portfolio.id));
  await deleteObject(ref(firebaseStorage, portfolio.html_path)).catch(() => undefined);
}
