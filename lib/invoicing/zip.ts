import { Zip, ZipPassThrough } from "fflate";

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

// Fixed, so the same files always make the same ZIP.
const FILE_TIME = new Date("2026-01-01T00:00:00Z");

/**
 * Builds a ZIP as it is read. The next file is only asked for when the reader
 * wants more, and each is let go once written, so a month of PDFs is never in
 * memory together. PDFs are already compressed, so files are stored as they
 * are.
 */
export function zipStream(
  entries: AsyncIterable<ZipEntry>,
): ReadableStream<Uint8Array> {
  const iterator = entries[Symbol.asyncIterator]();
  let zip: Zip;

  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        zip = new Zip((error, chunk, final) => {
          if (error) return controller.error(error);
          // A copy, because the ZIP library may reuse its buffer.
          controller.enqueue(chunk.slice());
          if (final) controller.close();
        });
      },
      async pull() {
        const { done, value } = await iterator.next();
        if (done) {
          zip.end();
          return;
        }
        const file = new ZipPassThrough(value.name);
        file.mtime = FILE_TIME;
        zip.add(file);
        file.push(value.data, true);
      },
      async cancel() {
        await iterator.return?.();
        zip.terminate();
      },
    },
    { highWaterMark: 0 },
  );
}
