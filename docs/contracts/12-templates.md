# Contract 12 — P2 portable source templates and safe generator plans (proposed v1)

> **Status: contract-only.** Owner: future `@zaakiyjs/templates`; actual generator work belongs to a later PR. See [ADR 0007](../adr/0007-p2-ui-contract-boundaries.md), [CLI generator rules](../development/cli.md), and [issue #37](https://github.com/sanukhandev/zaakiyjs/issues/37).

## Scope and delivery

A template is a **portable, editable directory of source assets**, never opaque serialized JSX elements, executable AI output or a runtime layout interpreter. Kinds: `project` and `page`. Source assets may import supported `@zaakiyjs/ui` public APIs and `@zaakiyjs/*` types but must not require every optional P2 package. Generated app code, not the template loader, owns its production dependencies and CSS.

The template package exports metadata and pure file-plan contracts, with a separate Node-only CLI/generator adapter when implemented. Importing metadata in a browser must not read the filesystem, start a process, access network, evaluate arbitrary code, load TS compilers, or bundle template files into application JS.

## Reserved metadata/plan schema v1

~~~ts
export type TemplateKind = "project" | "page";
export type TemplateCapability =
  | "core" | "signals" | "dom" | "styles" | "router" | "forms"
  | "ui" | "ui-primitives" | "motion" | "async" | "http";
export interface TemplateCompatibility {
  readonly compiler: string;     // supported SemVer range
  readonly domAbi: 1;             // current browser ABI; do not assume v2
  readonly irSchema: 1;
  readonly browserTargets?: Readonly<Record<"chrome" | "firefox" | "safari", number>>;
  readonly requiredFeatures: readonly TemplateCapability[];
  readonly optionalFeatures?: readonly TemplateCapability[];
}
export interface TemplateAsset {
  readonly path: string;          // normalized relative POSIX path
  readonly contentSha256: string; // lowercase 64-character hex
  readonly encoding: "utf-8";
  readonly mode?: "file";         // never executable/script permissions by default
}
export interface TemplateManifestV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly version: string;       // independently versioned
  readonly kind: TemplateKind;
  readonly name: string;
  readonly description: string;
  readonly license: string;
  readonly compatibility: TemplateCompatibility;
  readonly packages: Readonly<Record<string, string>>; // exact names -> pinned/ranged versions
  readonly assets: readonly TemplateAsset[];
  readonly entry?: string;
}
export interface PlanRequest {
  readonly manifest: TemplateManifestV1;
  readonly targetDirectory: string;
  readonly variables: Readonly<Record<string, string>>;
  readonly existingPaths: readonly string[];
  readonly authorizedReplacements?: Readonly<Record<string, string>>; // path -> expected current SHA-256
  readonly overwrite?: "error" | "skip"; // never implicit force
}
export interface PlannedWrite {
  readonly kind: "create" | "replace";
  readonly relativePath: string;
  readonly expectedExistingSha256?: string; // required for replace
  readonly contentSha256: string;
  readonly content: string; // source asset with validated substitutions
}
export interface PlanDiagnostic {
  readonly code: string;
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly path?: string;
}
export interface TemplateFilePlan {
  readonly schemaVersion: 1;
  readonly writes: readonly PlannedWrite[];
  readonly dependencies: Readonly<Record<string, string>>;
  readonly diagnostics: readonly PlanDiagnostic[];
}
~~~

Reserved `validateTemplate(manifest, assets): readonly PlanDiagnostic[]` and `planTemplate(request): TemplateFilePlan` are pure and deterministic. `applyTemplatePlan(plan, fsAdapter)` is a **separate explicit Node adapter**; no filesystem writes occur in `planTemplate`, no implicit install, script execution, network calls or AI generation. Dry-run is simply rendering the plan. A `replace` write is permitted only for a path explicitly listed in `authorizedReplacements`, with the supplied existing SHA-256 matching the file at apply time; otherwise collisions error/skip. A privileged `--force` workflow requires a new explicit policy, not a hidden meaning of `overwrite`.

## Security, reproducibility and portability

- Manifest IDs, variables, file hashes, dependency ranges and paths are untrusted inputs. Reject `..`, absolute paths, control characters, backslashes/path aliases, reserved names, duplicate case-folded paths, symlink traversal, symlink output and out-of-target writes. Resolve/canonicalize within the target root at apply time, recheck TOCTOU/conflicts, and rollback fully on failure.
- Every asset's bytes must match its declared SHA-256; reject invalid encodings or content mismatches. Plan order is normalized lexicographic and deterministic for equal input/manifest/versions. Generate editable TSX, typed config, source CSS, tests and documentation; no generated `dist` only delivery.
- Validate manifest SemVer and minimum declared compiler/DOM ABI/browser features against **actual installed or chosen project versions**; unsupported TSX forms cause an actionable error, not a fallback JSX interpreter. A template requiring compiler refs, slots or dynamic class syntax is **not compatible** until issue #37 is delivered.
- Features/dependencies are explicit; never install all framework modules. A plain page template must work without a motion runtime. Generated code respects SOLID/MVVM organization without forcing ViewModels for static presentational views.
- Built assets never import `@zaakiyjs/templates` in the browser unless a separately tree-shakeable metadata-only import was deliberately requested. Node-only adapters use export subpaths that cannot leak Node APIs to browser entrypoints.

## Minimum validation before shipping templates

Fixtures for minimal/project/page, collisions, dry-run and rollback, path traversal/case/symlink/TOCTOU checks, checksum and schema rejection, version/feature incompatibility, frozen dependency lock install, AI-off offline reproducible hashes, strict TypeScript and executable generated Vite production build, Chromium/Firefox/WebKit smoke and documented accessibility/CSP. Template outputs must be editable source, not generated-only HTML blobs. No generator implementation, migrations, app assets or version bumps in P2-00.
