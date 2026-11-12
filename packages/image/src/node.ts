/** Node-only offline image optimization. No remote fetches, image proxy or browser codec. */
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { OptimizedImage, ImageSource } from "./index.js";

export type EncodedFormat = "jpeg" | "png" | "webp" | "avif";
export interface ImageMetadata {
  readonly width?: number;
  readonly height?: number;
  readonly format?: string;
  readonly pages?: number;
  readonly orientation?: number;
  readonly hasAlpha?: boolean;
}
export interface ImageProcessor {
  readonly id: string; // pinned encoder and version
  metadata(source: Uint8Array): Promise<ImageMetadata>;
  encode(source: Uint8Array, options: {
    readonly width: number;
    readonly format: EncodedFormat;
    readonly quality: number;
  }): Promise<Uint8Array>;
}
interface SharpPipeline {
  metadata(): Promise<ImageMetadata>;
  rotate(): SharpPipeline;
  resize(options: { width: number; withoutEnlargement: boolean }): SharpPipeline;
  toFormat(format: EncodedFormat, options: { quality: number }): SharpPipeline;
  toBuffer(): Promise<Uint8Array>;
}
/** Sharp is injected from the build toolchain, never imported by browser modules. */
export type SharpFactory = (
  input: Buffer, options?: { limitInputPixels: number; animated: boolean }
) => SharpPipeline;
export function createSharpProcessor(factory: SharpFactory, id: string): ImageProcessor {
  if (typeof factory !== "function" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(id))
    throw new TypeError("Image encoder requires a pinned, safe processor ID");
  const options = { limitInputPixels: 40_000_000, animated: false };
  return {
    id,
    metadata: source => factory(Buffer.from(source), options).metadata(),
    encode: (source, request) => factory(Buffer.from(source), options)
      .rotate()
      .resize({ width: request.width, withoutEnlargement: true })
      .toFormat(request.format, { quality: request.quality })
      .toBuffer()
  };
}
export interface LocalImageSource {
  readonly id: string;
  readonly file: string; // relative local source only
  readonly widths?: readonly number[];
  readonly quality?: number;
  readonly formats?: readonly ("webp" | "avif")[];
  readonly placeholder?: boolean;
}
export interface BuildImageOptions {
  readonly inputRoot: string;
  readonly outputDir: string;
  readonly publicPath?: string;
  readonly images: readonly LocalImageSource[];
  readonly processor: ImageProcessor;
}
export interface ImageOutputFile {
  readonly imageId: string;
  readonly width: number;
  readonly format: EncodedFormat;
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
}
export interface ImageManifest {
  readonly schema: "zaakiy.image-manifest/1";
  readonly buildId: string;
  readonly images: Readonly<Record<string, OptimizedImage>>;
}
export interface ImageBuildResult {
  readonly manifest: ImageManifest;
  readonly outputs: readonly ImageOutputFile[];
  readonly totalOutputBytes: number;
  readonly originalBytes: number;
}
const INPUT_FORMATS: Readonly<Record<string, string>> = {
  ".jpg": "jpeg", ".jpeg": "jpeg", ".png": "png", ".webp": "webp", ".avif": "heif"
};
const MIME: Readonly<Record<EncodedFormat, string>> = {
  jpeg: "image/jpeg", png: "image/png", webp: "image/webp", avif: "image/avif"
};
const sha = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");
function within(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path !== ".." && !path.startsWith(".." + sep) && !isAbsolute(path);
}
function sourcePath(file: string): void {
  if (typeof file !== "string" || file.length < 1 || file.length > 512 ||
      isAbsolute(file) || /[\\:]/.test(file) ||
      [...file].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
      file.split("/").some(part => part === "" || part === "." || part === "..") ||
      file.startsWith("//") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(file))
    throw new TypeError("Image source must be a safe relative local file");
}
function widthsOf(value: readonly number[] | undefined, fullWidth: number): number[] {
  const widths = value ?? [320, 640, 960, 1280, 1920, Math.min(fullWidth, 1920)];
  if (!Array.isArray(widths) || widths.length < 1 || widths.length > 8 ||
      widths.some(width => !Number.isSafeInteger(width) || width < 16 || width > 4096))
    throw new TypeError("Image widths must be 1–8 integer values in [16,4096]");
  const result = [...new Set(widths.filter(width => width <= fullWidth))].sort((a, b) => a - b);
  if (!result.length) result.push(fullWidth);
  return result;
}
function qualityOf(value: number | undefined): number {
  const q = value ?? 75;
  if (!Number.isSafeInteger(q) || q < 30 || q > 90)
    throw new TypeError("Image quality outside approved bounds");
  return q;
}
function formatsOf(value: LocalImageSource["formats"]): ("avif" | "webp")[] {
  const formats = value ?? ["webp", "avif"];
  if (!Array.isArray(formats) || formats.length > 2 ||
      formats.some(f => f !== "webp" && f !== "avif") ||
      new Set(formats).size !== formats.length)
    throw new TypeError("Unsupported image target format");
  return ["avif", "webp"].filter(f => formats.includes(f as "webp" | "avif")) as ("avif" | "webp")[];
}
function pathPrefix(prefix: string): string {
  if (typeof prefix !== "string" || prefix.length < 2 || prefix.length > 200 ||
      !/^\/[A-Za-z0-9_/-]+\/$/.test(prefix) || prefix.startsWith("//") ||
      prefix.split("/").some(part => part === "." || part === ".."))
    throw new TypeError("Image publicPath must be a safe absolute local URL prefix");
  return prefix;
}
async function emit(outputDir: string, bytes: Uint8Array, format: EncodedFormat): Promise<{
  file: string; sha256: string; bytes: number;
}> {
  if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > 20 * 1024 * 1024)
    throw new TypeError("Image encoder produced an invalid or oversized asset");
  const digest = sha(bytes);
  const file = digest.slice(0, 32) + "." + (format === "jpeg" ? "jpg" : format);
  const target = join(outputDir, file);
  try {
    await writeFile(target, bytes, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await readFile(target);
    if (sha(existing) !== digest)
      throw new TypeError("Image asset hash collision or tampered output");
  }
  return { file, sha256: digest, bytes: bytes.length };
}
/** SHA-addressed output, bounded sequential processing, stable sorted manifest. */
export async function optimizeLocalImages(options: BuildImageOptions): Promise<ImageBuildResult> {
  if (!options || typeof options.inputRoot !== "string" ||
      typeof options.outputDir !== "string" ||
      !Array.isArray(options.images) || options.images.length < 1 ||
      options.images.length > 256 || !options.processor ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(options.processor.id))
    throw new TypeError("Invalid local image build configuration");
  const root = await realpath(options.inputRoot);
  const outputDir = resolve(options.outputDir);
  const prefix = pathPrefix(options.publicPath ?? "/_zaakiy/images/");
  const images: Record<string, OptimizedImage> = Object.create(null);
  const outputs: ImageOutputFile[] = [];
  let originalBytes = 0;
  await mkdir(outputDir, { recursive: true });
  const ids = new Set<string>();
  for (const item of options.images) {
    if (!item || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(item.id) ||
        ids.has(item.id)) throw new TypeError("Duplicate or invalid image ID");
    ids.add(item.id);
    sourcePath(item.file);
    const expected = INPUT_FORMATS[extname(item.file).toLowerCase()];
    if (!expected)
      throw new TypeError("Only local JPEG/PNG/WebP/AVIF raster images are supported");
    const candidate = resolve(root, item.file);
    if (!within(root, candidate)) throw new TypeError("Image input escapes root");
    const actual = await realpath(candidate);
    if (!within(root, actual)) throw new TypeError("Image symlink escapes input root");
    const info = await stat(actual);
    if (!info.isFile() || info.size < 1 || info.size > 20 * 1024 * 1024)
      throw new TypeError("Image input file exceeds the permitted size");
    const source = await readFile(actual);
    if (source.length !== info.size)
      throw new TypeError("Image source changed while reading");
    originalBytes += source.length;
    const meta = await options.processor.metadata(source);
    if (!meta || !Number.isSafeInteger(meta.width) || !Number.isSafeInteger(meta.height) ||
        meta.width! < 16 || meta.height! < 16 ||
        meta.width! > 16_384 || meta.height! > 16_384 ||
        meta.width! * meta.height! > 40_000_000 ||
        (meta.pages ?? 1) !== 1 ||
        (expected !== meta.format && !(expected === "heif" && meta.format === "avif")))
      throw new TypeError("Image metadata, raster format or pixel budget is invalid");
    const rotated = [5, 6, 7, 8].includes(meta.orientation ?? 1);
    const width = rotated ? meta.height! : meta.width!;
    const height = rotated ? meta.width! : meta.height!;
    const widths = widthsOf(item.widths, width);
    const quality = qualityOf(item.quality);
    const formats = formatsOf(item.formats);
    const fallback: EncodedFormat = expected === "png" ||
      ((expected === "webp" || expected === "heif") && meta.hasAlpha)
      ? "png" : "jpeg";
    const fileByFormat = new Map<EncodedFormat, Array<{ url: string; width: number }>>();
    const generate = async (format: EncodedFormat, w: number, q: number): Promise<Uint8Array> => {
      const encoded = await options.processor.encode(source, { width: w, format, quality: q });
      const artifact = await emit(outputDir, encoded, format);
      outputs.push({ imageId: item.id, width: w, format, ...artifact });
      const entries = fileByFormat.get(format) ?? [];
      entries.push({ url: prefix + artifact.file, width: w });
      fileByFormat.set(format, entries);
      return encoded;
    };
    for (const format of [...formats, fallback]) {
      for (const w of widths) await generate(format, w, quality);
    }
    const srcSetOf = (format: EncodedFormat): string =>
      (fileByFormat.get(format) ?? []).map(entry =>
        entry.url + " " + entry.width + "w").join(", ");
    const fallbackEntries = fileByFormat.get(fallback)!;
    const pictureSources: ImageSource[] = formats.map(format => ({
      type: MIME[format] as ImageSource["type"], srcSet: srcSetOf(format)
    }));
    let blurDataURL: string | undefined;
    if (item.placeholder === true) {
      const tiny = await options.processor.encode(source, {
        width: Math.min(width, 24), format: "webp", quality: 35
      });
      if (tiny.length > 4_096) throw new TypeError("Image blur placeholder is oversized");
      blurDataURL = "data:image/webp;base64," + Buffer.from(tiny).toString("base64");
    }
    images[item.id] = {
      schema: "zaakiy.image/1", width, height,
      src: fallbackEntries[fallbackEntries.length - 1]!.url,
      srcSet: srcSetOf(fallback), sources: pictureSources,
      ...(blurDataURL ? { blurDataURL } : {})
    };
  }
  const manifestImages: Record<string, OptimizedImage> = Object.create(null);
  for (const id of Object.keys(images).sort()) manifestImages[id] = images[id]!;
  const canonical = JSON.stringify({
    processor: options.processor.id, images: manifestImages,
    outputs: outputs.map(({ imageId, width, format, sha256 }) =>
      ({ imageId, width, format, sha256 })).sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)))
  });
  const manifest: ImageManifest = {
    schema: "zaakiy.image-manifest/1", buildId: sha(canonical), images: manifestImages
  };
  return {
    manifest, outputs, originalBytes,
    totalOutputBytes: outputs.reduce((total, file) => total + file.bytes, 0)
  };
}
