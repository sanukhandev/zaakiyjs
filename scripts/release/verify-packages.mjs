#!/usr/bin/env node
/**
 * Audit built release artifacts, then install actual tarballs outside of the
 * workspace. This never contacts or publishes to npm except for ordinary
 * public, pinned third-party consumer dependencies.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pkgs = readdirSync(join(root, "packages"), { withFileTypes: true })
  .filter(entry => entry.isDirectory() && existsSync(join(root, "packages", entry.name, "package.json")))
  .map(entry => entry.name)
  .sort();
const verifyRelease = process.argv.includes("--enforce-release");
const temp = mkdtempSync(join(tmpdir(), "zaakiy-packed-consumer-"));
const output = process.env.ZAAKIY_RELEASE_REPORT || join(root, ".generated", "packed-consumer-report.json");
const findings = [];
const archives = {};
function run(program, args, cwd = root) {
  return execFileSync(program, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
function fail(message) { throw new Error(message); }
function check(cond, message) { if (!cond) fail(message); }
function warn(message) { findings.push(message); console.log("RELEASE BLOCKER: " + message); }
function listTar(path) { return run("tar", ["-tzf", path]).trim().split("\n").filter(Boolean); }
function readTar(path, entry) { return run("tar", ["-xOzf", path, entry]); }
try {
  mkdirSync(join(temp, "packages"), { recursive: true });
  for (const name of pkgs) {
    const source = join(root, "packages", name);
    const manifest = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
    const filesBefore = new Set(readdirSync(join(temp, "packages")));
    run("pnpm", ["pack", "--pack-destination", join(temp, "packages")], source);
    const generated = readdirSync(join(temp, "packages"))
      .filter(path => !filesBefore.has(path) && path.endsWith(".tgz"));
    check(generated.length === 1, "Exactly one package archive expected for " + name);
    const archive = join(temp, "packages", generated[0]);
    archives[manifest.name] = archive;
    const contents = new Set(listTar(archive));
    check(contents.has("package/package.json"), name + ": missing package manifest");
    const packed = JSON.parse(readTar(archive, "package/package.json"));
    check(packed.name === manifest.name, name + ": unexpected package identity");
    check(packed.version === manifest.version, name + ": version mismatch");
    for (const [entry, exports] of Object.entries(packed.exports ?? {})) {
      if (typeof exports !== "object" || exports === null) fail(name + ": non-object ESM export " + entry);
      const exportTargets = name === "proxy" ? exports.node : exports;
      if (name === "proxy") check(exportTargets && !exports.import && !exports.default && !exports.browser,
        name + ": must expose Node-only exports");
      for (const key of ["import", "types"]) {
        const target = exportTargets?.[key];
        check(typeof target === "string" && target.startsWith("./"),
          name + ": missing " + key + " for export " + entry);
        check(contents.has("package/" + target.slice(2)),
          name + ": packed export " + entry + " " + key + " does not exist: " + target);
      }
    }
    if (packed.bin) {
      for (const path of Object.values(packed.bin)) {
        check(contents.has("package/" + String(path).replace(/^\.\//, "")),
          name + ": missing packed CLI executable " + path);
      }
    }
    for (const [dep, range] of Object.entries(packed.dependencies ?? {})) {
      check(!String(range).startsWith("workspace:"),
        name + ": leaked workspace protocol in packed dependency " + dep);
    }
    if (manifest.version === "0.0.0") warn(name + " still has placeholder 0.0.0 version");
    if (!packed.license) warn(name + " package.json lacks license metadata");
    console.log("PACK PASS " + name + " files=" + contents.size +
      " tarballSHA256=" + createHash("sha256").update(readFileSync(archive)).digest("hex"));
  }
  if (!existsSync(join(root, "LICENSE")) && !existsSync(join(root, "LICENSE.md"))) {
    warn("Repository has no approved root LICENSE; publication must not proceed");
  }
  if (verifyRelease && findings.length) fail("Release preflight has " + findings.length + " unresolved blockers");

  const consumer = join(temp, "external-consumer");
  mkdirSync(consumer, { recursive: true });
  const deps = Object.fromEntries(Object.entries(archives).map(([name, path]) => [name, "file:" + path]));
  writeFileSync(join(consumer, "package.json"), JSON.stringify({
    name: "zaakiyjs-clean-consumer", version: "1.0.0", type: "module", private: true,
    dependencies: { ...deps, typescript: "5.9.3", vite: "6.3.5" },
    pnpm: { overrides: deps }
  }, null, 2));
  run("pnpm", ["install", "--ignore-scripts", "--no-frozen-lockfile"], consumer);
  writeFileSync(join(consumer, "verify.mjs"), [
    'import { signal } from "@zaakiyjs/signals";',
    'import { mount } from "@zaakiyjs/dom";',
    'import { Show, For } from "@zaakiyjs/core";',
    'import { compile } from "@zaakiyjs/compiler";',
    'import { zaakiyPlugin } from "@zaakiyjs/vite-plugin";',
    'import * as styles from "@zaakiyjs/styles";',
    'import * as cli from "@zaakiyjs/cli";',
    'import * as compat from "@zaakiyjs/compat";',
    'import * as asyncEngine from "@zaakiyjs/async";',
    'import * as store from "@zaakiyjs/store";',
    'import { createProxyRouter } from "@zaakiyjs/proxy";',
    'if(typeof createProxyRouter !== "function") throw new Error("Node proxy export missing");',
    'const s = signal(1); s.value++; if(s.value !== 2) throw new Error("Signal contract failed");',
    'if(typeof mount !== "function" || typeof Show !== "function" || typeof For !== "function") throw new Error("DOM/Core entrypoint missing");',
    'if(typeof compile !== "function" || typeof zaakiyPlugin !== "function") throw new Error("Build entrypoint missing");',
    'if(!Object.keys(styles).length || !Object.keys(cli).length || !Object.keys(compat).length || !Object.keys(asyncEngine).length || !Object.keys(store).length) throw new Error("Packed package empty");',
    'const out = compile({ fileName: "test.tsx", source: "function App(){ return <main>ok</main> }" });',
    'if(out.js.length !== 1 || out.diagnostics.some(d => d.severity === "error")) throw new Error(JSON.stringify(out.diagnostics));',
    'console.log("EXTERNAL CONSUMER ESM PASS");'
  ].join("\n"));
  run("node", ["verify.mjs"], consumer);
  writeFileSync(join(consumer, "types.tsx"),
    'import {signal} from "@zaakiyjs/signals";\n' +
    'import type {JSX} from "@zaakiyjs/core/jsx-runtime";\n' +
    'const x=signal(0); const y: JSX.Element=<p>{x.value}</p>; void y;\n');
  writeFileSync(join(consumer, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2022", module: "ESNext", moduleResolution: "Bundler",
      jsx: "preserve", jsxImportSource: "@zaakiyjs/core",
      strict: true, skipLibCheck: false, noEmit: true
    }, include: ["types.tsx"]
  }, null, 2));
  run("pnpm", ["exec", "tsc", "--noEmit"], consumer);
  console.log("EXTERNAL CONSUMER TYPECHECK PASS");
  const report = {
    validated: true, internalPackageCount: pkgs.length,
    packedConsumption: true, esm: true, typescript: true,
    npmPublished: false, licenseApproved: false, npmScopeOwnershipVerified: false,
    releaseBlockers: [...findings]
  };
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log("RESULT " + JSON.stringify(report));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
