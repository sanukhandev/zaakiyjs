#!/usr/bin/env python3
"""Production Vite TSX acceptance: real Chromium, Firefox and WebKit."""
from __future__ import annotations

import argparse
import sys
import traceback
from playwright.sync_api import Page, expect, sync_playwright


def rows(page: Page) -> list[str]:
    return page.locator("#rows li span").all_text_contents()


def counter_keyboard(page: Page) -> None:
    button = page.get_by_role("button", name="Count: 0")
    button.focus()
    page.keyboard.press("Enter")
    expect(page.locator("#counter")).to_have_text("Count: 1")
    expect(page.get_by_role("textbox", name="Row label")).to_have_count(2)


def conditional_ownership(page: Page) -> None:
    page.evaluate("window.__detachedShown = document.querySelector('#shown')")
    page.locator("#shown").click()
    expect(page.locator("#active-clicks")).to_have_text("1")
    page.locator("#toggle").click()
    expect(page.locator("#hidden")).to_have_text("Hidden")
    expect(page.locator("#shown")).to_have_count(0)
    page.evaluate("window.__detachedShown.click()")
    expect(page.locator("#active-clicks")).to_have_text("1")
    page.locator("#toggle").click()
    expect(page.locator("#shown")).to_have_text("Shown")
    assert page.evaluate("document.querySelector('#shown') !== window.__detachedShown")


def precise_mutations(page: Page) -> None:
    page.evaluate("""() => {
      const nodes = [...document.querySelectorAll('#rows li')];
      const probe = window.__mutationProbe = { nodes, unchanged: nodes[1].querySelector('span').firstChild, events: [] };
      const observer = new MutationObserver(events => probe.events.push(...events));
      observer.observe(document.querySelector('#rows'),
        { subtree: true, attributes: true, characterData: true, childList: true });
      probe.stop = () => observer.disconnect();
    }""")
    page.locator("#rename").click()
    expect(page.locator("#rows li span").first).to_have_text("Alpha2")
    assert rows(page) == ["Alpha2", "Beta"]
    result = page.evaluate("""() => {
      const probe = window.__mutationProbe;
      const current = [...document.querySelectorAll('#rows li')];
      return {
        first: current[0] === probe.nodes[0],
        second: current[1] === probe.nodes[1],
        untouched: current[1].querySelector('span').firstChild === probe.unchanged,
        unrelated: probe.events.filter(event =>
          event.type !== 'characterData' || event.target === probe.unchanged).length,
        mutations: probe.events.length
      };
    }""")
    assert result["first"] and result["second"] and result["untouched"], result
    assert result["unrelated"] == 0 and result["mutations"] >= 1, result
    page.evaluate("window.__mutationProbe.stop()")
    page.locator("#rows li button").first.click()
    expect(page.locator("#selected")).to_have_text("Alpha2")


def reorder_focus(page: Page) -> None:
    page.evaluate("""() => {
      const before = window.__previousRows = [...document.querySelectorAll('#rows li')];
      const input = window.__focusedInput = before[0].querySelector('input');
      input.focus();
      input.setSelectionRange(1, 4);
      document.querySelector('#reorder').click();
    }""")
    expect(page.locator("#rows li span").first).to_have_text("Beta")
    assert rows(page) == ["Beta", "Alpha"]
    result = page.evaluate("""() => {
      const after = [...document.querySelectorAll('#rows li')];
      return {
        first: after[1] === window.__previousRows[0],
        second: after[0] === window.__previousRows[1],
        input: after[1].querySelector('input') === window.__focusedInput,
        focus: document.activeElement === window.__focusedInput,
        start: window.__focusedInput.selectionStart,
        end: window.__focusedInput.selectionEnd
      };
    }""")
    assert result == {
        "first": True, "second": True, "input": True, "focus": True,
        "start": 1, "end": 4
    }, result


def add_remove_cleanup(page: Page) -> None:
    page.evaluate("window.__removedButton = document.querySelector('#rows li button')")
    page.locator("#remove").click()
    expect(page.locator("#rows li")).to_have_count(1)
    assert rows(page) == ["Beta"]
    page.evaluate("window.__removedButton.click()")
    expect(page.locator("#selected")).to_have_text("-")
    page.locator("#append").click()
    expect(page.locator("#rows li")).to_have_count(2)
    assert rows(page) == ["Beta", "Gamma"]
    page.locator("#rows li button").last.click()
    expect(page.locator("#selected")).to_have_text("Gamma")


