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


def native_label_association(page: Page) -> None:
    """Compiler emits native for=; the accessible name and label-click focus work."""
    field = page.get_by_role("textbox", name="Email address")
    expect(field).to_be_visible()
    expect(page.locator('label[for="email"]')).to_have_count(1)
    page.get_by_text("Email address", exact=True).click()
    assert field.evaluate("(node) => document.activeElement === node"), "Label click did not focus input"
    page.evaluate("window.__zaakiyAcceptance.dispose()")
    expect(page.locator('label[for="email"]')).to_have_count(0)
    expect(page.locator("#email")).to_have_count(0)


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



def multi_root_branches(page: Page) -> None:
    expect(page.locator("#advanced-a")).to_have_text("One")
    expect(page.locator("#advanced-b")).to_have_text("Two")
    page.evaluate("window.__oldAdvanced = document.querySelector('#advanced-a')")
    page.locator("#toggle").click()
    expect(page.locator("#advanced-a")).to_have_count(0)
    expect(page.locator("#advanced-b")).to_have_count(0)
    expect(page.locator("#fallback-a")).to_have_text("A")
    expect(page.locator("#fallback-b")).to_have_text("B")
    page.locator("#toggle").click()
    expect(page.locator("#fallback-a")).to_have_count(0)
    expect(page.locator("#fallback-b")).to_have_count(0)
    expect(page.locator("#advanced-a")).to_have_text("One")
    assert page.evaluate("document.querySelector('#advanced-a') !== window.__oldAdvanced")


def nested_keyed_fragments(page: Page) -> None:
    page.evaluate("""() => {
      const headings = [...document.querySelectorAll('#groups h2')];
      const labels = [...document.querySelectorAll('#groups li strong')];
      window.__groupBefore = { headings, labels, removed: document.querySelector('#groups li button') };
      const observer = new MutationObserver(events => window.__groupMutations.push(...events));
      window.__groupMutations = [];
      observer.observe(document.querySelector('#groups'),
        {subtree: true, childList: true, attributes: true, characterData: true});
      window.__groupStop = () => observer.disconnect();
    }""")
    page.locator("#group-rename").click()
    expect(page.locator("#groups h2").first).to_have_text("One2")
    expect(page.locator("#groups li strong").first).to_have_text("One2:First2")
    assert page.locator("#groups h2").all_text_contents() == ["One2", "Two"]
    unchanged = page.evaluate("""() => ({
      name: document.querySelectorAll('#groups h2')[1] === window.__groupBefore.headings[1],
      row: document.querySelectorAll('#groups li strong')[1] === window.__groupBefore.labels[1],
      unrelated: window.__groupMutations.filter(m =>
        m.target === window.__groupBefore.labels[1].firstChild ||
        m.target === window.__groupBefore.headings[1].firstChild).length
    })""")
    assert unchanged == {"name": True, "row": True, "unrelated": 0}, unchanged
    page.evaluate("window.__groupStop()")
    page.locator("#group-reorder").click()
    expect(page.locator("#groups h2").first).to_have_text("Two")
    assert page.locator("#groups h2").all_text_contents() == ["Two", "One2"]
    moved = page.evaluate("""() => {
      const headings = [...document.querySelectorAll('#groups h2')];
      return headings[0] === window.__groupBefore.headings[1] &&
             headings[1] === window.__groupBefore.headings[0];
    }""")
    assert moved, "A keyed fragment reorder must preserve both root DOM identities"
    page.locator("#group-remove").click()
    expect(page.locator("#groups h2")).to_have_count(1)
    assert page.locator("#groups h2").all_text_contents() == ["Two"]
    page.evaluate("window.__groupBefore.removed.click()")
    expect(page.locator("#selected")).to_have_text("-")


def keyed_component_live_getter(page: Page) -> None:
    page.evaluate("window.__componentBefore = [...document.querySelectorAll('#component-groups h3')]")
    assert page.locator("#component-groups h3").all_text_contents() == ["One", "Two"]
    page.locator("#group-rename").click()
    assert page.locator("#component-groups h3").all_text_contents() == ["One2", "Two"]
    same = page.evaluate("""() => {
      const nodes = [...document.querySelectorAll('#component-groups h3')];
      return nodes[0] === window.__componentBefore[0] &&
             nodes[1] === window.__componentBefore[1];
    }""")
    assert same, "Component getter update may not reinitialize keyed component rows"
    page.locator("#group-reorder").click()
    assert page.locator("#component-groups h3").all_text_contents() == ["Two", "One2"]
    moved = page.evaluate("""() => {
      const nodes = [...document.querySelectorAll('#component-groups h3')];
      return nodes[0] === window.__componentBefore[1] &&
             nodes[1] === window.__componentBefore[0];
    }""")
    assert moved, "Component-root keyed reorder must preserve node identity"
    page.locator("#group-remove").click()
    assert page.locator("#component-groups h3").all_text_contents() == ["Two"]

CASES = (
    ("counter_keyboard", counter_keyboard),
    ("native_label_association", native_label_association),
    ("conditional_ownership", conditional_ownership),
    ("precise_mutations", precise_mutations),
    ("reorder_focus", reorder_focus),
    ("add_remove_cleanup", add_remove_cleanup),
    ("injection_is_inert", injection_is_inert),
    ("duplicate_keys_atomic", duplicate_keys_atomic),
    ("disposal_stress", disposal_stress),
    ("multi_root_branches", multi_root_branches),
    ("nested_keyed_fragments", nested_keyed_fragments),
    ("keyed_component_live_getter", keyed_component_live_getter),
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
