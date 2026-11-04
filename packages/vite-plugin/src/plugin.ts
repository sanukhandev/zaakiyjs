import {
  createFilter,
  loadConfigFromFile,
  normalizePath,
  type Plugin,
  type ResolvedConfig,
  type ViteDevServer
} from "vite";
import type { ExtractedStyleToken, StyleConfig } from "@zaakiyjs/styles";
import type { CompilerDiagnostic } from "@zaakiyjs/compiler";
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
const OUTPUT_CSS_FILE = "assets/zaakiy-styles.css";
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
  const filter = createFilter(
    options.include?.length ? [...options.include] : /\.[cm]?tsx$/,
    options.exclude?.length ? [...options.exclude] : undefined
  );
  const modules = new Map<string, CompiledModule>();
  const revisions = new Map<string, number>();
  let resolved: ResolvedConfig | undefined;
  let server: ViteDevServer | undefined;
  let configPath: string | undefined;
  let brand: StyleConfig = { brand: {} };
  let css = "";
  let compiledCssMap: string | undefined;
  let lastStyleKey = "";
  let configRevision = 0;
  let buildMode = false;

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
          stamp.push(id + ":" + (revisions.get(id) ?? 0));
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
    if (!modules.size) {
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
    if (result.diagnostics.length) {
      const error = result.diagnostics[0];
      if (error) throw new Error("[" + error.code + "] " + error.message);
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
      await loadBrand();
    },

    configureServer(devServer) {
      server = devServer;
      if (configPath) devServer.watcher.add(configPath);
    },

    resolveId(source, importer, opts) {
      if (source === PUBLIC_CSS_ID) return INTERNAL_CSS_ID;
      if (source === INTERNAL_CSS_ID) return INTERNAL_CSS_ID;
      if (!opts?.ssr && importer && forbiddenBrowserImport(source)) {
        this.error("ZV3001: Server-only module " + source + " cannot enter a Zaakiy browser graph (imported by " + importer + ")");
      }
      return null;
    },

    load(id) {
      if (id === INTERNAL_CSS_ID) {
        // Production CSS is emitted after all component transforms have completed.
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
        const href = ((resolved?.base ?? "/") + OUTPUT_CSS_FILE)
          .replaceAll("&", "&amp;").replaceAll('"', "&quot;");
        return html.replace(
          /<\/head\s*>/i,
          '<link rel="stylesheet" href="' + href + '"></head>'
        );
      }
    },

    async transform(source, id, transformOptions) {
      if (!isTsx(id) || transformOptions?.ssr) return null;
      const file = simpleFile(id);
      const key = JSON.stringify([
        file, source, configRevision,
        styleFingerprint(brand, options.browserTargets ?? []),
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
        targetBrowsers: options.browserTargets
      });
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
          if (!parsed || typeof parsed !== "object") throw new Error("Invalid map object");
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
        tokens: styleTokensFromResult(output, file),
        additionalCss: output.css.map((item) => item.code)
      };
      modules.set(file, record);
      try {
        if (!buildMode) {
          await collectCss(false);
          const styleModule = server?.moduleGraph.getModuleById(INTERNAL_CSS_ID);
          if (styleModule && server) server.moduleGraph.invalidateModule(styleModule);
        }
      } catch (error) {
        modules.delete(file);
        throw error;
      }
      return { code: record.code, map: record.map };
    },

    async handleHotUpdate(ctx) {
      const file = simpleFile(ctx.file);
      bump(file);
      if (configPath && file === configPath) {
        await loadBrand();
        modules.clear();
        lastStyleKey = "";
        css = "";
        ctx.server.ws.send({ type: "full-reload", path: "*" });
        return [];
      }
      if (isTsx(file) || evictDependents(file, ctx.server)) {
        modules.delete(file);
        lastStyleKey = "";
        // No owner-compatible HMR ABI exists yet. A full document reload is the
        // only defensible way to guarantee disposal of all previous owners.
        ctx.server.ws.send({ type: "full-reload", path: "*" });
        return [];
      }
      return undefined;
    },

    async generateBundle(_output, bundle) {
      if (!buildMode) return;
      await collectCss(true);
      // Emit even an empty stylesheet so every HTML entry has a valid link.
      const content = compiledCssMap && resolved?.build.sourcemap
        ? css + "\n/*# sourceMappingURL=zaakiy-styles.css.map */\n"
        : css;
      this.emitFile({ type: "asset", fileName: OUTPUT_CSS_FILE, source: content });
      if (compiledCssMap && resolved?.build.sourcemap) {
        this.emitFile({
          type: "asset",
          fileName: OUTPUT_CSS_FILE + ".map",
          source: compiledCssMap
        });
      }
      const assets: GeneratedAssetRecord[] = Object.values(bundle)
        .map((entry): GeneratedAssetRecord | null => {
          if (entry.type === "chunk") {
            for (const mod of Object.keys(entry.modules)) {
              if (/(?:^|\/)(?:@zaakiyjs\/(?:compiler|styles|ai|proxy|vite-plugin)|packages\/(?:compiler|styles|ai|proxy|vite-plugin))(?:\/|$)/.test(normalizePath(mod))) {
                this.error("ZV3002: Build-only package entered browser chunk " + entry.fileName + ": " + mod);
              }
            }
            assertBrowserOutput(entry.code, entry.fileName);
            return { fileName: entry.fileName, kind: "js" };
          }
          if (entry.fileName.endsWith(".css")) return { fileName: entry.fileName, kind: "css" };
          if (entry.fileName.endsWith(".map")) return { fileName: entry.fileName, kind: "map" };
          return null;
        })
        .filter((item): item is GeneratedAssetRecord => item !== null);
      assets.push({ fileName: OUTPUT_CSS_FILE, kind: "css" });
      if (compiledCssMap && resolved?.build.sourcemap) {
        assets.push({ fileName: OUTPUT_CSS_FILE + ".map", kind: "map" });
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
