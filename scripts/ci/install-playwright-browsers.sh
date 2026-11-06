#!/usr/bin/env bash
# Install pinned native browser engines without masking download or OS-dependency failures.
# This runs on GitHub Actions Linux runners; no browser test or engine is skipped.
set -euo pipefail

version="1.64.1"
export PIP_DISABLE_PIP_VERSION_CHECK=1
export PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT="${PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT:-45000}"

echo "Installing pinned Python Playwright ${version}"
timeout --signal=TERM --kill-after=10s 120s python3 -m pip install "playwright==${version}"

echo "Installing Chromium, Firefox and WebKit native dependencies"
timeout --signal=TERM --kill-after=10s 240s python3 -m playwright install-deps chromium firefox webkit

for attempt in 1 2 3; do
  echo "Installing all three pinned browser engines (attempt ${attempt}/3)"
  if timeout --signal=TERM --kill-after=10s 180s python3 -m playwright install chromium firefox webkit; then
    echo "PASS: Chromium, Firefox and WebKit installed for Playwright ${version}"
    exit 0
  fi
  echo "Browser download attempt ${attempt} failed or exceeded 180 seconds" >&2
  if [ "${attempt}" -lt 3 ]; then sleep "$((attempt * 5))"; fi
done

echo "ERROR: Could not install all three pinned browser engines; native acceptance remains blocked" >&2
exit 1
