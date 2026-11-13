"""Simulates a deploy while the app is open: v9.1 running -> server gets v10 -> app returns to foreground -> auto reload into v10, progress intact."""
import asyncio, shutil, subprocess, sys, time, re, os
from playwright.async_api import async_playwright
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import wkshim  # box WebKit can't decode MP3
SRC = '/workspace/spanish-app'; TMP = '/tmp/spanish-upd'; PORT = 8788
def setv(n):
    for f, pat, rep in [('sw.js', r"CACHE = 'espanol-v[\d-]+'", f"CACHE = 'espanol-v{n}'"), ('app.js', r"APP_VERSION = 'v[\d.]+'", f"APP_VERSION = 'v{n}'")]:
        p = os.path.join(TMP, f); s = open(p).read(); open(p, 'w').write(re.sub(pat, rep, s))
async def run(engine):
    shutil.rmtree(TMP, ignore_errors=True); shutil.copytree(SRC, TMP, ignore=shutil.ignore_patterns('.git', 'screens', 'tests'))
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=TMP, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    try:
        async with async_playwright() as p:
            b = await (p.webkit if engine == 'webkit' else p.chromium).launch()
            ctx = await b.new_context(**(dict(p.devices['iPhone 15']) if engine == 'webkit' else {'viewport': {'width': 390, 'height': 844}}))
            await ctx.add_init_script("delete window.SpeechRecognition; delete window.webkitSpeechRecognition")  # v8: no recogniser; speaking drills are covered by v8_e2e
            page = await ctx.new_page(); errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            url = f'http://127.0.0.1:{PORT}/'
            await page.goto(url); await page.wait_for_selector('#go')
            await page.wait_for_function("navigator.serviceWorker.controller !== null", timeout=10000)
            await page.evaluate("(() => { const s = __app.state; s.placementDone = true; s.items['w:fuga'] = {s: 50, d: 3, reps: 4, lapses: 0, last: Date.now(), due: Date.now() + 40*864e5}; localStorage.setItem('spanish-app-state-v1', JSON.stringify(s)); })()")
            await page.reload(); await page.wait_for_selector('.stone')
            v_before = await page.evaluate("__app.version"); label = await page.inner_text('.version')
            setv(10)  # "deploy" (v9.1 -> v10)
            async with page.expect_navigation(timeout=15000):
                await page.evaluate("Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'visible'}); document.dispatchEvent(new Event('visibilitychange'));")
            await page.wait_for_selector('.stone')
            v_after = await page.evaluate("__app.version"); label2 = await page.inner_text('.version')
            fuga = await page.evaluate("__app.state.items['w:fuga'] && __app.state.items['w:fuga'].s")
            await page.wait_for_timeout(2000)
            still = await page.evaluate("__app.version")  # no reload loop
            await ctx.set_offline(True); await page.reload(); await page.wait_for_selector('.stone', timeout=8000)
            offline_v = await page.evaluate("__app.version"); await ctx.set_offline(False)
            print(f'{engine}: before={v_before} (label {label}) -> after={v_after} (label {label2}); progress kept={fuga == 50}; stable={still}; offline reload={offline_v}; errors={errors or "none"}')
            await b.close()
    finally:
        srv.terminate()
for e in (sys.argv[1:] or ['chromium', 'webkit']): asyncio.run(run(e))
