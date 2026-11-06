import { Buffer } from "node:buffer";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { gzipSync, brotliCompressSync } from "node:zlib";

const folder = resolve("dist");
let jsFiles = [];
function walk(path) {
  for (const entry of readdirSync(path)) {
    const target = join(path, entry);
    if (statSync(target).isDirectory()) walk(target);
    else if (target.endsWith(".js")) jsFiles.push(target);
  }
}
walk(folder);
if (!jsFiles.length) throw new Error("Ads build artifacts missing");
const buffers = jsFiles.sort().map(file => readFileSync(file));
const full = Buffer.concat(buffers);
const report = {
  package: "@zaakiyjs/ads",
  esmModules: jsFiles.length,
  jsBytes: full.length,
  gzipBytes: gzipSync(full, { level: 9 }).length,
  brotliBytes: brotliCompressSync(full).length,
  vendorDependencies: 0
};
console.log(JSON.stringify(report, null, 2));
