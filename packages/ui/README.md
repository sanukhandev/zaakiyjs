# @zaakiyjs/ui — P2 source-only implementation

The canonical full-workspace review is PR #49, rebased on `main` after UI Primitives PR #45 merged. PR #38 is the source-only implementation branch; PR #49 additionally contains the required lockfile, workspace verifier and CI integration. Review and merge PR #49 rather than trying to merge the incomplete workspace wiring in PR #38.

## Rendering model

ZaakiyJS compiles component calls with explicit props. This package returns **native DOM nodes**, not a virtual DOM tree. Component setup executes once under Core ownership. Controlled native inputs bind to existing Signals and update their individual DOM properties without remounting the input or resetting cursor/focus identity.

Explicitly import \`@zaakiyjs/ui/styles.css\` once in the application entry. It is a pre-generated, deterministic CSS asset: no stylesheet injection or Node-side Styles compiler is imported in the browser. It inherits scoped \`--z-*\` CSS variables from \`@zaakiyjs/styles\`' brand config, including light/dark appearance and nested brand scopes.

## Public components

- **Actions:** Button, IconButton, LinkButton, ButtonGroup. Button uses frozen Contract 10 \`label\`, \`tone\`, \`appearance\`, \`size\`, \`type\`, semantic \`onPress({ originalEvent })\`.
- **Fields:** TextField, Textarea, Checkbox, RadioGroup, Switch, Select (native), FieldLabel, FormField, FieldError, BoundTextField. BoundTextField uses a structural contract compatible with string-valued \`@zaakiyjs/forms\` fields; Forms is optional and owns validation.
- **Layouts:** Container, Stack, Inline, Grid, Flex, Separator, AspectRatio, Card. Container, Stack, Inline, Grid, Flex and Card support compiler-owned native default child slots when `componentSlots: true` is enabled, in addition to existing explicit item/text props.
- **Display:** Badge, Avatar, Skeleton, Progress, Alert, Table, Pagination, LoadingIndicator.
- **Navigation:** Breadcrumbs, NavigationMenu (native semantic navigation), SidebarLayout, Pagination.
- **Feedback:** Dialog, Tooltip, Popover, DropdownMenu, Tabs, Accordion, Toast and createToastCenter. Interactive behaviors delegate to `@zaakiyjs/ui-primitives`, and attach controllers in Core onMount after nodes become connected. Dialog accepts an optional compiler-owned named `body` slot; Popover accepts optional named `content` or text. Both require IR v2 for JSX-valued named props, reject forged/unowned slot values and preserve the existing overlay manager. ToastCenter remains per owner/host.

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

For compiler IR v1, arbitrary JSX component children, JSX-valued named props and unrestricted spreads are not supported; rejected syntax must fail with diagnostics.

With `zaakiyPlugin({componentSlots: true})`, IR v2 compiles the supported native default JSX child slots and explicitly named JSX-valued props into **one-shot, caller-owned native slot factories**, not a JSX object tree. Layouts/Card accept default `children`; Dialog accepts `body`; Popover accepts `content`. For example:

```tsx
<Dialog id="confirm" title="Confirm" description="Review" triggerLabel="Open"
  overlays={overlays} body={<section><p>Review this change</p></section>} />
<Popover id="details" triggerLabel="Details" overlays={overlays}
  content={<div>Extra information</div>} />
```

These slots are mounted once through `@zaakiyjs/dom/compiler.mountOwnedSlot` and disposed with the caller owner. They cannot be reused across components, substituted with raw HTML, or mounted from arbitrary JSX objects. Full interactive component-slot ergonomics, portal/keyed exits and universal JSX props remain separate work.

## Security and accessibility

- No unsafe HTML sinks, eval, browser compiler imports, global event patches or AI dependencies.
- User text is inserted through \`textContent\`/\`Text.data\`, never parsed as HTML.
- Navigation URLs use an explicit scheme policy; Avatar restricts remote images to HTTPS or same-origin absolute paths.
- Native semantics, labels, focus-visible states, disabled state and reduced-motion CSS are provided. Dialog, Tabs, Tooltip, Popover, Menu and Accordion reuse P2-01 accessibility controllers.
- Colors use native CSS tokens; **custom brand palettes still require contrast validation**. Manual assistive-technology review is required before a WCAG 2.2 AA conformance claim.
- Owner teardown releases listeners, timers, effects and overlays. No process-wide toast singleton.
- Only CSS with selectors that are already in this package is guaranteed. Caller custom class strings require explicit independently generated CSS.

## Testing and release

PR #49 targets `main` and includes the frozen pnpm importer, CI verifier registration and complete workspace CI. All eight workflows passed for the earlier validated stacked commit; revalidate the final main-based review SHA before approving. Source PR #38 alone does not meet integration constraints. The implementation is not a published npm release; npm scope ownership, license, non-placeholder version and independent package installation require approval. Do not merge either PR without verifying current checks, real compiled browser acceptance, and manual accessibility review.
