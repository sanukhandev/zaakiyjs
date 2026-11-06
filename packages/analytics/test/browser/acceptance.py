#!/usr/bin/env python3
"""Real-browser consent and PerformanceObserver cleanup tests; synthetic metrics
exercise the pipeline, not the Web Vitals measurement algorithm.
"""
import asyncio
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[4]
PORT = 4287
URL = f'http://127.0.0.1:{PORT}/packages/analytics/test/browser/fixture.html'
NATIVE_URL = f'http://127.0.0.1:{PORT}/packages/analytics/test/browser/native_fixture.html'


def ready():
    try:
        with urllib.request.urlopen(URL, timeout=1) as response:
            return response.status == 200
    except Exception:
        return False


async def browser_case(p, browser_name):
    browser = await getattr(p, browser_name).launch()
    page = await browser.new_page()
    errors = []
    requests = []
    page.on('pageerror', lambda exc: errors.append(str(exc)))
    page.on('request', lambda request: requests.append(request.url))
    try:
        await page.goto(URL, wait_until='networkidle')
        await page.evaluate('window.__analyticsFixture.ready')
        state = await page.evaluate('window.__analyticsFixture.counters()')
        assert state == {'start': 0, 'disconnect': 0, 'subscribers': 1, 'providers': 0}, state
        assert await page.evaluate('window.__analyticsFixture.events().length') == 0

        await page.evaluate('window.__analyticsFixture.grant()')
        await page.wait_for_function('window.__analyticsFixture.counters().start === 1')
        await page.locator('#interact').click()
        await page.wait_for_timeout(150)
        await page.evaluate('window.__analyticsFixture.flush()')
        await page.wait_for_function('window.__analyticsFixture.events().some(e => e.kind === "web-vital")')
        sent = await page.evaluate('window.__analyticsFixture.events()')
        assert any(e['kind'] == 'event' and e['name'] == 'interacted' for e in sent), sent
        assert any(e['kind'] == 'web-vital' and e['metric'] == 'LCP' for e in sent), sent
        assert 'never-store' not in str(sent), sent

        await page.evaluate('window.__analyticsFixture.revoke()')
        state = await page.evaluate('window.__analyticsFixture.counters()')
        assert state['disconnect'] == 1, state
        before = await page.evaluate('window.__analyticsFixture.events().length')
        await page.evaluate('window.__analyticsFixture.sample()')
        await page.wait_for_timeout(100)
        await page.evaluate('window.__analyticsFixture.flush()')
        assert await page.evaluate('window.__analyticsFixture.events().length') == before

        await page.evaluate('window.__analyticsFixture.grant()')
        await page.wait_for_function('window.__analyticsFixture.counters().start === 2')
        await page.evaluate('window.__analyticsFixture.stale()')
        await page.evaluate('window.__analyticsFixture.sample()')
        await page.wait_for_timeout(150)
        await page.evaluate('window.__analyticsFixture.flush()')
        await page.wait_for_function('window.__analyticsFixture.counters().providers >= 2')
        await page.evaluate('window.__analyticsFixture.dispose()')
        state = await page.evaluate('window.__analyticsFixture.counters()')
        assert state['disconnect'] == 2 and state['subscribers'] == 0, state
        assert not errors, f'unexpected browser JS errors {errors}'
        assert all(url.startswith(f'http://127.0.0.1:{PORT}/') for url in requests), requests
        print(f'PASS {browser_name}: unknown/grant/revoke/regrant, native observer cleanup, SSR-safe ESM and no external requests')
    finally:
        await page.close()
        await browser.close()



async def native_metric_case(p, browser_name):
    browser = await getattr(p, browser_name).launch()
    page = await browser.new_page(viewport={"width": 1280, "height": 900})
    page_errors = []
    page.on('pageerror', lambda exc: page_errors.append(str(exc)))
    try:
        await page.goto(NATIVE_URL, wait_until='networkidle')
        await page.evaluate('window.__nativeVitals.ready')
        assert (await page.evaluate('window.__nativeVitals.counts()'))['start'] == 0
        assert (await page.evaluate('window.__nativeVitals.events()')) == []
        supported = await page.evaluate('window.__nativeVitals.supported')
        await page.evaluate('window.__nativeVitals.grant()')
        if any(t in supported for t in ['largest-contentful-paint', 'layout-shift', 'event']):
            await page.wait_for_function('window.__nativeVitals.counts().start > 0')
        await page.evaluate('window.__nativeVitals.induceLayoutAndLcp()')
        await page.wait_for_timeout(200)
        await page.locator('#interact').click()
        await page.wait_for_timeout(450)
        await page.evaluate('window.__nativeVitals.flush()')
        events = await page.evaluate('window.__nativeVitals.events()')
        actual = {e['metric']: e for e in events if e['kind'] == 'web-vital'}
        if browser_name == 'chromium':
            # Chromium supports all three native Performance Timeline entry types.
            assert set(['LCP', 'INP', 'CLS']).issubset(actual), (supported, actual)
            assert actual['LCP']['value'] > 0, actual
            assert actual['INP']['value'] >= 40, actual
            assert actual['CLS']['value'] > 0, actual
        for record in events:
            assert 'private' not in str(record), record
        before = await page.evaluate('window.__nativeVitals.counts()')
        await page.evaluate('window.__nativeVitals.revoke()')
        after = await page.evaluate('window.__nativeVitals.counts()')
        assert after['disconnect'] > before['disconnect'], (before, after)
        assert after['disconnect'] == after['start'], after
        await page.evaluate('window.__nativeVitals.flush()')
        assert await page.evaluate('window.__nativeVitals.events()') == events
        await page.evaluate('window.__nativeVitals.dispose()')
        assert (await page.evaluate('window.__nativeVitals.counts()'))['subscribers'] == 0
        assert not page_errors, page_errors
        print(f'PASS {browser_name}: native LCP/INP/CLS, pre-consent silence, real observers, disconnect on revoke')
    finally:
        await page.close()
        await browser.close()


def main():
    server = subprocess.Popen(
        [sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1', '--directory', str(ROOT)],
        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    try:
        for _ in range(60):
            if server.poll() is not None:
                raise RuntimeError('HTTP server exited unexpectedly')
            if ready():
                break
            time.sleep(0.25)
        else:
            raise RuntimeError('Test server unavailable')
        async def run():
            async with async_playwright() as p:
                for engine in ('chromium', 'firefox', 'webkit'):
                    await browser_case(p, engine)
                    await native_metric_case(p, engine)
        asyncio.run(run())
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'FAIL analytics browser acceptance: {error}', file=sys.stderr)
        sys.exit(1)
