/** Build-time Vite integration. The executable compiler/style engines are separate packages. */
export const foundationStatus = { package: "@zaakiyjs/vite-plugin", implemented: true } as const;

export interface ZaakiyViteOptions {
  readonly configFile?: string;
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
  readonly cssVirtualId?: string;
  readonly browserTargets?: readonly string[];
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
