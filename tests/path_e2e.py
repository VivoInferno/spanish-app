import re
"""v4+ end-to-end: placement -> path -> all 4 stones of unit 1 -> unit 2 unlocked; long-press parking; v3 migration."""
import asyncio, json, sys, os
from playwright.async_api import async_playwright
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import wkshim  # box WebKit can't decode MP3
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8787/'
ENGINE = sys.argv[2] if len(sys.argv) > 2 else 'chromium'
OUT = '/workspace/spanish-app/screens'; os.makedirs(OUT, exist_ok=True)
V3 = json.load(open('/workspace/spanish-app/tests/fixtures/v3-export.json'))
ok_all = True
def check(cond, msg):
    global ok_all
    print(('PASS ' if cond else 'FAIL ') + msg); ok_all = ok_all and bool(cond)

async def answer(page, right=True):
    """Answer whatever card is on screen. Returns False when the run is over."""
    e = await page.evaluate("__app.run && __app.entry")
    if not e: return False
    if e.get('theme') or e.get('intro'):
        await page.click('#go'); return True
    ex = await page.evaluate("({kind: __app.ex.kind, answer: __app.ex.answer, answers: __app.ex.answers, tiles: __app.ex.tiles})")
    if ex['kind'] == 'mc':
        opts = await page.query_selector_all('.opt'); texts = [await o.inner_text() for o in opts]
        await opts[texts.index(ex['answer']) if right else next(i for i, t in enumerate(texts) if t != ex['answer'])].click()
    elif ex['kind'] == 'build':
        if right:
            import re
            want = re.sub(r'[¿?¡!.,;:]', '', ex['answers'][0]).split()
            used = set()
            for wtok in want:
                for k, t in enumerate(ex['tiles']):
                    if k not in used and t == wtok:
                        used.add(k); await page.click(f'#tiles .tile[data-k="{k}"]'); break
            await page.click('#check')
        else: await page.click('#skip')
    else:
        if right: await page.fill('#ans', ex['answers'][0]); await page.click('#check')
        else: await page.click('#skip')
    await page.click('#next'); return True

async def solve_story_tile(page):
    """v7: a story may pause on a "rebuild the line" word bank; place the tiles in order and check."""
    if not (await page.query_selector('#stile') and await page.query_selector('#check')): return False
    ex = await page.evaluate("({tiles: __app.story.tile.ex.tiles, answers: __app.story.tile.ex.answers})")
    used = []
    for wt in re.sub(r'[¿?¡!.,;:“”"]', '', ex['answers'][0]).split():
        for k, t in enumerate(ex['tiles']):
            if k not in used and t == wt: used.append(k); await page.click(f'#tiles .tile[data-k="{k}"]'); break
    await page.click('#check'); return True

