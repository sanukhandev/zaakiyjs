# @zaakiyjs/cli

First-party ZaakiyJS project starter and typed SOLID/MVVM generators. Source implementations are integrated into the framework workspace; independent npm publication and full production certification remain gated. Generated Counter browser acceptance exists, but that does not establish unrestricted TSX or public npm readiness.

## Commands

    npx @zaakiyjs/cli@latest start --project my-app
    zaakiy start --project my-app --template minimal
    zaakiy start --project my-app --template standard
    zaakiy start --project my-app --template enterprise
    zaakiy start --project my-app --dry-run
    zaakiy g component MyButton
    zaakiy generate feature products --architecture mvvm
    zaakiy g viewmodel Cart --dry-run
    zaakiy g page SalesReports
    zaakiy g layout Dashboard
    zaakiy g store Cart
    zaakiy g resource Products
    zaakiy g task SaveProduct
    zaakiy g interceptor Trace
    zaakiy g proxy Gateway
    zaakiy g service Inventory --force
    zaakiy dev
    zaakiy build
    zaakiy test
    zaakiy doctor
    zaakiy doctor --json
    zaakiy analyze bundle
    zaakiy analyze bundle --json

The executable is named **zaakiy**. Project creation uses **start --project**, not create.

- **Minimal:** strict TSX Counter, typed branding, native mount and the Vite plugin. Creation is refused until supported runtime/plugin exports exist and non-workspace versions have left M0 placeholder version 0.0.0.
- **Standard:** Minimal plus organized shared/feature directories; no unimplemented runtime imports.
- **Enterprise:** Standard plus application provider/branding and MVVM documentation structure; no router, forms, async resources or proxy APIs.

Project creation never installs dependencies or runs template scripts. Run your package manager's install command explicitly before dev/build/typecheck. Supported tools: Node 20.19+, npm 10+, pnpm 10+, Yarn 4+. Use --workspace only with --package-manager pnpm and an included target path (for example, --path packages in a workspace whose pnpm-workspace.yaml includes packages/*).

generate/g supports component, view, viewmodel, model, feature, service, provider, context, page, layout, store, resource, task, interceptor and proxy. The page/layout generators emit one native TSX root each with strict props. Layout includes a named native outlet element to wire manually through an application Router adapter; they do not promise automatic route registration or unrestricted JSX children. Store is owner-scoped. Resource/Task use AbortSignal and do not silently retry mutations. Interceptor uses public typed HTTP request hooks. Proxy is server-only and requires an explicit authenticator and authenticated routes. Feature generation uses Model repository interfaces, an owner-scoped signal-based ViewModel with native AbortController cancellation and stale-result protection, a typed TSX View, a service gateway and an owner adapter. The context and provider generators use the real @zaakiyjs/core scoped context API. Stateless components do not need ViewModels.

SEO audit: `zaakiy seo audit seo.json --json` accepts a versioned `SeoAuditInputV1` JSON envelope (`resolution` plus `visibility`) and runs the existing `@zaakiyjs/seo.auditSeoV1` implementation without executing code or modifying files. It returns exit code 1 when error diagnostics exist. Inputs are bounded at 256 KiB and reject symlinks/traversal. Sitemap generation and migration remain deferred.

Bundle analysis reads the generated `dist/zaakiy-assets.json` without executing output. `zaakiy analyze bundle [--json]` reports per-asset SHA-256 and raw/gzip/Brotli sizes for emitted JS and CSS; analysis is bounded and refuses path traversal or symlinks. It measures compiled asset bytes only, not runtime speed, network transfer, browser performance or third-party dependencies outside the manifest.

--dry-run shows the file plan, --force explicitly enables replacement, and --path selects a project-relative output directory. Path traversal, symlinks and Windows device names are rejected. Repeating a generator with unchanged content is a no-op; divergent files require --force. Files are staged before creation, failures trigger rollback, and unrecoverable backup restoration preserves recovery artifacts.

dev/build/test delegate to real project scripts, forward subprocess exit codes and handle termination signals. doctor inspects required files, strict TSX configuration, framework package declarations/exports and the Vite plugin configuration. It does not substitute for a production build.

analyze architecture|signals|styles|network, migrate, seo and ai are unavailable until their owning packages are implemented. They fail without creating files.

## Release gates

Before marking the PR ready, install packed packages in a clean fixture; verify generated typecheck, Vite production build, native DOM interaction, security tests, CLI executable, npm pack and provenance. The M0-only baseline cannot satisfy these gates. The branch includes a scoped pnpm lockfile update for CLI Node typings. Current CI passes lint/typecheck/build/test and validates pnpm-packed CLI invocation, but a clean compiled Counter production build remains blocked on the other foundation packages.