def injection_is_inert(page: Page) -> None:
    page.locator("#inject").click()
    payload = "<img src=x onerror=alert(1)>"
    expect(page.locator("#rows li span").first).to_have_text(payload)
    expect(page.locator("#rows img")).to_have_count(0)


def duplicate_keys_atomic(page: Page) -> None:
    page.locator("#duplicate").click()
    expect(page.locator("#duplicate-error")).to_have_text("rejected")
    assert rows(page) == ["Alpha", "Beta"], "Duplicate keys must not mutate DOM"


def disposal_stress(page: Page) -> None:
    assert page.evaluate("window.__zaakiyAcceptance.lifecycle.setups") == 1
    for _ in range(12):
        page.locator("#toggle").click()
        page.locator("#toggle").click()
        page.locator("#reorder").click()
    expect(page.locator("#shown")).to_have_text("Shown")
    page.evaluate("""() => {
      window.__staleCounter = document.querySelector('#counter');
      window.__staleRowButton = document.querySelector('#rows li button');
      window.__zaakiyAcceptance.dispose();
      window.__zaakiyAcceptance.dispose();
      window.__zaakiyAcceptance.mutateDisposedSignals();
    }""")
    result = page.evaluate("""() => ({
      disposed: window.__zaakiyAcceptance.isDisposed(),
      setups: window.__zaakiyAcceptance.lifecycle.setups,
      disposals: window.__zaakiyAcceptance.lifecycle.disposals,
      children: document.getElementById('app').childNodes.length,
      count: window.__zaakiyAcceptance.getCounter()
    })""")
    assert result["disposed"] and result["setups"] == 1, result
    assert result["disposals"] == 1 and result["children"] == 0, result
    page.evaluate("window.__staleCounter.click(); window.__staleRowButton.click()")
    assert page.evaluate("window.__zaakiyAcceptance.getCounter()") == result["count"]
    assert page.evaluate("window.__zaakiyAcceptance.getSelected()") == "-"
    assert page.evaluate("document.getElementById('app').childNodes.length") == 0


CASES = (
    ("counter_keyboard", counter_keyboard),
    ("conditional_ownership", conditional_ownership),
    ("precise_mutations", precise_mutations),
    ("reorder_focus", reorder_focus),
    ("add_remove_cleanup", add_remove_cleanup),
    ("injection_is_inert", injection_is_inert),
    ("duplicate_keys_atomic", duplicate_keys_atomic),
    ("disposal_stress", disposal_stress),
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:4188")
    options = parser.parse_args()
    failures = []
    successes = 0
    with sync_playwright() as playwright:
        for name in ("chromium", "firefox", "webkit"):
            try:
                browser = getattr(playwright, name).launch(headless=True)
            except Exception:
                failures.append((name, "launch", traceback.format_exc()))
                continue
            try:
                for case_name, case in CASES:
                    context = browser.new_context(viewport={"width": 1280, "height": 900},
                                                  reduced_motion="reduce")
                    page = context.new_page()
                    page.set_default_timeout(10000)
                    errors = []
                    page.on("pageerror", lambda error: errors.append(str(error)))
                    try:
                        page.goto(options.base_url, wait_until="networkidle", timeout=30000)
                        expect(page.get_by_role("heading",
                            name="ZaakiyJS M1 browser acceptance")).to_be_visible()
                        case(page)
                        if case_name != "duplicate_keys_atomic":
                            assert not errors, f"Unexpected page errors: {errors}"
                        successes += 1
                        print(f"PASS {name} / {case_name}", flush=True)
                    except Exception:
                        failures.append((name, case_name, traceback.format_exc()))
                        print(f"FAIL {name} / {case_name}", flush=True)
                        try:
                            page.screenshot(path=f"/tmp/zaakiy-{name}-{case_name}.png")
                        except Exception:
                            pass
                    finally:
                        context.close()
            finally:
                browser.close()
    for name, case, details in failures:
        print(f"\nFAILED {name} / {case}\n{details}", file=sys.stderr)
    print(f"M1 browser matrix: {successes}/{3 * len(CASES)} passed; {len(failures)} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
