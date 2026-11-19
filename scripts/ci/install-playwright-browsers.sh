#!/usr/bin/env bash
# Install pinned native browser engines without masking download or OS-dependency failures.
# This runs on GitHub Actions Linux runners; no browser test or engine is skipped.
set -euo pipefail

version="1.64.1"
export PIP_DISABLE_PIP_VERSION_CHECK=1
export PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT="${PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT:-45000}"

echo "Installing pinned Python Playwright ${version}"
timeout --signal=TERM --kill-after=10s 120s python3 -m pip install "playwright==${version}"

# The Ubuntu GitHub-hosted image already contains most native browser libraries.
# Installing ALL apt dependencies unconditionally causes nondeterministic 20-minute
# mirror stalls. First download the pinned engines and probe actual native launches;
# install missing OS libraries only if a launch check fails. Never skip a browser.
downloaded=0
for attempt in 1 2 3; do
  echo "Installing all three pinned browser engines (attempt ${attempt}/3)"
  if timeout --signal=TERM --kill-after=10s 180s python3 -m playwright install chromium firefox webkit; then
    downloaded=1
    break
  fi
  echo "Browser download attempt ${attempt} failed or exceeded 180 seconds" >&2
  if [ "${attempt}" -lt 3 ]; then sleep "$((attempt * 5))"; fi
done
if [ "$downloaded" -ne 1 ]; then
  echo "ERROR: Pinned browser downloads failed; certification remains blocked" >&2
  exit 1
fi

# Validate each real browser process. Only install OS libraries for an engine
# that demonstrably cannot launch on the pinned runner image.
probe() {
  local engine="$1"
  PLAYWRIGHT_ENGINE="$engine" timeout --signal=TERM --kill-after=5s 35s python3 - <<'PY'
import os
from playwright.sync_api import sync_playwright
name = os.environ["PLAYWRIGHT_ENGINE"]
with sync_playwright() as runtime:
    browser = getattr(runtime, name).launch(headless=True)
    try:
        page = browser.new_page()
        assert page.evaluate("() => 2 + 2") == 4, name
        print("PASS: native " + name + " launched and executed JavaScript")
    finally:
        browser.close()
PY
}
for engine in chromium firefox webkit; do
  if probe "$engine"; then
    continue
  fi
  echo "Native $engine needs OS dependencies; installing only its pinned requirements" >&2
  timeout --signal=TERM --kill-after=10s 850s python3 -m playwright install-deps "$engine"
  if ! probe "$engine"; then
    echo "ERROR: Native $engine cannot launch; certification blocked" >&2
    exit 1
  fi
done
echo "PASS: Chromium, Firefox and WebKit all launched and executed JavaScript"
