# Application building workflow

Baseline reference: ZaakiyJS main at 5fe0e1765bc802ea3f3eebb76a43bd585166c518 (2026-11-26). Runtime certified tree from d9db3fddd8638fb680e609e92331c7b52efdefea. Source packages are unpublished at this baseline.

## New application inside the source workspace

Use an authorized checkout and a new, unused project name under apps. From the repository root:

~~~bash
pnpm install --frozen-lockfile
pnpm build
node packages/cli/dist/bin.js start --project my-app --template minimal --workspace --path apps --package-manager pnpm --dry-run
node packages/cli/dist/bin.js start --project my-app --template minimal --workspace --path apps --package-manager pnpm
pnpm install --no-frozen-lockfile
pnpm --dir apps/my-app typecheck
pnpm --dir apps/my-app build
~~~

The second install links the new workspace importer and may update the lockfile: inspect and review that expected change, never modify the lockfile simply to evade an existing reproducibility failure. Start development with the generated project's dev script. Do not install into an existing app directory without first inspecting it. The CI workflow .github/workflows/m1-browser-matrix.yml uses this scaffold path. Use pnpm@10.20.0 and a compatible Node 22 environment; pin exact versions when reproducing the certified benchmark.

The CLI source supports minimal, standard and enterprise presets. Standard adds organization; enterprise adds architectural structure, not automatic working router/form/proxy integration. Do not use npm registry scaffolding for unpublished 0.0.0 packages. External applications can use a verified workspace or explicitly prepared packed-consumer setup; follow current repository packaging docs. Do not claim a standalone app works until clean consumer install/build succeeds.

## Minimal compiler-supported TSX

Adapt the maintained templates in packages/cli/templates/minimal. Example view:

~~~tsx
import { signal } from "@zaakiyjs/signals";

export function App() {
  const count = signal(0);
  return (
    <main class="mx-auto p-8">
      <h1>Counter</h1>
      <button type="button" onClick={() => { count.value += 1; }}>
        Count: {count.value}
      </button>
    </main>
  );
}
~~~

Entry, compiled through Zaakiy's Vite plugin:

~~~tsx
import { mount } from "@zaakiyjs/dom";
import { App } from "./App";
import "virtual:zaakiy-styles.css";
const target = document.getElementById("app");
if (!target) throw new Error("Missing #app");
mount(() => <App />, target);
~~~

Keep the generated tsconfig: strict true, jsx preserve, jsxImportSource @zaakiyjs/core, moduleResolution Bundler. Vite uses zaakiyPlugin() from @zaakiyjs/vite-plugin, not a React plugin. The current CLI template uses class, not React className. Use native label/input/button elements, explicit type for buttons, accessible names and keyboard navigation. Utility classes must be supported by the local styles engine/config. Do not use the DOM compiler ABI as an application-level replacement for supported TSX.

## Existing application

- Inspect the app package and generated layout first. Preserve its module naming, router registration, existing design tokens and dependencies.
- For a feature with actual domain behavior, put repository interfaces in Model, owner-scoped state/actions in ViewModel, native TSX in View and route/service composition in an adapter. Keep authorization on the server. A page adapter is application wiring, not automatic route registration.
- For CRUD, define stable record IDs, pending/error/empty UI, typed validation and explicit submit actions. Cancel obsolete work and prevent stale results. Never retry a non-idempotent mutation merely because its outcome is unknown.
- For forms, use createForm and field signals; verify accessible error association. For networking, inspect @zaakiyjs/http and @zaakiyjs/async exports, pass AbortSignal and keep server proxy secrets out of client output.
- For public SEO routes, inspect SSR/SEO contracts, only serialize approved public state, preserve metadata/cache/privacy boundaries. Do not pretend generic TSX automatically supports SSR.
- Use existing templates/primitives where they satisfy requirements. If the requested compiler construct is unsupported, simplify the view to a supported shape or report a separate framework issue; never add React as a shortcut.

## Generator use

The executable is zaakiy. In a built source workspace use node packages/cli/dist/bin.js from the correct working directory or the linked executable. Check --help and the current CLI README. Supported examples include start --project, g component, g feature --architecture mvvm, g viewmodel, g model, g page, g layout, g store, g context, g provider, g route, g guard, g loader, g resource, g task, g service, g interceptor and g proxy. Run --dry-run before writes. Generators create skeletons, not full application integration. The commands doctor --json and analyze bundle --json inspect project and emitted asset evidence respectively; dev/build/test delegate to actual app scripts.

At the pinned baseline analyze architecture/signals/styles/network, migrate and ai are explicitly unavailable. Do not fabricate them from the framework roadmap.

## Done for an application

A working compiled production build, actual user flow and failure-path tests, strict types, no unintended DOM replacement, cleanup on navigation/unmount, accessible controls, secure server boundary and a clear report of any missing validation. For UI work, inspect a real browser where available. Do not change the frozen framework simply to avoid adapting an application to its documented supported subset.
