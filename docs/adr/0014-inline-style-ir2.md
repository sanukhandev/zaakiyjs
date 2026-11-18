# ADR 0014 — Opt-in IR v2 safe native inline styles

**Status:** proposed, implementation under review. **Scope:** Compiler/Vite/DOM boundary only, no DOM ABI bump.

## Decision

Expose `styleBindings: true` on Compiler and Vite. Select IR v2 while preserving default IR v1 and its rejection of inline styles. Lower a literal, statically named JSX style object into an independent `PropertyBinding { target: "style", name: canonicalCssProperty, expression }` for each entry. Use only existing DOM `setStyle` and `bindStyle` APIs, and import them only when a style target exists. All reactive writes are owner-scoped effects. No browser-side compiler, runtime CSS parser, `style` attribute, `cssText`, `innerHTML`, or mandatory stylesheet injection.

## Supported authoring

```tsx
function View() {
  const color = signal("red");
  const visible = signal(true);
  return <main style={{color: color.value, backgroundColor: "blue",
    opacity: visible.value ? "1" : null}}>Content</main>;
}
```

Only a directly inspectable object literal is allowed. Property keys may be identifiers or string literals, and must normalize to safe CSS property names. Values are explicit strings, nullable expressions or signal reads; the owner-scoped DOM sink rejects other runtime values. No automatic px conversion. Static string literals are checked for unsafe URL, expression, control characters and CSS injection. Runtime `setStyle` independently rejects unsafe values. Ordinary atomic utility styling remains preferred.

### Unsupported by design

Dynamic object references; CSS spreads; computed/duplicate/dangerous property names; nested objects; function calls; JavaScript templates with computed evaluation; direct numeric and boolean literals; nonliteral style strings; untrusted CSS URL functions. More complex variant generation belongs in Zaakiy Styles build-time extraction, not this escape hatch.

## Version and ownership

- Default `compile()` uses IR v1 unchanged. Enabling `styleBindings` or `componentSlots` chooses IR v2.
- No new DOM module exports; `setStyle`/`bindStyle` already exist in the browser-facing ABI.
- Compiled output never changes the `style` attribute wholesale. Independent bindings do not reset unrelated properties, input selection, focus or DOM element identity.
- CSS values are vetted on every update, effects are disposed with the owner and unmount removes the mount range.
- Existing IR validators reject forged style bindings on v1, unsupported names and unknown fields.

## Acceptance

Compiler golden tests, typecheck, Vite production transform opt-in/default rejection, generated DOM integration, cross-browser smoke tests, security/injection fixtures, output size and reproducibility. This feature does not complete general component composition, SSR hydration, HMR or full compatibility lowering.

## Migration

For existing utility-class apps: no changes. Inline style authors must explicitly opt in and replace raw string styles with approved object syntax; dependency upgrades must be coordinated with the final application build.
