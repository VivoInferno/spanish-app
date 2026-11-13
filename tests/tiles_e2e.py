"""v7 tiles everywhere + fixed answer area + no double-tap zoom + Continue/Next debounce.
- tile-order drills (with distractors) appear in intro practice, practice, review picks and story (rebuild a line), in both
  directions (ES tiles / EN tiles), at roughly 20-30% of items that have a sentence; the test stays 12 vocab + 3 builds
- the word bank's y never moves while tiles are added/removed (answer area reserves 3 rows)
- viewport blocks zoom, touch-action: manipulation, dblclick and a quick second touchend are prevented
- a fast double tap on Check / Continue only moves one step (guard forced on with window.__forceTapGuard)"""
import asyncio, json, sys, os, re
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8787/'
ENGINE = sys.argv[2] if len(sys.argv) > 2 else 'chromium'
OUT = '/workspace/spanish-app/screens'; os.makedirs(OUT, exist_ok=True)
KEY = 'spanish-app-state-v1'
V5 = json.load(open('/workspace/spanish-app/tests/fixtures/v5-export.json'))
ok_all = True
def check(cond, msg):
    global ok_all
    print(('PASS ' if cond else 'FAIL ') + msg); ok_all = ok_all and bool(cond)
def shot(name): return f'{OUT}/{name}.png' if ENGINE == 'webkit' else f'{OUT}/{name}-{ENGINE}.png'
PUNCT = r'[¿?¡!.,;:“”"]'

async def place_tiles(page, n=None):
    ex = await page.evaluate("({tiles: __app.ex.tiles, answers: __app.ex.answers})")
    want = re.sub(PUNCT, '', ex['answers'][0]).split(); used = []
    for wt in want[:n] if n else want:
        for k, t in enumerate(ex['tiles']):
            if k not in used and t == wt: used.append(k); await page.click(f'#tiles .tile[data-k="{k}"]'); break
    return used

