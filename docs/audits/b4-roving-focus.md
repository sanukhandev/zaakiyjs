# B4 — UI Primitives: Roving Focus Registration

Stacked on `perf/b3-vite-build-benchmarks`. PR #62/63 remain unchanged.

## Motivation

The native roving-focus controller called `sync()` after registering each
initial item. `sync()` sorts the registered list, evaluates focusability/
CSS visibility, and updates all tab indices. Registering N initial items
therefore repeated this O(N)–O(N log N) work N times. Parent cleanup also
called `sync()` after each registered item was removed.

## Implementation

During constructor-only initial registration, collect existing connected DOM
items first and perform one final synchronization. Subsequent dynamic
`controller.register()` and `registration.dispose()` calls retain immediate
synchronization. Parent-owned teardown suppresses intermediate list sorting,
then clears the selected ID and all managed tabindex attributes.

The explicit `initialId` is honored even when its DOM node is later in the
initial list. A missing or disabled initial ID still falls back to the first
available item.

## Verification

Added 160-item keyboard/DOM identity and initialId test, dynamic registration,
focus movement, disabled fallback, parent cleanup and no retained tabindex.
The full package Vitest and browser acceptance suites are mandatory.

The diagnostic benchmark compares 20/80/160 initial native buttons, with
one warmup and 10 recorded samples, using jsdom 26 and Node 22. It measures
construction and owner teardown separately. It is *not* a frame-rate or
real-user INP benchmark. Do not infer browser speed from jsdom alone.

The change must not introduce event/listener leaks, inaccessible keyboard
navigation or mismatched focus scope behavior.
