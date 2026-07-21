import type { ResumeFileMeta } from '../services/resumeStorage';

export type ResumeFileCommitStage = 'profile-save';

export class ResumeFileCommitError extends Error {
  readonly stage: ResumeFileCommitStage;
  readonly cause: unknown;
  readonly cleanupError?: unknown;

  constructor(
    stage: ResumeFileCommitStage,
    message: string,
    cause: unknown,
    cleanupError?: unknown,
  ) {
    super(message);
    this.name = 'ResumeFileCommitError';
    this.stage = stage;
    this.cause = cause;
    this.cleanupError = cleanupError;
  }
}

interface ResumeFileReplacementInput {
  uid: string;
  file: File;
  previousPath: string | null;
  /** False when a newer selection won or the signed-in account changed. */
  isCurrent: () => boolean;
  uploadResume: (uid: string, file: File) => Promise<ResumeFileMeta>;
  saveProfile: (uid: string, meta: ResumeFileMeta) => Promise<void>;
  deleteResume: (path: string) => Promise<void>;
}

export type ResumeFileReplacementResult =
  | { status: 'saved'; meta: ResumeFileMeta }
  | { status: 'discarded'; meta: null };

/**
 * Commit a replacement as a small saga: upload -> persist the reference ->
 * remove the old object. A new object is compensated whenever it cannot become
 * the authoritative profile reference.
 */
export const commitResumeFileReplacement = async (
  input: ResumeFileReplacementInput,
): Promise<ResumeFileReplacementResult> => {
  const meta = await input.uploadResume(input.uid, input.file);

  if (!input.isCurrent()) {
    await input.deleteResume(meta.resume_file_path);
    return { status: 'discarded', meta: null };
  }

  try {
    await input.saveProfile(input.uid, meta);
  } catch (error) {
    let cleanupError: unknown;
    try {
      await input.deleteResume(meta.resume_file_path);
    } catch (deleteError) {
      cleanupError = deleteError;
    }
    throw new ResumeFileCommitError(
      'profile-save',
      'The uploaded resume reference could not be saved.',
      error,
      cleanupError,
    );
  }

  if (input.previousPath && input.previousPath !== meta.resume_file_path) {
    await input.deleteResume(input.previousPath);
  }

  return { status: 'saved', meta };
};

/**
 * A completed upload without a resolvable URL cannot be referenced by callers.
 * Delete it immediately, while retaining the original URL-resolution failure.
 */
export const resolveUploadedObjectUrl = async <TReference>(
  storageRef: TReference,
  getUrl: (reference: TReference) => Promise<string>,
  remove: (reference: TReference) => Promise<void>,
): Promise<string> => {
  try {
    return await getUrl(storageRef);
  } catch (error) {
    try {
      await remove(storageRef);
    } catch (cleanupError) {
      console.warn('Could not remove an upload whose URL resolution failed:', cleanupError);
    }
    throw error;
  }
};
