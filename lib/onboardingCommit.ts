import type { UserProfile } from '../types';
import type { ResumeFileMeta } from '../services/resumeStorage';

export type OnboardingCommitStage = 'consent' | 'profile-save';

export class OnboardingCommitError extends Error {
  readonly stage: OnboardingCommitStage;
  readonly cause: unknown;
  readonly cleanupError?: unknown;

  constructor(stage: OnboardingCommitStage, message: string, cause?: unknown, cleanupError?: unknown) {
    super(message);
    this.name = 'OnboardingCommitError';
    this.stage = stage;
    this.cause = cause;
    this.cleanupError = cleanupError;
  }
}

export interface OnboardingCommitDependencies {
  uploadResume: (uid: string, file: File) => Promise<ResumeFileMeta>;
  saveProfile: (uid: string, patch: Partial<UserProfile>) => Promise<void>;
  deleteResume: (path: string) => Promise<void>;
}

export interface OnboardingCommitInput {
  uid: string;
  consented: boolean;
  profilePatch: Partial<UserProfile>;
}

export interface OnboardingCommitResult {
  resumeFileMeta: ResumeFileMeta | null;
  resumeUploadError: unknown | null;
}

export interface OnboardingCommitter {
  stageResume: (file: File) => void;
  discardResume: () => void;
  commit: (input: OnboardingCommitInput) => Promise<OnboardingCommitResult>;
}

export const createOnboardingCommitter = (
  dependencies: OnboardingCommitDependencies,
): OnboardingCommitter => {
  let stagedResume: File | null = null;
  let commitPromise: Promise<OnboardingCommitResult> | null = null;

  const runCommit = async (input: OnboardingCommitInput): Promise<OnboardingCommitResult> => {
    const resumeToUpload = stagedResume;
    let resumeFileMeta: ResumeFileMeta | null = null;
    let resumeUploadError: unknown | null = null;
    if (resumeToUpload) {
      try {
        resumeFileMeta = await dependencies.uploadResume(input.uid, resumeToUpload);
      } catch (error) {
        // The reviewed text is the source of truth. Preserve the existing
        // best-effort original-file behavior while reporting partial failure.
        resumeUploadError = error;
      }
    }
    try {
      await dependencies.saveProfile(input.uid, {
        ...input.profilePatch,
        ...(resumeFileMeta ?? {}),
      });
    } catch (error) {
      let cleanupError: unknown;
      if (resumeFileMeta) {
        try {
          await dependencies.deleteResume(resumeFileMeta.resume_file_path);
        } catch (deleteError) {
          cleanupError = deleteError;
        }
      }
      throw new OnboardingCommitError(
        'profile-save',
        'The onboarding profile could not be saved.',
        error,
        cleanupError,
      );
    }
    return { resumeFileMeta, resumeUploadError };
  };

  return {
    stageResume(file) {
      stagedResume = file;
    },
    discardResume() {
      stagedResume = null;
    },
    commit(input) {
      if (!input.consented) {
        return Promise.reject(new OnboardingCommitError(
          'consent',
          'Onboarding data cannot be saved before the user consents.',
        ));
      }
      if (commitPromise) return commitPromise;

      const attempt = runCommit(input);
      commitPromise = attempt;
      void attempt.catch(() => {
        // A failed save can be retried; successful commits stay latched forever.
        if (commitPromise === attempt) commitPromise = null;
      });
      return attempt;
    },
  };
};
