"""ZaakiyJS compat opt-in AbortSignal helper acceptance in real browser engines."""
from __future__ import annotations

import argparse
import sys
from playwright.sync_api import Error as PlaywrightError, sync_playwright


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True)
    args = parser.parse_args()
    url = args.base_url.rstrip("/") + "/packages/compat/test/fixtures/browser-abort.html"
    failures: list[str] = []

    with sync_playwright() as playwright:
        for name in ("chromium", "firefox", "webkit"):
            browser = None
            try:
                browser = getattr(playwright, name).launch(headless=True)
                page = browser.new_page()
                exceptions: list[str] = []
                page.on("pageerror", lambda error: exceptions.append(str(error)))
                response = page.goto(url, wait_until="load", timeout=20000)
                if not response or response.status != 200:
                    raise AssertionError(f"Expected HTTP 200, got {response.status if response else 'no response'}")
                page.locator('#result[data-status="pass"]').wait_for(timeout=10000)
                if exceptions:
                    raise AssertionError("Browser page exception: " + "; ".join(exceptions))
                print(f"PASS: {name} native AbortController, scoped composition, timeout and disposal")
            except (AssertionError, PlaywrightError) as error:
                failures.append(f"{name}: {error}")
                print(f"FAIL: {name}: {error}", file=sys.stderr)
            finally:
                if browser is not None:
                    browser.close()

    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
