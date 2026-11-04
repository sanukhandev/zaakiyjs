# Contract 07 — Vite integration and generated assets

**Owner:** `@zaakiyjs/vite-plugin`; Node/build time only. It may depend on compiler/styles and peer-depend on Vite. It must **not** ship in application browser import graphs.

Reserved plugin factory: `zaakiyPlugin(options?: ZaakiyViteOptions): Plugin`, with `Plugin` from Vite when implemented. Options: config path, include/exclude globs, virtual CSS ID and browser targets. M0 exports the `ZaakiyViteOptions` and `VitePluginFactory<Plugin>` type aliases only.

Reserve public virtual CSS import `virtual:zaakiy-styles.css`, whose internal resolved ID is `\0virtual:zaakiy-styles.css`. Build must emit deterministic JS, CSS, source maps and a versioned asset manifest containing `schemaVersion: 1` and `{ fileName,kind,sourceFile? }[]`. CSS is emitted once per relevant entry/chunk and available through virtual import in development. Diagnostics preserve originating TSX spans and fail production builds on compiler errors.

HMR must not silently duplicate listeners/effects; when incremental recompilation can no longer preserve owner identity, explicitly replace and dispose the affected owner. Never emit raw private config/credentials or import build-time packages into browser bundles.

No plugin factory, virtual module, transform or HMR is implemented at M0; this contract enables type review and package dependency boundaries only.
