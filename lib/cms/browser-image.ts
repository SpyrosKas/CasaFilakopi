// Runs in the browser, before a photo leaves the phone. Shrinking first makes an
// upload on a slow island connection take seconds, not minutes. It is only a
// convenience: the server rebuilds every file whatever happens here.

const MAX_EDGE = 2880;
const QUALITY = 0.9;

/** What the file picker offers, and what a phone or computer may send. */
export const ACCEPTED_FILES =
  "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";

export const MAX_CHOSEN_BYTES = 40 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export function looksLikePhoto(file: File): boolean {
  return (
    /^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) ||
    /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)
  );
}

/**
 * Returns a smaller JPEG, or the file itself when this browser cannot decode
 * it, such as HEIC outside Safari. The server then decides if it can read it.
 */
export async function shrinkForUpload(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas
      .getContext("2d")!
      .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALITY),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}

/** Plain XMLHttpRequest, because fetch cannot report upload progress. */
export function putWithProgress(
  url: string,
  body: Blob,
  onProgress: (percent: number) => void,
): Promise<boolean> {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.setRequestHeader(
      "content-type",
      body.type || "application/octet-stream",
    );
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    request.onload = () =>
      resolve(request.status >= 200 && request.status < 300);
    request.onerror = () => resolve(false);
    request.onabort = () => resolve(false);
    request.send(body);
  });
}
