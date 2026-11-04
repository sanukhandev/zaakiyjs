#!/usr/bin/env python3
"""Public Router + compiled TSX acceptance against real Chromium, Firefox, WebKit."""
from __future__ import annotations

import argparse
import sys
import traceback
from playwright.sync_api import Page, expect, sync_playwright


def navigate(page: Page, target: str) -> dict:
    return page.evaluate("(url) => window.__zaakiyRouter.navigate(url)", target)


def metrics(page: Page) -> dict:
    return page.evaluate("() => structuredClone(window.__zaakiyRouter.metrics)")


def start(page: Page, base: str, path: str = "/app/") -> None:
    page.goto(base + path, wait_until="networkidle", timeout=30000)
    expect(page.get_by_role("heading", name="ZaakiyJS Router acceptance")).to_be_visible()
    assert page.evaluate("window.__zaakiyRouter.router.signals.status.value") == "idle"


def typed_navigation(page: Page) -> None:
    page.locator("#nav-product").click()
    expect(page.locator("#product-heading")).to_have_text("Product alpha")
    assert page.url.endswith("/app/products/alpha")
    assert page.locator("#route-outlet #product-page").count() == 1
    page.locator("#increment").click()
    expect(page.locator("#increment")).to_have_text("Count: 1")
    before = metrics(page)
    assert before["shellSetup"] == 1 and before["productSetup"] == 1, before
    assert before["productMount"] == 1, before


def nested_identity_and_hash(page: Page) -> None:
    assert navigate(page, "/app/products/alpha")["status"] == "committed"
    page.locator("#product-input").focus()
    page.locator("#product-input").fill("edited notes")
    page.evaluate("""() => {
      window.__shell = document.querySelector('#router-shell');
      window.__product = document.querySelector('#product-page');
      window.__notes = document.querySelector('#product-input');
    }""")
    assert navigate(page, "/app/products/alpha#details")["status"] == "committed"
    state = page.evaluate("""() => ({
      shell: document.querySelector('#router-shell') === window.__shell,
      product: document.querySelector('#product-page') === window.__product,
      notes: document.querySelector('#product-input') === window.__notes,
      text: document.querySelector('#product-input').value,
      focus: document.activeElement === window.__notes,
      hash: window.__zaakiyRouter.router.signals.hash.value
    })""")
    assert state == {
        "shell": True, "product": True, "notes": True,
        "text": "edited notes", "focus": True, "hash": "#details"
    }, state
    assert navigate(page, "/app/products/alpha?q=changed")["status"] == "committed"
    expect(page.locator("#query-value")).to_have_text("Query: changed")
    state = page.evaluate("""() => ({
      shell: document.querySelector('#router-shell') === window.__shell,
      product: document.querySelector('#product-page') !== window.__product
    })""")
    assert state == {"shell": True, "product": True}, state
    counts = metrics(page)
    assert counts["shellSetup"] == 1 and counts["productSetup"] == 2, counts
    assert counts["productCleanup"] == 1, counts


def history_popstate(page: Page) -> None:
    navigate(page, "/app/products/one")
    navigate(page, "/app/products/two")
    expect(page.locator("#product-heading")).to_have_text("Product two")
    page.evaluate("window.__zaakiyRouter.back()")
    expect(page.locator("#product-heading")).to_have_text("Product one")
    assert page.url.endswith("/app/products/one")
    page.evaluate("window.__zaakiyRouter.forward()")
    expect(page.locator("#product-heading")).to_have_text("Product two")
    assert page.url.endswith("/app/products/two")
    assert metrics(page)["shellSetup"] == 1


def guard_denial_and_redirect(page: Page) -> None:
    initial_url = page.url
    denied = navigate(page, "/app/blocked")
    assert denied["status"] == "blocked", denied
    assert page.url == initial_url
    expect(page.locator("#home-page")).to_be_visible()
    committed = navigate(page, "/app/redirect")
    assert committed["status"] == "committed", committed
    expect(page.locator("#product-heading")).to_have_text("Product redirected")
    assert page.url.endswith("/app/products/redirected")
    assert metrics(page)["shellSetup"] == 1


def lazy_module_and_cleanup(page: Page) -> None:
    page.locator("#nav-lazy").click()
    expect(page.locator("#lazy-page h2")).to_have_text("Lazy module loaded")
    state = metrics(page)
    assert state["lazySetup"] == 1, state
    assert navigate(page, "/app/products/sibling")["status"] == "committed"
    expect(page.locator("#product-heading")).to_have_text("Product sibling")
    state = metrics(page)
    assert state["lazyCleanup"] == 1 and state["shellSetup"] == 1, state
    assert state["announcements"][-1] == "/app/products/sibling", state


