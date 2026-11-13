"""v6 Batch 1: 15-unit B1 path in syllabus order, v5 -> v6 migration keeps progress, every unit's test is 12 + 3,
every new story plays through with its questions answerable, all exercises build with speakable text, start-parked words."""
import asyncio, json, sys, os, re
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8787/'
ENGINE = sys.argv[2] if len(sys.argv) > 2 else 'chromium'
OUT = '/workspace/spanish-app/screens'; os.makedirs(OUT, exist_ok=True)
KEY = 'spanish-app-state-v1'
V5 = json.load(open('/workspace/spanish-app/tests/fixtures/v5-export.json'))
ORDER = ['u1', 'u2', 'ta1', 'u3', 'u4', 'ta2', 'u5', 'u6', 'ta3', 'u7', 'u8', 'ta4', 'u9', 'u10', 'ta5']
NEW = ['ta1', 'ta2', 'ta3', 'ta4', 'u10', 'ta5']
ok_all = True
def check(cond, msg):
    global ok_all
    print(('PASS ' if cond else 'FAIL ') + msg); ok_all = ok_all and bool(cond)

async def new_ctx(b, p):
    dev = dict(p.devices['iPhone 15']) if ENGINE == 'webkit' else dict(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True)
    c = await b.new_context(**dev, timezone_id='America/Mexico_City'); await c.add_init_script("delete window.SpeechRecognition; delete window.webkitSpeechRecognition"); return c  # v8: no recogniser here; speaking drills are covered by v8_e2e

async def solve_story_tile(page):
    """v7: a story may pause on a "rebuild the line" word bank; place the tiles in order and check."""
    if not (await page.query_selector('#stile') and await page.query_selector('#check')): return False
    ex = await page.evaluate("({tiles: __app.story.tile.ex.tiles, answers: __app.story.tile.ex.answers})")
    used = []
    for wt in re.sub(r'[¿?¡!.,;:“”"]', '', ex['answers'][0]).split():
        for k, t in enumerate(ex['tiles']):
            if k not in used and t == wt: used.append(k); await page.click(f'#tiles .tile[data-k="{k}"]'); break
    await page.click('#check'); return True

async def play_story(page, uid, shot=None):
    await page.evaluate(f"__app.openStone('{uid}', 1)"); await page.wait_for_selector('.story')
    asked = 0; steps = 0
    while await page.evaluate("!!__app.story") and steps < 80:
        steps += 1
        if await page.query_selector('.squestion .opt') and not await page.query_selector('.squestion .opt.right'):
            correct = await page.evaluate("(() => { const st = __app.story; const q = st.u.story.qs.find(q => q.after === st.shown - 1 && st.answered[st.u.story.qs.indexOf(q)] == null); return q.o[0]; })()")
            if shot and asked == 1:
                await page.wait_for_timeout(400); await page.screenshot(path=shot)
            await page.click(f'.squestion .opt[data-o="{correct}"]'); asked += 1
            check(await page.query_selector('.squestion .opt.right') is not None, f'{uid}: question {asked} marked right')
        await solve_story_tile(page)
        await page.click('#next')
    return asked

