import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createSharpProcessor, optimizeLocalImages } from "../packages/image/dist/node.js";
import { getImageProps, renderPictureHtml } from "../packages/image/dist/index.js";

const require = createRequire(join(resolve(".benchmark-image-codec"), "entry.cjs"));
const sharp = require("sharp");
const processor = createSharpProcessor(sharp, "sharp-0.35.5");
const width = 1600, height = 1000;
const rgb = Buffer.alloc(width * height * 3);
let seed = 0x9E3779B9;
for (let i = 0; i < rgb.length; i++) {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  rgb[i] = seed & 255;
}
const sourceJpeg = await sharp(rgb, { raw: { width, height, channels: 3 } })
  .jpeg({ quality: 92, mozjpeg: true }).toBuffer();
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const pct = (a, q) => {
  const values = [...a].sort((x,y) => x-y);
  const n = (values.length - 1) * q;
  const low = Math.floor(n), high = Math.ceil(n);
  return values[low] + (values[high]-values[low])*(n-low);
};
async function runOne() {
  const dir = await mkdtemp(join(tmpdir(), "zaakiy-image-perf-"));
  try {
    const inputRoot = join(dir, "source"), outputDir = join(dir, "output");
    await mkdir(inputRoot);
    await writeFile(join(inputRoot, "hero.jpg"), sourceJpeg);
    const started = performance.now();
    const built = await optimizeLocalImages({
      inputRoot, outputDir, processor,
      images: [{
        id: "hero", file: "hero.jpg",
        widths: [320,640,1200], quality: 75,
        formats: ["webp", "avif"], placeholder: true
      }]
    });
    const elapsed = performance.now() - started;
    if (built.outputs.length !== 9 || built.originalBytes !== sourceJpeg.length)
      throw new Error("Missing expected image formats, outputs or source bytes");
    for (const item of built.outputs) {
      const bytes = await readFile(join(outputDir, item.file));
      if (digest(bytes) !== item.sha256 || bytes.byteLength !== item.bytes)
        throw new Error("Encoded asset failed SHA-256 verification");
      const meta = await sharp(bytes).metadata();
      const expected = item.format === "avif" ? "heif" : item.format;
      if (meta.width !== item.width || meta.format !== expected || meta.height < 1)
        throw new Error("Image codec failed width/format attestation: "+item.format);
    }
    const image = built.manifest.images.hero;
    if (!image || image.width !== width || image.height !== height ||
        image.sources.length !== 2 || !image.blurDataURL)
      throw new Error("Invalid native picture descriptor");
    const p = getImageProps(image, { alt: "Image test", priority: true });
    if (p.loading !== "eager" || p.fetchPriority !== "high" ||
        !renderPictureHtml(image, {alt:"Image test"}).includes("image/avif"))
      throw new Error("Invalid accessible image rendering");
    const variantBytes = (format, w) => built.outputs.find(x =>
      x.format===format && x.width===w)?.bytes;
    const selected = {
      mobileWebp: variantBytes("webp",320),
      mobileAvif: variantBytes("avif",320),
      tabletWebp: variantBytes("webp",640),
      desktopWebp: variantBytes("webp",1200),
      desktopFallbackJpeg: variantBytes("jpeg",1200)
    };
    if (Object.values(selected).some(x => !Number.isSafeInteger(x) || x < 1))
      throw new Error("Missing image transfer-size comparison");
    return {
      ms:elapsed, buildId:built.manifest.buildId,
      originalBytes:built.originalBytes,
      totalOutputBytes:built.totalOutputBytes,
      imageVariants:built.outputs.length, selected
    };
  } finally { await rm(dir, { recursive:true, force:true }); }
}
await runOne();
const samples=[];
const results=[];
for(let n=0;n<5;n++){
  const out=await runOne();
  results.push(out);
  samples.push(out.ms);
}
const first=results[0];
if (!results.every(x => x.buildId===first.buildId &&
    x.originalBytes===first.originalBytes &&
    JSON.stringify(x.selected)===JSON.stringify(first.selected))) {
  throw new Error("Image builds were nondeterministic");
}
const savings=Object.fromEntries(Object.entries(first.selected).map(([key,bytes]) =>
  [key,100*(1-bytes/first.originalBytes)]));
const report={
  schemaVersion:1, fixture:"deterministic-1600x1000-noisy-jpeg-v1",
  node:process.version, sharp:sharp.versions.sharp, libvips:sharp.versions.vips,
  sourceBytes:first.originalBytes, totalOutputBytes:first.totalOutputBytes,
  variantCount:first.imageVariants, selectedBytes:first.selected,
  savingsPercent:savings, buildSha256:first.buildId,
  samples:5, warmups:1, p50Ms:pct(samples,.5),p95Ms:pct(samples,.95),
  rawMs:samples, note:"Original JPEG vs one responsive variant, not Next.js direct benchmarking"
};
const lines=[
 "# ZaakiyJS native image optimization — real Sharp codec",
 "",
 "Deterministic 1,600×1,000 high-detail JPEG baseline; Sharp "+sharp.versions.sharp+
 " (libvips "+sharp.versions.vips+"). Build-time variants: WebP, AVIF, JPEG at 320/640/1200 widths.",
 "Each format and width is decoded and verified for SHA-256, dimensions and MIME. Five fresh-directory samples after one warmup.",
 "",
 "| Selected browser asset | Original JPEG | Responsive asset | Transfer-size change |",
 "| --- | ---: | ---: | ---: |",
 ...Object.entries(first.selected).map(([name,bytes]) =>
   "| "+name+" | "+first.originalBytes.toLocaleString()+" B | "+
   bytes.toLocaleString()+" B | "+savings[name].toFixed(1)+"% less |"),
 "",
 "| Encoder pipeline | p50 | p95 | Generated assets on disk |",
 "| --- | ---: | ---: | ---: |",
 "| Full build (9 variants + blur) | "+report.p50Ms.toFixed(1)+" ms | "+
   report.p95Ms.toFixed(1)+" ms | "+first.totalOutputBytes.toLocaleString()+" B |",
 "",
 "Browser transfer compares **one selected image variant**, not the sum of every generated responsive asset.",
 "Build processing cost is measured separately, not mistaken for user-facing load latency.",
 "No real-browser LCP/CLS, network timing, or direct Next.js optimizer comparison is claimed.",
 ""
];
await mkdir(resolve("benchmark-artifacts"),{recursive:true});
await writeFile(resolve("benchmark-artifacts/image-optimizer.json"),JSON.stringify(report,null,2)+"\n");
await writeFile(resolve("benchmark-artifacts/image-optimizer.md"),lines.join("\n"));
console.log(lines.join("\n"));