async def main():
    async with async_playwright() as p:
        b = await (p.webkit if ENGINE == 'webkit' else p.chromium).launch()
        dev = dict(p.devices['iPhone 15']) if ENGINE == 'webkit' else dict(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True)
        ctx = await b.new_context(**dev, timezone_id='America/Mexico_City', service_workers='block')
        await ctx.add_init_script("delete window.SpeechRecognition; delete window.webkitSpeechRecognition")  # v8: no recogniser; speaking drills are covered by v8_e2e
        raw = {k: v for k, v in V5.items() if k not in ('exportedAt', 'app', 'appVersion')}
        await ctx.add_init_script(f"if (!localStorage.getItem('{KEY}')) localStorage.setItem('{KEY}', {json.dumps(json.dumps(raw))})")
        page = await ctx.new_page(); errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        await page.goto(URL); await page.wait_for_selector('.stone')
        check(await page.evaluate("__app.version") == 'v8', 'app version is v8')

        # ---- zoom off ----
        vp = await page.evaluate("document.querySelector('meta[name=viewport]').content")
        check('maximum-scale=1' in vp and 'user-scalable=no' in vp, f'viewport blocks zoom ({vp})')
        ta = await page.evaluate("[document.documentElement, document.body, document.querySelector('button')].map(e => getComputedStyle(e).touchAction)")
        check(all(t == 'manipulation' for t in ta), f'touch-action manipulation on html/body/button ({ta})')
        dbl = await page.evaluate("(() => { const e = new MouseEvent('dblclick', {bubbles: true, cancelable: true}); document.querySelector('.stone').dispatchEvent(e); return e.defaultPrevented; })()")
        check(dbl, 'dblclick default (zoom) is prevented')
        te = await page.evaluate("""(() => { window.__forceTapGuard = true; const b = document.querySelector('button');
            const fire = () => { const e = new Event('touchend', {bubbles: true, cancelable: true}); b.dispatchEvent(e); return e.defaultPrevented; };
            const r = [fire(), fire()]; window.__forceTapGuard = false; return r; })()""")
        check(te == [False, True], f'single tap passes, quick second tap on the same control is prevented ({te})')

        # ---- frequency / directions ----
        uid = (await page.evaluate("__app.currentPos()"))['uid']
        stats = await page.evaluate("""(() => { const C = __app.content; const out = {n: 0, build: 0, es: 0, en: 0, nosent: 0};
            const ids = C.units.flatMap(u => u.words.map(w => w.id)); const withS = new Set(C.units.flatMap(u => u.sentences.filter(s => s.es.split(' ').length <= 10).map(s => s.k)));
            for (let r = 0; r < 30; r++) ids.forEach(id => { const ex = __app.makeExercise({id: 'w:' + id});
              if (!withS.has(id)) { if (ex.kind === 'build') out.nosent++; return; }
              out.n++; if (ex.kind === 'build') { out.build++; ex.bigEs ? out.en++ : out.es++; } });
            return out; })()""")
        share = stats['build'] / stats['n']
        check(0.18 <= share <= 0.32, f"review/practice picks: {share:.0%} of items with a sentence are tile drills ({stats})")
        check(stats['es'] > 0 and stats['en'] > 0 and stats['nosent'] == 0, 'both directions (ES tiles and EN tiles), none without a sentence')
        ex_en = await page.evaluate("(() => { for (let i = 0; i < 400; i++) { const ex = __app.makeExercise({id: 'w:' + __app.content.units[0].words[i % __app.content.units[0].words.length].id, ex: 'buildEn'}); if (ex.kind === 'build') return ex; } })()")
        check(ex_en and ex_en['opts']['lang'] == 'en' and len(ex_en['tiles']) > len(re.sub(PUNCT, '', ex_en['answers'][0]).split()), 'EN-tile drill has English target and distractor tiles')
        iq = await page.evaluate(f"""(() => {{ let n = 0, t = 0; for (let r = 0; r < 40; r++) __app.introQueue('{uid}').forEach(e => {{ if (e.practice) {{ n++; if (e.ex === 'build' || e.ex === 'buildEn') t++; }} }}); return [n, t]; }})()""")
        check(iq[1] > 0 and iq[1] / max(iq[0], 1) <= 0.35, f'intro practice items include tile drills ({iq[1]}/{iq[0]})')
        tq = await page.evaluate(f"__app.testQueue('{uid}')")
        nb = sum(1 for e in tq if e.get('ex') == 'build'); nv = sum(1 for e in tq if not e.get('theme') and e.get('ex') != 'build')
        check(nv == 12 and nb == 3, f'test stays 12 vocab + 3 builds ({nv}+{nb})')
        st = await page.evaluate(f"__app.pickStoryTile('{uid}')")
        check(st is not None, f'story gets a rebuild-the-line tile drill ({st})')

        # ---- bank stays put (practice, forced long build) ----
        await page.evaluate(f"__app.openStone('{uid}', 2)"); await page.wait_for_selector('main.card')
        sent = await page.evaluate("""(() => { const e = __app.entry; const C = __app.content; const all = C.units.flatMap(u => u.sentences);
            return all.filter(s => s.es.split(' ').length >= 8 && s.es.split(' ').length <= 10).sort((a, b) => b.es.length - a.es.length)[0]; })()""")
        # put the card on that sentence's word so the build uses it
        await page.evaluate(f"__app.run.queue[__app.run.i] = {{id: 'w:{sent['k']}'}}")
        await page.evaluate(f"__app.forceEx('build', {json.dumps(sent)})"); await page.wait_for_selector('#tiles .tile')
        # y relative to the card's top (a tap may scroll the page; what matters is the bank's place in the layout)
        bank_y = lambda: page.evaluate("Math.round((document.getElementById('tiles').getBoundingClientRect().y - document.querySelector('main.card').getBoundingClientRect().y) * 10) / 10")
        y0 = await bank_y(); ys = []; rows = 0
        ex = await page.evaluate("({tiles: __app.ex.tiles})")
        for k in range(len(ex['tiles'])):
            await page.click(f'#tiles .tile[data-k="{k}"]'); ys.append(await bank_y())
            rows = max(rows, await page.evaluate("new Set([...document.querySelectorAll('#line .tile')].map(t => t.offsetTop)).size"))
        if rows < 3: print(f'note: answer reached {rows} row(s) with all {len(ex["tiles"])} tiles')
        for k in range(len(ex['tiles'])):
            await page.click('#line .tile >> nth=0'); ys.append(await bank_y())
        check(rows >= 2, f'answer area wrapped to {rows} rows')
        check(all(y == y0 for y in ys), f'word bank y stays {y0} while adding/removing {len(ex["tiles"])} tiles (seen {sorted(set(ys))})')
        lh = await page.evaluate("Math.round(document.getElementById('line').getBoundingClientRect().height)")
        check(lh >= 160, f'answer area reserves ~3 rows ({lh}px)')
        # screenshot a non-test drill with a few tiles placed
        await page.evaluate(f"__app.forceEx('build', {json.dumps(sent)})"); await page.wait_for_selector('#tiles .tile')
        await place_tiles(page, 4); await page.wait_for_timeout(300)
        await page.screenshot(path=shot('v7-tiles-lesson'))
        check(await page.evaluate("__app.run.mode") == 'practice', 'screenshot is a practice (non-test) tile drill')
        # correct build is graded right
        await page.evaluate(f"__app.forceEx('build', {json.dumps(sent)})"); await page.wait_for_selector('#tiles .tile')
        await place_tiles(page); await page.click('#check')
        check(await page.query_selector('.feedback.good') is not None, 'correct tile order is graded correct')

        # ---- debounce (forced on; automation skips it otherwise) ----
        await page.evaluate("window.__forceTapGuard = true"); await page.wait_for_timeout(600)
        i0 = await page.evaluate("__app.run.i")
        await page.dblclick('#next'); await page.wait_for_timeout(100)
        check(await page.evaluate("__app.run.i") == i0 + 1, 'double tap on Continue advances exactly one card')
        await page.wait_for_timeout(600)
        await page.evaluate(f"__app.run.queue[__app.run.i] = {{id: 'w:{sent['k']}'}}; __app.forceEx('en2es')"); i1 = await page.evaluate("__app.run.i")
        await page.fill('#ans', 'zzzz'); await page.dblclick('#check'); await page.wait_for_timeout(100)
        check(await page.evaluate("__app.run.i") == i1 and await page.evaluate("__app.run.answered"), 'double tap on Check grades but does not skip the feedback')
        await page.wait_for_timeout(600); await page.click('#next')
        check(await page.evaluate("__app.run.i") == i1 + 1, 'a normal later tap on Continue still works')
        await page.evaluate("window.__forceTapGuard = false")

        # ---- story rebuild-the-line drill ----
        await page.click('#quit'); await page.wait_for_selector('.stone')
        await page.evaluate(f"__app.openStone('{uid}', 1)"); await page.wait_for_selector('.story')
        seen = False
        for _ in range(200):
            if await page.query_selector('#stile'):
                seen = True
                check(await page.query_selector('#stile #tiles .tile') is not None and await page.query_selector('#stile #line') is not None, 'story shows a word bank for a line')
                tgt = await page.evaluate("__app.story.tile.ex.answers[0]")
                line_es = await page.evaluate("__app.story.u.story.lines[__app.story.tile.after].es")
                check(tgt == line_es, f'story drill rebuilds the line just read ({tgt})')
                check((await page.evaluate("getComputedStyle(document.querySelector('.sline.veil .ses span')).filter")).startswith('blur'), 'the line being rebuilt is veiled while the drill is open')
                vis = await page.evaluate("(() => { const r = document.querySelector('#stile #tiles').getBoundingClientRect(), f = document.querySelector('footer').getBoundingClientRect(); return r.bottom <= f.top + 1 && r.top >= 0; })()")
                await page.wait_for_timeout(700)
                vis = vis or await page.evaluate("(() => { const r = document.querySelector('#stile #tiles').getBoundingClientRect(), f = document.querySelector('footer').getBoundingClientRect(); return r.bottom <= f.top + 1 && r.top >= 0; })()")
                check(vis, 'story word bank is scrolled into view above the footer')
                await page.screenshot(path=shot('v7-tiles-story'))
                await place_tiles_story(page); await page.click('#check')
                check(await page.query_selector('#stile .feedback.good') is not None, 'story tile drill graded correct')
                await page.click('#next'); continue
            q = await page.query_selector('.squestion .opt')
            if q: await q.click(); await page.click('#next'); continue
            nxt = await page.query_selector('#next')
            if not nxt: break
            await nxt.click()
            if not await page.evaluate("!!__app.story"): break
        check(seen, 'story tile drill appeared')
        check(await page.evaluate("!__app.story"), 'story finishes after the drill')
        check(not errors, f'no page errors {errors}')
        await b.close()
    print('ALL PASS' if ok_all else 'SOME FAILED'); sys.exit(0 if ok_all else 1)

async def place_tiles_story(page):
    ex = await page.evaluate("({tiles: __app.story.tile.ex.tiles, answers: __app.story.tile.ex.answers})")
    want = re.sub(PUNCT, '', ex['answers'][0]).split(); used = []
    for wt in want:
        for k, t in enumerate(ex['tiles']):
            if k not in used and t == wt: used.append(k); await page.click(f'#tiles .tile[data-k="{k}"]'); break

asyncio.run(main())
