"use server";

import type { CmsStrings } from "@/lib/cms/strings";
import { adminI18n } from "@/lib/admin/i18n-server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireOwner, type AdminContext } from "@/lib/admin/session";
import { loadCollection, loadUnused, type PhotoItem } from "@/lib/cms/data";
import {
  processPhoto,
  UnreadablePhotoError,
  type ProcessedPhoto,
} from "@/lib/cms/image-process";
import { MEDIA_BUCKET, SITE_PREFIX } from "@/lib/cms/media-url";
import { collectionName, findCollection } from "@/lib/cms/registry";
import { refreshPublicPages } from "@/lib/cms/refresh";
import {
  altSchema,
  focusSchema,
  deleteSchema,
  finishUploadSchema,
  placementSchema,
  reorderSchema,
  startUploadSchema,
} from "@/lib/cms/schemas";
import { runUpload, type UploadSteps } from "@/lib/cms/upload-flow";
import { createAdminClient } from "@/lib/db/admin";

// Photo changes go live when saved: media has no draft, so each action refreshes
// the public pages that show the photo.
//
// Uploads go from the browser straight to a private bucket, because a phone
// photo is larger than a server action may receive. The server then reads the
// file, rebuilds it without metadata, and only that clean copy reaches the
// public bucket. The unprocessed file is never public, even for a moment.

const TEMP_BUCKET = "uploads-private";
const CACHE_SECONDS = "31536000";
const UNIQUE_VIOLATION = "23505";

export type PhotoResult =
  | { ok: true; items: PhotoItem[]; message?: string }
  | { ok: false; message: string };

const failure =
  (t: CmsStrings) =>
  (message: string = t.common.somethingWrong): PhotoResult => ({
    ok: false,
    message,
  });

/**
 * The private bucket has no policies, so it needs the secret key, and the
 * secret key skips the MFA check. So the database confirms the role first.
 */
async function secretStorage(admin: AdminContext) {
  const { data: role, error } = await admin.supabase.rpc("current_admin_role");
  if (error || role !== "owner") throw new Error("not_authorised");
  return createAdminClient().storage.from(TEMP_BUCKET);
}

function pagesOf(collections: string[]): string[] {
  return collections.flatMap((id) => findCollection(id)?.pages ?? []);
}

function refreshAdmin() {
  revalidatePath("/admin/photos", "layout");
}

async function collectionsOf(admin: AdminContext, mediaId: string) {
  const { data, error } = await admin.supabase
    .from("media_placements")
    .select("collection")
    .eq("media_id", mediaId);
  if (error) throw error;
  return data.map((row) => row.collection);
}

async function placesUsing(admin: AdminContext, mediaId: string) {
  const { data, error } = await admin.supabase
    .from("places")
    .select("id")
    .eq("media_id", mediaId);
  if (error) throw error;
  return data;
}

const sectionResult = async (
  admin: AdminContext,
  collection: string,
  message?: string,
): Promise<PhotoResult> => ({
  ok: true,
  items: await loadCollection(admin, collection),
  message,
});

export async function startUpload(input: unknown) {
  const admin = await requireOwner();
  const parsed = startUploadSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const };
  try {
    const path = `cms/${admin.userId}/${randomUUID()}`;
    const storage = await secretStorage(admin);
    const { data, error } = await storage.createSignedUploadUrl(path);
    if (error) throw error;
    return { ok: true as const, path, url: data.signedUrl };
  } catch {
    return { ok: false as const };
  }
}

/** Puts the cover flag on the first photo and numbers the rest. */
async function writeOrder(
  admin: AdminContext,
  collection: string,
  order: string[],
) {
  const { data, error } = await admin.supabase
    .from("media_placements")
    .select("id, media_id")
    .eq("collection", collection);
  if (error) throw error;

  // One statement, so the order changes all at once or not at all. The index
  // allows one cover per section and is checked row by row, so the flag is
  // cleared here and set afterwards. Pages follow the order, not the flag.
  const rows = order.map((mediaId, index) => ({
    id: data.find((row) => row.media_id === mediaId)!.id,
    collection,
    media_id: mediaId,
    sort_order: index,
    is_cover: false,
  }));
  if (rows.length === 0) return;
  const { error: orderError } = await admin.supabase
    .from("media_placements")
    .upsert(rows);
  if (orderError) throw orderError;
  const { error: coverError } = await admin.supabase
    .from("media_placements")
    .update({ is_cover: true })
    .eq("id", rows[0].id);
  if (coverError) throw coverError;
}

