/**
 * Reads a request body up to a byte limit, and stops as soon as it is passed.
 * Null means it was larger. A Content-Length header can lie, so bytes are
 * counted as they arrive.
 */
export async function readCapped(
  request: Request,
  maxBytes: number,
): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) {
    return null;
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
