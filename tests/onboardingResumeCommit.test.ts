import { describe, expect, it, vi } from 'vitest';
import { createOnboardingCommitter } from '../lib/onboardingCommit';

describe('onboarding resume commit', () => {
  it('keeps a staged resume local when completion has not been consented to', async () => {
    const uploadResume = vi.fn();
    const saveProfile = vi.fn();
    const deleteResume = vi.fn();
    const committer = createOnboardingCommitter({ uploadResume, saveProfile, deleteResume });
    const resume = new File(['resume'], 'candidate.pdf', { type: 'application/pdf' });

    committer.stageResume(resume);

    await expect(committer.commit({ uid: 'candidate-1', consented: false, profilePatch: {} }))
      .rejects.toMatchObject({ stage: 'consent' });
    expect(uploadResume).not.toHaveBeenCalled();
    expect(saveProfile).not.toHaveBeenCalled();
    expect(deleteResume).not.toHaveBeenCalled();
  });

  it('never uploads a staged resume after it is discarded', async () => {
    const uploadResume = vi.fn();
    const saveProfile = vi.fn(async () => undefined);
    const deleteResume = vi.fn();
    const committer = createOnboardingCommitter({ uploadResume, saveProfile, deleteResume });
    committer.stageResume(new File(['resume'], 'candidate.pdf', { type: 'application/pdf' }));

    committer.discardResume();
    const result = await committer.commit({
      uid: 'candidate-1',
      consented: true,
      profilePatch: { full_name: 'Ada Lovelace' },
    });

    expect(uploadResume).not.toHaveBeenCalled();
    expect(saveProfile).toHaveBeenCalledWith('candidate-1', { full_name: 'Ada Lovelace' });
    expect(result).toEqual({ resumeFileMeta: null, resumeUploadError: null });
    expect(deleteResume).not.toHaveBeenCalled();
  });

  it('uploads a staged resume only as part of an explicitly consented profile save', async () => {
    const meta = {
      resume_file_url: 'https://storage.invalid/new-resume',
      resume_file_name: 'candidate.pdf',
      resume_file_path: 'resumes/candidate-1/new-resume.pdf',
      resume_file_size: 6,
      resume_file_uploaded_at: '2026-07-13T19:00:00.000Z',
    };
    const uploadResume = vi.fn(async () => meta);
    const saveProfile = vi.fn(async () => undefined);
    const deleteResume = vi.fn(async () => undefined);
    const committer = createOnboardingCommitter({ uploadResume, saveProfile, deleteResume });
    const resume = new File(['resume'], 'candidate.pdf', { type: 'application/pdf' });

    committer.stageResume(resume);
    const result = await committer.commit({
      uid: 'candidate-1',
      consented: true,
      profilePatch: { full_name: 'Ada Lovelace', resume_text: 'Reviewed resume text' },
    });

    expect(uploadResume).toHaveBeenCalledWith('candidate-1', resume);
    expect(saveProfile).toHaveBeenCalledWith('candidate-1', {
      full_name: 'Ada Lovelace',
      resume_text: 'Reviewed resume text',
      ...meta,
    });
    expect(result).toEqual({ resumeFileMeta: meta, resumeUploadError: null });
    expect(deleteResume).not.toHaveBeenCalled();
  });

  it('still saves reviewed resume text when the optional original-file upload fails', async () => {
    const uploadError = new Error('storage unavailable');
    const uploadResume = vi.fn(async () => { throw uploadError; });
    const saveProfile = vi.fn(async () => undefined);
    const deleteResume = vi.fn(async () => undefined);
    const committer = createOnboardingCommitter({ uploadResume, saveProfile, deleteResume });
    committer.stageResume(new File(['resume'], 'candidate.pdf', { type: 'application/pdf' }));

    const result = await committer.commit({
      uid: 'candidate-1',
      consented: true,
      profilePatch: { full_name: 'Ada Lovelace', resume_text: 'Reviewed resume text' },
    });

    expect(saveProfile).toHaveBeenCalledWith('candidate-1', {
      full_name: 'Ada Lovelace',
      resume_text: 'Reviewed resume text',
    });
    expect(result).toEqual({ resumeFileMeta: null, resumeUploadError: uploadError });
    expect(deleteResume).not.toHaveBeenCalled();
  });

  it('deletes only the newly uploaded object when the profile save fails', async () => {
    const meta = {
      resume_file_url: 'https://storage.invalid/new-resume',
      resume_file_name: 'candidate.pdf',
      resume_file_path: 'resumes/candidate-1/new-resume.pdf',
      resume_file_size: 6,
      resume_file_uploaded_at: '2026-07-13T19:00:00.000Z',
    };
    const profileError = new Error('profile write denied');
    const uploadResume = vi.fn(async () => meta);
    const saveProfile = vi.fn(async () => { throw profileError; });
    const deleteResume = vi.fn(async () => undefined);
    const committer = createOnboardingCommitter({ uploadResume, saveProfile, deleteResume });
    committer.stageResume(new File(['resume'], 'candidate.pdf', { type: 'application/pdf' }));

    await expect(committer.commit({
      uid: 'candidate-1',
      consented: true,
      profilePatch: {
        resume_text: 'Reviewed resume text',
        resume_file_path: 'resumes/candidate-1/existing-resume.pdf',
      },
    })).rejects.toMatchObject({ stage: 'profile-save', cause: profileError });

    expect(deleteResume).toHaveBeenCalledOnce();
    expect(deleteResume).toHaveBeenCalledWith('resumes/candidate-1/new-resume.pdf');
    expect(deleteResume).not.toHaveBeenCalledWith('resumes/candidate-1/existing-resume.pdf');
  });

  it('shares one synchronous in-flight commit when completion is double-clicked', async () => {
    const meta = {
      resume_file_url: 'https://storage.invalid/new-resume',
      resume_file_name: 'candidate.pdf',
      resume_file_path: 'resumes/candidate-1/new-resume.pdf',
      resume_file_size: 6,
      resume_file_uploaded_at: '2026-07-13T19:00:00.000Z',
    };
    let resolveUpload!: (value: typeof meta) => void;
    const uploadResume = vi.fn(() => new Promise<typeof meta>((resolve) => {
      resolveUpload = resolve;
    }));
    const saveProfile = vi.fn(async () => undefined);
    const deleteResume = vi.fn(async () => undefined);
    const committer = createOnboardingCommitter({ uploadResume, saveProfile, deleteResume });
    committer.stageResume(new File(['resume'], 'candidate.pdf', { type: 'application/pdf' }));
    const input = {
      uid: 'candidate-1',
      consented: true,
      profilePatch: { resume_text: 'Reviewed resume text' },
    };

    const first = committer.commit(input);
    const second = committer.commit(input);

    expect(second).toBe(first);
    expect(uploadResume).toHaveBeenCalledOnce();
    resolveUpload(meta);
    await expect(Promise.all([first, second])).resolves.toEqual([
      { resumeFileMeta: meta, resumeUploadError: null },
      { resumeFileMeta: meta, resumeUploadError: null },
    ]);
    expect(saveProfile).toHaveBeenCalledOnce();
  });
});
