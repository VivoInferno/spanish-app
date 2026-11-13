"""v7 "Can't listen now": button only on audio exercises, tap = no penalty + non-audio replacement, no audio exercises for
10 minutes anywhere (test, practice, intro, review picks), auto-play muted, persists through reload, expires on a fake clock,
early re-enable from the 🔇 indicator, test stays 12 + 3."""
import asyncio, json, sys, os, re
from datetime import datetime, timezone, timedelta
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8787/'
ENGINE = sys.argv[2] if len(sys.argv) > 2 else 'chromium'
OUT = '/workspace/spanish-app/screens'; os.makedirs(OUT, exist_ok=True)
KEY = 'spanish-app-state-v1'
V5 = json.load(open('/workspace/spanish-app/tests/fixtures/v5-export.json'))
T0 = datetime(2026, 11, 12, 10, tzinfo=timezone(timedelta(hours=-6)))
ok_all = True
def check(cond, msg):
    global ok_all
    print(('PASS ' if cond else 'FAIL ') + msg); ok_all = ok_all and bool(cond)
def shot(name): return f'{OUT}/{name}.png' if ENGINE == 'webkit' else f'{OUT}/{name}-{ENGINE}.png'

async def answer(page):
    e = await page.evaluate("__app.run && __app.entry")
    if not e: return False
    if e.get('theme') or e.get('intro'): await page.click('#go'); return True
    ex = await page.evaluate("({kind: __app.ex.kind, answer: __app.ex.answer, answers: __app.ex.answers, tiles: __app.ex.tiles})")
    if ex['kind'] == 'mc':
        opts = await page.query_selector_all('.opt'); texts = [await o.inner_text() for o in opts]; await opts[texts.index(ex['answer'])].click()
    elif ex['kind'] == 'build':
        want = re.sub(r'[¿?¡!.,;:]', '', ex['answers'][0]).split(); used = set()
        for wt in want:
            for k, t in enumerate(ex['tiles']):
                if k not in used and t == wt: used.add(k); await page.click(f'#tiles .tile[data-k="{k}"]'); break
        await page.click('#check')
    else: await page.fill('#ans', ex['answers'][0]); await page.click('#check')
    await page.click('#next'); return True

async def run_all(page, label):
    """Answer a whole run; returns (cards, audio cards seen, cards with the button, non-audio cards with the button)."""
    cards = audio = btn = wrongbtn = 0
    while await page.evaluate("!!__app.run"):
        e = await page.evaluate("__app.entry")
        if not (e.get('theme') or e.get('intro')):
            cards += 1
            a = await page.evaluate("!!__app.ex.audio"); b = await page.query_selector('#cantListen') is not None
            audio += a; btn += b; wrongbtn += (b and not a)
        await answer(page)
    return cards, audio, btn, wrongbtn

