// The order of an upload, kept apart so each way it can fail can be tested.
//
// Until the placement lands, nothing on the site points at the new photo, so
// any failure removes its row and its file. Once it lands the site does point
// at it, so nothing after that step may touch the new file: tidying up is best
// effort and can never undo the photo.

export type UploadOutcome =
  /** The photo is on the site. */
  | { status: "placed"; mediaId: string }
  /** The section changed while uploading. The new photo was taken back out. */
  | { status: "stale" }
  /** It failed before reaching the site, and nothing was left behind. */
  | { status: "failed" };

export interface UploadSteps {
  storeFile(): Promise<string>;
  insertRow(path: string): Promise<string>;
  /** Adds or swaps the placement. False means the section moved on. */
  place(mediaId: string): Promise<boolean>;
  deleteRow(mediaId: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  /** Cover flag and removal of the old photo. Failure here is harmless. */
  tidyUp(mediaId: string): Promise<void>;
}

async function quietly(step: () => Promise<void>) {
  try {
    await step();
  } catch {
    console.error("A photo clean-up step failed; the photo stays unused.");
  }
}

export async function runUpload(steps: UploadSteps): Promise<UploadOutcome> {
  let path: string | null = null;
  let mediaId: string | null = null;

  const rollBack = async () => {
    if (mediaId) await quietly(() => steps.deleteRow(mediaId!));
    if (path) await quietly(() => steps.deleteFile(path!));
  };

  try {
    path = await steps.storeFile();
    mediaId = await steps.insertRow(path);
    if (!(await steps.place(mediaId))) {
      await rollBack();
      return { status: "stale" };
    }
  } catch {
    await rollBack();
    return { status: "failed" };
  }

  await quietly(() => steps.tidyUp(mediaId!));
  return { status: "placed", mediaId };
}
