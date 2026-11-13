#!/bin/bash
# Full suite: unit tests + every e2e on Chromium and WebKit (iPhone 15). Needs the app served at :8787.
cd "$(dirname "$0")/.."
export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1
WK="LD_LIBRARY_PATH=/workspace/tools/wkdeps/root/usr/lib/x86_64-linux-gnu"
fail=0
node tests/unit.test.js > /tmp/t-unit.log 2>&1 && echo "unit: $(tail -1 /tmp/t-unit.log)" || { echo "unit: FAIL"; fail=1; }
for eng in chromium webkit; do
  for t in path_e2e daily_e2e batch1_e2e listen_e2e typo_e2e tiles_e2e v8_e2e v81_e2e; do
    if [ $eng = webkit ]; then env $WK timeout 600 python3 tests/$t.py http://127.0.0.1:8787/ webkit > /tmp/t-$t-$eng.log 2>&1; else timeout 600 python3 tests/$t.py http://127.0.0.1:8787/ chromium > /tmp/t-$t-$eng.log 2>&1; fi
    p=$(grep -c '^PASS' /tmp/t-$t-$eng.log); f=$(grep -c '^FAIL' /tmp/t-$t-$eng.log); tb=$(grep -c Traceback /tmp/t-$t-$eng.log)
    echo "$eng $t: $p pass, $f fail$([ $tb -gt 0 ] && echo ', CRASH')"; [ $f -gt 0 -o $tb -gt 0 ] && fail=1
  done
done
timeout 300 python3 tests/e2e.py > /tmp/t-e2e.log 2>&1; echo "chromium e2e: $(grep -E 'console errors|offline' /tmp/t-e2e.log | tr '\n' ' ')"
env $WK timeout 300 python3 tests/fx_check.py http://127.0.0.1:8787/ webkit > /tmp/t-fx-webkit.log 2>&1; timeout 300 python3 tests/fx_check.py http://127.0.0.1:8787/ chromium > /tmp/t-fx-chromium.log 2>&1
echo "fx_check: $(grep -c 'errors: none' /tmp/t-fx-*.log | tr '\n' ' ')"
env $WK timeout 300 python3 tests/update_flow.py chromium webkit 2>&1 | tail -2
timeout 120 python3 tests/exercises.py 2>&1 | tail -1
exit $fail
