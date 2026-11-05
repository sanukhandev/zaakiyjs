# @zaakiyjs/ui — P2 draft foundation

This branch contains a narrow, non-production-ready UI slice. It is not the full P2-02 delivery and MUST NOT be published or merged as a complete UI package.

## Current native component slice

Button, Badge, TextField, Checkbox, FieldLabel, FieldError, Progress, Separator, Alert and a basic semantic Table. They use explicit typed props and return native DOM nodes through the current owner-scoped compiler component-call ABI. A component creates its native nodes once, never reconciles virtual nodes, and installs no process-global state.

Example: import Button from @zaakiyjs/ui, then use TSX with an explicit label attribute: <Button label="Save" variant="primary" onClick={save} />. Compile through the Zaakiy Vite plugin. Import @zaakiyjs/ui/styles.css in the application entry once; this CSS is an explicit static asset, not runtime injection. Colors, spacing, type, radii and motion reference the existing --z-* brand variables. Appearance changes are handled by inherited CSS variables, not JS remounts.

Native inputs can be standalone or accept existing WritableSignal values. They rely on the current DOM bindProperty implementation for precise input value/checked updates and owner disposal. Form-validation semantics stay in @zaakiyjs/forms. This draft does not advertise a form adapter until its contract is agreed.

## Compiler/P2 dependency gates

- Missing on main: approved P2-00 UI component contracts, and the @zaakiyjs/ui-primitives implementation (P2-01).
- Current compiler ZC2102 rejects component children. Layout, Card composition, nested menu/dialog content and standard slot APIs must remain unsupported until the Compiler owner freezes and implements a children ABI.
- Current compiler ZC1002 rejects JSX prop spreads; ZC2108 rejects nested JSX expressions. Do not bypass these with a runtime JSX interpreter.
- Avoid passing evaluated signal values as component props; pass the signal for bindings or wait for a compiler-backed reactive-prop contract.
- Dialog, Tooltip, Popover, Tabs, DropdownMenu, NavigationMenu and Toast intentionally remain unavailable; do not substitute custom focus, portal or keyboard logic.
- The package declares workspace dependencies; a coordinated root pnpm-lock.yaml update is required from the integration owner before frozen-lockfile CI can pass.
- This is not an npm release approval. P2 contracts may change component signatures and shape.

## Known risks and follow-up validation

CSS is shipped as an explicitly imported static stylesheet. Class recipe strings are statically enumerated in source and paired with selectors in the packaged CSS; no arbitrary runtime class synthesis. Brand overrides reuse @zaakiyjs/styles variables. Custom brand colors still need WCAG 2.2 AA contrast auditing; not all color combinations guarantee accessible text. Current manual native-node bridge casts the opaque ViewNode type locally; replace it with an agreed compiler/DOM type contract rather than exporting a second JSX runtime.

Before marking ready for review: merge P2-00 and P2-01, finish the component inventory, compiler-generated multi-component browser showcase, Playwright keyboard/screen-reader oriented checks, dark/light/responsive and scoped-brand visuals, bundle and CSS size measurements, source maps, package artifact verification, external npm installation, complete accessibility review, and full CI including frozen lockfile. None of these checks are claimed as passed here.
