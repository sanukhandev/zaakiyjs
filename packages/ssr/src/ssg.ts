/** Deterministic build-only static output. No runtime TSX compilation. */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { createNodeServerAdapter } from "./node.js";
import { compileRoutes, matchRoutes } from "@zaakiyjs/router";
import type { ServerOptions } from "./node.js";

export interface StaticBuildOptions {
  readonly server: ServerOptions;
  readonly outDir: string;
  readonly paths?: readonly string[];
  readonly discover?: (signal: AbortSignal) => Promise<readonly string[]> | AsyncIterable<string>;
  readonly concurrency?: number;
  readonly maxRoutes?: number;
  readonly failurePolicy?: "abort" | "continue";
  readonly signal?: AbortSignal;
  readonly assets?: Readonly<Record<string, string>>;
}
export interface StaticResult {
  readonly outputs: readonly { readonly path: string; readonly file: string; readonly sha256: string }[];
  readonly failures: readonly { readonly path: string; readonly reason: string }[];
}
function safeOutput(path: string, root: string): string {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("?") || path.includes("#") ||
      /[%\\\u0000-\u001f\u007f]/.test(path)) throw new TypeError("Unsafe static route path");
  const segments = path.split("/").filter(Boolean);
  if (segments.some(segment => segment === "." || segment === ".." || !/^[\p{L}\p{N}_.~-]+$/u.test(segment)))
    throw new TypeError("Unsafe static route segment");
  const relative = [...segments, "index.html"].join("/");
  const output = resolve(root, relative);
  if (!output.startsWith(root + sep)) throw new TypeError("Static path escapes build directory");
  return output;
}
export async function prerenderStatic(options: StaticBuildOptions): Promise<StaticResult> {
  const concurrency = options.concurrency ?? 4;
  const max = options.maxRoutes ?? 10_000;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16 ||
      !Number.isSafeInteger(max) || max < 1 || max > 100_000) throw new TypeError("Unsafe SSG bounds");
  const root = resolve(options.outDir);
  const signal = options.signal ?? new AbortController().signal;
  if (signal.aborted) throw signal.reason;
  const paths = [...(options.paths ?? [])];
  if (options.discover) {
    const source = await options.discover(signal);
    for await (const path of source) {
      if (signal.aborted) throw signal.reason;
      paths.push(path);
      if (paths.length > max) throw new TypeError("Too many static routes");
    }
  }
  if (paths.length > max) throw new TypeError("Too many static routes");
  const table = compileRoutes(options.server.routes);
  const ssgIds = new Set(options.server.policies.filter(p => p.mode === "ssg" && p.cache?.scope === "public").map(p => p.routeId));
  const unique = new Set<string>();
  const files = new Set<string>();
  const ordered = paths.map(path => {
    const file = safeOutput(path, root);
    const match = matchRoutes(table, path).at(-1);
    if (!match || !ssgIds.has(match.route.id)) throw new TypeError("Route is not approved for public SSG");
    if (unique.has(path) || files.has(file)) throw new TypeError("Duplicate static route: " + path);
    unique.add(path); files.add(file);
    return { path, file };
  }).sort((a, b) => a.path.localeCompare(b.path));
  const policies = options.server.policies.map(policy => {
    if (policy.mode !== "ssg") return policy;
    if (policy.cache?.scope !== "public") throw new TypeError("SSG requires explicitly public routes");
    return { ...policy, mode: "ssr" as const };
  });
  const server = createNodeServerAdapter({ ...options.server, policies, cache: undefined,
    resolvePrincipal: () => ({ scope: "public" }) });
  const successes: { path: string; file: string; body: string; sha256: string }[] = [];
  const failures: { path: string; reason: string }[] = [];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < ordered.length) {
      if (signal.aborted) throw signal.reason;
      const current = ordered[cursor++]!;
      try {
        const target = new URL(current.path, options.server.origin);
        const response = await server.handle(new Request(target), { signal });
        if (response.status !== 200 || !response.headers.get("content-type")?.includes("text/html"))
          throw new TypeError("Static route did not return public HTML (HTTP " + response.status + ")");
        const body = await response.text();
        if (new TextEncoder().encode(body).byteLength > 4_000_000) throw new TypeError("Static HTML too large");
        successes.push({ ...current, body, sha256: createHash("sha256").update(body).digest("hex") });
      } catch {
        failures.push({ path: current.path, reason: "Rendering failed or route was not public" });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ordered.length) }, () => worker()));
  if (failures.length && options.failurePolicy !== "continue") throw new Error("SSG failed for " + failures.length + " routes");
  if (signal.aborted) throw signal.reason;
  successes.sort((a, b) => a.path.localeCompare(b.path));
  const assetEntries = Object.entries(options.assets ?? {}).sort(([a], [b]) => a.localeCompare(b));
  for (const [name, asset] of assetEntries) {
    if (!/^\/[a-zA-Z0-9_./-]+$/.test(name) || name.includes("..") || !/^\/[a-zA-Z0-9_./-]+$/.test(asset) || asset.includes(".."))
      throw new TypeError("Invalid static asset manifest");
  }
  for (const item of successes) {
    await mkdir(resolve(item.file, ".."), { recursive: true });
    await writeFile(item.file, item.body, { encoding: "utf8", flag: "w" });
  }
  const result: StaticResult = { outputs: successes.map(({ path, file, sha256 }) => ({ path, file, sha256 })),
    failures: failures.sort((a, b) => a.path.localeCompare(b.path)) };
  await mkdir(root, { recursive: true });
  await writeFile(resolve(root, "prerender-manifest.json"),
    JSON.stringify({ schema: "zaakiy.prerender/1", buildId: options.server.manifest.buildId,
      assets: Object.fromEntries(assetEntries),
      routes: result.outputs.map(x => ({ path: x.path, file: x.file.slice(root.length + 1).replace(/\\/g, "/"),
        sha256: x.sha256 })) }) + "\n", "utf8");
  return result;
}
