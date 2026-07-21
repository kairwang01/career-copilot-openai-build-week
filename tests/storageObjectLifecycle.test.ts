import { describe, expect, it, vi } from 'vitest';
import {
  createPendingUploadTracker,
  firebaseStoragePathFromDownloadUrl,
} from '../lib/storageObjectLifecycle';

describe('Firebase Storage download URL parsing', () => {
  it('extracts only an object inside the expected owner prefix', () => {
    const url = 'https://firebasestorage.googleapis.com/v0/b/demo.appspot.com/o/avatars%2Fuser-1%2Fphoto.png?alt=media&token=abc';
    expect(firebaseStoragePathFromDownloadUrl(url, 'avatars/user-1')).toBe('avatars/user-1/photo.png');
    expect(firebaseStoragePathFromDownloadUrl(url, 'avatars/user-2')).toBeNull();
  });

  it('supports emulator URLs and rejects malformed or traversal-like paths', () => {
    expect(firebaseStoragePathFromDownloadUrl(
      'http://127.0.0.1:9199/v0/b/demo/o/company-logos%2Fuser-1%2Flogo.png?alt=media',
      'company-logos/user-1',
    )).toBe('company-logos/user-1/logo.png');
    expect(firebaseStoragePathFromDownloadUrl('not a URL', 'avatars/user-1')).toBeNull();
    expect(firebaseStoragePathFromDownloadUrl(
      'https://firebasestorage.googleapis.com/v0/b/demo/o/avatars%2Fuser-1%2F..%2Fother.png',
      'avatars/user-1',
    )).toBeNull();
  });
});

describe('pending upload tracker', () => {
  it('cleans up a superseded pending object', async () => {
    const remove = vi.fn(async () => undefined);
    const tracker = createPendingUploadTracker(remove);
    await tracker.replace({ url: 'https://example.test/one', path: 'company-logos/user-1/one.png' });
    await tracker.replace({ url: 'https://example.test/two', path: 'company-logos/user-1/two.png' });

    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('company-logos/user-1/one.png');
    expect(tracker.current()).toEqual({
      url: 'https://example.test/two',
      path: 'company-logos/user-1/two.png',
    });
  });

  it('discards an uncommitted object on reset or unmount', async () => {
    const remove = vi.fn(async () => undefined);
    const tracker = createPendingUploadTracker(remove);
    await tracker.replace({ url: 'https://example.test/pending', path: 'company-logos/user-1/pending.png' });

    await tracker.discard();

    expect(remove).toHaveBeenCalledWith('company-logos/user-1/pending.png');
    expect(tracker.current()).toBeNull();
  });

  it('commits the pending object and removes the previously referenced object', async () => {
    const remove = vi.fn(async () => undefined);
    const tracker = createPendingUploadTracker(remove);
    await tracker.replace({
      url: 'https://example.test/new',
      path: 'company-logos/user-1/new.png',
    });
    const previousUrl = 'https://firebasestorage.googleapis.com/v0/b/demo/o/company-logos%2Fuser-1%2Fold.png?alt=media';

    const committed = await tracker.commit(previousUrl, 'company-logos/user-1');

    expect(committed?.path).toBe('company-logos/user-1/new.png');
    expect(remove).toHaveBeenCalledWith('company-logos/user-1/old.png');
    expect(remove).not.toHaveBeenCalledWith('company-logos/user-1/new.png');
    expect(tracker.current()).toBeNull();
  });
});
