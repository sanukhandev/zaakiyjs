#!/usr/bin/env python3
"""Real-browser P3 Ads contract acceptance: no provider network without consent, CLS, focus, teardown."""
from __future__ import annotations

import argparse
import sys
import traceback
from playwright.sync_api import sync_playwright, expect


def state(page):
    return page.evaluate("() => ({state: window.__ads.state(), lazy: window.__ads.lazyState(), ...window.__ads.metrics})")


def run_case(page):
    page.goto("http://127.0.0.1:4199/", wait_until="networkidle")
    page.wait_for_function("() => !!window.__ads")
    before = state(page)
    assert before["starts"] == 0 and before["loads"] == 0, before
    assert before["state"] == "awaiting-consent", before
    assert page.locator("iframe").count() == 0, "No creative or vendor frame before consent"
    assert page.evaluate("window.__ads.initialIsSame()") is True
    page.locator("#focus").focus()
    page.evaluate("window.__ads.grantAnalytics()")
    assert state(page)["starts"] == 0, "Analytics consent must not authorize ads"
    page.evaluate("window.__ads.grantAds()")
    page.wait_for_function("() => window.__ads.state() === 'ready'")
    assert state(page)["starts"] == 1
    assert state(page)["loads"] == 1, state(page)
    assert page.locator("#first iframe").count() == 1
    assert page.evaluate("document.activeElement?.id") == "focus", "Ad load stole focus"
    assert abs(page.evaluate("window.__ads.afterPosition() - window.__ads.initialPosition")) < 1, "Ad caused avoidable layout shift"
    assert sum(page.evaluate("window.__ads.layoutShifts")) < 0.02, "Layout-shift performance entries regressed"
    assert state(page)["lazy"] == "idle", "Offscreen ad loaded before visibility"
    page.locator("#second").scroll_into_view_if_needed()
    page.wait_for_function("() => window.__ads.lazyState() === 'ready'")
    assert state(page)["loads"] == 2, state(page)
    page.evaluate("window.__ads.revokeAds()")
    page.wait_for_function("() => window.__ads.state() === 'revoked'")
    page.wait_for_function("() => document.querySelectorAll('iframe').length === 0")
    page.wait_for_function("() => window.__ads.metrics.disposes >= 1")
    assert page.evaluate("document.querySelector('#first').style.minHeight") == "180px"
    page.evaluate("window.__ads.grantAds()")
    # Regrant must start a fresh provider and restore its first placement.
    page.wait_for_function("() => window.__ads.state() === 'ready' && window.__ads.metrics.starts === 2")
    assert page.locator("#first iframe").count() == 1
    page.evaluate("window.__ads.dispose()")
    page.wait_for_function("() => window.__ads.state() === 'disposed'")
    page.wait_for_function("() => window.__ads.subscriptions() === 0")
    assert page.locator("iframe").count() == 0
    assert page.evaluate("document.querySelector('#first').style.minHeight") == "180px"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--base-url", default="http://127.0.0.1:4199")
    args = p.parse_args()
    failures = []
    total = 0
    with sync_playwright() as pw:
        for browser_name in ("chromium", "firefox", "webkit"):
            browser = getattr(pw, browser_name).launch(headless=True)
            try:
                for width in (360, 1280):
                    context = browser.new_context(viewport={"width": width, "height": 850}, reduced_motion="reduce")
                    page = context.new_page()
                    errors = []
                    third_party = []
                    page.on("pageerror", lambda exc: errors.append(str(exc)))
                    page.on("request", lambda request: third_party.append(request.url) if not request.url.startswith(args.base_url) else None)
                    try:
                        page.goto(args.base_url + "/", wait_until="networkidle")
                        page.wait_for_function("() => !!window.__ads")
                        assert not third_party, f"Unexpected third-party requests before consent: {third_party}"
                        run_case(page)
                        assert not errors, f"Browser errors: {errors}"
                        assert not third_party, f"Unexpected third-party network: {third_party}"
                        print(f"PASS Ads {browser_name} viewport={width}", flush=True)
                        total += 1
                    except Exception:
                        detail = traceback.format_exc() + f"\nPage errors: {errors}\nExternal requests: {third_party}"
                        failures.append((browser_name, width, detail))
                        try:
                            page.screenshot(path=f"/tmp/zaakiy-ads-{browser_name}-{width}.png")
                        except Exception:
                            pass
                    finally:
                        context.close()
                    if failures:
                        break
            finally:
                browser.close()
            if failures:
                break
    for browser, width, error in failures:
        print(f"FAIL Ads {browser} viewport={width}\n{error}", file=sys.stderr)
    print(f"Ads browser contract matrix {total}/6 passed; {len(failures)} failed", flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