async def main():
    async with async_playwright() as p:
        b = await (p.webkit if ENGINE == 'webkit' else p.chromium).launch()
        dev = dict(p.devices['iPhone 15']) if ENGINE == 'webkit' else dict(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True)
        ctx = await b.new_context(**dev, timezone_id='America/Mexico_City', service_workers='block')
        await ctx.add_init_script("delete window.SpeechRecognition; delete window.webkitSpeechRecognition")  # v8: no recogniser; speaking drills are covered by v8_e2e
        raw = {k: v for k, v in V5.items() if k not in ('exportedAt', 'app', 'appVersion')}
        await ctx.add_init_script(f"if (!localStorage.getItem('{KEY}')) localStorage.setItem('{KEY}', {json.dumps(json.dumps(raw))})")
        # count speech calls (auto-play vs taps)
        await ctx.add_init_script("window.__spoken = []; if (window.speechSynthesis) { const o = speechSynthesis.speak.bind(speechSynthesis); speechSynthesis.speak = u => { window.__spoken.push(u.text); try { o(u) } catch (e) {} }; }")
        page = await ctx.new_page(); errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        await page.clock.install(time=T0); await page.clock.pause_at(T0)
        await page.goto(URL); await page.wait_for_selector('.stone')
        check(await page.evaluate("__app.version") == 'v8.1', 'app version is v8.1')
        s = await page.evaluate("__app.state")
        check(s['listenPauseUntil'] == 0 and s['items'] == raw['items'] and s['streak'] == raw['streak'] and s['daily'] == raw['daily'] and s['schema'] == 5 and s['speakPauseUntil'] == 0, 'v6 data loads losslessly, listening on by default')
        flags = await page.evaluate("['es2en','en2es','cloze','listen','listenS','build'].map(t => [t, !!__app.makeExercise({id: 'w:fuga', ex: t}).audio])")
        check([t for t, a in flags if a] == ['listen', 'listenS'], f'only listen/listenS exercises are marked audio-only: {flags}')
        # ---- unit test of unit 1: walk to the first audio card
        await page.evaluate("__app.openStone('u1', 3)")
        q = await page.evaluate("__app.run.queue.map(e => e.ex)")
        check(len(q) == 15 and q.count('build') == 3 and q.count('listen') >= 1, f'test queue 12 + 3 with {q.count("listen")} listening items before the pause')
        seen_nonaudio_btn = 0
        while not await page.evaluate("!!__app.ex.audio"):
            seen_nonaudio_btn += await page.query_selector('#cantListen') is not None
            await answer(page)
        check(seen_nonaudio_btn == 0, 'no button on the non-audio cards before it')
        check(await page.is_visible('#cantListen'), 'button shown on the audio card')
        await page.evaluate("document.getAnimations().forEach(a => { try { a.finish() } catch (e) {} })")
        await page.screenshot(path=shot('v7-cant-listen'))
        before = await page.evaluate("(() => { const e = __app.entry; return {id: e.id, i: __app.run.i, total: __app.run.total, score: __app.run.score, item: JSON.stringify(__app.state.items[e.id] || null), first: !!__app.run.firstDone[e.id], misses: __app.run.misses.length, len: __app.run.queue.length}; })()")
        await page.click('#cantListen'); await page.clock.run_for(400)
        after = await page.evaluate("(() => { const e = __app.entry; return {id: e.id, i: __app.run.i, total: __app.run.total, score: __app.run.score, item: JSON.stringify(__app.state.items[e.id] || null), first: !!__app.run.firstDone[e.id], misses: __app.run.misses.length, len: __app.run.queue.length, audio: !!__app.ex.audio, label: __app.ex.label, answered: __app.run.answered}; })()")
        check(after['id'] == before['id'] and after['i'] == before['i'] and not after['audio'], f'same item rebuilt as a non-audio card: “{after["label"]}”')
        check(after['item'] == before['item'] and after['total'] == before['total'] and after['misses'] == before['misses'] and after['first'] == before['first'] and not after['answered'], f'no grade, no miss, no SRS change from tapping it {before} {after}')
        check(after['len'] == before['len'], 'queue length unchanged (test stays 15)')
        until = await page.evaluate("__app.state.listenPauseUntil"); now = await page.evaluate("Date.now()")
        check(abs(until - now - 600000) < 1000, 'pause stored for 10 minutes')
        ind = (await page.inner_text('#lpInd')).strip()
        check(ind == '🔇 10 min', f'indicator in the lesson bar: "{ind}"')
        await page.clock.run_for(2000); await page.evaluate("document.getAnimations().forEach(a => { try { a.finish() } catch (e) {} })")
        await page.screenshot(path=shot('v7-listen-paused'))
        cards, audio, btn, wb = await run_all(page, 'test')
        check(audio == 0 and btn == 0, f'rest of the test: {cards} cards, {audio} audio')
        res = await page.inner_text('main'); check('15 / 15' in res, f'test finished with full count: {res.splitlines()[1] if len(res.splitlines()) > 1 else res}')
        await page.click('#home'); await page.wait_for_selector('.stone')
        # ---- practice, an intro stone and random (review-style) picks: no audio while paused
        await page.evaluate("__app.openStone('u2', 2)"); cards, audio, btn, wb = await run_all(page, 'practice')
        check(cards >= 10 and audio == 0 and btn == 0, f'practice stone: {cards} cards, {audio} audio')
        await page.wait_for_selector('.stone')
        await page.evaluate("window.__spoken = []")
        await page.evaluate("__app.openStone('ta1', 0)"); cards, audio, btn, wb = await run_all(page, 'intro')
        check(cards >= 10 and audio == 0, f'intro stone of unit 3: {cards} cards, {audio} audio')
        check(await page.evaluate("window.__spoken.length") == 0, 'auto-play of new words is muted while paused')
        rnd = await page.evaluate("(() => { const ids = Object.keys(__app.content.units.flatMap(u => u.words).reduce((a, w) => (a['w:' + w.id] = 1, a), {})); let n = 0; for (let k = 0; k < 300; k++) n += !!__app.makeExercise({id: ids[k % ids.length]}).audio; return n; })()")
        check(rnd == 0, f'300 review-style random picks: {rnd} audio')
        tq = await page.evaluate("(() => { const q = __app.testQueue('ta5'); return [q.length, q.filter(e => e.ex === 'build').length, q.filter(e => __app.makeExercise(e).audio).length]; })()")
        check(tq[0] == 15 and tq[1] == 3 and tq[2] == 0, f'a test built while paused is still 12 + 3 with no audio ({tq})')
        # story: auto-play muted, tapping a line's speaker still works
        await page.wait_for_selector('.stone'); await page.evaluate("window.__spoken = []; __app.openStone('ta2', 1)"); await page.wait_for_selector('.story')
        auto = await page.evaluate("window.__spoken.length"); await page.click('.sline .speak'); tapped = await page.evaluate("window.__spoken.length")
        check(auto == 0 and tapped == 1, f'story: no auto-play while paused, tapping 🔊 still plays ({auto} → {tapped})')
        check(await page.query_selector('#lpInd') is not None, 'indicator also on the story screen')
        await page.click('#quit'); await page.wait_for_selector('.stone')
        # ---- persists through a reload / app switch
        await page.clock.run_for(3 * 60000)
        await page.reload(); await page.wait_for_selector('.stone')
        ind = (await page.inner_text('#lpInd')).strip()
        check(await page.evaluate("__app.listenPaused()") and ind == '🔇 7 min', f'after reload 3 min later: still paused, home shows "{ind}"')
        # ---- expires on its own
        await page.clock.run_for(7 * 60000 + 2000)
        check(not await page.evaluate("__app.listenPaused()") and await page.query_selector('#lpInd') is None, 'after 10 minutes: listening back on, indicator gone')
        rnd = await page.evaluate("(() => { let n = 0; for (let k = 0; k < 200; k++) n += !!__app.makeExercise({id: 'w:fuga'}).audio; return n; })()")
        check(rnd > 0, f'audio exercises come back after expiry ({rnd}/200 random picks)')
        # ---- early re-enable from the indicator
        await page.evaluate("__app.openStone('u1', 3)")
        while not await page.evaluate("!!__app.ex.audio"): await answer(page)
        await page.click('#cantListen'); await page.clock.run_for(400)
        check(await page.evaluate("__app.listenPaused()"), 'paused again')
        await page.click('#lpInd'); await page.clock.run_for(100)
        check(not await page.evaluate("__app.listenPaused()") and await page.query_selector('#lpInd') is None and await page.evaluate("__app.state.listenPauseUntil") == 0, 'tapping 🔇 turns listening back on early')
        await page.click('#quit')
        exp = await page.evaluate("__app.state")
        check('listenPauseUntil' in exp, 'pause field is part of backups/exports')
        check(not errors, f'no page errors ({errors[:3]})')
        await b.close()
    print('\nALL PASS' if ok_all else '\nSOME CHECKS FAILED')
asyncio.run(main())
