# @zaakiyjs/ui — P2 source-only implementation

The canonical review integration is PR #49 (stacked on the verified UI Primitives integration PR #45). PR #38 remains source-only and is not independently mergeable until its dependency and workspace lockfile integration lands.

## Rendering model

ZaakiyJS compiles component calls with explicit props. This package returns **native DOM nodes**, not a virtual DOM tree. Component setup executes once under Core ownership. Controlled native inputs bind to existing Signals and update their individual DOM properties without remounting the input or resetting cursor/focus identity.

Explicitly import \`@zaakiyjs/ui/styles.css\` once in the application entry. It is a pre-generated, deterministic CSS asset: no stylesheet injection or Node-side Styles compiler is imported in the browser. It inherits scoped \`--z-*\` CSS variables from \`@zaakiyjs/styles\`' brand config, including light/dark appearance and nested brand scopes.

## Public components

- **Actions:** Button, IconButton, LinkButton, ButtonGroup. Button uses frozen Contract 10 \`label\`, \`tone\`, \`appearance\`, \`size\`, \`type\`, semantic \`onPress({ originalEvent })\`.
- **Fields:** TextField, Textarea, Checkbox, RadioGroup, Switch, Select (native), FieldLabel, FormField, FieldError, BoundTextField. BoundTextField uses a structural contract compatible with string-valued \`@zaakiyjs/forms\` fields; Forms is optional and owns validation.
- **Layouts:** Container, Stack, Inline, Grid, Flex, Separator, AspectRatio, Card. Current explicit \`items\`/text props deliberately replace unsupported TSX component children; these are limited compositional forms.
- **Display:** Badge, Avatar, Skeleton, Progress, Alert, Table, Pagination, LoadingIndicator.
- **Navigation:** Breadcrumbs, NavigationMenu (native semantic navigation), SidebarLayout, Pagination.
- **Feedback:** Dialog, Tooltip, Popover, DropdownMenu, Tabs, Accordion, Toast and createToastCenter. Interactive behaviors delegate to \`@zaakiyjs/ui-primitives\`, and attach controllers in Core onMount after nodes become connected. Dialog, Popover and DropdownMenu accept an explicitly owned OverlayManager. ToastCenter is per owner/host, not a mutable process-global registry.

Example:

~~~tsx
import { Button, TextField, Badge } from "@zaakiyjs/ui";
import { signal } from "@zaakiyjs/signals";

export function Profile() {
  const name = signal("");
  return <main class="p-4">
    <TextField id="display-name" label="Display name" value={name} />
    <Button label="Save" tone="primary" appearance="solid"
      onPress={() => { /* application action */ }} />
    <Badge label="Active" variant="success" />
  </main>;
}
~~~

## Compiler boundary (do not bypass)

The current Compiler rejects component JSX children (\`ZC2102\`), attribute spreads (\`ZC1002\`), JSX slots inside props (\`ZC2108\`), native refs (\`ZC1003\`) and dynamic class/style patterns (\`ZC2203\`/\`ZC2204\`). This package does **not** ship a React-style renderer or a JSX interpreter to work around these constraints. Conventional composable Card/Stack slots, arbitrary nested dialog content and declarative DOM-ref attachment require the separate Compiler/DOM issue #37.

The visual subset supports explicit typed text/data props; claiming parity with full declarative component children would be incorrect. Components requiring caller-composable rich content are limited until the compiler ABI extends.

## Security and accessibility

- No unsafe HTML sinks, eval, browser compiler imports, global event patches or AI dependencies.
- User text is inserted through \`textContent\`/\`Text.data\`, never parsed as HTML.
- Navigation URLs use an explicit scheme policy; Avatar restricts remote images to HTTPS or same-origin absolute paths.
- Native semantics, labels, focus-visible states, disabled state and reduced-motion CSS are provided. Dialog, Tabs, Tooltip, Popover, Menu and Accordion reuse P2-01 accessibility controllers.
- Colors use native CSS tokens; **custom brand palettes still require contrast validation**. Manual assistive-technology review is required before a WCAG 2.2 AA conformance claim.
- Owner teardown releases listeners, timers, effects and overlays. No process-wide toast singleton.
- Only CSS with selectors that are already in this package is guaranteed. Caller custom class strings require explicit independently generated CSS.

## Testing and release

PR #49 is the integration validation branch with frozen pnpm importer, CI verifier registration and complete workspace CI. Source PR #38 alone does not meet integration constraints. The implementation is not a published npm release; npm scope ownership, license, non-placeholder version and independent package installation require approval. Do not merge either PR without verifying current checks, real compiled browser acceptance, and manual accessibility review.
