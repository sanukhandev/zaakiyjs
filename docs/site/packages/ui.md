---
title: "@zaakiyjs/ui"
description: "Native styled components, layout, form fields, feedback and accessible interactions"
sidebar_position: 16
---

# @zaakiyjs/ui

Use the UI package for brand-token-aware visual components and pre-generated CSS; interactive components delegate behavior to UI Primitives.

> **Availability:** Source implementation in ZaakiyJS, not a verified published npm release. The package's manifest at the referenced revision uses `0.0.0`; use workspace tooling until independent publishing is approved.

## At a glance

- **Use it when:** Import its stylesheet once, compose typed component props and use signals for controlled field values.
- **Reference revision:** [9f6c6603c98c](https://github.com/sanukhandev/zaakiyjs/commit/9f6c6603c98ca566c2fed6fed34cc770f6a72960).

## Try it in the monorepo

```sh
pnpm --filter @zaakiyjs/ui typecheck
pnpm --filter @zaakiyjs/ui test
pnpm --filter @zaakiyjs/ui build
```

## Feature usage: first working pattern

```tsx
import '@zaakiyjs/ui/styles.css'; // In your application entry, exactly once
import { Button, TextField, Badge } from '@zaakiyjs/ui';
import { signal } from '@zaakiyjs/signals';

export function Profile() {
  const name = signal('');
  return <main class="p-4">
    <TextField id="display-name" label="Display name" value={name} />
    <Button label="Save" tone="primary" appearance="solid"
      onPress={() => { /* save via an application ViewModel */ }} />
    <Badge label="Active" variant="success" />
  </main>;
}
```

## Usage and correctness guidelines

- The CSS asset is required and should be imported once; it is not injected at runtime.
- Component slots/children, spreads, refs and dynamic classes are constrained by current Compiler lowering; prefer the supported explicit props.
- Product-specific contrast, screen reader behavior and server-side input validation require application verification.

## Public API index

Exported symbols detected in the package root `src/index.ts`. Platform-specific subpaths and structural contracts are explained in the detailed guide and package manifest.

- `Accordion`
- `AccordionEntry`
- `AccordionProps`
- `Alert`
- `AlertProps`
- `AspectRatio`
- `AspectRatioProps`
- `Avatar`
- `AvatarProps`
- `Badge`
- `BadgeProps`
- `BadgeVariant`
- `BoundTextField`
- `BoundTextFieldProps`
- `BreadcrumbItem`
- `Breadcrumbs`
- `BreadcrumbsProps`
- `Button`
- `ButtonGroup`
- `ButtonGroupProps`
- `ButtonProps`
- `Card`
- `CardProps`
- `Checkbox`
- `CheckboxProps`
- `Container`
- `ContainerProps`
- `Dialog`
- `DialogProps`
- `DropdownMenu`
- `DropdownMenuProps`
- `FieldError`
- `FieldErrorProps`
- `FieldLabel`
- `FieldLabelProps`
- `Flex`
- `FlexProps`
- `FormField`
- `FormFieldProps`
- `Grid`
- `GridProps`
- `IconButton`
- `IconButtonProps`
- `Inline`
- `LayoutBaseProps`
- `LinkButton`
- `LinkButtonProps`
- `LoadingIndicator`
- `LoadingIndicatorProps`
- `MenuEntry`
- `NativeOption`
- `NavigationLink`
- `NavigationMenu`
- `NavigationMenuProps`
- `Pagination`
- `PaginationProps`
- `Popover`
- `PopoverProps`
- `Progress`
- `ProgressProps`
- `RadioChoice`
- `RadioGroup`
- `RadioGroupProps`
- `Select`
- `SelectProps`
- `SelectionDetail`
- `SelectionProps`
- `Separator`
- `SeparatorProps`
- `SidebarLayout`
- `SidebarLayoutProps`
- `Skeleton`
- `SkeletonProps`
- `Stack`
- `StackProps`
- `Switch`
- `SwitchProps`
- `TabItem`
- `Table`
- `TableProps`
- `Tabs`
- `TabsProps`
- `TextField`
- `TextFieldBinding`
- `TextFieldProps`
- `Textarea`
- `TextareaProps`
- `Toast`
- `ToastCenter`
- `ToastCenterOptions`
- `ToastPayload`
- `ToastProps`
- `ToastTone`
- `Tooltip`
- `TooltipProps`
- `UiAction`
- `UiActionDetail`
- `UiAppearance`
- `UiBaseProps`
- `UiSize`
- `UiTone`
- `badgeClasses`
- `buttonClasses`
- `createToastCenter`
- `uiStatus`

## Detailed feature guide

### Rendering model

ZaakiyJS compiles component calls with explicit props. This package returns **native DOM nodes**, not a virtual DOM tree. Component setup executes once under Core ownership. Controlled native inputs bind to existing Signals and update their individual DOM properties without remounting the input or resetting cursor/focus identity.

Explicitly import \`@zaakiyjs/ui/styles.css\` once in the application entry. It is a pre-generated, deterministic CSS asset: no stylesheet injection or Node-side Styles compiler is imported in the browser. It inherits scoped \`--z-*\` CSS variables from \`@zaakiyjs/styles\`' brand config, including light/dark appearance and nested brand scopes.

### Public components

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

### Compiler boundary (do not bypass)

The current Compiler rejects component JSX children (\`ZC2102\`), attribute spreads (\`ZC1002\`), JSX slots inside props (\`ZC2108\`), native refs (\`ZC1003\`) and dynamic class/style patterns (\`ZC2203\`/\`ZC2204\`). This package does **not** ship a React-style renderer or a JSX interpreter to work around these constraints. Conventional composable Card/Stack slots, arbitrary nested dialog content and declarative DOM-ref attachment require the separate Compiler/DOM issue #37.

The visual subset supports explicit typed text/data props; claiming parity with full declarative component children would be incorrect. Components requiring caller-composable rich content are limited until the compiler ABI extends.

### Security and accessibility

- No unsafe HTML sinks, eval, browser compiler imports, global event patches or AI dependencies.
- User text is inserted through \`textContent\`/\`Text.data\`, never parsed as HTML.
- Navigation URLs use an explicit scheme policy; Avatar restricts remote images to HTTPS or same-origin absolute paths.
- Native semantics, labels, focus-visible states, disabled state and reduced-motion CSS are provided. Dialog, Tabs, Tooltip, Popover, Menu and Accordion reuse P2-01 accessibility controllers.
- Colors use native CSS tokens; **custom brand palettes still require contrast validation**. Manual assistive-technology review is required before a WCAG 2.2 AA conformance claim.
- Owner teardown releases listeners, timers, effects and overlays. No process-wide toast singleton.
- Only CSS with selectors that are already in this package is guaranteed. Caller custom class strings require explicit independently generated CSS.

## Integrate with neighboring packages

- [@zaakiyjs/ui-primitives](./ui-primitives.md)
- [@zaakiyjs/styles](./styles.md)
- [@zaakiyjs/forms](./forms.md)
- [@zaakiyjs/templates](./templates.md)

## Source and maintenance

- [Package README](https://github.com/sanukhandev/zaakiyjs/blob/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/ui/README.md)
- [Public source exports](https://github.com/sanukhandev/zaakiyjs/blob/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/ui/src/index.ts)
- [Package test cases](https://github.com/sanukhandev/zaakiyjs/tree/9f6c6603c98ca566c2fed6fed34cc770f6a72960/packages/ui/test)
- Update this page when public APIs, runtime semantics or platform guarantees change.
