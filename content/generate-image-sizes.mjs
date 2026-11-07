// Regenerates content/image-sizes.json from legacy/img, so pages can give the
// browser each photo's size before it loads (no layout jump).
// Run after adding a photo: node content/generate-image-sizes.mjs
import { readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import sharp from "sharp";

const root = "legacy";

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.(jpe?g|png)$/i.test(entry.name) ? [path] : [];
  });
}

const sizes = {};
for (const file of walk(join(root, "img")).sort()) {
  const metadata = await sharp(file).metadata();
  // autoOrient: phone photos are stored sideways with a rotation flag.
  const { width, height } = metadata.autoOrient;
  sizes[`/${relative(root, file)}`] = [width, height];
}
writeFileSync(
  "content/image-sizes.json",
  `${JSON.stringify(sizes, null, 2)}\n`,
);
console.log(`${Object.keys(sizes).length} images`);
