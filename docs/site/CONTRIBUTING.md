# Maintaining the ZaakiyJS documentation site

These Markdown files are intended for use by a documentation site generator. There is no claim that a site build, search index, deployment or public URL is already configured by this docs-only branch.

## Page format

Each package page belongs in `docs/site/packages/<name>.md` and follows:

1. YAML frontmatter (title, description, sidebar position).
2. Purpose and source/package availability notice.
3. Source workspace commands and **one executable, feature-specific usage recipe**.
4. Correctness, security, platform and accessibility notes.
5. Public API inventory verified against `packages/<name>/src/index.ts` and package subpaths.
6. Detailed feature explanations/examples, integrations and source links.

Prefer readable headings, concise paragraphs, typed code fences, meaningful cross-links and concrete limitations. Avoid marketing metrics, generic filler, undocumented imports and untested claims. Keep code fenced snippets clearly labeled when they use application-supplied placeholders.

## Review steps for documentation changes

- Read `AGENTS.md`, the relevant ADR/contracts, package `README.md`, `package.json` exports, source `src/index.ts`, and tests.
- Confirm the feature exists on the commit used by the documentation or mark it proposed.
- Compile/typecheck runnable code snippets in an isolated example fixture when practical; verify browser behavior for DOM examples.
- Check local relative Markdown links and headings, tables, code fences, frontmatter and navigation entries.
- Keep examples faithful to Zaakiy's compiler-only TSX semantics and owner disposal.
- Do not silently promote a contract into an implemented feature or an implemented package into a published npm release.
- Update the package page **in the same PR** as the public API, code behavior, security constraint or compiler feature change.
- Run `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test` as applicable, and report actual results; do not claim CI passed without checking.

## Site integration

The files are theme-neutral. A Docusaurus, VitePress, Astro Starlight or custom documentation site can ingest them with an explicit navigation mapping. Check the chosen engine's frontmatter and MDX settings before enabling it. A site generator and deployment workflow are **not** added here.

The package `README.md` files and exported source types remain authoritative if a duplicated description becomes stale. The pinned source revision in these pages is a provenance aid, not a guarantee of future API compatibility.
