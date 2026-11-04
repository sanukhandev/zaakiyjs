import { isAbsolute, relative } from "node:path";

/**
 * Vite's facadeModuleId is typically an absolute machine-local path.
 * Asset metadata must use project-relative, POSIX paths only.
 *
 * Exclude virtual modules, external package entries and files outside root:
 * they have no meaningful reproducible sourceFile value.
 */
export function portableSourceFile(fileName: string | null, projectRoot: string): string | undefined {
  if (!fileName || fileName.includes("\0") ||
      !isAbsolute(fileName) || !isAbsolute(projectRoot)) return undefined;
  const path = relative(projectRoot, fileName).replaceAll("\\", "/");
  if (!path || path === "." || path === ".." ||
      path.startsWith("../") || path.startsWith("/") ||
      /^[A-Za-z]:\//.test(path)) return undefined;
  return path;
}

/** The URL in a CSS sourceMappingURL comment is relative to its CSS asset. */
export function cssSourceMapComment(cssFileName: string): string {
  const basename = cssFileName.slice(cssFileName.lastIndexOf("/") + 1);
  return "/*# sourceMappingURL=" + basename + ".map */";
}
