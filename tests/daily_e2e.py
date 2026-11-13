"""v5: daily minutes bar + streak. Uses Playwright's fake clock in America/Mexico_City.
Covers: v4 -> v5 migration keeps all data and seeds the streak at 1090 once; minutes accumulate only while a lesson is open,
pause after 60 s without input and while the app is hidden; local-midnight rollover; goal-hit state; streak continue/break; Edit streak."""
import asyncio, json, sys, os, re
from datetime import datetime, timezone, timedelta
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8787/'
ENGINE = sys.argv[2] if len(sys.argv) > 2 else 'chromium'
OUT = '/workspace/spanish-app/screens'; os.makedirs(OUT, exist_ok=True)
KEY = 'spanish-app-state-v1'
V4 = json.load(open('/workspace/spanish-app/tests/fixtures/v4-export.json'))
CST = timezone(timedelta(hours=-6))
def at(y, m, d, h=0, mi=0): return datetime(y, m, d, h, mi, tzinfo=CST)
ok_all = True
def check(cond, msg):
    global ok_all
    print(('PASS ' if cond else 'FAIL ') + msg); ok_all = ok_all and bool(cond)

async def answer(page):
    e = await page.evaluate("__app.run && __app.entry")
    if not e: return False
    if e.get('theme') or e.get('intro'): await page.click('#go'); return True
    ex = await page.evaluate("({kind: __app.ex.kind, answer: __app.ex.answer, answers: __app.ex.answers, tiles: __app.ex.tiles})")
    if ex['kind'] == 'mc':
        opts = await page.query_selector_all('.opt'); texts = [await o.inner_text() for o in opts]; await opts[texts.index(ex['answer'])].click()
    elif ex['kind'] == 'build':
        want = re.sub(r'[¿?¡!.,;:]', '', ex['answers'][0]).split(); used = set()
        for wtok in want:
            for k, t in enumerate(ex['tiles']):
                if k not in used and t == wtok: used.add(k); await page.click(f'#tiles .tile[data-k="{k}"]'); break
        await page.click('#check')
    else: await page.fill('#ans', ex['answers'][0]); await page.click('#check')
    await page.click('#next'); return True

async def active(page, minutes, step=20):
    """Simulate studying: a key press every `step` seconds for `minutes` minutes."""
    for _ in range(int(minutes * 60 / step)):
        await page.keyboard.press('Shift'); await page.clock.run_for(step * 1000)

async def bar(page): return (await page.inner_text('#mins')).strip(), (await page.inner_text('#streak-n')).strip(), await page.evaluate("document.getElementById('streak').classList.contains('lit')")
async def goto_time(page, dt):
    now = await page.evaluate('Date.now()'); await page.clock.fast_forward(int(dt.timestamp() * 1000 - now)); await page.clock.run_for(1500)
async def ms(page): return await page.evaluate("(__app.state.daily[Object.keys(__app.state.daily).sort().pop()] || {ms: 0}).ms")
async def mins(page): return await page.evaluate("__app.todayMinutes()")
async def finish_practice(page):  # complete a full practice stone (counts as a session for the streak)
    await page.evaluate("__app.openStone('u1', 2)")
    while await answer(page): pass
    await page.wait_for_selector('#daybar')

