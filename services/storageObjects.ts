import { deleteObject, getStorage, ref } from 'firebase/storage';
import { app } from '../lib/firebaseClient';

export const deleteStorageObject = async (path: string): Promise<void> => {
  if (!path) return;
  await deleteObject(ref(getStorage(app), path));
};

export const deleteStorageObjectBestEffort = async (path: string): Promise<void> => {
  try {
    await deleteStorageObject(path);
  } catch (error) {
    console.warn('Could not delete superseded Storage object:', { path, error });
  }
};
