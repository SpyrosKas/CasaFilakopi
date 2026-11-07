import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/** The text a PDF reader finds, page by page. Proves what is really in the file. */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  const task = getDocument({
    // pdf.js takes ownership of the array it is given.
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    verbosity: 0,
  });
  const document = await task.promise;
  const pages: string[] = [];
  for (let number = 1; number <= document.numPages; number += 1) {
    const content = await (await document.getPage(number)).getTextContent();
    pages.push(
      content.items.map((item) => ("str" in item ? item.str : "")).join(" "),
    );
  }
  await task.destroy();
  return pages.join("\n");
}
