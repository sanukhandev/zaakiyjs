# E5 — Integrated CRUD acceptance fixture (initial slice)

## Vertical slice
A 300-record native keyed DOM list, one editable validated form, a scoped immutable Store action, a cancellable asynchronous Task, and Router navigation/loader cancellation run together in jsdom under Vitest.

## Non-negotiable assertions
- Editing one record updates exactly one keyed view; all retained input elements keep identity and focus/selection.
- The edit causes zero child-list mutations, no unrelated view creations, and no owner disposals.
- Form validation rejects empty titles; submission applies one store action.
- A superseded route loader does not commit stale navigation data.
- All 300 keyed child cleanups execute exactly once on unmount.

## Follow-up before E5 completion
Run a real-browser CRUD dashboard with 100/300/700-field stress cases, record p50/p95 INP and retained heap in Chromium/Firefox/WebKit, benchmark equivalent React/Vue/Angular apps, and profile the Store/Forms/Router hotspots. This fixture alone is not a real-browser performance certification.
