# @zaakiyjs/cli

First-party ZaakiyJS project starter and typed SOLID/MVVM generators. **Draft implementation:** the M0 compiler and runtime packages are contract-only; a working Minimal production build is not yet verified. Do not publish the CLI until the linked foundation packages pass clean-install and integration gates.

## Commands

    npx @zaakiyjs/cli@latest start --project my-app
    zaakiy start --project my-app --template minimal
    zaakiy start --project my-app --template standard
    zaakiy start --project my-app --template enterprise
    zaakiy start --project my-app --dry-run
    zaakiy g component MyButton
    zaakiy generate feature products --architecture mvvm
    zaakiy g viewmodel Cart --dry-run
    zaakiy g service Inventory --force
    zaakiy dev
    zaakiy build
    zaakiy test
    zaakiy doctor
    zaakiy doctor --json

The executable is named **zaakiy**. Project creation uses **start --project**, not create.

- **Minimal:** strict TSX Counter, typed branding, native mount and the Vite plugin. Creation is refused until supported runtime/plugin exports exist and non-workspace versions have left M0 placeholder version 0.0.0.
- **Standard:** Minimal plus organized shared/feature directories; no unimplemented runtime imports.
- **Enterprise:** Standard plus application provider/branding and MVVM documentation structure; no router, forms, async resources or proxy APIs.

Project creation never installs dependencies or runs template scripts. Run your package manager's install command explicitly before dev/build/typecheck. Supported tools: Node 20.19+, npm 10+, pnpm 10+, Yarn 4+. Use --workspace in an existing pnpm workspace to emit workspace protocol versions.

generate/g supports component, view, viewmodel, model, feature, service, provider, context. Feature generation uses model repository interfaces, signal-based ViewModel, typed TSX View, service gateway and composition adapter. Stateless components do not need ViewModels.

--dry-run shows the file plan, --force explicitly enables replacement, and --path selects a project-relative output directory. Path traversal, symlinks and Windows device names are rejected. Files are staged before creation; failures trigger rollback.

dev/build/test delegate to real project scripts, forward subprocess exit codes and handle termination signals. doctor inspects required files, strict TSX configuration, framework package declarations/exports and the Vite plugin configuration. It does not substitute for a production build.

page, layout, store, resource, task, interceptor, proxy, analyze, migrate, seo and ai are unavailable until their owning packages are implemented. They fail without creating files.

## Release gates

Before marking the PR ready, install packed packages in a clean fixture; verify generated typecheck, Vite production build, native DOM interaction, security tests, CLI executable, npm pack and provenance. The M0-only baseline cannot satisfy these gates. Regenerate the workspace lockfile during integration for the CLI Node typings.
