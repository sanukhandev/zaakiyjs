# CLI Starters, Generators and Automation Contracts

> All commands below are proposed and are **not available yet**.

## Project creation

```bash
npx @zaakiyjs/cli@latest start --project my-app
npx @zaakiyjs/cli@latest start --project my-app --template minimal
npx @zaakiyjs/cli@latest start --project my-app --template enterprise
```

`start --project` scaffolds and configures a project; `zaakiy dev` starts its development server. Presets: Minimal, Standard (default), Enterprise. Never install all 26 packages by default; include only selected capabilities and their transitive dependencies. Starter creation must pass TypeScript compile, basic unit checks and production build with AI disabled.

## Generators

Canonical syntax: `zaakiy generate <type> <name>`; shortcut `zaakiy g`. Each generator should create strict typed files, relevant tests, exports and safe registration edits.

| Category | Types |
| --- | --- |
| UI | `component`, `view`, `layout`, `template`, `recipe`, `animation` |
| Architecture | `feature`, `model`, `viewmodel`, `adapter`, `provider`, `context` |
| State | `store`, `signal` / `custom-signal`, `computed`, `effect` |
| Navigation | `page`, `route`, `guard`, `loader`, `middleware --target route` |
| Data | `service`, `repository`, `api-client`, `resource`, `task`, `validator` |
| Networking | `interceptor`, `proxy`, `middleware --target proxy|http|server` |
| Forms | `form`, `field`, `wizard` |
| Tooling | `test`, `benchmark`, `plugin`, `config` |

Example commands:

```bash
zaakiy g feature products --architecture mvvm
zaakiy g page products --layout StoreLayout --store
zaakiy g store Cart --scope app
zaakiy g custom-signal UseCounter
zaakiy g interceptor AuthToken
zaakiy g task SaveProduct --abortable
zaakiy g middleware Auth --target route
zaakiy g recipe PrimaryButton
```

Additional proposed operations: `zaakiy dev`, `build`, `test`, `lint`, `doctor`, `upgrade`, `migrate`, `add`, `remove`, `analyze bundle|architecture|signals|styles|network`, `seo audit`, `ai analyze --consent` and `ai optimize --review --consent`.

## Safety and ergonomics

- Support meaningful `--path`, `--scope`, `--test`/`--no-test`, `--style`, `--dry-run`, `--force`, `--skip-install` and `--json` flags.
- Resolve name/path collisions and never silently overwrite files.
- Modify route/exports/config through AST-aware edits; show diff and support rollback.
- Use supported package exports; do not invent modules or import compiler-only code into browsers.
- Generated SOLID/MVVM code separates Model contracts, ViewModels, Views, adapter and I/O services.
- Generated resources/tasks use native AbortSignal, owner-scoped cancellation and typed errors.
- Generator tests must execute generated projects rather than asserting only file text.

## Sample Standard starter structure

```text
src/
  app/{providers,routing,branding}/
  features/users/{model,viewmodels,views,adapters,services}/
  shared/{components,contracts,utilities}/
  main.tsx
zaakiy.config.ts
vite.config.ts
tsconfig.json
package.json
```
