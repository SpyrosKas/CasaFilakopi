import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { zipStream, type ZipEntry } from "@/lib/invoicing/zip";

async function readAll(stream: ReadableStream<Uint8Array>) {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function* entries(names: string[]): AsyncGenerator<ZipEntry> {
  for (const name of names) {
    yield { name, data: new TextEncoder().encode(`contents of ${name}`) };
  }
}

describe("the ZIP stream", () => {
  it("makes a real ZIP with the right files", async () => {
    const bytes = await readAll(
      zipStream(entries(["a.pdf", "b.pdf", "c.csv"])),
    );
    const files = unzipSync(bytes);
    expect(Object.keys(files)).toEqual(["a.pdf", "b.pdf", "c.csv"]);
    expect(strFromU8(files["b.pdf"])).toBe("contents of b.pdf");
  });

  it("works with nothing in it", async () => {
    const files = unzipSync(await readAll(zipStream(entries([]))));
    expect(Object.keys(files)).toEqual([]);
  });

  it("gives the same bytes for the same files", async () => {
    const first = await readAll(zipStream(entries(["a.pdf"])));
    const second = await readAll(zipStream(entries(["a.pdf"])));
    expect(first).toEqual(second);
  });

  it("only asks for the next file when the reader wants it", async () => {
    let produced = 0;
    async function* slow(): AsyncGenerator<ZipEntry> {
      for (let i = 0; i < 50; i += 1) {
        produced += 1;
        yield { name: `${i}.pdf`, data: new Uint8Array(1024) };
      }
    }
    const reader = zipStream(slow()).getReader();
    await reader.read();
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Far from all 50: a month of PDFs is never held at once.
    expect(produced).toBeLessThan(4);
    await reader.cancel();
  });

  it("stops asking when the reader gives up", async () => {
    let finished = false;
    async function* endless(): AsyncGenerator<ZipEntry> {
      try {
        for (;;) yield { name: "x.pdf", data: new Uint8Array(8) };
      } finally {
        finished = true;
      }
    }
    const reader = zipStream(endless()).getReader();
    await reader.read();
    await reader.cancel();
    expect(finished).toBe(true);
  });
});
