import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Validate files referenced by package exports, typings, and command-line bins
 * after the full workspace build. No package is imported or executed.
 */
export function inspectPackageExports(root) {
  const packageDir = join(root, "packages");
  const findings = [];
  const packages = [];
  for (const entry of readdirSync(packageDir, { withFileTypes: true }).filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const directory = join(packageDir, entry.name);
    const manifestPath = join(directory, "package.json");
    if (!existsSync(manifestPath)) {
      findings.push({ package: entry.name, field: "package.json", message: "Missing manifest" });
      continue;
    }
    let manifest;
    try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); }
    catch { findings.push({ package: entry.name, field: "package.json", message: "Invalid JSON" }); continue; }
    let verified = 0;
    const check = (field, target) => {
      if (typeof target !== "string" || !target.startsWith("./") || target.includes("*")) {
        findings.push({ package: entry.name, field, message: "Expected a concrete package-relative file target" });
        return;
      }
      const candidate = resolve(directory, target);
      const relativePath = relative(directory, candidate);
      if (!relativePath || relativePath === ".." || relativePath.startsWith(".." + sep) || relativePath.startsWith(sep)) {
        findings.push({ package: entry.name, field, message: "Export target escapes package directory" });
        return;
      }
      if (!existsSync(candidate) || !statSync(candidate).isFile()) {
        findings.push({ package: entry.name, field, message: "Export file missing: " + target });
        return;
      }
      const realTarget = realpathSync(candidate);
      const realRoot = realpathSync(directory);
      const realRelative = relative(realRoot, realTarget);
      if (!realRelative || realRelative === ".." || realRelative.startsWith(".." + sep) || realRelative.startsWith(sep)) {
        findings.push({ package: entry.name, field, message: "Export symlink escapes package directory" });
        return;
      }
      verified++;
    };
    const walk = (field, value) => {
      if (typeof value === "string") { check(field, value); return; }
      if (!value || typeof value !== "object" || Array.isArray(value) || !Object.keys(value).length) {
        findings.push({ package: entry.name, field, message: "Missing or invalid conditional export" });
        return;
      }
      for (const [condition, child] of Object.entries(value)) walk(field + "." + condition, child);
    };
    if (!manifest.exports || !Object.keys(manifest.exports).length) {
      findings.push({ package: entry.name, field: "exports", message: "Missing exports" });
    } else {
      walk("exports", manifest.exports);
    }
    if (manifest.types) check("types", manifest.types);
    if (typeof manifest.bin === "string") check("bin", manifest.bin);
    else if (manifest.bin && typeof manifest.bin === "object") {
      for (const [name, target] of Object.entries(manifest.bin)) check("bin." + name, target);
    }
    packages.push({ name: manifest.name ?? entry.name, verifiedTargets: verified });
  }
  return { schemaVersion: 1, packageCount: packages.length, packages, findings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = inspectPackageExports(resolve(process.argv[2] ?? "."));
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (result.findings.length) process.exitCode = 1;
}
