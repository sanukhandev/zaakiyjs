# Image optimization contract — initial build-time slice

- `@zaakiyjs/image` browser entry exports native picture attributes, DOM creation and escaped markup; Node-only output is confined to `@zaakiyjs/image/node`.
- Native TSX image compiler lowering and on-demand remote optimization are deferred; they would require separate compiler and server security contracts.
- Build inputs are authorized local raster files only, with filename realpath containment, compressed input/pixel/variant budgets, no user-controllable network endpoints, signed-byte SHA-derived filenames and deterministic manifests.
- All ordinary builds work offline with explicit processor injection. Sharp is an explicit, consumer-owned build dependency; its version must be pinned in each consuming app.
- Accessibility: mandatory alt (empty permitted for decorative images), explicit intrinsic dimensions to prevent layout shift, default lazy loading and optional priority/eager request for LCP assets.
- Benchmark matched deterministic photo data: source JPEG bytes versus selected per-viewport AVIF/WebP/JPEG output bytes; measure cold complete build p50/p95, exact output dimensions and hashed bytes. Image transfer savings are workload-specific; **not** proof of Next.js-relative throughput or browser LCP.
