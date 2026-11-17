import { lstat, readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { CliError } from "./args.js";
import { safeDestination } from "./fs-safe.js";

export interface BundleAssetMetrics {
  readonly fileName: string;
  readonly kind: "js" | "css" | "map" | "manifest";
  readonly rawBytes: number;
  readonly gzipBytes: number;
  readonly brotliBytes: number;
  readonly sha256: string;
}
export interface BundleReport {
  readonly schemaVersion: 1;
  readonly files: readonly BundleAssetMetrics[];
  readonly totals: { readonly js: MetricTotals; readonly css: MetricTotals };
}
interface MetricTotals { readonly rawBytes: number; readonly gzipBytes: number; readonly brotliBytes: number }
const MAX_BYTES_PER_ASSET = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const categories = new Set(["js", "css", "map", "manifest"]);

async function assertNoSymlink(base: string, relative: string): Promise<string> {
  const root = resolve(base);
  const target = safeDestination(root, relative);
  let current = root;
  const segments = [".", ...relative.replaceAll("\\", "/").split("/")];
  for (const segment of segments) {
    if (segment !== ".") current = join(current, segment);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new CliError("BUNDLE_SYMLINK", "Refusing linked bundle path: " + relative);
    if (segment !== segments[segments.length - 1] && !info.isDirectory()) {
      throw new CliError("BUNDLE_PATH", "Expected a bundle directory: " + relative);
    }
  }
  if (!target.startsWith(root + sep)) throw new CliError("BUNDLE_PATH", "Bundle path escapes its output directory");
  return target;
}
function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CliError("BUNDLE_MANIFEST", "Bundle manifest must be a JSON object");
  }
  return value as Record<string, unknown>;
}
function totals() { return { rawBytes: 0, gzipBytes: 0, brotliBytes: 0 }; }
/** Read-only bundle report; consumes only Zaakiy's emitted versioned manifest. */
export async function analyzeBundle(projectRoot: string): Promise<BundleReport> {
  const dist = resolve(projectRoot, "dist");
  let manifest: Record<string, unknown>;
  try {
    const path = await assertNoSymlink(dist, "zaakiy-assets.json");
    const bytes = await readFile(path);
    if (bytes.byteLength > MAX_BYTES_PER_ASSET) throw new CliError("BUNDLE_TOO_LARGE", "Manifest exceeds size limit");
    manifest = asRecord(JSON.parse(bytes.toString("utf8")) as unknown);
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError("BUNDLE_MANIFEST", "Cannot read a valid dist/zaakiy-assets.json; build the project first");
  }
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.assets)) {
    throw new CliError("BUNDLE_MANIFEST", "Unsupported or invalid Zaakiy asset manifest version");
  }
  if (manifest.assets.length > 5_000) throw new CliError("BUNDLE_TOO_LARGE", "Asset list exceeds size limit");
  const records: BundleAssetMetrics[] = [];
  const known = new Set<string>();
  let totalSize = 0;
  for (const item of manifest.assets as unknown[]) {
    const asset = asRecord(item);
    if (typeof asset.fileName !== "string" || typeof asset.kind !== "string" || !categories.has(asset.kind)) {
      throw new CliError("BUNDLE_MANIFEST", "Invalid asset descriptor in Zaakiy manifest");
    }
    const fileName = asset.fileName;
    if (known.has(fileName)) throw new CliError("BUNDLE_MANIFEST", "Duplicate bundle asset: " + fileName);
    known.add(fileName);
    const path = await assertNoSymlink(dist, fileName);
    const info = await lstat(path);
    if (!info.isFile()) throw new CliError("BUNDLE_PATH", "Asset is not a file: " + fileName);
    if (info.size > MAX_BYTES_PER_ASSET || totalSize + info.size > MAX_TOTAL_BYTES) {
      throw new CliError("BUNDLE_TOO_LARGE", "Bundle exceeds bounded analysis limits");
    }
    const bytes = await readFile(path);
    totalSize += bytes.byteLength;
    records.push({
      fileName, kind: asset.kind as BundleAssetMetrics["kind"],
      rawBytes: bytes.byteLength, gzipBytes: gzipSync(bytes).byteLength,
      brotliBytes: brotliCompressSync(bytes).byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex")
    });
  }
  records.sort((a, b) => a.fileName.localeCompare(b.fileName));
  const js = totals(), css = totals();
  for (const item of records) {
    const bucket = item.kind === "js" ? js : item.kind === "css" ? css : null;
    if (bucket) {
      bucket.rawBytes += item.rawBytes;
      bucket.gzipBytes += item.gzipBytes;
      bucket.brotliBytes += item.brotliBytes;
    }
  }
  return { schemaVersion: 1, files: records, totals: { js, css } };
}