async def main():
    async with async_playwright() as p:
        b = await (p.webkit if ENGINE == 'webkit' else p.chromium).launch()
        errors = []
        # ---------- 1. migration from real v5 progress (old path order: u3 was unit 3)
        raw = {k: v for k, v in V5.items() if k not in ('exportedAt', 'app', 'appVersion')}
        for mode in ('localStorage', 'import'):
            ctx = await new_ctx(b, p); pg = await ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
            if mode == 'localStorage':
                await ctx.add_init_script(f"if (!localStorage.getItem('{KEY}')) localStorage.setItem('{KEY}', {json.dumps(json.dumps(raw))})")
                await pg.goto(URL); await pg.wait_for_selector('.stone')
            else:
                await pg.goto(URL); await pg.wait_for_selector('#go'); await pg.evaluate("s => __app.importBackup(s)", json.dumps(V5)); await pg.reload(); await pg.wait_for_selector('.stone')
            check(await pg.evaluate("__app.version") == 'v8', f'[{mode}] app version is v8')
            s = await pg.evaluate("__app.state"); stored = await pg.evaluate(f"JSON.parse(localStorage.getItem('{KEY}'))")
            keep = ['items', 'pstats', 'recent', 'parked', 'daily', 'streak', 'placementDone', 'placementSummary', 'sessions', 'created']
            check(all(s.get(k) == raw.get(k) for k in keep), f'[{mode}] SRS items ({len(raw["items"])}), stats, parked, daily history, streak unchanged')
            check(all(s['path']['done'].get(u) == v for u, v in raw['path']['done'].items()) and s['path']['tests'] == raw['path']['tests'], f'[{mode}] every unit’s stones and test scores unchanged')
            check(s['schema'] == 5 and stored and stored['items'] == raw['items'], f'[{mode}] schema 5, saved under the same key')
            cur = await pg.evaluate("__app.currentPos()")
            check(cur == {'uid': 'ta1', 'stone': 0}, f'[{mode}] next stop is the new unit 3 (Primer mensaje por WhatsApp): {cur}')
            u3 = await pg.evaluate("[...document.querySelectorAll('#unit-u3 .stone')].map(b => b.classList.contains('done'))")
            check(u3 == [True] * 4, f'[{mode}] El trabajo (now unit 4) still shows all 4 stones done')
            if mode == 'localStorage':
                ids = await pg.evaluate("[...document.querySelectorAll('.unit')].map(e => e.id.slice(5))")
                check(ids == ORDER, f'path shows 15 units in syllabus order')
                labels = await pg.evaluate("[...document.querySelectorAll('.unit')].map(e => !!e.querySelector('.badge.ta'))")
                check([i for i, x in enumerate(labels) if x] == [2, 5, 8, 11, 14], 'Tres Aguas badge on units 3, 6, 9, 12, 15')
                await pg.evaluate("window.scrollTo(0,0); document.getAnimations().forEach(a => { try { a.finish() } catch (e) {} })"); await pg.wait_for_timeout(300)
                await pg.screenshot(path=f'{OUT}/v6-path.png' if ENGINE == 'webkit' else f'{OUT}/v6-{ENGINE}-path.png', full_page=True)
                # ---------- 2. every unit's test = 12 vocab + 3 sentence tiles; practice builds
                for uid in ORDER:
                    q = await pg.evaluate(f"__app.testQueue('{uid}').map(e => e.ex)")
                    check(len(q) == 15 and q.count('build') == 3, f'{uid}: test has {len(q) - q.count("build")} vocab + {q.count("build")} sentence questions')
                # ---------- 3. all exercises for new units build with speakable text
                bad = await pg.evaluate("""(() => { const C = __app.content, bad = [], NEW = %s;
                  for (const u of C.units.filter(u => NEW.includes(u.id))) {
                    for (const w of u.words) for (const ex of ['es2en','en2es','cloze','listen','listenS','build']) {
                      const e = __app.makeExercise({id: 'w:' + w.id, ex});
                      const say = e.listen || e.speakAfter || e.speakNow || (e.reveal && e.reveal.es);
                      if (!e.answers || !e.answers[0] || !String(e.answers[0]).trim() || !say || /___/.test(say) || (e.clozeEs && !e.clozeEs.includes('_____'))) bad.push(w.id + ':' + ex);
                    }
                    for (const p of u.focus) for (let i = 0; i < C.patterns[p].items.length; i++) { const e = __app.makeExercise({id: 'p:' + p, itemIdx: i}); if (!e.speakAfter || e.speakAfter.includes('___') || !e.options.includes(e.answer)) bad.push(p + ':' + i); }
                  } return bad; })()""" % json.dumps(NEW))
                check(not bad, f'every new word (6 exercise types) and grammar item builds with answer + audio text {bad[:5]}')
                # ---------- 4. play the 6 new stories end to end
                for uid in NEW:
                    shot = (f'{OUT}/v6-ta-story.png' if ENGINE == 'webkit' else f'{OUT}/v6-{ENGINE}-ta-story.png') if uid == 'ta4' else None
                    n = await play_story(pg, uid, shot)
                    check(n == 4 and await pg.evaluate(f"__app.state.path.done['{uid}'][1]") is True, f'{uid}: story finished with 4 questions answered')
                # ---------- 5. play the full ta1 unit: intro (new words flagged), practice, test
                await pg.click('.stone.current'); await pg.wait_for_selector('.badge.new')
                new_words = await pg.evaluate("[...document.querySelectorAll('.list .badge.new')].length")
                note = await pg.inner_text('main')
                check(new_words == 5 and 'practice examples' in note, f'ta1 intro flags {new_words} new words and shows the illustrative-figures note')
                await pg.click('#go')
                while await pg.evaluate("!!__app.run"):
                    e = await pg.evaluate("__app.entry")
                    if e.get('theme') or e.get('intro'): await pg.click('#go'); continue
                    ex = await pg.evaluate("({kind: __app.ex.kind, answer: __app.ex.answer, answers: __app.ex.answers, tiles: __app.ex.tiles})")
                    if ex['kind'] == 'mc':
                        opts = await pg.query_selector_all('.opt'); texts = [await o.inner_text() for o in opts]; await opts[texts.index(ex['answer'])].click()
                    elif ex['kind'] == 'build':
                        want = re.sub(r'[¿?¡!.,;:]', '', ex['answers'][0]).split(); used = set()
                        for wt in want:
                            for k, t in enumerate(ex['tiles']):
                                if k not in used and t == wt: used.add(k); await pg.click(f'#tiles .tile[data-k="{k}"]'); break
                        await pg.click('#check')
                    else: await pg.fill('#ans', ex['answers'][0]); await pg.click('#check')
                    await pg.click('#next')
                check(await pg.evaluate("__app.state.path.done.ta1[0]") is True and await pg.evaluate("!!__app.state.items['p:clitic_usted']"), 'ta1 intro completed; clitic_usted pattern now scheduled')
            await ctx.close()
        # ---------- 6. start-parked syllabus words (simulated: a future unit adds "la poesía")
        ctx = await new_ctx(b, p); pg = await ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        async def patch(route):
            r = await route.fetch(); C = await r.json()
            C['units'][0]['words'].append({'id': 'poesia', 'es': 'la poesía', 'en': 'poetry', 'accept': ['poetry']})
            await route.fulfill(response=r, json=C)
        await pg.route('**/content.json', patch)
        await ctx.add_init_script(f"if (!localStorage.getItem('{KEY}')) localStorage.setItem('{KEY}', {json.dumps(json.dumps(raw))})")
        await pg.goto(URL); await pg.wait_for_selector('.stone')
        check(await pg.evaluate("!!(__app.state.parked.poesia && __app.state.parked.poesia.auto)"), 'syllabus start-parked word (la poesía) is parked automatically')
        await pg.evaluate("(() => { delete __app.state.parked.poesia; localStorage.setItem('spanish-app-state-v1', JSON.stringify(__app.state)); })()")
        await pg.reload(); await pg.wait_for_selector('.stone')
        check(await pg.evaluate("!__app.state.parked.poesia"), 'after Unpark it is not re-parked on reload')
        await ctx.close()
        check(not errors, f'no page errors ({errors[:3]})')
        await b.close()
    print('\nALL PASS' if ok_all else '\nSOME CHECKS FAILED')
asyncio.run(main())
