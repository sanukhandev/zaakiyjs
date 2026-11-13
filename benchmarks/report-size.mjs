import {readdir, readFile, writeFile, mkdir} from "node:fs/promises";
import {join, resolve, relative} from "node:path";
import {gzipSync, brotliCompressSync, constants} from "node:zlib";

async function assets(root, folder = root) {
  const result = [];
  for (const entry of await readdir(folder, {withFileTypes: true})) {
    const full = join(folder, entry.name);
    if (entry.isDirectory()) result.push(...await assets(root, full));
    else if (entry.isFile() && /\.(?:js|css)$/.test(entry.name)) {
      const bytes = await readFile(full);
      result.push({
        file: relative(root, full).replaceAll("\\", "/"),
        raw: bytes.length,
        gzip: gzipSync(bytes, {level: 9}).length,
        brotli: brotliCompressSync(bytes, {params: {[constants.BROTLI_PARAM_QUALITY]: 11}}).length
      });
    }
  }
  return result.sort((a, b) => a.file.localeCompare(b.file));
}
const variants = {
  react: "benchmarks/react-reference/dist",
  baseline: ".benchmark-baseline/apps/benchmark-app/dist",
  hardening: ".benchmark-hardening/apps/benchmark-app/dist",
  candidate: "apps/benchmark-app/dist"
};
const result = {schemaVersion: 1, units: "bytes", assets: {}};
for (const [name, folder] of Object.entries(variants)) {
  const values = await assets(resolve(folder));
  if (!values.length) throw new Error("No production JS/CSS for " + name);
  result.assets[name] = {
    totals: Object.fromEntries(["raw", "gzip", "brotli"].map(key => [key, values.reduce((total, item) => total + item[key], 0)])),
    files: values
  };
}
await mkdir("benchmark-artifacts", {recursive: true});
await writeFile("benchmark-artifacts/bundle-sizes.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(Object.fromEntries(Object.entries(result.assets).map(([name, details]) => [name, details.totals])), null, 2));