async function currentOrder(admin: AdminContext, collection: string) {
  const { data, error } = await admin.supabase
    .from("media_placements")
    .select("media_id")
    .eq("collection", collection)
    .order("sort_order")
    .order("created_at")
    .order("id");
  if (error) throw error;
  return data.map((row) => row.media_id);
}

/** Deletes a stored photo once nothing shows it. Retried from Unused photos. */
async function removeFileAndRow(
  admin: AdminContext,
  mediaId: string,
): Promise<boolean> {
  const { data: media, error } = await admin.supabase
    .from("media")
    .select("path, bucket")
    .eq("id", mediaId)
    .maybeSingle();
  if (error) throw error;
  if (!media) return true;

  const { error: fileError } = await admin.supabase.storage
    .from(media.bucket)
    .remove([media.path]);
  if (fileError) return false;

  const { error: rowError } = await admin.supabase
    .from("media")
    .delete()
    .eq("id", mediaId);
  return !rowError;
}

export async function finishUpload(input: unknown): Promise<PhotoResult> {
  const { cms: t } = await adminI18n();
  const failed = failure(t);

  const admin = await requireOwner();
  const parsed = finishUploadSchema.safeParse(input);
  if (!parsed.success) return failed();
  const { collection, tempPath, replaceMediaId } = parsed.data;
  if (!tempPath.startsWith(`cms/${admin.userId}/`)) return failed();
  const def = findCollection(collection)!;

  try {
    const temp = await secretStorage(admin);
    try {
      const { data: file, error: readError } = await temp.download(tempPath);
      if (readError) throw readError;

      let photo;
      try {
        photo = await processPhoto(Buffer.from(await file.arrayBuffer()));
      } catch (error) {
        if (error instanceof UnreadablePhotoError) {
          return failed(t.photos.cannotRead(t.photos.thisPhoto));
        }
        throw error;
      }

      const order = await currentOrder(admin, collection);
      const replaced = replaceMediaId;
      if (replaced && !order.includes(replaced)) {
        return failed(t.common.pageChanged);
      }
      // Only Replace may change a filled one-photo place. An Add from a page
      // opened before it was filled must not quietly throw that photo away.
      if (!replaced && def.single && order.length) {
        return failed(t.photos.takenFirst);
      }

      const outcome = await runUpload(
        uploadSteps(admin, collection, photo, replaced),
      );
      if (outcome.status === "stale") return failed(t.common.pageChanged);
      if (outcome.status === "taken") return failed(t.photos.takenFirst);
      if (outcome.status === "failed") return failed();

      refreshPublicPages(pagesOf([collection]));
      refreshAdmin();
      return await sectionResult(
        admin,
        collection,
        replaced ? t.photos.replaced : undefined,
      ).catch(() => failed(t.photos.savedReload));
    } finally {
      await temp.remove([tempPath]).then(
        () => undefined,
        () => undefined,
      );
    }
  } catch {
    return failed();
  }
}

