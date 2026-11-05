#!/usr/bin/env python3
"""Real production Vite/Zaakiy compiled UI smoke in Chromium, Firefox and WebKit.
Requires playwright==1.64.1. Runs locally against a built production preview.
"""
import asyncio
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[4]
PORT = 4196
CONFIG = "packages/ui/test/browser/vite.config.ts"


def ready(url):
    try:
        with urllib.request.urlopen(url, timeout=1) as response:
            return response.status == 200
    except Exception:
        return False


async def browser_case(p, browser_name, url):
    browser = await getattr(p, browser_name).launch()
    page = await browser.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    try:
        await page.goto(url, wait_until="networkidle")
        await expect(page.locator("#save")).to_have_text("Save")
        await expect(page.locator("#customer")).to_have_value("Alice")
        await page.locator("#customer").fill("Updated")
        assert await page.evaluate("window.__zaakiyUi.getCounts().saves") == 0
        await page.locator("#save").click()
        await expect(page.locator("#toast-host [role=status]")).to_have_text("Saved 1")
        await page.locator("#disabled").click(force=True)
        assert await page.evaluate("window.__zaakiyUi.getCounts().saves") == 1
        await expect(page.locator("#loading")).to_be_disabled()
        await page.locator("#account-tab-profile").focus()
        await page.keyboard.press("ArrowRight")
        await expect(page.locator("#account-tab-billing")).to_have_attribute("aria-selected","true")
        await expect(page.locator("#account-panel-billing")).to_be_visible()
        await page.get_by_role("button", name="Open Settings").click()
        await expect(page.locator("#settings")).to_be_visible()
        await expect(page.locator("#settings")).to_have_attribute("aria-modal","true")
        await page.keyboard.press("Escape")
        await expect(page.locator("#settings")).to_be_hidden()
        await page.get_by_role("button",name="Actions").click()
        await expect(page.locator("#actions")).to_be_visible()
        await page.keyboard.press("ArrowDown")
        await page.keyboard.press("Enter")
        assert await page.evaluate("window.__zaakiyUi.getCounts().selection") != "none"
        await page.get_by_role("button",name="Help").focus()
        await expect(page.locator("#save-tip")).to_be_visible(timeout=2000)
        await page.keyboard.press("Escape")
        await expect(page.locator("#save-tip")).to_be_hidden()
        await page.get_by_role("button",name="More").click()
        await expect(page.locator("#extra")).to_be_visible()
        await page.locator("#faq button").click()
        await expect(page.locator("#faq-panel-one")).to_be_visible()
        await expect(page.locator(".zui-alert")).to_contain_text("<img")
        assert await page.locator(".zui-alert img").count() == 0
        await expect(page.locator("table caption")).to_have_text("Items")
        await page.evaluate("window.__zaakiyUi.setNickname('X')")
        await page.locator("#nickname").focus()
        await page.locator("#nickname").blur()
        await page.evaluate("window.__zaakiyUi.dispose()")
        assert await page.evaluate("window.__zaakiyUi.isDisposed()")
        assert await page.locator("#app main").count() == 0
        assert not errors, f"Unexpected page errors: {errors}"
        print(f"PASS {browser_name}: compiled components, keyboard, ownership, accessibility and XSS")
    finally:
        await page.close()
        await browser.close()


def main():
    subprocess.run(["pnpm","exec","vite","build","--config",CONFIG], cwd=ROOT, check=True)
    preview = subprocess.Popen(
        ["pnpm","exec","vite","preview","--config",CONFIG,"--host","127.0.0.1",
         "--port",str(PORT),"--strictPort"],
        cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE
    )
    url=f"http://127.0.0.1:{PORT}/"
    try:
        for _ in range(80):
            if preview.poll() is not None:
                raise RuntimeError("UI production preview failed to start")
            if ready(url):
                break
            time.sleep(0.25)
        else:
            raise RuntimeError("UI production preview not ready")
        async def run():
            async with async_playwright() as p:
                for engine in ("chromium","firefox","webkit"):
                    await browser_case(p,engine,url)
        asyncio.run(run())
    finally:
        preview.terminate()
        try:
            preview.wait(timeout=5)
        except subprocess.TimeoutExpired:
            preview.kill()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"FAIL UI browser acceptance: {exc}",file=sys.stderr)
        sys.exit(1)
