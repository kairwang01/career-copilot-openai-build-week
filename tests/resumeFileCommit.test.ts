import { describe, expect, it, vi } from 'vitest';
import {
  ResumeFileCommitError,
  commitResumeFileReplacement,
  resolveUploadedObjectUrl,
} from '../lib/resumeFileCommit';

const uploadedMeta = {
  resume_file_url: 'https://storage.example/new.pdf',
  resume_file_name: 'new.pdf',
  resume_file_path: 'resumes/user-1/new.pdf',
  resume_file_size: 123,
  resume_file_uploaded_at: '2026-07-13T12:00:00.000Z',
};

describe('resume file replacement commit', () => {
  it('persists the new reference before deleting the previous object', async () => {
    const events: string[] = [];
    const uploadResume = vi.fn(async () => {
      events.push('upload');
      return uploadedMeta;
    });
    const saveProfile = vi.fn(async () => { events.push('save'); });
    const deleteResume = vi.fn(async (path: string) => { events.push(`delete:${path}`); });

    const result = await commitResumeFileReplacement({
      uid: 'user-1',
      file: new File(['resume'], 'new.pdf', { type: 'application/pdf' }),
      previousPath: 'resumes/user-1/old.pdf',
      isCurrent: () => true,
      uploadResume,
      saveProfile,
      deleteResume,
    });

    expect(result).toEqual({ status: 'saved', meta: uploadedMeta });
    expect(events).toEqual([
      'upload',
      'save',
      'delete:resumes/user-1/old.pdf',
    ]);
  });

  it('deletes the newly uploaded object when the profile reference cannot be saved', async () => {
    const primaryError = new Error('profile unavailable');
    const deleteResume = vi.fn(async () => undefined);

    await expect(commitResumeFileReplacement({
      uid: 'user-1',
      file: new File(['resume'], 'new.pdf', { type: 'application/pdf' }),
      previousPath: 'resumes/user-1/old.pdf',
      isCurrent: () => true,
      uploadResume: vi.fn(async () => uploadedMeta),
      saveProfile: vi.fn(async () => { throw primaryError; }),
      deleteResume,
    })).rejects.toMatchObject({
      name: 'ResumeFileCommitError',
      stage: 'profile-save',
      cause: primaryError,
    });

    expect(deleteResume).toHaveBeenCalledTimes(1);
    expect(deleteResume).toHaveBeenCalledWith(uploadedMeta.resume_file_path);
    expect(deleteResume).not.toHaveBeenCalledWith('resumes/user-1/old.pdf');
  });

  it('cleans up a completed upload when the selection or account was superseded', async () => {
    let current = true;
    const deleteResume = vi.fn(async () => undefined);
    const saveProfile = vi.fn(async () => undefined);

    const result = await commitResumeFileReplacement({
      uid: 'user-1',
      file: new File(['resume'], 'new.pdf', { type: 'application/pdf' }),
      previousPath: null,
      isCurrent: () => current,
      uploadResume: vi.fn(async () => {
        current = false;
        return uploadedMeta;
      }),
      saveProfile,
      deleteResume,
    });

    expect(result).toEqual({ status: 'discarded', meta: null });
    expect(saveProfile).not.toHaveBeenCalled();
    expect(deleteResume).toHaveBeenCalledWith(uploadedMeta.resume_file_path);
  });

  it('retains the primary profile error when compensating deletion also fails', async () => {
    const primaryError = new Error('profile unavailable');
    const cleanupError = new Error('storage unavailable');

    let caught: unknown;
    try {
      await commitResumeFileReplacement({
        uid: 'user-1',
        file: new File(['resume'], 'new.pdf', { type: 'application/pdf' }),
        previousPath: null,
        isCurrent: () => true,
        uploadResume: vi.fn(async () => uploadedMeta),
        saveProfile: vi.fn(async () => { throw primaryError; }),
        deleteResume: vi.fn(async () => { throw cleanupError; }),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ResumeFileCommitError);
    expect(caught).toMatchObject({ cause: primaryError, cleanupError });
  });
});

describe('download URL resolution cleanup', () => {
  it('returns the URL without deleting a valid upload', async () => {
    const remove = vi.fn(async () => undefined);
    await expect(resolveUploadedObjectUrl(
      { path: uploadedMeta.resume_file_path },
      vi.fn(async () => uploadedMeta.resume_file_url),
      remove,
    )).resolves.toBe(uploadedMeta.resume_file_url);
    expect(remove).not.toHaveBeenCalled();
  });

  it('deletes an uploaded object when its download URL cannot be resolved', async () => {
    const primaryError = new Error('URL unavailable');
    const storageRef = { path: uploadedMeta.resume_file_path };
    const remove = vi.fn(async () => undefined);

    await expect(resolveUploadedObjectUrl(
      storageRef,
      vi.fn(async () => { throw primaryError; }),
      remove,
    )).rejects.toBe(primaryError);
    expect(remove).toHaveBeenCalledWith(storageRef);
  });
});
