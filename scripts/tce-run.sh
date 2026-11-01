#!/usr/bin/env bash
# TCE_Agent's execution step for the "auto" rows of
# docs/testing/test-case-catalog.md. Runs the app's and backend's existing
# checks back to back, continuing past a failure so one red suite doesn't
# hide a failure in the next one, then prints which of the four passed.
#
# Usage: scripts/tce-run.sh
# Writes nothing itself — pipe/tee its output into
# docs/testing/results/<run-id>.md yourself, or capture it with `tee`.
set -uo pipefail
cd "$(dirname "$0")/.."

run_step() {
  local name="$1"; shift
  echo "=== $name ==="
  if "$@"; then
    echo "--- $name: PASS ---"
    RESULTS+=("$name: PASS")
  else
    echo "--- $name: FAIL ---"
    RESULTS+=("$name: FAIL")
  fi
  echo
}

RESULTS=()

run_step "app typecheck" npm run typecheck
run_step "app lint" npm run lint
run_step "app tests" npm test

pushd backend > /dev/null
run_step "backend tests" npm test
popd > /dev/null

echo "============================"
echo "TCE run summary — $(date -u +%Y-%m-%dT%H:%M:%SZ) — $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
for r in "${RESULTS[@]}"; do
  echo "  $r"
done
