import React, { useEffect, useId, useRef, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { deleteObject, getDownloadURL, getStorage, ref, uploadBytesResumable } from 'firebase/storage';
import { Building2, Loader2, Pencil } from 'lucide-react';
import { app } from '../lib/firebaseClient';
import { resolveUploadedObjectUrl } from '../lib/resumeFileCommit';
import { createSecureRandomToken } from '../lib/secureRandomId';
import type { UploadedStorageObject } from '../lib/storageObjectLifecycle';
import { deleteStorageObjectBestEffort } from '../services/storageObjects';
import { useToast } from './Toast';

// Watchdog so a hung upload can never leave the control stuck on "Uploading…".
const UPLOAD_TIMEOUT_MS = 30000;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

interface CompanyLogoProps {
  url: string | null;
  size: number;
  onUpload?: (upload: UploadedStorageObject) => void | Promise<void>;
  altText?: string;
  uploadLabel?: string;
  uploadingLabel?: string;
  signInRequiredMessage?: string;
  maxSizeMessage?: string;
  timeoutMessage?: string;
}

const CompanyLogo: React.FC<CompanyLogoProps> = ({
  url,
  size,
  onUpload,
  altText = 'Company logo',
  uploadLabel = 'Upload logo',
  uploadingLabel = 'Uploading...',
  signInRequiredMessage = 'You must be signed in to upload a logo.',
  maxSizeMessage = 'Image must be smaller than 5 MB.',
  timeoutMessage = 'Upload timed out. Check your connection and try again.',
}) => {
  const { addToast } = useToast();
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const uploadId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLogoUrl(url && url.startsWith('http') ? url : null);
  }, [url]);

  const uploadLogo = async (event: React.ChangeEvent<HTMLInputElement>) => {
    let uncommittedPath: string | null = null;
    try {
      setUploading(true);

      if (!event.target.files || event.target.files.length === 0) {
        return;
      }

      const auth = getAuth(app);
      const uid = auth.currentUser?.uid;
      if (!uid) throw new Error(signInRequiredMessage);

      const file = event.target.files[0];
      if (file.size >= MAX_UPLOAD_BYTES) {
        throw new Error(maxSizeMessage);
      }
      const fileExt = file.name.split('.').pop();
      const filePath = `${createSecureRandomToken()}.${fileExt}`;
      const storage = getStorage(app);
      const objectPath = `company-logos/${uid}/${filePath}`;
      const storageRef = ref(storage, objectPath);

      const downloadUrl = await new Promise<string>((resolve, reject) => {
        const task = uploadBytesResumable(storageRef, file, { contentType: file.type });
        const timer = setTimeout(() => {
          task.cancel();
          reject(new Error(timeoutMessage));
        }, UPLOAD_TIMEOUT_MS);
        task.on(
          'state_changed',
          undefined,
          (err) => { clearTimeout(timer); reject(err); },
          () => {
            clearTimeout(timer);
            resolveUploadedObjectUrl(task.snapshot.ref, getDownloadURL, deleteObject)
              .then(resolve)
              .catch(reject);
          },
        );
      });

      uncommittedPath = objectPath;
      await onUpload?.({ url: downloadUrl, path: objectPath });
      setLogoUrl(downloadUrl);
      uncommittedPath = null;
    } catch (error) {
      if (uncommittedPath) await deleteStorageObjectBestEffort(uncommittedPath);
      addToast((error as Error).message, 'error');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="relative rounded-xl border border-gray-200 bg-gray-50 shadow-sm dark:border-gray-700 dark:bg-gray-900"
        style={{ height: size, width: size }}
      >
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={altText}
            className="rounded-xl object-contain"
            style={{ height: size, width: size }}
          />
        ) : (
          <div className="flex items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800" style={{ height: size, width: size }}>
            <Building2 className="h-1/2 w-1/2 text-gray-400 dark:text-gray-500" aria-hidden="true" />
          </div>
        )}
        {onUpload && (
          <div className="absolute -bottom-3 -right-3">
            <label
              htmlFor={uploadId}
              aria-label={uploadLabel}
              className={`inline-flex cursor-pointer rounded-full bg-blue-600 p-2 text-white shadow-md transition-colors hover:bg-blue-700 focus-within:ring-2 focus-within:ring-blue-400/40 ${
                uploading ? 'pointer-events-none opacity-70' : ''
              }`}
            >
              {uploading ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Pencil className="h-5 w-5" aria-hidden="true" />}
            </label>
            <input
              ref={fileInputRef}
              className="sr-only"
              type="file"
              id={uploadId}
              accept="image/*"
              onChange={uploadLogo}
              disabled={uploading}
            />
          </div>
        )}
      </div>
      {onUpload && (
        <p className="text-sm text-gray-500 dark:text-gray-400">{uploading ? uploadingLabel : uploadLabel}</p>
      )}
    </div>
  );
};

export default CompanyLogo;