def cancel_stale_loader(page: Page) -> None:
    response = page.evaluate("""async () => {
      const slow = window.__zaakiyRouter.navigate('/app/slow');
      await new Promise(resolve => setTimeout(resolve, 100));
      const fast = window.__zaakiyRouter.navigate('/app/products/latest');
      return [await slow, await fast];
    }""")
    assert response[0]["status"] == "cancelled", response
    assert response[1]["status"] == "committed", response
    expect(page.locator("#product-heading")).to_have_text("Product latest")
    assert page.locator("#product-page").count() == 1
    state = metrics(page)
    assert state["slowAborts"] == 1, state
    assert page.url.endswith("/app/products/latest")
    assert page.evaluate("window.__zaakiyRouter.router.signals.pending.value") is None


def deep_link_refresh(page: Page, base: str) -> None:
    start(page, base, "/app/products/deep?q=refresh")
    expect(page.locator("#product-heading")).to_have_text("Product deep")
    expect(page.locator("#query-value")).to_have_text("Query: refresh")
    page.reload(wait_until="networkidle")
    expect(page.locator("#product-heading")).to_have_text("Product deep")


def inert_params_and_unsafe_targets(page: Page) -> None:
    payload = "<img src=x onerror=alert(1)>"
    result = page.evaluate("""async (payload) => {
      const app = window.__zaakiyRouter;
      const target = app.href(payload);
      return {target, result: await app.navigate(target)};
    }""", payload)
    assert result["result"]["status"] == "committed", result
    expect(page.locator("#safe-param")).to_have_text(payload)
    assert page.locator("#product-page img").count() == 0
    before = page.url
    for value in ("javascript:alert(1)", "//example.com/x", "/outside/"):
        result = page.evaluate("""async (target) => {
          try { await window.__zaakiyRouter.navigate(target); return 'accepted'; }
          catch (error) { return error.name; }
        }""", value)
        assert result == "UnsafeNavigationError", (value, result)
        assert page.url == before, value


def owner_disposal(page: Page) -> None:
    navigate(page, "/app/products/cleanup")
    expect(page.locator("#product-page")).to_be_visible()
    state = page.evaluate("""() => {
      window.__oldButton = document.querySelector('#increment');
      window.__oldText = window.__oldButton.firstChild;
      window.__zaakiyRouter.dispose();
      window.__zaakiyRouter.dispose();
      window.__oldButton.click();
      return {
        connected: window.__oldButton.isConnected,
        children: document.querySelector('#app').childElementCount,
        button: window.__oldButton.textContent
      };
    }""")
    assert state["connected"] is False and state["children"] == 0, state
    assert state["button"].strip() == "Count: 0", state
    counts = metrics(page)
    assert counts["productCleanup"] == 1 and counts["shellCleanup"] == 1, counts


CASES = (
    ("typed_navigation", typed_navigation),
    ("nested_identity_and_hash", nested_identity_and_hash),
    ("history_popstate", history_popstate),
    ("guard_denial_and_redirect", guard_denial_and_redirect),
    ("lazy_module_and_cleanup", lazy_module_and_cleanup),
    ("cancel_stale_loader", cancel_stale_loader),
    ("inert_params_and_unsafe_targets", inert_params_and_unsafe_targets),
    ("owner_disposal", owner_disposal),
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:4188")
    args = parser.parse_args()
    failures = []
    passed = 0
    with sync_playwright() as playwright:
        for engine in ("chromium", "firefox", "webkit"):
            try:
                browser = getattr(playwright, engine).launch(headless=True)
            except Exception:
                failures.append((engine, "launch", traceback.format_exc()))
                continue
            try:
                runs = list(CASES) + [
                    ("deep_link_refresh", lambda p: deep_link_refresh(p, args.base_url))
                ]
                for case, action in runs:
                    context = browser.new_context(
                        viewport={"width": 1280, "height": 900},
                        reduced_motion="reduce"
                    )
                    page = context.new_page()
                    errors = []
                    page.on("pageerror", lambda error: errors.append(str(error)))
                    page.set_default_timeout(10000)
                    try:
                        start(page, args.base_url)
                        action(page)
                        assert not errors, f"Page errors: {errors}"
                        print(f"PASS {engine} / {case}", flush=True)
                        passed += 1
                    except Exception:
                        failures.append((engine, case, traceback.format_exc() + f"\\nPage errors: {errors}"))
                        print(f"FAIL {engine} / {case}: {errors}", flush=True)
                        try:
                            page.screenshot(path=f"/tmp/zaakiy-router-{engine}-{case}.png")
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
    for engine, case, detail in failures:
        print(f"\nFAILED {engine} / {case}\n{detail}", file=sys.stderr)
    print(f"Router browser matrix: {passed}/{3 * (len(CASES) + 1)} passed, {len(failures)} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
