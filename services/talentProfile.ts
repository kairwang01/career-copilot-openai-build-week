/**
 * talentProfile — load/save the candidate's reusable Talent Profile.
 * Stored at talent_profiles/{uid} (owner-only per firestore.rules). Employers
 * never read it directly; the Discover Talent / applicant flow reads it
 * server-side (Admin SDK).
 */
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { firestoreDb } from '../lib/firebaseClient';
import { emptyTalentProfile, type TalentProfile } from '../lib/talentProfile';

export async function loadTalentProfile(uid: string): Promise<TalentProfile> {
  // Throws on a real read failure (network / permission) so callers can tell a
  // genuine "no profile yet" (empty) apart from "couldn't read". Never silently
  // returns empty — a save would then persist that empty over the real profile.
  const snap = await getDoc(doc(firestoreDb, 'talent_profiles', uid));
  if (snap.exists()) {
    return { ...emptyTalentProfile(), ...(snap.data() as Partial<TalentProfile>) } as TalentProfile;
  }
  return emptyTalentProfile();
}

export async function saveTalentProfile(uid: string, profile: TalentProfile): Promise<void> {
  await setDoc(
    doc(firestoreDb, 'talent_profiles', uid),
    { ...profile, updated_at: new Date().toISOString() },
    { merge: false },
  );
}

/**
 * Withdraw discovery consent without rewriting the rest of the profile.
 *
 * This deliberately bypasses form-completeness validation: privacy opt-out must
 * remain available even when an older profile no longer satisfies the current
 * schema or the candidate has unsaved invalid edits.
 */
export async function withdrawTalentDiscoveryConsent(uid: string): Promise<void> {
  await setDoc(
    doc(firestoreDb, 'talent_profiles', uid),
    { discoverable: false, updated_at: new Date().toISOString() },
    { merge: true },
  );
}
