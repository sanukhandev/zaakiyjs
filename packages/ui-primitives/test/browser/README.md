# Browser acceptance (Chromium, Firefox, WebKit)

These are real-browser interaction tests, not jsdom simulations. They exercise modal Tab containment, nested focus/restoration, inertness, Escape, tab arrows, listbox typeahead, menu selection, tooltip and popover dismissal, and owner disposal.

From the repository root after a frozen workspace install/build (with the reviewed integration lockfile):

```bash
python3 -m pip install 'playwright==1.64.1'
python3 -m playwright install --with-deps chromium firefox webkit
pnpm --filter @zaakiyjs/ui-primitives test:browser
```

The runner starts a package-local Vite fixture and exits nonzero on the first failure. No package runtime or compiler exports are altered. Until this script is run and results are recorded, browser behavior remains **unverified**. Manual keyboard/screen-reader review is still necessary for WCAG claims.
