import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const expected = new Set(["signals", "core", "dom", "compiler", "styles", "vite-plugin", "cli"]);
const allowed = new Set([...expected, "compat", "store", "async", "router", "forms", "http", "proxy", "templates"]);
const scriptNames = ["lint", "typecheck", "build", "test"];
const manifestByName = new Map();
let errors = 0;
function fail(message) { console.error(message); errors++; }
for (const group of ["packages", "apps", "examples"]) {
  if (!existsSync(group)) continue;
  for (const entry of readdirSync(group)) {
    const dir = join(group, entry);
    if (!statSync(dir).isDirectory()) continue;
    const manifestPath = join(dir, "package.json");
    if (!existsSync(manifestPath)) { fail(`Missing package.json in workspace ${dir}`); continue; }
    let pkg;
    try { pkg = JSON.parse(readFileSync(manifestPath, "utf8")); }
    catch { fail(`Invalid JSON: ${manifestPath}`); continue; }
    for (const script of scriptNames) {
      if (!pkg.scripts?.[script]?.trim()) fail(`Missing operational ${script} script: ${manifestPath}`);
    }
    if (group !== "packages") continue;
    if (!allowed.has(entry)) fail(`Unexpected source package: ${dir}`);
    if (pkg.name !== `@zaakiyjs/${entry}`) fail(`Name/path mismatch: ${manifestPath}`);
    const entrypoint = pkg.exports?.["."];
    const serverOnly = entry === "proxy";
    const validEntrypoint = serverOnly
      ? entrypoint?.node?.types && entrypoint?.node?.import && !entrypoint.import && !entrypoint.default && !entrypoint.browser
      : entrypoint?.types && entrypoint?.import;
    if (pkg.type !== "module" || !pkg.types || !validEntrypoint) fail(`Missing or unsafe ESM exports/types: ${manifestPath}`);
    if (!pkg.version || !pkg.publishConfig || pkg.publishConfig.access !== "public") fail(`Missing independent version or publication metadata: ${manifestPath}`);
    manifestByName.set(pkg.name, pkg);
  }
}
for (const name of expected) if (!manifestByName.has(`@zaakiyjs/${name}`)) fail(`Missing required M0 package: ${name}`);
const browserPackages = new Set(["@zaakiyjs/signals", "@zaakiyjs/core", "@zaakiyjs/dom", "@zaakiyjs/store", "@zaakiyjs/async", "@zaakiyjs/router", "@zaakiyjs/forms", "@zaakiyjs/http", "@zaakiyjs/templates"]);
const buildOnly = new Set(["@zaakiyjs/compiler", "@zaakiyjs/styles", "@zaakiyjs/vite-plugin", "@zaakiyjs/cli", "@zaakiyjs/compat"]);
const serverOnly = new Set(["@zaakiyjs/proxy"]);
const depsOf = (name) => Object.keys(manifestByName.get(name)?.dependencies ?? {}).filter((dep) => dep.startsWith("@zaakiyjs/"));
for (const [name, pkg] of manifestByName) {
  for (const dep of depsOf(name)) {
    if (!manifestByName.has(dep)) fail(`Unknown internal dependency ${name} -> ${dep}`);
    if (!pkg.dependencies[dep].startsWith("workspace:")) fail(`Internal dependency must use workspace protocol: ${name} -> ${dep}`);
    if (browserPackages.has(name) && buildOnly.has(dep)) fail(`Browser package cannot import build-only ${dep}`);
    if (browserPackages.has(name) && serverOnly.has(dep)) fail(`Browser package cannot import server-only ${dep}`);
  }
}
if (depsOf("@zaakiyjs/signals").length) fail("signals must not depend on any other workspace package");
const state = new Map();
function visit(name, path = []) {
  if (state.get(name) === "done") return;
  if (state.get(name) === "active") { fail(`Circular package dependencies: ${[...path, name].join(" -> ")}`); return; }
  state.set(name, "active");
  for (const dep of depsOf(name)) if (manifestByName.has(dep)) visit(dep, [...path, name]);
  state.set(name, "done");
}
for (const name of manifestByName.keys()) visit(name);
const root = JSON.parse(readFileSync("package.json", "utf8"));
for (const name of expected) {
  if (root.devDependencies?.[`@zaakiyjs/${name}`] !== "workspace:^") {
    fail(`Root contract consumer must link @zaakiyjs/${name} through workspace:^ devDependency`);
  }
}
if (!existsSync("pnpm-lock.yaml")) fail("M0 source packages require committed pnpm-lock.yaml");
const changeset = JSON.parse(readFileSync(".changeset/config.json", "utf8"));
if (changeset.fixed?.length || changeset.linked?.length) fail("Changesets must remain independently versioned");
if (errors) process.exit(1);
console.log(`Workspace contract valid: ${manifestByName.size} packages, independent versions, no cycles`);
