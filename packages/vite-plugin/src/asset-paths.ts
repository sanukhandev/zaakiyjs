/**
 * Manifest source files must be project-relative and independent of machine
 * checkout paths. This package must not require Node typings at build time.
 */
function normalizedAbsolute(path: string): string | undefined {
  if (path.includes("\0")) return undefined;
  const normalized = path.replaceAll("\\", "/");
  if (!normalized.startsWith("/") && !/^[A-Za-z]:\//.test(normalized)) {
    return undefined;
  }
  // Do not try to resolve traversal: Vite's facade IDs should already be
  // resolved absolute paths, and ambiguous paths must never enter a manifest.
  if (normalized.split("/").some(part => part === "." || part === "..")) {
    return undefined;
  }
  return normalized.replace(/\/+$/, "") || "/";
}

export function portableSourceFile(fileName: string | null, projectRoot: string): string | undefined {
  if (!fileName) return undefined;
  const file = normalizedAbsolute(fileName);
  const root = normalizedAbsolute(projectRoot);
  if (!file || !root) return undefined;
  const prefix = root === "/" ? "/" : root + "/";
  // Compare drive letters case-insensitively on Windows, preserve original
  // spelling in the portable result for readable deterministic output.
  const windows = /^[A-Za-z]:\//.test(root);
  if (windows
    ? !file.toLowerCase().startsWith(prefix.toLowerCase())
    : !file.startsWith(prefix)) return undefined;
  const source = file.slice(prefix.length);
  if (!source || source.split("/").some(part => !part || part === "." || part === "..")) return undefined;
  return source;
}

/** sourceMappingURL is interpreted relative to the generated stylesheet. */
export function cssSourceMapComment(cssFileName: string): string {
  const basename = cssFileName.slice(cssFileName.lastIndexOf("/") + 1);
  return "/*# sourceMappingURL=" + basename + ".map */";
}