async def main():
    async with async_playwright() as p:
        if ENGINE == 'webkit': b = await p.webkit.launch(); ctx = await b.new_context(**dict(p.devices['iPhone 15'])); await ctx.add_init_script("delete window.SpeechRecognition; delete window.webkitSpeechRecognition")
        else: b = await p.chromium.launch(); ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True); await ctx.add_init_script("delete window.SpeechRecognition; delete window.webkitSpeechRecognition")
        page = await ctx.new_page(); errors = []
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append(str(e)))
        await page.goto(URL); await page.wait_for_selector('#go')
        check(await page.evaluate("__app.version") == 'v9.2', 'app version is v9.2')
        # --- placement
        await page.click('#go'); k = 0
        while not await page.query_selector('h1:has-text("Placement results")'):
            await answer(page, right=(k % 3 != 0)); k += 1
        print('placement items:', k)
        await page.click('#go'); await page.wait_for_selector('.stone.current')
        await page.wait_for_timeout(400); await page.evaluate('window.scrollTo(0,0)'); await page.wait_for_timeout(100); await page.screenshot(path=f'{OUT}/v5-{ENGINE}-path.png')
        check(await page.evaluate("__app.currentPos().uid") == 'u1', 'path starts at unit 1 (B1)')
        check(len(await page.query_selector_all('.section-card')) == 6, 'six CEFR section cards (A1..C2)')
        # --- stone 1: intro
        await page.click('.stone.current')
        await page.wait_for_selector('.badge.new'); await page.wait_for_timeout(350); await page.screenshot(path=f'{OUT}/v5-{ENGINE}-intro-theme.png')
        check(await page.evaluate("getComputedStyle(document.querySelector('.w')).webkitUserSelect || getComputedStyle(document.querySelector('.w')).userSelect") == 'none', 'word spans suppress text selection')
        while await answer(page): pass
        await page.wait_for_selector('.stone.just-done')
        check(await page.evaluate("__app.state.path.done.u1[0]") is True, 'stone 1 (intro) completed')
        await page.wait_for_timeout(250); await page.screenshot(path=f'{OUT}/v5-{ENGINE}-stone-done.png')
        # --- stone 2: story
        await page.click('.stone.current'); await page.wait_for_selector('.story')
        shot = False; steps = 0
        while await page.evaluate("!!__app.story") and steps < 60:
            steps += 1
            if await page.query_selector('.squestion .opt:not(.right):not(.wrong)') and not await page.query_selector('.squestion .opt.right'):
                if not shot: await page.click('#en'); await page.wait_for_timeout(350); await page.screenshot(path=f'{OUT}/v5-{ENGINE}-story.png'); shot = True
                correct = await page.evaluate("(() => { const st = __app.story; const q = st.u.story.qs.find(q => q.after === st.shown - 1 && st.answered[st.u.story.qs.indexOf(q)] == null); return q.o[0]; })()")
                await page.click(f'.squestion .opt[data-o="{correct}"]')
            await solve_story_tile(page)
            await page.click('#next')
        check(await page.evaluate("__app.state.path.done.u1[1]") is True, 'stone 2 (story) completed')
        # --- stone 3: practice
        await page.click('.stone.current')
        while await answer(page): pass
        check(await page.evaluate("__app.state.path.done.u1[2]") is True, 'stone 3 (practice) completed')
        # --- stone 4: test (first attempt: fail on purpose, then pass)
        await page.click('.stone.current')
        tq = await page.evaluate("__app.run.queue.map(e => e.ex)")
        check(len(tq) == 15 and tq.count('build') == 3, f'test has 12 vocab + 3 sentence questions ({len(tq)} items, {tq.count("build")} build)')
        n = 0
        while await page.evaluate("!!__app.run"):
            if await page.evaluate("__app.ex && __app.ex.kind === 'build'") and n < 1:
                await page.wait_for_timeout(350); await page.screenshot(path=f'{OUT}/v5-{ENGINE}-test-build.png'); n += 1
            await answer(page, right=await page.evaluate("__app.run.i % 3 !== 0"))
        txt = await page.inner_text('main'); check('need' in txt, 'failing test shows retry (score below 80%)')
        await page.screenshot(path=f'{OUT}/v5-{ENGINE}-test-fail.png')
        await page.click('#retry')
        i = 0
        while await page.evaluate("!!__app.run"):
            await answer(page, right=(i != 4)); i += 1
        await page.wait_for_timeout(350); await page.screenshot(path=f'{OUT}/v5-{ENGINE}-test-pass.png')
        check('Passed' in await page.inner_text('main'), 'retry passes with 14/15')
        await page.click('#home'); await page.wait_for_selector('.stone.current')
        check(await page.evaluate("__app.currentPos().uid") == 'u2', 'unit 2 unlocked after passing')
        # --- long-press parking on unit 2's theme card
        await page.click('.stone.current'); await page.wait_for_selector('.badge.new')
        target = await page.query_selector('.list .w[data-w]'); wid = await target.get_attribute('data-w')
        box = await target.bounding_box()
        await page.mouse.move(box['x'] + 5, box['y'] + 5); await page.mouse.down(); await page.wait_for_timeout(650)
        menu = await page.query_selector('.wmenu'); await page.mouse.up()
        check(menu is not None, f'long-press opens word menu ({wid})')
        await page.screenshot(path=f'{OUT}/v5-{ENGINE}-longpress-menu.png')
        await page.click('#wm-act')
        st = await page.evaluate(f"({{parked: !!__app.state.parked['{wid}'], inQueue: __app.run.queue.some(e => e.id === 'w:{wid}'), inTest: __app.testQueue('u2').some(e => e.id === 'w:{wid}'), inPractice: __app.practiceQueue('u2').some(e => e.id === 'w:{wid}'), testLen: __app.testQueue('u2').filter(e => e.ex !== 'build').length}})")
        check(st['parked'] and not st['inQueue'] and not st['inTest'] and not st['inPractice'] and st['testLen'] == 12, f'parked word removed from intro/test/practice, test refilled to 12 vocab: {st}')
        # a quick tap must not open the menu
        await page.mouse.click(box['x'] + 5, box['y'] + 5); await page.wait_for_timeout(100)
        check(await page.query_selector('.wmenu') is None, 'short tap does not open the menu')
        await page.click('#quit'); await page.click('#prog')
        exp = await page.evaluate("JSON.parse(JSON.stringify(__app.state))")
        check(wid in exp['parked'], 'parked words included in export data')
        check(await page.query_selector(f'.unpark[data-id="{wid}"]') is not None, 'Progress page lists the parked word')
        await page.screenshot(path=f'{OUT}/v5-{ENGINE}-progress-parked.png', full_page=True)
        await page.click(f'.unpark[data-id="{wid}"]')
        check(not await page.evaluate(f"!!__app.state.parked['{wid}']"), 'Unpark works')
        # import round-trip of parked
        exp['parked'] = {wid: {'at': 1}}
        await page.evaluate("s => __app.importBackup(s)", json.dumps(exp))
        check(await page.evaluate(f"!!__app.state.parked['{wid}'] && !__app.dueIds().includes('w:{wid}')"), 'import restores parked words and they leave review')
        # --- migration from a real v3 progress export
        for mode in ('localStorage', 'import'):
            ctx2 = await b.new_context(); pg = await ctx2.new_page(); errs2 = []
            pg.on('pageerror', lambda e: errs2.append(str(e)))
            raw = dict(V3); raw.pop('exportedAt', None); raw.pop('app', None)
            if mode == 'localStorage':
                await pg.add_init_script(f"localStorage.setItem('spanish-app-state-v1', {json.dumps(json.dumps(raw))})")
                await pg.goto(URL); await pg.wait_for_selector('.stone')
            else:
                await pg.goto(URL); await pg.wait_for_selector('#go')
                await pg.evaluate("s => __app.importBackup(s)", json.dumps(V3)); await pg.reload(); await pg.wait_for_selector('.stone')
            s2 = await pg.evaluate("__app.state")
            same = all(s2['items'].get(k) == v for k, v in V3['items'].items()) and len(s2['items']) == len(V3['items'])
            check(same, f'migration ({mode}): all {len(V3["items"])} SRS item states preserved exactly')
            check(s2['settings'].get('sound') is not None and s2['schema'] == 5 and 'path' in s2 and 'parked' in s2, f'migration ({mode}): new fields added, schema 5 (v8)')
            u1 = s2['path']['done'].get('u1')
            print(f'   derived path ({mode}): u1={u1}, current={await pg.evaluate("__app.currentPos()")}, testedOut={list(s2["path"]["testedOut"].keys())}')
            stored = await pg.evaluate("JSON.parse(localStorage.getItem('spanish-app-state-v1'))")
            check(stored and stored['items'] == s2['items'], f'migration ({mode}): saved under the same storage key')
            check(not errs2, f'migration ({mode}): no page errors {errs2}')
            await ctx2.close()
        check(not errors, f'no console errors ({errors[:3]})')
        await b.close()
    print('\nALL PASS' if ok_all else '\nSOME CHECKS FAILED')
asyncio.run(main())
