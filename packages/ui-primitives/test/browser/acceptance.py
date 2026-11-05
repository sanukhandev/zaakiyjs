#!/usr/bin/env python3
"""Native browser acceptance tests for headless focus/keyboard/overlay controllers.

Requires playwright==1.64.1 plus chromium, firefox and webkit browser engines.
Starts a local Vite fixture server unless --base-url is supplied.
"""
import argparse
import asyncio
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
PORT = 4193


async def exercise(browser_name: str, p, base_url: str):
    browser = await getattr(p, browser_name).launch()
    page = await browser.new_page()
    try:
        await page.goto(base_url, wait_until="networkidle")
        await page.locator("#open-dialog").click()
        await expect(page.locator("#dialog")).to_be_visible()
        await expect(page.locator("#app")).to_have_attribute("inert", "")
        await expect(page.locator("#dialog")).to_have_attribute("aria-modal", "true")
        assert await page.evaluate("document.activeElement.id") == "first", "dialog initial focus"

        await page.locator("#open-nested").click()
        await expect(page.locator("#subdialog")).to_be_visible()
        assert await page.evaluate("document.activeElement.id") == "nested-first", "nested focus"
        await page.keyboard.press("Escape")
        await expect(page.locator("#subdialog")).to_be_hidden()
        assert await page.evaluate("document.activeElement.id") == "open-nested", "nested focus restoration"

        await page.locator("#close-dialog").focus()
        await page.keyboard.press("Tab")
        assert await page.evaluate("document.activeElement.id") == "first", "Tab wraps modal"
        await page.keyboard.press("Shift+Tab")
        assert await page.evaluate("document.activeElement.id") == "close-dialog", "Shift+Tab wraps modal"
        await page.keyboard.press("Escape")
        await expect(page.locator("#dialog")).to_be_hidden()
        assert await page.evaluate("document.activeElement.id") == "open-dialog", "dialog restore focus"
        assert await page.locator("#app").get_attribute("inert") is None, "background inertness teardown"

        await page.locator("#tab-one").focus()
        await page.keyboard.press("ArrowRight")
        await expect(page.locator("#tab-two")).to_have_attribute("aria-selected", "true")
        await expect(page.locator("#panel-two")).to_be_visible()

        await page.locator("#listbox").focus()
        await page.keyboard.press("p")
        await expect(page.locator("#listbox")).to_have_attribute("aria-activedescendant", "option-two")
        await page.keyboard.press("Enter")
        await expect(page.locator("#option-two")).to_have_attribute("aria-selected", "true")

        await page.locator("#menu-trigger").click()
        await expect(page.locator("#menu-content")).to_be_visible()
        await page.keyboard.press("ArrowDown")
        await page.keyboard.press("Enter")
        await expect(page.locator("#menu-result")).to_have_text("beta")
        await expect(page.locator("#menu-content")).to_be_hidden()

        await page.locator("#tip-trigger").focus()
        await expect(page.locator("#tooltip")).to_be_visible(timeout=2500)
        await page.keyboard.press("Escape")
        await expect(page.locator("#tooltip")).to_be_hidden()

        await page.locator("#popover-trigger").click()
        await expect(page.locator("#popover-content")).to_be_visible()
        assert await page.evaluate("document.activeElement.id") == "popover-action", "popover focus"
        await page.locator("#background-focus").dispatch_event("pointerdown")
        await expect(page.locator("#popover-content")).to_be_hidden()

        await page.evaluate("window.zaakiyP2FixtureDispose()")
        assert await page.locator("#app").get_attribute("inert") is None, "owner cleanup"
        print(f"PASS {browser_name}: dialogs, focus, tabs, listbox, menu, tooltip, popover, disposal")
    finally:
        await page.close()
        await browser.close()


def server_ready(url):
    try:
        with urllib.request.urlopen(url, timeout=1) as response:
            return response.status == 200
    except Exception:
        return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default=None)
    args = parser.parse_args()
    url = args.base_url or f"http://127.0.0.1:{PORT}/"
    server = None
    try:
        if args.base_url is None:
            server = subprocess.Popen(
                ["pnpm", "exec", "vite", "test/browser/fixture", "--host",
                 "127.0.0.1", "--port", str(PORT), "--strictPort"],
                cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE
            )
            for _ in range(80):
                if server.poll() is not None:
                    raise RuntimeError("Vite fixture exited before readiness")
                if server_ready(url):
                    break
                time.sleep(0.25)
            else:
                raise RuntimeError("Vite fixture did not become ready")
        async def suite():
            async with async_playwright() as p:
                for name in ("chromium", "firefox", "webkit"):
                    await exercise(name, p, url)
        asyncio.run(suite())
    finally:
        if server is not None:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"FAIL UI primitives browser acceptance: {exc}", file=sys.stderr)
        sys.exit(1)
