#!/usr/bin/env python3
"""CSP/Trusted Types, automated WCAG and owner/heap acceptance for packed M1 app.

This test is intentionally distinct from the 3-engine M1 behavior suite.
Automated axe checks do not replace human assistive-technology verification.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]


def audit_browser(browser, url: str) -> dict:
    context = browser.new_context(reduced_motion="reduce", viewport={"width": 1280, "height": 900})
    page = context.new_page()
    page.set_default_timeout(12000)
    page_errors = []
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.goto(url, wait_until="networkidle")
    expect(page.locator("#counter")).to_have_text("Count: 0")
    csp = page.locator('meta[http-equiv="Content-Security-Policy"]').get_attribute("content")
    assert csp and "script-src 'self'" in csp and "object-src 'none'" in csp, csp
    assert "'unsafe-inline'" not in csp and "'unsafe-eval'" not in csp, csp

    page.locator("#inject").click()
    expect(page.locator("#rows li span").first).to_have_text("<img src=x onerror=alert(1)>")
    expect(page.locator("#rows img")).to_have_count(0)

    # Test a genuinely inserted inline script, NOT merely a Playwright
    # devtools evaluate that bypasses page CSP.
    page.evaluate("""() => {
      window.__cspExecuted = false;
      window.__cspViolations = [];
      document.addEventListener("securitypolicyviolation", event => {
        window.__cspViolations.push({ directive: event.violatedDirective, blocked: event.blockedURI });
      });
      window.__trustedScriptBlocked = false;
      const script = document.createElement("script");
      try {
        script.textContent = "window.__cspExecuted = true";
        document.body.appendChild(script);
      } catch (error) {
        // Trusted Types enforcement may reject even assigning script content.
        window.__trustedScriptBlocked = error instanceof TypeError || !!error;
      }
      const dataScript = document.createElement("script");
      try {
        dataScript.src = "data:text/javascript,window.__cspExecuted=true";
        document.body.appendChild(dataScript);
      } catch (error) {
        window.__trustedScriptBlocked = true;
      }
    }""")
    page.wait_for_timeout(150)
    csp_result = page.evaluate("""() => ({
      executed: window.__cspExecuted,
      blocked: window.__cspViolations.some(e => e.directive === 'script-src-elem' ||
                                                e.directive === 'script-src')
    })""")
    assert csp_result["executed"] is False, csp_result
    assert csp_result["blocked"] or page.evaluate("window.__trustedScriptBlocked"), csp_result

    # axe.min.js is served locally by Vite, not fetched from the public CDN.
    expect(page.locator('script[src="/axe.min.js"]')).to_have_count(1)
    page.wait_for_function("typeof window.axe !== 'undefined'")
    result = page.evaluate("""async tags => await window.axe.run(document, {
      runOnly: {type: "tag", values: tags},
      resultTypes: ["violations", "incomplete"]
    })""", WCAG_TAGS)
    violations = [{
        "id": v["id"], "impact": v.get("impact"), "help": v.get("help"),
        "nodes": [node.get("target") for node in v.get("nodes", [])]
    } for v in result.get("violations", [])]
    assert not violations, "axe WCAG rule violations: " + json.dumps(violations)
    expect(page.get_by_role("button", name="Count: 0")).to_be_visible()
    page.get_by_role("button", name="Count: 0").focus()
    page.keyboard.press("Enter")
    expect(page.locator("#counter")).to_have_text("Count: 1")
    assert not page_errors, "Unexpected browser errors: " + repr(page_errors)
    version = browser.version
    context.close()
    return {
        "browser": browser.browser_type.name, "version": version, "csp": "pass",
        "textInjection": "pass", "keyboard": "pass",
        "axe": "pass", "axeViolations": violations,
        "axeNeedsReview": len(result.get("incomplete", [])),
        "manualScreenReader": "not_verified"
    }


def measured_chromium_heap(browser, url: str) -> dict:
    context = browser.new_context(reduced_motion="reduce")
    page = context.new_page()
    page.goto(url, wait_until="networkidle")
    expect(page.locator("#counter")).to_have_text("Count: 0")
    cdp = context.new_cdp_session(page)
    cdp.send("Performance.enable")
    cdp.send("HeapProfiler.enable")

    def measure() -> int:
        for _ in range(3):
            cdp.send("HeapProfiler.collectGarbage")
        page.wait_for_timeout(80)
        metrics = cdp.send("Performance.getMetrics")["metrics"]
        return int(next(entry["value"] for entry in metrics if entry["name"] == "JSHeapUsedSize"))

    page.evaluate("window.__zaakiyAcceptance.cycleMount(60)")
    before = measure()
    page.evaluate("window.__zaakiyAcceptance.cycleMount(300)")
    middle = measure()
    page.evaluate("window.__zaakiyAcceptance.cycleMount(300)")
    after = measure()
    lifecycle = page.evaluate("window.__zaakiyAcceptance.lifecycle")
    assert lifecycle["setups"] - lifecycle["disposals"] == 1, lifecycle
    # This is a regression ceiling, not a proof of zero retained objects.
    # Require the warm-state growth across 600 owner disposal cycles to
    # remain below 8MiB even when browser GC noise is present.
    increase = max(0, after - before)
    ceiling = 8 * 1024 * 1024
    report = {
        "browser": "chromium", "warmupCycles": 60, "measuredCycles": 600,
        "heapStartBytes": before, "heapMiddleBytes": middle,
        "heapEndBytes": after, "heapGrowthBytes": increase,
        "growthCeilingBytes": ceiling, "ownersRetained": lifecycle["setups"]-lifecycle["disposals"]
    }
    assert increase <= ceiling, "Owner stress exceeds heap regression ceiling: " + json.dumps(report)
    page.evaluate("window.__zaakiyAcceptance.dispose()")
    assert page.evaluate("window.__zaakiyAcceptance.lifecycle.setups - window.__zaakiyAcceptance.lifecycle.disposals") == 0
    context.close()
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:4189")
    parser.add_argument("--report", default=".generated/release-browser-report.json")
    args = parser.parse_args()
    report = {"audits": [], "heap": None, "passed": False}
    failures = []
    with sync_playwright() as playwright:
        for name in ("chromium", "firefox", "webkit"):
            try:
                browser = getattr(playwright, name).launch(headless=True)
                try:
                    outcome = audit_browser(browser, args.base_url)
                    report["audits"].append(outcome)
                    print(f"PASS {name} CSP and axe WCAG; version={outcome['version']}", flush=True)
                finally:
                    browser.close()
            except Exception:
                failures.append((name, traceback.format_exc()))
                print(f"FAIL {name}: CSP/axe", flush=True)

        try:
            chromium = playwright.chromium.launch(headless=True, args=["--js-flags=--expose-gc"])
            try:
                report["heap"] = measured_chromium_heap(chromium, args.base_url)
                print("PASS Chromium heap stress " + json.dumps(report["heap"]), flush=True)
            finally:
                chromium.close()
        except Exception:
            failures.append(("chromium-heap", traceback.format_exc()))
            print("FAIL Chromium heap stress", flush=True)

    report["passed"] = not failures and len(report["audits"]) == 3 and report["heap"] is not None
    out = Path(args.report)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2) + "\n")
    for name, failure in failures:
        print(f"\n{name}: {failure}", file=sys.stderr)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