function uploadSteps(
  admin: AdminContext,
  collection: string,
  photo: ProcessedPhoto,
  replaced: string | undefined,
): UploadSteps {
  const media = admin.supabase.storage.from(MEDIA_BUCKET);
  const def = findCollection(collection)!;
  return {
    async storeFile() {
      const path = `uploads/${randomUUID()}.webp`;
      const { error } = await media.upload(path, photo.data, {
        contentType: photo.mimeType,
        cacheControl: CACHE_SECONDS,
        upsert: false,
      });
      if (error) throw error;
      return path;
    },
    async insertRow(path) {
      const { data, error } = await admin.supabase
        .from("media")
        .insert({
          path,
          mime_type: photo.mimeType,
          width: photo.width,
          height: photo.height,
          size_bytes: photo.data.length,
          created_by: admin.userId,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data.id;
    },
    async place(mediaId) {
      if (replaced) {
        // One update, so the section is never without its photo. Only this
        // section changes: anywhere else the old photo is used, it stays.
        const { data, error } = await admin.supabase
          .from("media_placements")
          .update({ media_id: mediaId })
          .eq("collection", collection)
          .eq("media_id", replaced)
          .select("id");
        if (error) throw error;
        return data.length === 1 ? "placed" : "stale";
      }

      // A one-photo place claims the cover flag in the insert itself. The
      // media_placements_one_cover index then lets exactly one through, however
      // the two uploads interleave. Reading the section back cannot decide
      // this: created_at is when a transaction began, not when it committed,
      // so the second to commit can look first, and each sees itself winning.
      if (def.single) {
        const { error } = await admin.supabase.from("media_placements").insert({
          collection,
          media_id: mediaId,
          sort_order: 0,
          is_cover: true,
        });
        if (error?.code === UNIQUE_VIOLATION) return "taken";
        if (error) throw error;
        return "placed";
      }

      // A section of many waits for tidyUp to set its cover: two uploads into
      // an empty one are both welcome, and must not fight over the flag.
      const { count, error: countError } = await admin.supabase
        .from("media_placements")
        .select("id", { count: "exact", head: true })
        .eq("collection", collection);
      if (countError) throw countError;
      const { error } = await admin.supabase.from("media_placements").insert({
        collection,
        media_id: mediaId,
        sort_order: count ?? 0,
      });
      if (error) throw error;
      return "placed";
    },
    async deleteRow(mediaId) {
      const { error } = await admin.supabase
        .from("media")
        .delete()
        .eq("id", mediaId);
      if (error) throw error;
    },
    async deleteFile(path) {
      const { error } = await media.remove([path]);
      if (error) throw error;
    },
    async tidyUp() {
      // Never in a one-photo place: writeOrder clears the cover flag for a
      // moment, and that flag is what keeps a second photo out.
      if (!def.single) {
        await writeOrder(
          admin,
          collection,
          await currentOrder(admin, collection),
        );
      }
      if (replaced) await dropIfUnused(admin, replaced);
    },
  };
}

/**
 * Imported files stay: the built-in fallback pages point at them, and a site
 * with a database outage must still find its photos.
 */
async function dropIfUnused(admin: AdminContext, mediaId: string) {
  const inUse =
    (await collectionsOf(admin, mediaId)).length > 0 ||
    (await placesUsing(admin, mediaId)).length > 0;
  if (inUse) return;
  const { data } = await admin.supabase
    .from("media")
    .select("path")
    .eq("id", mediaId)
    .maybeSingle();
  if (data && !data.path.startsWith(SITE_PREFIX)) {
    await removeFileAndRow(admin, mediaId);
  }
}

export async function reorderPhotos(input: unknown): Promise<PhotoResult> {
  const { cms: t } = await adminI18n();
  const failed = failure(t);

  const admin = await requireOwner();
  const parsed = reorderSchema.safeParse(input);
  if (!parsed.success) return failed();
  const { collection, ids } = parsed.data;

  try {
    const current = await currentOrder(admin, collection);
    const same =
      current.length === ids.length &&
      [...current].sort().join() === [...ids].sort().join();
    if (!same) return failed(t.common.pageChanged);
    await writeOrder(admin, collection, ids);
    refreshPublicPages(pagesOf([collection]));
    refreshAdmin();
    return await sectionResult(admin, collection);
  } catch {
    return failed();
  }
}

export async function saveAlt(input: unknown): Promise<PhotoResult> {
  const { cms: t } = await adminI18n();
  const failed = failure(t);

  const admin = await requireOwner();
  const parsed = altSchema.safeParse(input);
  if (!parsed.success) return failed();
  const { collection, mediaId, en, el } = parsed.data;
  if (!en && !el) return failed(t.photos.altRequired);

  try {
    const { data: media, error: readError } = await admin.supabase
      .from("media")
      .select("alt")
      .eq("id", mediaId)
      .single();
    if (readError) throw readError;
    const { error } = await admin.supabase
      .from("media")
      .update({ alt: { ...(media.alt as object), en, el } })
      .eq("id", mediaId);
    if (error) throw error;

    const places = await placesUsing(admin, mediaId);
    refreshPublicPages([
      ...pagesOf(await collectionsOf(admin, mediaId)),
      ...(places.length ? ["home"] : []),
    ]);
    refreshAdmin();
    return await sectionResult(admin, collection, t.photos.altSaved);
  } catch {
    return failed();
  }
}

/** The spot every frame keeps in view. Null puts it back in the centre. */
export async function saveFocus(input: unknown): Promise<PhotoResult> {
  const { cms: t } = await adminI18n();
  const failed = failure(t);

  const admin = await requireOwner();
  const parsed = focusSchema.safeParse(input);
  if (!parsed.success) return failed();
  const { collection, mediaId, focus } = parsed.data;

  try {
    const { error } = await admin.supabase
      .from("media")
      .update({ focus_x: focus?.x ?? null, focus_y: focus?.y ?? null })
      .eq("id", mediaId);
    if (error) throw error;

    const places = await placesUsing(admin, mediaId);
    refreshPublicPages([
      ...pagesOf(await collectionsOf(admin, mediaId)),
      ...(places.length ? ["home"] : []),
    ]);
    refreshAdmin();
    return await sectionResult(admin, collection, t.photos.focusSaved);
  } catch {
    return failed();
  }
}

export async function addExistingPhoto(input: unknown): Promise<PhotoResult> {
  const { cms: t } = await adminI18n();
  const failed = failure(t);

  const admin = await requireOwner();
  const parsed = placementSchema.safeParse(input);
  if (!parsed.success) return failed();
  const { collection, mediaId } = parsed.data;
  const def = findCollection(collection)!;

  try {
    const order = await currentOrder(admin, collection);
    if (order.includes(mediaId)) return failed(t.photos.alreadyThere);
    if (def.single && order.length) return failed(t.photos.takenFirst);
    const { error } = await admin.supabase.from("media_placements").insert({
      collection,
      media_id: mediaId,
      sort_order: order.length,
      is_cover: Boolean(def.single),
    });
    if (error?.code === UNIQUE_VIOLATION) return failed(t.photos.takenFirst);
    if (error) throw error;
    if (!def.single) {
      await writeOrder(
        admin,
        collection,
        await currentOrder(admin, collection),
      );
    }
    refreshPublicPages(pagesOf([collection]));
    refreshAdmin();
    return {
      ok: true,
      items: await loadUnused(admin),
      message: t.photos.addedToSection,
    };
  } catch {
    return failed();
  }
}

export async function removeFromSection(input: unknown): Promise<PhotoResult> {
  const { cms: t } = await adminI18n();
  const failed = failure(t);

  const admin = await requireOwner();
  const parsed = placementSchema.safeParse(input);
  if (!parsed.success) return failed();
  const { collection, mediaId } = parsed.data;
  const def = findCollection(collection)!;
  if (def.single && !def.optional) return failed(t.photos.needsOne);

  try {
    const { error } = await admin.supabase
      .from("media_placements")
      .delete()
      .eq("collection", collection)
      .eq("media_id", mediaId);
    if (error) throw error;
    await writeOrder(admin, collection, await currentOrder(admin, collection));
    const orphan =
      (await collectionsOf(admin, mediaId)).length === 0 &&
      (await placesUsing(admin, mediaId)).length === 0;
    refreshPublicPages(pagesOf([collection]));
    refreshAdmin();
    return await sectionResult(
      admin,
      collection,
      orphan ? t.photos.removedUnused : t.photos.removed,
    );
  } catch {
    return failed();
  }
}

/**
 * Takes the photo off every page first, then deletes the file, then the row.
 * A failure at any step leaves a photo that is simply unused, never a page
 * pointing at a missing file, and the delete can be tried again.
 */
export async function deleteEverywhere(input: unknown): Promise<PhotoResult> {
  const { cms: t, say } = await adminI18n();
  const failed = failure(t);

  const admin = await requireOwner();
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return failed();
  const { mediaId } = parsed.data;

  try {
    const collections = await collectionsOf(admin, mediaId);
    const required = collections.filter((id) => {
      const def = findCollection(id);
      return def?.single && !def.optional;
    });
    if (required.length) {
      return failed(
        t.photos.needsOneElsewhere(
          required.map(collectionName).map(say).join(", "),
        ),
      );
    }

    const places = await placesUsing(admin, mediaId);
    if (places.length) {
      const { error } = await admin.supabase
        .from("places")
        .update({ media_id: null })
        .eq("media_id", mediaId);
      if (error) throw error;
    }
    if (collections.length) {
      const { error } = await admin.supabase
        .from("media_placements")
        .delete()
        .eq("media_id", mediaId);
      if (error) throw error;
      for (const collection of collections) {
        await writeOrder(
          admin,
          collection,
          await currentOrder(admin, collection),
        );
      }
    }
    refreshPublicPages([
      ...pagesOf(collections),
      ...(places.length ? ["home"] : []),
    ]);

    const gone = await removeFileAndRow(admin, mediaId);
    refreshAdmin();
    if (!gone) return failed(t.photos.deleteFileFailed);
    return {
      ok: true,
      items: await loadUnused(admin),
      message: t.photos.deleted,
    };
  } catch {
    return failed();
  }
}
