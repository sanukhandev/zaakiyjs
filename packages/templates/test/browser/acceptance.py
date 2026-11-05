#!/usr/bin/env python3
"""Native Chromium, Firefox and WebKit smoke tests for generated ZaakiyJS apps."""
from __future__ import annotations
import os
import sys
import traceback
from playwright.sync_api import sync_playwright, expect, Page

BASE = "http://127.0.0.1:"
PORTS = {"dashboard": 4191, "authentication": 4192, "settings": 4193, "crud": 4194}

def audit_accessibility(page: Page) -> None:
    """Run pinned axe-core WCAG 2.0/2.1 A/AA against the actual generated DOM."""
    violations = page.evaluate("""async () => {
      const result=await window.axe.run(document,{
        runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21a","wcag21aa"]}
      });
      return result.violations.map(x=>({
        id:x.id,impact:x.impact,
        nodes:x.nodes.map(node=>({target:node.target,summary:node.failureSummary}))
      }));
    }""")
    assert not violations, f"Generated application WCAG violations: {violations}"

def start(page: Page, name: str) -> None:
    page.goto(BASE + str(PORTS[name]), wait_until="networkidle", timeout=30000)
    expect(page.locator("main")).to_be_visible(timeout=15000)
    page.add_script_tag(path=os.environ["ZAAKIY_TEMPLATES_AXE_PATH"])

def dashboard(page: Page) -> None:
    expect(page.get_by_role("heading", name="Operations overview")).to_be_visible()
    expect(page.get_by_text("Example onboarding completed")).to_be_visible()
    page.get_by_role("searchbox", name="Filter activity").fill("reviewed")
    expect(page.get_by_text("Example request reviewed")).to_be_visible()
    expect(page.get_by_text("Example onboarding completed")).to_have_count(0)
    page.get_by_role("button", name="Refresh report").click()
    expect(page.get_by_role("heading", name="Key metrics")).to_have_count(0)  # section uses accessible label, not a heading
    expect(page.get_by_role("region", name="Key metrics")).to_be_visible()

def auth(page: Page) -> None:
    expect(page.get_by_role("heading", name="zaakiy-template-demo account")).to_be_visible()
    page.get_by_role("textbox", name="Email").fill("demo@example.com")
    page.get_by_label("Password", exact=True).fill("a-sample-password")
    page.get_by_role("button", name="Sign in securely").click()
    expect(page.get_by_text("Sign-in failed. Try again.")).to_be_visible()
    expect(page.get_by_text("Authenticated by backend")).to_have_count(0)
    page.get_by_role("button", name="Forgot password").click()
    expect(page.get_by_role("heading", name="Request password recovery")).to_be_visible()
    page.get_by_role("button", name="Session expired").click()
    expect(page.get_by_role("heading", name="Your session has expired")).to_be_visible()
    assert page.evaluate("Object.keys(localStorage).length") == 0

def settings(page: Page) -> None:
    expect(page.get_by_role("heading", name="Settings")).to_be_visible()
    expect(page.get_by_text("Settings could not be loaded.")).to_be_visible()
    page.get_by_role("textbox", name="Display name").fill("Example User")
    expect(page.get_by_text("You have unsaved changes.")).to_be_visible()
    page.get_by_role("button", name="Save settings").click()
    expect(page.get_by_text("Load your settings before saving.")).to_be_visible()
    page.get_by_role("button", name="Discard changes").click()
    expect(page.get_by_text("Unsaved changes discarded.")).to_be_visible()

def crud(page: Page) -> None:
    expect(page.get_by_role("heading", name="Product management")).to_be_visible()
    expect(page.get_by_text("Example keyboard")).to_be_visible()
    page.get_by_role("button", name="Create product").click()
    expect(page.get_by_role("heading", name="Create product")).to_be_visible()
    page.get_by_role("textbox", name="Name").fill("Demo item")
    page.get_by_role("textbox", name="SKU").fill("DEMO-04")
    page.get_by_role("spinbutton", name="Price in cents").fill("1234")
    page.get_by_role("button", name="Save product").click()
    expect(page.get_by_text("Demo item (DEMO-04)")).to_be_visible()
    row = page.get_by_role("listitem").filter(has_text="Demo item")
    row.get_by_role("button", name="Delete").click()
    dialog=page.get_by_role("dialog", name="Confirm deletion")
    expect(dialog).to_be_visible()
    dialog.press("Escape")
    expect(dialog).not_to_be_visible()
    row.get_by_role("button", name="Delete").click()
    dialog.get_by_role("button", name="Confirm delete").click()
    expect(page.get_by_text("Product deleted.")).to_be_visible()
    expect(page.get_by_text("Demo item (DEMO-04)")).to_have_count(0)

CASES = {"dashboard":dashboard,"authentication":auth,"settings":settings,"crud":crud}

def main() -> int:
    failures=[]
    passed=0
    with sync_playwright() as pw:
        for engine_name in ("chromium","firefox","webkit"):
            browser=getattr(pw,engine_name).launch(headless=True)
            try:
                for name,case in CASES.items():
                    for width in (1280,390):
                        context=browser.new_context(viewport={"width":width,"height":900},reduced_motion="reduce")
                        page=context.new_page()
                        errors=[]
                        page.on("pageerror",lambda error:errors.append(str(error)))
                        try:
                            start(page,name)
                            audit_accessibility(page)
                            case(page)
                            audit_accessibility(page)
                            assert not errors,errors
                            assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2")
                            print(f"PASS {engine_name} {name} {width}",flush=True)
                            passed+=1
                        except Exception:
                            print(f"FAIL {engine_name} {name} {width}",flush=True)
                            failures.append((engine_name,name,width,traceback.format_exc(),errors))
                            try:page.screenshot(path=f"/tmp/zaakiy-templates-{engine_name}-{name}-{width}.png")
                            except Exception:pass
                        finally:context.close()
                        if failures:
                            break
                    if failures:
                        break
            finally:browser.close()
            if failures:
                break
    for engine,name,width,trace,errors in failures:
        print(f"FAILURE {engine}/{name}/{width}: {errors}\n{trace}",file=sys.stderr)
    print(f"Template browser matrix: {passed}/24 passed; {len(failures)} failed",flush=True)
    return 1 if failures else 0

if __name__=="__main__":
    raise SystemExit(main())
