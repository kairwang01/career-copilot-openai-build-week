export interface UploadedStorageObject {
  url: string;
  path: string;
}

export const firebaseStoragePathFromDownloadUrl = (
  downloadUrl: string | null | undefined,
  expectedPrefix: string,
): string | null => {
  if (!downloadUrl || !expectedPrefix) return null;
  try {
    const url = new URL(downloadUrl);
    const markerIndex = url.pathname.indexOf('/o/');
    if (markerIndex < 0) return null;
    const objectPath = decodeURIComponent(url.pathname.slice(markerIndex + 3));
    const normalizedPrefix = expectedPrefix.replace(/^\/+|\/+$/g, '');
    const segments = objectPath.split('/');
    if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return null;
    if (!objectPath.startsWith(`${normalizedPrefix}/`)) return null;
    return objectPath;
  } catch {
    return null;
  }
};

export interface PendingUploadTracker {
  current: () => UploadedStorageObject | null;
  replace: (upload: UploadedStorageObject) => Promise<void>;
  discard: () => Promise<void>;
  commit: (
    previousDownloadUrl: string | null | undefined,
    expectedPreviousPrefix: string,
  ) => Promise<UploadedStorageObject | null>;
}

/** Tracks an object uploaded before its owning form is saved. */
export const createPendingUploadTracker = (
  remove: (path: string) => Promise<void>,
): PendingUploadTracker => {
  let pending: UploadedStorageObject | null = null;

  return {
    current: () => pending,
    async replace(upload) {
      const superseded = pending;
      pending = upload;
      if (superseded && superseded.path !== upload.path) {
        await remove(superseded.path);
      }
    },
    async discard() {
      const discarded = pending;
      pending = null;
      if (discarded) await remove(discarded.path);
    },
    async commit(previousDownloadUrl, expectedPreviousPrefix) {
      const committed = pending;
      pending = null;
      if (!committed) return null;

      const previousPath = firebaseStoragePathFromDownloadUrl(
        previousDownloadUrl,
        expectedPreviousPrefix,
      );
      if (previousPath && previousPath !== committed.path) {
        await remove(previousPath);
      }
      return committed;
    },
  };
};
