# M0 open decisions — requires ADR or coordinated contract revision

1. **Signals scheduling: RESOLVED by ADR 0003.** Initial execution, phases, error policy, cycle thresholds, and `flushSync` restrictions are frozen for M1; integrated Core/DOM conformance still required.
2. **Component/TSX lowering:** handling of children/JSX spread, expression side effects, refs and typed DOM/SVG event tables; whether to support classic JSX fallback. M0 only provides typecheck-only `jsx: preserve`.
3. **Owner scopes:** implicit current-owner propagation at async boundaries is forbidden without explicit adapter semantics. Decide absent-provider errors vs `undefined`, provider update policy and keep-alive transitions.
4. **DOM ABI keyed lists: PARTIALLY RESOLVED by ADR 0004.** Range markers, primitive duplicate-key rejection, same-key item update and child teardown are frozen; typed `<For>`/`<Show>` source syntax, SSR/hydration and full generated-code conformance remain outstanding.
5. **IR v1 serialized schema:** decide canonical JSON schema, version migration and optimizer node-ID mapping; ensure future SSR/compat metadata does not expose TS parser objects.
6. **Brand CSS:** utility grammar, scoped brand resolution, atomic hash/cascade determinism, responsive/hover/focus variant precedence and dynamic class safelist rules.
7. **Vite:** SSR/externalization rules, HMR versioning, cross-platform source maps and atomic asset emission.
8. **Publication:** npm `@zaakiyjs` scope ownership, package licenses, exact semver range/tested peer matrix, first-publication approval and Trusted Publishing.
9. **Browser targets:** supported browsers/compatibility profiles; defer Polyfill Zone API to dedicated package.
10. **Quality evidence:** M0 package export/type tests do not establish runtime behavior, DOM correctness, browsers, security or performance; each implementation PR must add those tests.

**Parallel agent rule:** M0 fixes symbol ownership, dependency direction and IR discriminants. Do not change these unilaterally. Use ADR + one coordinated integration PR for an incompatible contract revision.
