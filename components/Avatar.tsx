import React, { useEffect, useId, useRef, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { deleteObject, getDownloadURL, getStorage, ref, uploadBytesResumable } from 'firebase/storage';
import { Loader2, Pencil, User } from 'lucide-react';
import { app } from '../lib/firebaseClient';
import { resolveUploadedObjectUrl } from '../lib/resumeFileCommit';
import { createSecureRandomToken } from '../lib/secureRandomId';
import {
  firebaseStoragePathFromDownloadUrl,
  type UploadedStorageObject,
} from '../lib/storageObjectLifecycle';
import { deleteStorageObjectBestEffort } from '../services/storageObjects';
import { useToast } from './Toast';

// A hung upload (storage CORS / bucket misconfig / rules not deployed) must never
// leave the button stuck on "Uploading…". This watchdog turns an indefinite hang
// into a visible, retryable error.
const UPLOAD_TIMEOUT_MS = 30000;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

interface AvatarProps {
  url: string | null;
  size: number;
  onUpload?: (upload: UploadedStorageObject) => boolean | void | Promise<boolean | void>;
  altText?: string;
  uploadLabel?: string;
  uploadingLabel?: string;
  selectImageMessage?: string;
  signInRequiredMessage?: string;
  maxSizeMessage?: string;
  timeoutMessage?: string;
  maxUploadBytes?: number;
  uploadControlClassName?: string;
  uploadIconClassName?: string;
  showUploadLabel?: boolean;
}

const Avatar: React.FC<AvatarProps> = ({
  url,
  size,
  onUpload,
  altText = 'Avatar',
  uploadLabel = 'Upload a new photo',
  uploadingLabel = 'Uploading...',
  selectImageMessage = 'You must select an image to upload.',
  signInRequiredMessage = 'You must be signed in to upload an avatar.',
  maxSizeMessage = 'Image must be smaller than 5 MB.',
  timeoutMessage = 'Upload timed out. Check your connection and try again.',
  maxUploadBytes = MAX_UPLOAD_BYTES,
  uploadControlClassName = 'p-2',
  uploadIconClassName = 'h-5 w-5',
  showUploadLabel = true,
}) => {
  const { addToast } = useToast();
  const inputId = useId();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setAvatarUrl(url && url.startsWith('http') ? url : null);
  }, [url]);

  const uploadAvatar = async (event: React.ChangeEvent<HTMLInputElement>) => {
    let uncommittedPath: string | null = null;
    try {
      setUploading(true);

      if (!event.target.files || event.target.files.length === 0) {
        throw new Error(selectImageMessage);
      }

      const auth = getAuth(app);
      const uid = auth.currentUser?.uid;
      if (!uid) throw new Error(signInRequiredMessage);

      const file = event.target.files[0];
      if (file.size >= maxUploadBytes) {
        throw new Error(maxSizeMessage);
      }
      const fileExt = file.name.split('.').pop();
      const fileName = `${createSecureRandomToken()}.${fileExt}`;
      const storage = getStorage(app);
      const objectPath = `avatars/${uid}/${fileName}`;
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
      const accepted = await onUpload?.({ url: downloadUrl, path: objectPath });
      if (accepted === false) {
        await deleteStorageObjectBestEffort(objectPath);
        uncommittedPath = null;
        return;
      }

      const previousPath = firebaseStoragePathFromDownloadUrl(avatarUrl, `avatars/${uid}`);
      setAvatarUrl(downloadUrl);
      uncommittedPath = null;
      if (previousPath && previousPath !== objectPath) {
        await deleteStorageObjectBestEffort(previousPath);
      }
    } catch (error) {
      if (uncommittedPath) await deleteStorageObjectBestEffort(uncommittedPath);
      addToast((error as Error).message, 'error');
    } finally {
      setUploading(false);
      // Reset so re-selecting the same file still fires onChange.
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <span className="flex flex-col items-center space-y-4">
      <span
        className="relative rounded-full bg-gray-200 block"
        style={{ height: size, width: size }}
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={altText}
            className="rounded-full object-cover"
            style={{ height: size, width: size }}
          />
        ) : (
          <span className="flex items-center justify-center rounded-full bg-gray-300" style={{ height: size, width: size }}>
            <User className="h-1/2 w-1/2 text-gray-500" aria-hidden="true" />
          </span>
        )}
        {onUpload && (
          <span className="absolute bottom-0 right-0">
            <label
              htmlFor={inputId}
              aria-label={uploading ? uploadingLabel : uploadLabel}
              className={`cursor-pointer bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-md inline-block transition-colors focus-within:outline-none focus-within:ring-2 focus-within:ring-blue-400/50 ${uploadControlClassName} ${uploading ? 'cursor-not-allowed opacity-75' : ''}`}
            >
              {uploading ? (
                <Loader2 className={`${uploadIconClassName} animate-spin`} aria-hidden="true" />
              ) : (
                <Pencil className={uploadIconClassName} aria-hidden="true" />
              )}
              <input
                ref={fileInputRef}
                className="sr-only"
                type="file"
                id={inputId}
                accept="image/*"
                onChange={uploadAvatar}
                disabled={uploading}
              />
            </label>
          </span>
        )}
      </span>
      {showUploadLabel && onUpload && (uploading || uploadLabel) && (
        <p className="text-sm text-gray-500">{uploading ? uploadingLabel : uploadLabel}</p>
      )}
    </span>
  );
};

export default Avatar;
