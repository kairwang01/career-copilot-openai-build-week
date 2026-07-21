/**
 * portfolioDraft — persisted, user-reviewed text draft for the Showcase builder.
 * Stored at portfolio_drafts/{uid}. Images are intentionally excluded; headshots
 * and project images should use Storage, not a Firestore document.
 */
import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import { firestoreDb } from '../lib/firebaseClient';
import type { PortfolioContent } from '../types';

export interface PortfolioDraftDetails {
  tagline: string;
  bio: string;
  theme: string;
}

export interface PortfolioDraftProject {
  title: string;
  description: string;
  url: string;
  category: string;
}

export interface PortfolioDraftInput {
  resume_fingerprint: string;
  details: PortfolioDraftDetails;
  projects: PortfolioDraftProject[];
  content: PortfolioContent | null;
}

export interface PortfolioDraft extends PortfolioDraftInput {
  version: 1;
  updated_at: string;
}

const asRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const asString = (value: unknown, maxLength: number): string => (
  typeof value === 'string' ? value.slice(0, maxLength) : ''
);

const asList = (value: unknown): unknown[] => (
  Array.isArray(value) ? value : []
);

const normalizeDetails = (value: unknown): PortfolioDraftDetails => {
  const record = asRecord(value) ?? {};
  return {
    tagline: asString(record.tagline, 180),
    bio: asString(record.bio, 1200),
    theme: asString(record.theme, 40) || 'sapphire',
  };
};

const normalizeProject = (value: unknown): PortfolioDraftProject => {
  const record = asRecord(value) ?? {};
  return {
    title: asString(record.title, 160),
    description: asString(record.description, 800),
    url: asString(record.url, 2048),
    category: asString(record.category, 80) || 'Web',
  };
};

const normalizeContent = (value: unknown): PortfolioContent | null => {
  const record = asRecord(value);
  if (!record) return null;

  const socials = asRecord(record.socials) ?? {};

  return {
    fullName: asString(record.fullName, 160),
    firstName: asString(record.firstName, 80),
    lastName: asString(record.lastName, 80),
    contactEmail: asString(record.contactEmail, 320),
    contactPhone: asString(record.contactPhone, 80),
    contactLocation: asString(record.contactLocation, 180),
    socials: {
      linkedin: asString(socials.linkedin, 2048),
      github: asString(socials.github, 2048),
      twitter: asString(socials.twitter, 2048),
    },
    skills: asList(record.skills).slice(0, 12).map((skill) => {
      const item = asRecord(skill) ?? {};
      return {
        icon: asString(item.icon, 40),
        category: asString(item.category, 120),
        description: asString(item.description, 800),
      };
    }),
    experience: asList(record.experience).slice(0, 12).map((exp) => {
      const item = asRecord(exp) ?? {};
      return {
        date: asString(item.date, 80),
        title: asString(item.title, 160),
        company: asString(item.company, 160),
        description: asString(item.description, 1200),
      };
    }),
    projects: asList(record.projects).slice(0, 12).map(normalizeProject),
  };
};

export function portfolioDraftResumeFingerprint(resumeText: string): string {
  const normalized = resumeText.trim().replace(/\s+/g, ' ');
  let hash = 5381;
  for (let i = 0; i < normalized.length; i += 1) {
    hash = ((hash << 5) + hash) ^ normalized.charCodeAt(i);
  }
  return `${normalized.length}:${(hash >>> 0).toString(36)}`;
}

export async function loadPortfolioDraft(uid: string): Promise<PortfolioDraft | null> {
  const snap = await getDoc(doc(firestoreDb, 'portfolio_drafts', uid));
  if (!snap.exists()) return null;

  const data = snap.data();
  return {
    version: 1,
    resume_fingerprint: asString(data.resume_fingerprint, 80),
    details: normalizeDetails(data.details),
    projects: asList(data.projects).slice(0, 12).map(normalizeProject),
    content: normalizeContent(data.content),
    updated_at: asString(data.updated_at, 40),
  };
}

export async function savePortfolioDraft(uid: string, draft: PortfolioDraftInput): Promise<void> {
  await setDoc(
    doc(firestoreDb, 'portfolio_drafts', uid),
    {
      version: 1,
      ...draft,
      updated_at: new Date().toISOString(),
    },
    { merge: false },
  );
}

export async function deletePortfolioDraft(uid: string): Promise<void> {
  await deleteDoc(doc(firestoreDb, 'portfolio_drafts', uid));
}
