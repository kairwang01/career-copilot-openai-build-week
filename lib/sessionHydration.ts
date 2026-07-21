/** Wait for an external auth store to restore persistence before reading it. */
export const resolveHydratedValue = async <T>(
  waitUntilReady: () => Promise<unknown>,
  readCurrent: () => T,
): Promise<T> => {
  await waitUntilReady();
  return readCurrent();
};
