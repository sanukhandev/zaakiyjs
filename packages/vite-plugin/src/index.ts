import type { TargetConfiguration } from "@zaakiyjs/compat";
/** Build-time Vite integration. The executable compiler/style engines are separate packages. */
export const foundationStatus = { package: "@zaakiyjs/vite-plugin", implemented: true } as const;

export interface ZaakiyViteOptions {
  readonly configFile?: string;
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
  readonly cssVirtualId?: string;
  readonly browserTargets?: readonly string[];
  /** Opt-in TSX-source and final-JS strict browser feature analysis; emits compat-manifest.json.
   * This is NOT full CSS/dynamic-API certification and will reject transforms/shims
   * until verified source maps and runtime integration are implemented.
   */
  readonly compatibility?: {
    readonly mode: "strict";
    readonly targets: TargetConfiguration;
    /** Explicit opt-in: TypeScript 5.9.3 ES2019 transforms final JS chunks with chained maps. */
    readonly syntaxTransforms?: "approved-es2019";
  };
  /** Explicit IR v2 opt-in for compiled default component children slots. */
  readonly componentSlots?: boolean;
  /** Relative file path for the single generated CSS asset, under assets/. */
  readonly cssFileName?: string;
}
export interface GeneratedAssetRecord {
  readonly fileName: string;
  readonly kind: "js" | "css" | "map" | "manifest";
  readonly sourceFile?: string;
}
export interface ZaakiyAssetManifest {
  readonly schemaVersion: 1;
  readonly assets: readonly GeneratedAssetRecord[];
}
export interface VirtualCssContract {
  readonly publicId: "virtual:zaakiy-styles.css";
  readonly resolvedId: "\u0000virtual:zaakiy-styles.css";
}
export type VitePluginFactory<Plugin> = (options?: ZaakiyViteOptions) => Plugin;

export { zaakiyPlugin } from "./plugin.js";
