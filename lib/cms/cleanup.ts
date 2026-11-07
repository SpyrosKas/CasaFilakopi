// Removes uploads that were started and never finished. finishUpload removes
// its own temporary file, so only an upload abandoned part way reaches here,
// such as a phone losing its connection.

export const TEMP_PREFIX = "cms";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PAGE = 1000;

interface StoredEntry {
  name: string;
  /** Null for a folder. */
  id: string | null;
  created_at: string | null;
}

interface Result<T> {
  data: T | null;
  error: { message: string } | null;
}

export interface TempStorage {
  list(
    path: string,
    options: { limit: number },
  ): PromiseLike<Result<StoredEntry[]>>;
  remove(paths: string[]): PromiseLike<Result<unknown>>;
}

export async function removeOldUploads(
  storage: TempStorage,
  nowMs: number,
): Promise<number> {
  const { data: folders, error } = await storage.list(TEMP_PREFIX, {
    limit: PAGE,
  });
  if (error) throw new Error(error.message);

  let removed = 0;
  for (const folder of folders ?? []) {
    if (folder.id !== null) continue;
    const prefix = `${TEMP_PREFIX}/${folder.name}`;
    const { data: files, error: listError } = await storage.list(prefix, {
      limit: PAGE,
    });
    if (listError) throw new Error(listError.message);

    const old = (files ?? [])
      .filter(
        (file) =>
          file.id !== null &&
          file.created_at !== null &&
          nowMs - new Date(file.created_at).getTime() > MAX_AGE_MS,
      )
      .map((file) => `${prefix}/${file.name}`);
    if (old.length === 0) continue;

    const { error: removeError } = await storage.remove(old);
    if (removeError) throw new Error(removeError.message);
    removed += old.length;
  }
  return removed;
}