async def main():
    async with async_playwright() as p:
        if ENGINE == 'webkit': b = await p.webkit.launch(); dev = dict(p.devices['iPhone 15'])
        else: b = await p.chromium.launch(); dev = dict(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True)
        ctx = await b.new_context(**dev, timezone_id='America/Mexico_City', service_workers='block')
        await ctx.add_init_script("delete window.SpeechRecognition; delete window.webkitSpeechRecognition")  # v8: no recogniser; speaking drills are covered by v8_e2e
        raw = dict(V4); [raw.pop(k, None) for k in ('exportedAt', 'app', 'appVersion')]
        await ctx.add_init_script(f"if (!localStorage.getItem('{KEY}')) localStorage.setItem('{KEY}', {json.dumps(json.dumps(raw))})")
        page = await ctx.new_page(); errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        await page.clock.install(time=at(2026, 11, 11, 9)); await page.clock.pause_at(at(2026, 11, 11, 9))
        await page.goto(URL); await page.wait_for_selector('#daybar')
        check(await page.evaluate("__app.version") == 'v8', 'app version is v8')
        # --- migration from v4 progress
        s = await page.evaluate("__app.state"); stored = await page.evaluate(f"JSON.parse(localStorage.getItem('{KEY}'))")
        diff = [k for k, v in raw.items() if k not in ('schema', 'settings', 'path') and s.get(k) != v]
        path_same = all(s['path']['done'].get(u) == v for u, v in raw['path']['done'].items()) and s['path']['tests'] == raw['path']['tests'] and s['path']['testedOut'] == raw['path']['testedOut']
        same = not diff and path_same  # path.done may gain empty entries for units added later (v6), nothing existing changes
        if not same: print('   differs:', diff, 'path same:', path_same)
        check(same, 'v4 migration: items, pstats, recent, path, tests, parked, placement, sessions all identical')
        check(all(s['settings'].get(k) == v for k, v in raw['settings'].items()) and s['settings']['goalMin'] == 15, 'v4 migration: settings kept, 15-min goal added')
        check(s['schema'] == 5 and s['streak']['count'] == 1090 and s['streak']['lastDay'] == '2026-11-11' and s['daily'] == {}, f"v4 migration: schema 5, streak seeded 1090 (lastDay {s['streak']['lastDay']})")
        check(stored is not None and stored['items'] == raw['items'], 'v4 migration: saved under the same storage key')
        m, n, lit = await bar(page)
        check(m == '0 / 15 min' and n == '1,090' and lit, f'home shows seed: "{m}", streak {n}, flame lit={lit}')
        top = await page.evaluate("document.getElementById('daybar').getBoundingClientRect().top")
        await page.evaluate("window.scrollTo(0, 2000)"); top2 = await page.evaluate("document.getElementById('daybar').getBoundingClientRect().top"); await page.evaluate("window.scrollTo(0, 0)")
        check(top < 120 and abs(top - top2) < 2, f'bar pinned at the top while the path scrolls (top {top:.0f} -> {top2:.0f})')
        # --- minutes accumulate only inside a lesson
        await active(page, 2); check(await mins(page) == 0, 'no minutes counted on the home screen')
        await page.click('.stone.current'); await page.wait_for_selector('#quit')
        await active(page, 7); check(await mins(page) == 7, f'7 min of active lesson time counted ({await mins(page)})')
        await page.keyboard.press('Shift'); m0 = await ms(page)
        await page.clock.run_for(5 * 60000); d = await ms(page) - m0
        check(59000 <= d <= 61000, f'idle 5 min after the last input: only 60 s counted ({d/1000:.0f} s)')
        await page.keyboard.press('Shift'); m0 = await ms(page)
        await page.evaluate("Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'hidden'}); document.dispatchEvent(new Event('visibilitychange'))")
        await active(page, 3); d = await ms(page) - m0; check(d < 1500, f'backgrounded 3 min: paused ({d/1000:.1f} s counted)')
        await page.evaluate("Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'visible'}); document.dispatchEvent(new Event('visibilitychange'))")
        await active(page, 1 + 20/60); check(await mins(page) == 9, f'resumes when visible again ({await mins(page)} min)')
        await page.click('#quit'); await page.wait_for_selector('#daybar')
        m, n, lit = await bar(page); check(m == '9 / 15 min', f'home bar after quitting: "{m}"')
        w = await page.evaluate("parseFloat(document.querySelector('.mbar span').style.width)"); check(abs(w - 60) < 0.5, f'bar filled 60% ({w})')
        await page.clock.run_for(800); await page.evaluate("window.scrollTo(0,0); document.getAnimations().forEach(a => { try { a.finish() } catch (e) {} })")
        await page.screenshot(path=f'{OUT}/v5-home.png' if ENGINE == 'webkit' else f'{OUT}/v5-{ENGINE}-home.png')
        await page.reload(); await page.wait_for_selector('#daybar'); check(await mins(page) == 9, 'minutes persist across reload')
        # --- reach the goal
        await page.click('.stone.current'); await page.wait_for_selector('#quit'); await active(page, 6.5)
        await page.click('#quit'); await page.wait_for_selector('#daybar'); await page.clock.run_for(400)
        d = await page.evaluate("__app.state.daily['2026-11-11']")
        cls = await page.get_attribute('#daybar', 'class')
        check(d['goal'] and d['celebrated'] and 'goal-done' in cls, f'goal hit at 15 min: "{(await bar(page))[0]}", classes "{cls}"')
        await page.clock.run_for(300); await page.evaluate("window.scrollTo(0,0); document.getAnimations().forEach(a => { try { a.finish() } catch (e) {} })")
        await page.screenshot(path=f'{OUT}/v5-{ENGINE}-home-goal.png')
        await page.click('#prog'); await page.click('#back'); await page.wait_for_selector('#daybar')
        check(not await page.query_selector('.daybar.fx-goal'), 'goal celebration plays only once per day')
        # --- streak: same-day session does not add
        await finish_practice(page)
        check((await bar(page))[1] == '1,090', 'session on Nov 11 (already counted by seed): still 1,090')
        # --- midnight rollover while sitting on the home screen
        await goto_time(page, at(2026, 11, 12, 0, 0))
        m, n, lit = await bar(page)
        check(await page.evaluate("new Date().getDate()") == 12 and m == '0 / 15 min' and n == '1,090' and not lit, f'local midnight: bar reset to "{m}", streak {n} pending (lit={lit})')
        await finish_practice(page); m, n, lit = await bar(page)
        check(n == '1,091' and lit, f'Nov 12 session continues the streak: {n}')
        # --- a lesson that runs across midnight splits its minutes
        await goto_time(page, at(2026, 11, 12, 23, 57))
        await page.click('.stone.current'); await page.wait_for_selector('#quit'); await active(page, 6)
        daily = await page.evaluate("__app.state.daily"); await page.click('#quit')
        a, c = daily.get('2026-11-12', {}).get('ms', 0) / 1000, daily.get('2026-11-13', {}).get('ms', 0) / 1000
        check(170 <= a <= 180 and 179 <= c <= 181 and (await bar(page))[0] == '3 / 15 min', f'lesson 23:57–00:03 split at midnight: Nov 12 got {a:.0f} s, Nov 13 got {c:.0f} s')
        m, n, lit = await bar(page); check(n == '1,091' and not lit, f'Nov 13 not yet completed: {n} unlit')
        # --- break: miss all of Nov 13 and Nov 14
        await goto_time(page, at(2026, 11, 14, 10))
        check((await bar(page))[1] == '0', f'Nov 14 after missing all of Nov 13: streak shows {(await bar(page))[1]}')
        await goto_time(page, at(2026, 11, 15, 10))
        await page.reload(); await page.wait_for_selector('#daybar')
        check((await bar(page))[1] == '0', f'Nov 15, still broken after reload: {(await bar(page))[1]}')
        await finish_practice(page); check((await bar(page))[1] == '1', 'new streak starts at 1')
        hist = await page.evaluate("Object.keys(__app.state.daily).sort()")
        check(hist == ['2026-11-11', '2026-11-12', '2026-11-13', '2026-11-15'], f'daily history kept for charting: {hist}')
        # --- Edit streak in Settings
        await page.click('#prog'); await page.fill('#streakIn', '1094'); await page.click('#streakSave'); await page.click('#back'); await page.wait_for_selector('#daybar')
        m, n, lit = await bar(page); check(n == '1,094' and lit, f'Edit streak -> {n} (today done, lit={lit})')
        await page.reload(); await page.wait_for_selector('#daybar')
        check((await bar(page))[1] == '1,094', 'edited streak survives reload (seed is not reapplied)')
        exp = await page.evaluate("__app.state"); fresh = await b.new_context(); pg2 = await fresh.new_page(); await pg2.goto(URL); await pg2.wait_for_selector('#go')
        await pg2.evaluate("s => __app.importBackup(s)", json.dumps(exp)); s3 = await pg2.evaluate("__app.state")
        check(s3['streak']['count'] == 1094 and s3['daily'] == exp['daily'], 'export/import round-trips streak and daily history'); await fresh.close()
        check(not errors, f'no console errors ({errors[:3]})')
        await b.close()
    print('\nALL PASS' if ok_all else '\nSOME CHECKS FAILED')
asyncio.run(main())
