import {
  createFilter,
  loadConfigFromFile,
  normalizePath,
  type Plugin,
  type ResolvedConfig,
  type ViteDevServer
} from "vite";
import type { ExtractedStyleToken, StyleConfig } from "@zaakiyjs/styles";
import { createCompilerSession, type CompilerSession } from "@zaakiyjs/compiler";
import type { CompilerDiagnostic } from "@zaakiyjs/compiler";
import { cssSourceMapComment, portableSourceFile } from "./asset-paths.js";
import { equalStyleInputs } from "./style-inputs.js";
import type { ZaakiyAssetManifest, ZaakiyViteOptions, GeneratedAssetRecord } from "./index.js";
import {
  assertBrowserOutput,
  assertStyleConfig,
  forbiddenBrowserImport,
  formatDiagnostic,
  invokeCompiler,
  invokeStyles,
  styleTokensFromResult
} from "./bridge.js";

const PUBLIC_CSS_ID = "virtual:zaakiy-styles.css";
const INTERNAL_CSS_ID = "\u0000virtual:zaakiy-styles.css";
const MANIFEST_FILE = "zaakiy-assets.json";

interface CompiledModule {
  readonly source: string;
  readonly key: string;
  readonly code: string;
  readonly map: string | null;
  readonly tokens: readonly ExtractedStyleToken[];
  readonly additionalCss: readonly string[];
}

function simpleFile(id: string): string {
  return normalizePath(id.split("?")[0] ?? id);
}

function styleFingerprint(value: StyleConfig, targets: readonly string[]): string {
  return JSON.stringify({ value, targets });
}

