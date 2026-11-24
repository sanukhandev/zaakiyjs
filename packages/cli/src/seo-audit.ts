import { lstat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { auditSeoV1 } from "@zaakiyjs/seo";
import type { SeoAuditInputV1 } from "@zaakiyjs/seo";
import { CliError } from "./args.js";
import { safeRelativePath } from "./fs-safe.js";

const MAX_SEO_INPUT_BYTES = 256 * 1024;

/** No JSON input is treated as executable code; no write operations. */
export async function auditSeoFile(projectRoot: string, inputPath: string) {
  const normalized = safeRelativePath(inputPath);
  const root = resolve(projectRoot);
  let current = root;
  for (const part of normalized.split("/")) {
    current = join(current, part);
    let info;
    try { info = await lstat(current); }
    catch { throw new CliError("SEO_INPUT", "SEO audit input does not exist"); }
    if (info.isSymbolicLink()) throw new CliError("SEO_SYMLINK", "SEO audit refuses symbolic links");
  }
  const fileInfo = await lstat(current);
  if (!fileInfo.isFile() || fileInfo.size > MAX_SEO_INPUT_BYTES) {
    throw new CliError("SEO_INPUT", "SEO audit expects a JSON file smaller than 256 KiB");
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(current, "utf8")) as unknown;
  } catch {
    throw new CliError("SEO_INPUT", "SEO audit input is not valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CliError("SEO_INPUT", "SEO audit input must be a versioned SEO object");
  }
  const fields = value as Record<string, unknown>;
  const resolution = fields.resolution;
  if (!resolution || typeof resolution !== "object" || Array.isArray(resolution) ||
      fields.visibility !== "public" && fields.visibility !== "private" && fields.visibility !== "draft") {
    throw new CliError("SEO_INPUT", "SEO audit requires resolution and valid visibility");
  }
  const record = resolution as Record<string, unknown>;
  if (record.version !== 1 || !Number.isInteger(record.status) ||
      !record.metadata || typeof record.metadata !== "object" || Array.isArray(record.metadata) ||
      (record.metadata as Record<string, unknown>).version !== 1) {
    throw new CliError("SEO_INPUT", "SEO audit requires the supported version 1 resolution/metadata contract");
  }
  let diagnostics: ReturnType<typeof auditSeoV1>;
  try {
    diagnostics = auditSeoV1(value as unknown as SeoAuditInputV1);
  } catch {
    // Untrusted document errors are not allowed to leak strings or serialized secrets.
    throw new CliError("SEO_INPUT", "SEO audit rejected malformed metadata");
  }
  return {schemaVersion: 1 as const, ok: diagnostics.every(item => item.severity !== "error"),
    diagnostics};
}
