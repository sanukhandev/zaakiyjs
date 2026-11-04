/** Build-time Vite integration. The executable compiler/style engines are separate packages. */
export const foundationStatus = { package: "@zaakiyjs/vite-plugin", implemented: false } as const;

export interface ZaakiyViteOptions {
  readonly configFile?: string;
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
  readonly cssVirtualId?: string;
  readonly browserTargets?: readonly string[];
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