/** Stable, dependency-free FNV-1a hash for Vite module transform fingerprints. */
function stableHash(source: string): string {
  let hash = 0x811c9dc5;
  for (let offset = 0; offset < source.length; offset++) {
    hash ^= source.charCodeAt(offset);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function sortedTokens(modules: ReadonlyMap<string, CompiledModule>): ExtractedStyleToken[] {
  const known = new Map<string, ExtractedStyleToken>();
  for (const [file, compiled] of [...modules.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    for (const token of compiled.tokens) {
      const normalized: ExtractedStyleToken = { token: token.token, file: token.file || file, offset: token.offset };
      const identity = JSON.stringify([normalized.file, normalized.offset, normalized.token]);
      known.set(identity, normalized);
    }
  }
  return [...known.values()].sort((a, b) =>
    a.token.localeCompare(b.token) || a.file.localeCompare(b.file) || a.offset - b.offset
  );
}

function compilerCss(modules: ReadonlyMap<string, CompiledModule>): string {
  const chunks = new Set<string>();
  for (const [, output] of [...modules.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    for (const code of output.additionalCss) {
      if (code.trim()) chunks.add(code.trim());
    }
  }
  return [...chunks].join("\n");
}

function diagnosticError(d: CompilerDiagnostic, fallback: string): Error & {
  id?: string;
  loc?: { file: string; line: number; column: number };
} {
  const formatted = formatDiagnostic(d, fallback);
  return Object.assign(new Error(formatted.message), {
    id: formatted.id,
    ...(formatted.loc ? { loc: formatted.loc } : {})
  });
}

/**
 * Compiler-first Vite bridge. Runtime APIs are not shimmed: missing upstream
 * implementations are fatal, and no React/TypeScript JSX fallback is used.
 */
export function zaakiyPlugin(options: ZaakiyViteOptions = {}): Plugin {
  if (options.cssVirtualId !== undefined && options.cssVirtualId !== PUBLIC_CSS_ID) {
    throw new Error("ZV0001: CSS virtual ID is frozen as " + PUBLIC_CSS_ID);
  }
  const cssOutputFile = options.cssFileName ?? "assets/zaakiy-styles.css";
  if (!/^assets\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.css$/.test(cssOutputFile)) {
    throw new Error("ZV0002: cssFileName must be an assets/ path with a .css extension, without traversal or URL segments");
  }
  const filter = createFilter(
    options.include?.length ? [...options.include] : /\.[cm]?tsx$/,
    options.exclude?.length ? [...options.exclude] : undefined
  );
  const modules = new Map<string, CompiledModule>();
  const revisions = new Map<string, number>();
  // Weak keys avoid retaining old ModuleNodes after Vite graph invalidation.
  const dependencyCodeHashes = new WeakMap<object, { code: string; hash: string }>();
  let resolved: ResolvedConfig | undefined;
  let server: ViteDevServer | undefined;
  let configPath: string | undefined;
  let brand: StyleConfig = { brand: {} };
  let css = "";
  let compiledCssMap: string | undefined;
  let lastStyleKey = "";
  let configRevision = 0;
  let buildMode = false;
  let compilerSession: CompilerSession | undefined;

  function isTsx(id: string): boolean {
    const file = simpleFile(id);
    return /\.[cm]?tsx$/.test(file) && filter(file) &&
      !file.includes("/node_modules/");
  }

  function graphStamp(file: string): string {
    if (!server) return "";
    const start = server.moduleGraph.getModuleById(file);
    if (!start) return "";
    const visited = new Set<string>();
    const stamp: string[] = [];
    function walk(mod: typeof start): void {
      if (!mod || visited.has(mod.url)) return;
      visited.add(mod.url);
      for (const dependency of mod.importedModules) {
        const id = dependency.file ? simpleFile(dependency.file) : dependency.id;
        if (id && !visited.has(dependency.url)) {
          const content = dependency.transformResult?.code ?? dependency.ssrTransformResult?.code ?? "";
          const previousHash = dependencyCodeHashes.get(dependency);
          const hash = previousHash?.code === content ? previousHash.hash : stableHash(content);
          if (!previousHash || previousHash.code !== content) {
            dependencyCodeHashes.set(dependency, { code: content, hash });
          }
          stamp.push(id + ":" + (revisions.get(id) ?? 0) + ":" + hash);
          walk(dependency);
        }
      }
    }
    walk(start);
    return stamp.sort().join("|");
  }

  async function loadBrand(): Promise<void> {
    if (!resolved) return;
    if (!options.configFile) {
      brand = { brand: {} };
      configRevision++;
      return;
    }
    const path = normalizePath(options.configFile);
    configPath = /^(?:[A-Za-z]:)?\//.test(path) ? path : normalizePath(resolved.root + "/" + path);
    const loaded = await loadConfigFromFile(
      { command: resolved.command, mode: resolved.mode },
      configPath,
      resolved.root,
      "silent"
    );
    if (!loaded) {
      throw new Error("ZV2006: Unable to load brand configuration " + configPath);
    }
    brand = assertStyleConfig(loaded.config, configPath);
    configRevision++;
  }

  async function collectCss(minify: boolean): Promise<void> {
    const hasStyleInputs = modules.size > 0 || Object.keys(brand.brand).length > 0 ||
      Boolean(brand.mode || brand.safelist?.length);
    if (!hasStyleInputs) {
      css = "";
      compiledCssMap = undefined;
      lastStyleKey = "";
      return;
    }
    const tokens = sortedTokens(modules);
    const extra = compilerCss(modules);
    const key = JSON.stringify({
      config: styleFingerprint(brand, options.browserTargets ?? []),
      tokens,
      extra,
      minify
    });
    if (key === lastStyleKey) return;
    const result = await invokeStyles({ tokens, config: brand, minify });
    for (const diagnostic of result.diagnostics) {
      const metadata = diagnostic as unknown as {
        readonly severity?: "error" | "warning";
        readonly file?: string;
        readonly offset?: number;
      };
      const location = metadata.file
        ? " (" + metadata.file + (metadata.offset === undefined ? "" : ":" + metadata.offset) + ")"
        : "";
      const message = "[" + diagnostic.code + "] " + diagnostic.message + location;
      if (metadata.severity === "error" || diagnostic.code === "ZSTY_DYNAMIC_CLASS") {
        throw new Error(message);
      }
      resolved?.logger.warn(message);
    }
    css = [result.css.trim(), extra].filter(Boolean).join("\n");
    // A concatenated compiler CSS fragment cannot inherit the styles-only map.
    compiledCssMap = extra ? undefined : result.sourceMap;
    lastStyleKey = key;
  }

  function bump(file: string): void {
    revisions.set(file, (revisions.get(file) ?? 0) + 1);
  }

  function evictDependents(file: string, devServer: ViteDevServer): boolean {
    const visited = new Set<string>();
    let affected = false;
    const graphModules = devServer.moduleGraph.getModulesByFile(file);
    const walk = (mod: NonNullable<typeof graphModules> extends Set<infer T> ? T : never): void => {
      if (visited.has(mod.url)) return;
      visited.add(mod.url);
      if (mod.file && modules.delete(simpleFile(mod.file))) affected = true;
      devServer.moduleGraph.invalidateModule(mod);
      for (const importer of mod.importers) walk(importer);
    };
    for (const mod of graphModules ?? []) walk(mod);
    if (modules.delete(file)) affected = true;
    return affected;
  }

  return {
    name: "zaakiy:compiler",
    enforce: "pre",

    async configResolved(config) {
      resolved = config;
      buildMode = config.command === "build";
      compilerSession?.dispose();
      compilerSession = createCompilerSession(config.root);
      await loadBrand();
    },

    configureServer(devServer) {
      server = devServer;
      if (configPath) devServer.watcher.add(configPath);
      devServer.httpServer?.once("close", () => {
        compilerSession?.dispose();
        compilerSession = undefined;
      });
    },

    resolveId(source, importer, opts) {
      if (source === PUBLIC_CSS_ID) return INTERNAL_CSS_ID;
      if (source === INTERNAL_CSS_ID) return INTERNAL_CSS_ID;
      if (!opts?.ssr && importer && forbiddenBrowserImport(source)) {
        this.error("ZV3001: Server-only module " + source + " cannot enter a Zaakiy browser graph (imported by " + importer + ")");
      }
      return null;
    },

    async load(id) {
      if (id === INTERNAL_CSS_ID) {
        // The development virtual module compiles current utilities and config.
        // Production CSS is emitted after all component transforms complete.
        if (!buildMode) await collectCss(false);
        return buildMode ? "" : css;
      }
      return null;
    },

    transformIndexHtml: {
      order: "post",
      handler(html) {
        if (!buildMode) return html;
        // Vite may emit index.html after this plugin's generateBundle hook.
        // Link at HTML-transform time, never by mutating a possibly absent asset.
        if (!/<\/head\s*>/i.test(html)) {
          throw new Error("ZV2010: HTML entry has no </head> for Zaakiy CSS linkage");
        }
        const href = ((resolved?.base ?? "/") + cssOutputFile)
          .replaceAll("&", "&amp;").replaceAll('"', "&quot;");
        return html.replace(
          /<\/head\s*>/i,
          '<link rel="stylesheet" href="' + href + '"></head>'
        );
      }
    },

    async transform(source, id, transformOptions) {
      if (!isTsx(id)) return null;
      if (transformOptions?.ssr) {
        this.error("ZV1008: Zaakiy TSX SSR transform is unsupported; do not fall back to generic JSX lowering (" + id + ")");
      }
      const file = simpleFile(id);
      const key = JSON.stringify([
        file, source, configRevision,
        styleFingerprint(brand, options.browserTargets ?? []),
        options.componentSlots === true ? "component-slots-ir2" : "ir1",
        graphStamp(file)
      ]);
      const previous = modules.get(file);
      if (previous?.key === key) {
        return { code: previous.code, map: previous.map };
      }

      const output = await invokeCompiler({
        fileName: file,
        source,
        rootDir: resolved?.root,
        targetBrowsers: options.browserTargets,
        componentSlots: options.componentSlots === true
      }, compilerSession);
      for (const diagnostic of output.diagnostics) {
        const error = diagnosticError(diagnostic, file);
        if (diagnostic.severity === "error") this.error(error);
        else if (diagnostic.severity === "warning") this.warn(error);
        else resolved?.logger.info(error.message);
      }
      if (output.js.length !== 1) {
        this.error("ZV1005: The first Vite ABI requires one JS asset per transformed TSX module (" + file + ")");
      }
      const asset = output.js[0];
      if (!asset) this.error("ZV1005: No executable JS asset was returned for " + file);
      if (asset.map) {
        try {
          const parsed: unknown = JSON.parse(asset.map);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("Invalid map object");
          }
          const map = parsed as Record<string, unknown>;
          if (map.version !== 3 || !Array.isArray(map.sources) ||
              map.sources.some((source: unknown) => typeof source !== "string") ||
              typeof map.mappings !== "string") {
            throw new Error("Source map must be version 3 with sources and mappings");
          }
        } catch {
          this.error("ZV1006: Malformed source map returned by compiler for " + file);
        }
      } else if (resolved?.build.sourcemap) {
        this.error("ZV1007: Source map was requested but the compiler omitted it for " + file);
      }

      assertBrowserOutput(asset.code, file);
      const record: CompiledModule = {
        source,
        key,
        code: asset.code + '\nimport "' + PUBLIC_CSS_ID + '";\n',
        map: asset.map ?? null,
        tokens: styleTokensFromResult(output, file, source),
        additionalCss: output.css.map((item) => item.code)
      };
      modules.set(file, record);
      try {
        if (!buildMode && (!previous || !equalStyleInputs(previous, record))) {
          const previousCss = css;
          const previousMap = compiledCssMap;
          await collectCss(false);
          // Do not invalidate the stylesheet when TSX produced identical CSS
          // and mapping; this also avoids needless dependent browser updates.
          if (previousCss !== css || previousMap !== compiledCssMap) {
            const styleModule = server?.moduleGraph.getModuleById(INTERNAL_CSS_ID);
            if (styleModule && server) server.moduleGraph.invalidateModule(styleModule);
          }
        }
      } catch (error) {
        modules.delete(file);
        throw error;
      }
      return { code: record.code, map: record.map };
    },

    async handleHotUpdate(ctx) {
      const file = simpleFile(ctx.file);
      compilerSession?.invalidate(file);
      bump(file);
      if (configPath && file === configPath) {
        await loadBrand();
        modules.clear();
        lastStyleKey = "";
        css = "";
        ctx.server.ws.send({ type: "full-reload", path: "*" });
        return [];
      }
      if (isTsx(file)) {
        // Preserve the previous CSS contribution until the new TSX transform
        // replaces it. Source bytes/revision still invalidate the JS cache.
        // This lets a JavaScript-only edit skip global CSS regeneration, while
        // a style-token edit regenerates CSS with exact source positions.
        // Owner-safe stateful HMR is not implemented: reload remains required.
        ctx.server.ws.send({ type: "full-reload", path: "*" });
        return [];
      }
      if (evictDependents(file, ctx.server)) {
        modules.delete(file);
        lastStyleKey = "";
        ctx.server.ws.send({ type: "full-reload", path: "*" });
        return [];
      }
      return undefined;
    },

    closeBundle() {
      compilerSession?.dispose();
      compilerSession = undefined;
    },

    async generateBundle(_output, bundle) {
      if (!buildMode) return;
      await collectCss(true);
      // Emit even an empty stylesheet so every HTML entry has a valid link.
      const content = compiledCssMap && resolved?.build.sourcemap
        ? css + "\n" + cssSourceMapComment(cssOutputFile) + "\n"
        : css;
      this.emitFile({ type: "asset", fileName: cssOutputFile, source: content });
      if (compiledCssMap && resolved?.build.sourcemap) {
        this.emitFile({
          type: "asset",
          fileName: cssOutputFile + ".map",
          source: compiledCssMap
        });
      }
      const assets: GeneratedAssetRecord[] = Object.values(bundle)
        .map((entry): GeneratedAssetRecord | null => {
          if (entry.type === "chunk") {
            for (const mod of Object.keys(entry.modules)) {
              const id = normalizePath(mod);
              // Inspect executable package roots, not similarly named fixture paths.
              // A source fixture nested under packages/vite-plugin/test is app code.
              const packageSource = /(?:^|\/)packages\/(?:compiler|styles|ai|proxy|vite-plugin)\/(?:src|dist)(?:\/|$)/;
              const installedPackage = /(?:^|\/)node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?@zaakiyjs\/(?:compiler|styles|ai|proxy|vite-plugin)(?:\/|$)/;
              if (packageSource.test(id) || installedPackage.test(id)) {
                this.error("ZV3002: Build-only package entered browser chunk " + entry.fileName + ": " + mod);
              }
            }
            assertBrowserOutput(entry.code, entry.fileName);
            return {
              fileName: entry.fileName,
              kind: "js",
              ...(entry.facadeModuleId && resolved
                ? (() => {
                    const sourceFile = portableSourceFile(simpleFile(entry.facadeModuleId), resolved.root);
                    return sourceFile ? { sourceFile } : {};
                  })()
                : {})
            };
          }
          if (entry.fileName.endsWith(".css")) return { fileName: entry.fileName, kind: "css" };
          if (entry.fileName.endsWith(".map")) return { fileName: entry.fileName, kind: "map" };
          return null;
        })
        .filter((item): item is GeneratedAssetRecord => item !== null);
      assets.push({ fileName: cssOutputFile, kind: "css" });
      if (compiledCssMap && resolved?.build.sourcemap) {
        assets.push({ fileName: cssOutputFile + ".map", kind: "map" });
      }
      assets.push({ fileName: MANIFEST_FILE, kind: "manifest" });
      const manifest: ZaakiyAssetManifest = {
        schemaVersion: 1,
        assets: assets.sort((a, b) => a.fileName.localeCompare(b.fileName))
      };
      this.emitFile({ type: "asset", fileName: MANIFEST_FILE, source: JSON.stringify(manifest, null, 2) + "\n" });
    }
  };
}
