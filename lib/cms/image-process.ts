import sharp from "sharp";

// Every uploaded photo passes through here on the server, whatever the browser
// already did. Rebuilding the image drops all metadata, including GPS position,
// and keeps the bucket to one sensible size and format.

/** Longest side of a stored photo: sharp on a large screen, small on a phone. */
export const MAX_PHOTO_EDGE = 2560;

/** A bigger picture than any phone takes, so a crafted file cannot exhaust memory. */
const MAX_INPUT_PIXELS = 120_000_000;

const ALLOWED_FORMATS = ["jpeg", "png", "webp", "heif"];

export interface ProcessedPhoto {
  data: Buffer;
  width: number;
  height: number;
  mimeType: "image/webp";
}

export class UnreadablePhotoError extends Error {}

/** Trusts the bytes, never the file name or the type the browser reported. */
export async function processPhoto(input: Buffer): Promise<ProcessedPhoto> {
  try {
    const image = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS });
    const { format } = await image.metadata();
    if (!ALLOWED_FORMATS.includes(format)) {
      throw new UnreadablePhotoError(`format ${format}`);
    }
    const { data, info } = await image
      .rotate() // Phones store photos sideways with a flag; apply it, then drop it.
      .resize({
        width: MAX_PHOTO_EDGE,
        height: MAX_PHOTO_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return {
      data,
      width: info.width,
      height: info.height,
      mimeType: "image/webp",
    };
  } catch (error) {
    if (error instanceof UnreadablePhotoError) throw error;
    throw new UnreadablePhotoError(
      error instanceof Error ? error.message : "unreadable",
    );
  }
}
