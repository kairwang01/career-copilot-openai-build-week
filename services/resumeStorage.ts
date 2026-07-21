/**
 * resumeStorage — uploads the ORIGINAL resume file (PDF/DOCX/TXT/scan) to
 * Firebase Storage so the candidate keeps a downloadable copy of exactly what
 * they submitted, alongside the extracted `resume_text` we persist in Firestore
 * for the AI tools.
 *
 * Privacy: resume files are PII. Storage rules (storage.rules → resumes/{uid})
 * allow ONLY the owner to read/write/delete them. Employers never receive the
 * file — talent discovery serves server-extracted text via a Cloud Function.
 *
 * Mirrors the proven Avatar.tsx / CompanyLogo.tsx upload pattern
 * (uploadBytesResumable + timeout watchdog + getDownloadURL).
 */

import {
  deleteObject,
  getDownloadURL,
  getStorage,
  ref,
  uploadBytesResumable,
} from 'firebase/storage';
import { app } from '../lib/firebaseClient';
import {
  assertResumeFileAccepted,
  isSupportedResumeFile,
  MAX_RESUME_FILE_BYTES,
  ResumeFileValidationError,
} from '../lib/resumeFileValidation';
import { resolveUploadedObjectUrl } from '../lib/resumeFileCommit';
import { createSecureRandomToken } from '../lib/secureRandomId';

// Resumes can be larger and slower to upload than avatars, so allow more time.
const UPLOAD_TIMEOUT_MS = 60_000;
export const MAX_RESUME_BYTES = MAX_RESUME_FILE_BYTES; // Matches storage.rules.
export { isSupportedResumeFile };

export interface ResumeFileMeta {
  resume_file_url: string;
  resume_file_name: string;
  resume_file_path: string;
  resume_file_size: number;
  resume_file_uploaded_at: string;
}

const extensionOf = (name: string): string => {
  const parts = name.split('.');
  return parts.length > 1 ? parts.pop()!.toLowerCase() : '';
};

/**
 * Upload `file` to resumes/{uid}/{uuid}.{ext} and return the metadata to persist
 * on the user profile. Throws on oversize / unsupported / timeout / upload error.
 */
export const uploadResumeFile = async (uid: string, file: File): Promise<ResumeFileMeta> => {
  if (!uid) throw new Error('A signed-in user is required to save a resume file.');
  try {
    assertResumeFileAccepted(file);
  } catch (error) {
    if (error instanceof ResumeFileValidationError) throw error;
    throw new Error('Unsupported file type. Upload a PDF, DOCX, text, PNG, or JPEG file.');
  }

  const ext = extensionOf(file.name) || 'bin';
  const fileName = `${createSecureRandomToken()}.${ext}`;
  const path = `resumes/${uid}/${fileName}`;
  const storage = getStorage(app);
  const storageRef = ref(storage, path);

  const url = await new Promise<string>((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, file, {
      contentType: file.type || 'application/octet-stream',
    });
    // A hung upload (CORS / rules-not-deployed / bucket misconfig) must surface
    // as a retryable error, never an indefinite spinner.
    const timer = setTimeout(() => {
      task.cancel();
      reject(new Error('Upload timed out. Check your connection and try again.'));
    }, UPLOAD_TIMEOUT_MS);
    task.on(
      'state_changed',
      undefined,
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
      () => {
        clearTimeout(timer);
        resolveUploadedObjectUrl(task.snapshot.ref, getDownloadURL, deleteObject)
          .then(resolve)
          .catch(reject);
      },
    );
  });

  return {
    resume_file_url: url,
    resume_file_name: file.name.slice(0, 255),
    resume_file_path: path,
    resume_file_size: file.size,
    resume_file_uploaded_at: new Date().toISOString(),
  };
};

/** Best-effort delete of a previously-stored resume file (orphan cleanup on replace/remove). */
export const deleteResumeFile = async (path: string | null | undefined): Promise<void> => {
  if (!path) return;
  try {
    await deleteObject(ref(getStorage(app), path));
  } catch (err) {
    // Non-fatal: the file may already be gone, or rules may block it. The
    // authoritative state is the Firestore metadata, which we update regardless.
    console.warn('Could not delete previous resume file:', err);
  }
};
