# ADR: compact-v3 resource-free native keyed rows (candidate)

## Decision
Add explicit large-tier compiler option `hydrationMarkerFormat: "compact-v3"`.
The compiler may mark a keyed region `flat: true` only when its sole native
root is a safe standard scalar element (li, span, p, div, button, h1–h6),
with allowlisted static attributes, no events and exactly one direct
item-derived own scalar field. This is not general component hydration.
Reserve `data-zk` on specialized roots for the verified key. Root/list,
conditional and component boundaries remain comments. Other rows use the
existing compact-v2 representation and owner lifecycle. Older modes are
unchanged; the new format is in the template digest.

Client adoption of compact-v3 requires explicit immutable `itemDataMode:
"snapshot"`, matching verified compiler artifacts, and no externally
registered element-ID events. Use existing formats for explicit row
listeners or reactive proxies. Compiled events on non-flat elements still
work. Before attachment, validate static template identities once, row
attribute descriptors once per list, then check every actual row key,
namespace, tag, exact attributes and exact scalar text. Reject duplicate
keys, unsafe paths, missing/extra nodes, accessors, invalid budgets and
mismatched build/route identities. Native element identity serves as the row
boundary. Resource-free rows do not create independent owners or effects.
A list-level owned render effect manages all rows. New/replacement values
are validated and new native nodes staged before mutation. Preserve
existing rows, focus, ordering, zero-mutation initial adoption and markup
on disposal. Empty scalar rows need no initial Text allocation. Use the
existing DOM range planning algorithm for reorders and native insertions
for singleton ranges. Never use HTML parsing or code evaluation.

## Evidence
Measure equivalent behavior in H4 (including legacy and nested fallback
unit tests), three independent paired trials, diagnostic phase counters
and production-size fixture separately from full benchmark harness.
Do not claim target attainment until exact-head CI and raw evidence pass.
This is a bounded specialization, not a rewrite of the general hydration
engine or a promise that arbitrary applications have resource-free rows.
