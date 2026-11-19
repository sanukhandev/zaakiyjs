import {lstat, readFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {generateSitemaps, type SitemapEntry} from "@zaakiyjs/seo";
import {CliError} from "./args.js";
import {safeRelativePath, writeGenerated} from "./fs-safe.js";

const MAX_INPUT_BYTES = 256 * 1024;
const MAX_INPUT_RECORDS = 10_000;
const ENTRY_FIELDS = new Set([
  "loc", "lastmod", "changefreq", "priority", "alternates", "published",
  "private", "authorized", "noindex", "status", "redirect", "soft404", "visibility"
]);
const INPUT_FIELDS = new Set(["schema", "siteURL", "entries", "maxEntries", "maxBytes"]);

interface SitemapCliOptions {
  readonly dryRun: boolean;
  readonly force: boolean;
  readonly outputPath?: string;
}
export interface SitemapCliReport {
  readonly schemaVersion: 1;
  readonly dryRun: boolean;
  readonly files: readonly string[];
  readonly included: number;
  readonly excluded: number;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optionalBoolean(row: Record<string, unknown>, field: string): boolean | undefined {
  const value = row[field];
  if (value !== undefined && typeof value !== "boolean") throw new CliError("SEO_SITEMAP_INPUT", "Invalid sitemap entry boolean");
  return value as boolean | undefined;
}

function readEntry(value: unknown): SitemapEntry {
  if (!record(value) || Object.keys(value).some(key => !ENTRY_FIELDS.has(key))) {
    throw new CliError("SEO_SITEMAP_INPUT", "Sitemap entry contains unsupported fields");
  }
  if (typeof value.loc !== "string" || value.loc.length === 0 || value.loc.length > 2048) {
    throw new CliError("SEO_SITEMAP_INPUT", "Sitemap entry requires a bounded loc string");
  }
  if (value.lastmod !== undefined && typeof value.lastmod !== "string") {
    throw new CliError("SEO_SITEMAP_INPUT", "Sitemap lastmod must be a string");
  }
  const frequency = value.changefreq;
  const allowedFrequency = ["always", "hourly", "daily", "weekly", "monthly", "yearly", "never"];
  if (frequency !== undefined && (typeof frequency !== "string" || !allowedFrequency.includes(frequency))) {
    throw new CliError("SEO_SITEMAP_INPUT", "Unsupported sitemap changefreq");
  }
  if (value.priority !== undefined && (typeof value.priority !== "number" ||
      !Number.isFinite(value.priority) || value.priority < 0 || value.priority > 1)) {
    throw new CliError("SEO_SITEMAP_INPUT", "Invalid sitemap priority");
  }
  if (value.status !== undefined && (!Number.isInteger(value.status) ||
      typeof value.status !== "number" || value.status < 100 || value.status > 599)) {
    throw new CliError("SEO_SITEMAP_INPUT", "Invalid sitemap HTTP status");
  }
  if (value.visibility !== undefined && !["public", "private", "draft"].includes(String(value.visibility))) {
    throw new CliError("SEO_SITEMAP_INPUT", "Invalid sitemap visibility");
  }
  if (value.alternates !== undefined && (!record(value.alternates) ||
      Object.entries(value.alternates).some(([locale, target]) =>
        locale.length > 64 || typeof target !== "string" || target.length > 2048))) {
    throw new CliError("SEO_SITEMAP_INPUT", "Invalid sitemap alternates");
  }
  return {
    loc: value.loc,
    lastmod: value.lastmod as string | undefined,
    changefreq: frequency as SitemapEntry["changefreq"],
    priority: value.priority as number | undefined,
    alternates: value.alternates as Readonly<Record<string, string>> | undefined,
    published: optionalBoolean(value, "published"),
    private: value.visibility === "private" || value.visibility === "draft" ? true : optionalBoolean(value, "private"),
    authorized: optionalBoolean(value, "authorized"),
    noindex: optionalBoolean(value, "noindex"),
    status: value.status as number | undefined,
    redirect: optionalBoolean(value, "redirect"),
    soft404: optionalBoolean(value, "soft404")
  };
}

async function loadFile(rootPath: string, relativePath: string): Promise<Record<string, unknown>> {
  const root = resolve(rootPath);
  const path = safeRelativePath(relativePath);
  const base = await lstat(root);
  if (!base.isDirectory() || base.isSymbolicLink()) throw new CliError("SEO_SITEMAP_INPUT", "Unsafe sitemap project root");
  let current = root;
  for (const segment of path.split("/")) {
    current = join(current, segment);
    let info;
    try { info = await lstat(current); }
    catch { throw new CliError("SEO_SITEMAP_INPUT", "Sitemap JSON file does not exist"); }
    if (info.isSymbolicLink()) throw new CliError("SEO_SITEMAP_INPUT", "Sitemap JSON cannot traverse symlinks");
  }
  const info = await lstat(current);
  if (!info.isFile() || info.size > MAX_INPUT_BYTES) {
    throw new CliError("SEO_SITEMAP_INPUT", "Sitemap input must be a JSON file at most 256 KiB");
  }
  let input: unknown;
  try { input = JSON.parse(await readFile(current, "utf8")) as unknown; }
  catch { throw new CliError("SEO_SITEMAP_INPUT", "Sitemap input must contain valid JSON"); }
  if (!record(input) || Object.keys(input).some(key => !INPUT_FIELDS.has(key))) {
    throw new CliError("SEO_SITEMAP_INPUT", "Unsupported sitemap input schema or fields");
  }
  return input;
}

/** Static, deterministic sitemap output from an explicitly supplied local JSON feed. */
export async function generateSitemapFiles(
  rootPath: string, inputPath: string, options: SitemapCliOptions
): Promise<SitemapCliReport> {
  const input = await loadFile(rootPath, inputPath);
  if (input.schema !== "zaakiy.sitemap-input/1" || typeof input.siteURL !== "string" ||
      !Array.isArray(input.entries) || input.entries.length > MAX_INPUT_RECORDS) {
    throw new CliError("SEO_SITEMAP_INPUT", "Expected zaakiy.sitemap-input/1 with siteURL and bounded entries");
  }
  let origin: URL;
  try { origin = new URL(input.siteURL); }
  catch { throw new CliError("SEO_SITEMAP_INPUT", "Invalid sitemap siteURL"); }
  if (origin.protocol !== "https:" || origin.username || origin.password ||
      origin.search || origin.hash || (input.siteURL !== origin.origin && input.siteURL !== origin.origin + "/")) {
    throw new CliError("SEO_SITEMAP_INPUT", "siteURL must be a trusted HTTPS origin");
  }
  for (const key of ["maxEntries", "maxBytes"] as const) {
    if (input[key] !== undefined && (!Number.isSafeInteger(input[key]) || typeof input[key] !== "number")) {
      throw new CliError("SEO_SITEMAP_INPUT", "Invalid sitemap generation bound");
    }
  }
  const entries = input.entries.map(readEntry);
  let build;
  try {
    build = await generateSitemaps(entries, {
      siteURL: origin.origin, maxRecords: MAX_INPUT_RECORDS,
      maxEntries: input.maxEntries as number | undefined,
      maxBytes: input.maxBytes as number | undefined
    });
  } catch {
    // Never echo untrusted URLs, page metadata or filesystem content.
    throw new CliError("SEO_SITEMAP_INPUT", "Sitemap generation rejected invalid, unsafe or conflicting entries");
  }
  const outputDirectory = options.outputPath === undefined ? "public" : safeRelativePath(options.outputPath);
  const files = [
    ...build.files.map(file => ({path: outputDirectory + "/" + file.filename, content: file.xml + "\n"})),
    ...(build.index ? [{path: outputDirectory + "/sitemap-index.xml", content: build.index + "\n"}] : [])
  ];
  const written = await writeGenerated(rootPath, files, {dryRun: options.dryRun, force: options.force});
  return {
    schemaVersion: 1, dryRun: options.dryRun, files: written,
    included: build.files.reduce((total, file) => total + file.count, 0),
    excluded: build.excluded
  };
}
