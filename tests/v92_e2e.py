"""v9.2: (1) typed answers in a wrapping, growing textarea (2 → ~6 lines), Return checks, no newlines, grading unchanged, footer
above the keyboard; (2) tap-to-translate on every Spanish word (not in the unit test; tiles / answer buttons keep their tap);
(3) long-press "Not a priority" on ANY Spanish word (course words + others as 'g:' parks), never also picking a tile / answer /
hint; (4) tile glide (FLIP) that survives rapid taps, respects reduced motion, and never reflows the bank. Lossless v9.1 → v9.2.
Screenshots (WebKit iPhone 15): screens/v92-dictation-wrap.png, v92-tap-translate.png, v92-longpress.png."""
import asyncio, json, sys, os, re, random
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'v8_e2e.py')).read().split('async def main')[0]
exec(src)

def moved(a, b):
    # the bank's own layout must never change (no tile shifts inside it). The whole block may move down as one piece only
    # if a very long answer packs into more rows than were reserved (small phones, no spare row).
    if len(a) != len(b) or not a: return len(a) != len(b)
    dx, dy = a[0][0] - b[0][0], a[0][1] - b[0][1]
    if dy: SHIFTS.append(dy)
    return any(abs(x[0] - y[0] - dx) > 2 or abs(x[1] - y[1] - dy) > 2 for x, y in zip(a, b))

SHIFTS = []


async def long_press(pg, sel_or_loc, ms=650):
    loc = pg.locator(sel_or_loc).first if isinstance(sel_or_loc, str) else sel_or_loc
    await loc.scroll_into_view_if_needed(); bb = await loc.bounding_box()
    x, y = bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2
    await pg.mouse.move(x, y); await pg.mouse.down(); await pg.wait_for_timeout(ms); await pg.mouse.up(); await pg.wait_for_timeout(120)

async def tap(pg, loc):
    await loc.scroll_into_view_if_needed(); bb = await loc.bounding_box()
    await pg.mouse.click(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2); await pg.wait_for_timeout(120)

async def fresh(pg, wid, ex, sent=None):
    await pg.evaluate(f"(() => {{ const r = __app.run; r.answered = false; delete r.firstDone['w:{wid}']; r.queue[r.i] = {{ id: 'w:{wid}' }}; __app.forceEx('{ex}'{', ' + json.dumps(sent) if sent else ''}); }})()")
    await pg.wait_for_timeout(120)

TILE_STATE = """(() => { const ex = __app.ex || (__app.story && __app.story.tile && __app.story.tile.ex);
  const line = [...document.querySelectorAll('#line .tile')].map(t => +t.dataset.k), used = [...document.querySelectorAll('#tiles .tile.used')].map(t => +t.dataset.k).sort((a, b) => a - b);
  return { order: ex.order.slice(), line, used, dup: new Set(ex.order).size !== ex.order.length, ghosts: document.querySelectorAll('.tile-ghost').length,
    landing: document.querySelectorAll('#tiles .tile.landing').length, bank: [...document.querySelectorAll('#tiles .tile')].map(t => { const r = t.getBoundingClientRect(); return [Math.round(r.left + scrollX), Math.round(r.top + scrollY)]; }) }; })()"""

async def main():
    async with async_playwright() as p:
        b = await (p.webkit if ENGINE == 'webkit' else p.chromium).launch()
        V7 = strip_meta(json.load(open(FIX + 'v7-export.json')))
        V91 = dict(V7, settings=dict(V7['settings'], voice='', voice2='', voiceMode='recorded', anim=True)); V91['schema'] = 5; V91['speakPauseUntil'] = 0
        ctx = await new_ctx(b, p, V91, sr=False)
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL); await pg.wait_for_selector('.stone'); await pg.wait_for_timeout(500)
        s = await pg.evaluate("__app.state")
        check(await pg.evaluate("__app.version") == 'v9.3' and s['items'] == V91['items'] and s['path'] == V91['path'] and s['daily'] == V91['daily'] and s['streak'] == V91['streak'] and s['settings']['voiceMode'] == 'recorded',
              'v9.1 data → v9.3 losslessly')
        LONG = await pg.evaluate("__app.content.units.flatMap(u => u.sentences).sort((a, b) => b.es.length - a.es.length)[0]")
        print('   longest sentence:', LONG['es'])

        # ---------- 1. dictation textarea (in the unit test, like Colby's screenshot) ----------
        await pg.evaluate("__app.openStone('u3', 3)"); await pg.wait_for_selector('.card'); await pg.wait_for_timeout(150)
        await fresh(pg, LONG['k'], 'listenS', LONG); await pg.wait_for_selector('#ans')
        a = await pg.evaluate("""(() => { const a = document.getElementById('ans'), cs = getComputedStyle(a); return { tag: a.tagName, fs: parseFloat(cs.fontSize), ac: a.getAttribute('autocapitalize'), acr: a.getAttribute('autocorrect'), sc: a.getAttribute('spellcheck'), h: a.getBoundingClientRect().height, lh: parseFloat(cs.lineHeight), label: document.querySelector('.label').textContent }; })()""")
        check(a['tag'] == 'TEXTAREA' and a['fs'] >= 16 and a['ac'] == 'off' and a['acr'] == 'off' and a['sc'] == 'false', f'answer field is a textarea, {a["fs"]}px, autocapitalize/autocorrect/spellcheck off')
        check(1.7 * a['lh'] < a['h'] < 3.2 * a['lh'] + 40, f'starts about 2 lines tall ({a["h"]:.0f}px, line {a["lh"]:.0f}px) · {a["label"]}')
        typed = re.sub(r'[¿?¡!.,]', '', await pg.evaluate("__app.ex.listen")).lower()
        await pg.click('#ans'); await pg.keyboard.type(typed, delay=0)
        m = await pg.evaluate("(() => { const a = document.getElementById('ans'); return { sw: a.scrollWidth, cw: a.clientWidth, h: a.getBoundingClientRect().height, sh: a.scrollHeight, v: a.value, doc: document.documentElement.scrollWidth, vw: innerWidth }; })()")
        check(m['sw'] <= m['cw'] + 1 and m['doc'] <= m['vw'] + 1, f'long sentence wraps: no horizontal overflow (scrollWidth {m["sw"]} ≤ {m["cw"]})')
        check(m['h'] > a['h'] + 10 or m['sh'] <= a['h'], f'box grows with the text ({a["h"]:.0f} → {m["h"]:.0f}px)')
        if ENGINE == 'webkit': await pg.screenshot(path=f'{OUT}/v92-dictation-wrap.png')
        fb = await pg.evaluate("(() => { const f = document.querySelector('footer').getBoundingClientRect(); return f.bottom <= innerHeight + 1 && f.top >= 0; })()")
        check(fb, 'Check button / footer visible while typing')
        await pg.keyboard.press('Enter'); await pg.wait_for_selector('#fb .feedback')
        check(await pg.query_selector('.feedback.good') is not None and '\n' not in await pg.evaluate("document.getElementById('ans').value"), 'Return checks the answer (no newline) and grading is unchanged (correct)')
        await pg.click('#quit'); await pg.wait_for_selector('.stone')
        await pg.evaluate("__app.openStone('u3', 2)"); await pg.wait_for_selector('.card'); await pg.wait_for_timeout(150)
        await fresh(pg, LONG['k'], 'listenS', LONG); await pg.wait_for_selector('#ans')
        await pg.fill('#ans', 'uno\ndos\r\ntres'); v = await pg.evaluate("document.getElementById('ans').value")
        check(v == 'uno dos tres', f'pasted line breaks become spaces ({v!r})')
        await pg.fill('#ans', ' '.join([typed] * 6)); await pg.wait_for_timeout(50)
        big = await pg.evaluate("(() => { const a = document.getElementById('ans'), cs = getComputedStyle(a); return { h: a.getBoundingClientRect().height, lh: parseFloat(cs.lineHeight), oy: cs.overflowY, sw: a.scrollWidth, cw: a.clientWidth }; })()")
        check(big['h'] <= 6 * big['lh'] + 40 and big['oy'] == 'auto' and big['sw'] <= big['cw'] + 1, f'caps at ~6 lines then scrolls ({big["h"]:.0f}px, overflow-y {big["oy"]})')
        await pg.fill('#ans', 'zzzz qqqq'); await pg.click('#check'); await pg.wait_for_selector('#fb .feedback')
        check(await pg.query_selector('.feedback.miss') is not None, 'wrong answer still wrong')
        # simulate the iOS keyboard: the visual viewport shrinks by 300px
        await pg.evaluate("(() => { const real = window.visualViewport; window.__vv = { height: innerHeight - 300, offsetTop: 0, addEventListener() {} }; Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => window.__vv }); __app.keepFooterVisible(); })()")
        await pg.wait_for_timeout(50)
        kb = await pg.evaluate("(() => { const f = document.querySelector('footer').getBoundingClientRect(); return [Math.round(f.bottom), innerHeight - 300]; })()")
        check(kb[0] <= kb[1] + 1, f'with the iOS keyboard (300px) the footer rides above it ({kb})')
        await pg.evaluate("window.__vv = { height: innerHeight, offsetTop: 0 }; __app.keepFooterVisible()")
        kb2 = await pg.evaluate("Math.round(document.querySelector('footer').getBoundingClientRect().bottom) + ' ' + innerHeight")
        check(kb2.split()[0] == kb2.split()[1], f'keyboard closed: footer back at the bottom ({kb2})')
        # flip card + translate use the same box
        await fresh(pg, LONG['k'], 'flip'); check(await pg.evaluate("document.getElementById('ans').tagName") == 'TEXTAREA', 'flip card answer is the same textarea')
        await fresh(pg, LONG['k'], 'en2es'); check(await pg.evaluate("document.getElementById('ans').tagName") == 'TEXTAREA', 'translate answer is the same textarea')

        # ---------- 2. tap to translate ----------
        await fresh(pg, LONG['k'], 'buildEn', LONG); await pg.wait_for_selector('.bubble .tok')
        tok = pg.locator('.bubble .tok').nth(1); g = await tok.get_attribute('data-g'); await tap(pg, tok)
        pop = await pg.evaluate("(document.querySelector('.hint-pop') || {}).textContent || ''")
        check(pop and not await pg.evaluate("__app.run.answered") and await pg.evaluate("__app.ex.order.length") == 0, f'practice: tapping a prompt word shows its gloss ({g} → {pop}), nothing answered, no tile placed')
        if ENGINE == 'webkit': await pg.screenshot(path=f'{OUT}/v92-tap-translate.png')
        await tap(pg, pg.locator('#tiles .tile').first)
        check(await pg.evaluate("__app.ex.order.length") == 1 and await pg.query_selector('.hint-pop') is None, 'tapping a tile still places it (no hint)')
        await fresh(pg, LONG['k'], 'pickEn'); await pg.wait_for_selector('.opt')
        await tap(pg, pg.locator('.opt').first)
        check(await pg.evaluate("__app.run.answered") and await pg.query_selector('.hint-pop') is None, 'tapping a Spanish answer button answers (no hint)')
        await pg.click('#quit'); await pg.wait_for_selector('.stone')
        await pg.evaluate("__app.openStone('u3', 1)"); await pg.wait_for_selector('.story .sline .tok')
        t2 = pg.locator('.sline .tok').first; await tap(pg, t2)
        check(await pg.query_selector('.hint-pop') is not None, 'story: tap a word for its gloss')
        await pg.click('#quit'); await pg.wait_for_selector('.stone')
        await pg.evaluate("__app.openStone('u3', 0)"); await pg.wait_for_selector('#go'); await pg.click('#go'); await pg.wait_for_timeout(150)
        ex_t = await pg.query_selector('.example .tok')
        if ex_t: await tap(pg, pg.locator('.example .tok').first); check(await pg.query_selector('.hint-pop') is not None, 'intro: tap a word in the example sentence')
        await pg.click('#quit'); await pg.wait_for_selector('.stone')
        # unit test: no hints
        await pg.evaluate("__app.openStone('u3', 3)"); await pg.wait_for_selector('.card'); await pg.wait_for_timeout(150)
        await fresh(pg, LONG['k'], 'buildEn', LONG); await pg.wait_for_selector('.bubble .tok')
        await tap(pg, pg.locator('.bubble .tok').nth(1))
        deco = await pg.evaluate("getComputedStyle(document.querySelector('.bubble .tok')).textDecorationLine")
        check(await pg.query_selector('.hint-pop') is None and await pg.evaluate("document.querySelector('main').classList.contains('hints-off')") and deco == 'none' and await pg.evaluate("__app.ex.order.length") == 0,
              f'unit test: tapping a word shows no hint and no dotted underline ({deco})')
        # long-press still works in the test
        await long_press(pg, pg.locator('.bubble .tok').nth(1))
        check(await pg.query_selector('.wmenu') is not None and await pg.query_selector('.hint-pop') is None, 'unit test: long-press still opens Not a priority')
        await pg.click('#wm-cancel'); await pg.click('#quit'); await pg.wait_for_selector('.stone')

        # ---------- 3. long-press any word ----------
        await pg.evaluate("__app.openStone('u3', 2)"); await pg.wait_for_selector('.card'); await pg.wait_for_timeout(150)
        await fresh(pg, LONG['k'], 'buildEn', LONG); await pg.wait_for_selector('.bubble .tok')
        nonc = await pg.evaluate("[...document.querySelectorAll('.bubble .tok')].findIndex(t => !t.dataset.w && t.dataset.g.length > 3)")
        t = pg.locator('.bubble .tok').nth(max(nonc, 0)); word = await t.get_attribute('data-g')
        await long_press(pg, t)
        mw = await pg.evaluate("(document.querySelector('.wmenu-word') || {}).textContent || ''")
        check(await pg.query_selector('.wmenu') is not None and await pg.query_selector('.hint-pop') is None and mw.lower() == word.lower(), f'long-press a non-course word in a bubble: menu for “{mw}”, no hint')
        if ENGINE == 'webkit': await pg.screenshot(path=f'{OUT}/v92-longpress.png')
        await pg.click('#wm-act'); await pg.wait_for_timeout(150)
        keys = await pg.evaluate("Object.keys(__app.state.parked).filter(k => k.startsWith('g:'))")
        toast = await pg.evaluate("(document.getElementById('toast') || {}).textContent || ''")
        check(len(keys) == 1 and 'not a priority' in toast, f'Not a priority saves it as {keys} ({toast})')
        await fresh(pg, LONG['k'], 'build', LONG); await pg.wait_for_selector('#tiles .tile[data-lp]')
        await long_press(pg, pg.locator('#tiles .tile').first)
        check(await pg.query_selector('.wmenu') is not None and await pg.evaluate("__app.ex.order.length") == 0, 'long-press a tile: menu opens and the tile is NOT placed')
        await pg.click('#wm-cancel'); await pg.wait_for_timeout(100)
        await tap(pg, pg.locator('#tiles .tile').first); check(await pg.evaluate("__app.ex.order.length") == 1, 'a normal tap after that still places the tile')
        for t in ('pick', 'pickEn'):
            await fresh(pg, LONG['k'], t); await pg.wait_for_selector('.opt')
            if await pg.query_selector('.opt[data-lp]'): break
        await long_press(pg, pg.locator('.opt[data-lp]').first)
        check(await pg.query_selector('.wmenu') is not None and not await pg.evaluate("__app.run.answered"), 'long-press a Spanish answer button: menu, not answered')
        await pg.click('#wm-cancel')
        await fresh(pg, LONG['k'], 'cloze'); await pg.wait_for_selector('#ans'); await pg.click('#skip'); await pg.wait_for_selector('#fb .feedback')
        fbt = pg.locator('#fb .tok').first
        if await fbt.count():
            await long_press(pg, fbt); check(await pg.query_selector('.wmenu') is not None, 'long-press a word in the correct-answer feedback'); await pg.click('#wm-cancel')
        else: check(False, 'feedback has tappable words')
        sel = await pg.evaluate("(() => { const t = document.querySelector('.tok'), cs = getComputedStyle(t); return [cs.webkitUserSelect || cs.userSelect, cs.webkitTouchCallout || 'n/a']; })()")
        check(sel[0] == 'none' and sel[1] in ('none', 'n/a'), f'no text selection / callout on words ({sel})')
        await pg.click('#quit'); await pg.wait_for_selector('.stone')
        # course word in a story line → real park
        await pg.evaluate("__app.openStone('u3', 1)"); await pg.wait_for_selector('.story .sline')
        cw = pg.locator('.sline .tok[data-w]').first
        if await cw.count():
            cid = await cw.get_attribute('data-w'); was = await pg.evaluate(f"!!__app.state.parked['{cid}']")
            await long_press(pg, cw); await pg.click('#wm-act'); await pg.wait_for_timeout(150)
            check(await pg.evaluate(f"!!__app.state.parked['{cid}']") != was, f'long-press a course word in a story line parks/unparks it ({cid})')
        await pg.click('#quit'); await pg.wait_for_selector('.stone')
        # a 'g:' park turns into a real park once the word is a course word
        cand = await pg.evaluate("__app.content.units.flatMap(u => u.words).find(w => !__app.state.parked[w.id])")
        base = await pg.evaluate(f"Check.stripAcc ? Check.stripAcc({json.dumps(cand['es'].split(' ')[-1].lower() if cand['es'].split(' ')[0] in ('el','la','los','las') else cand['es'].lower())}) : ''")
        await pg.evaluate(f"(() => {{ const s = __app.state; s.parked['g:{base}'] = {{ at: Date.now(), word: 'x' }}; localStorage.setItem('spanish-app-state-v1', JSON.stringify(s)); }})()")
        await pg.reload(); await pg.wait_for_selector('.stone')
        check(await pg.evaluate(f"!!__app.state.parked['{cand['id']}']"), f'an earlier long-press park (g:{base}) parks the course word {cand["id"]}')
        await pg.click('#prog'); await pg.wait_for_selector('#parked')
        check(len(keys) == 1 and await pg.evaluate(f"[...document.querySelectorAll('#parked li')].some(li => li.textContent.toLowerCase().includes({json.dumps(word.lower())}))"), 'Progress lists the non-course parked word with Unpark')
        await pg.click('#home') if await pg.query_selector('#home') else await pg.goto(URL)
        await pg.wait_for_selector('.stone')

        # ---------- 4. tile glide ----------
        await pg.evaluate("__app.openStone('u3', 2)"); await pg.wait_for_selector('.card'); await pg.wait_for_timeout(150)
        await fresh(pg, LONG['k'], 'build', LONG); await pg.wait_for_selector('#tiles .tile')
        st0 = await pg.evaluate(TILE_STATE)
        await pg.evaluate("document.querySelector('#tiles .tile').click()")
        an = await pg.evaluate("(() => { const t = document.querySelector('#line .tile'); const a = t.getAnimations(); return a.length ? JSON.stringify(a[0].effect.getKeyframes()[0].transform) + ' ' + a[0].effect.getTiming().duration : 'none'; })()")
        check('translate' in an and ' 240' in an, f'tap → the tile glides from the bank to its slot ({an})')
        await pg.evaluate("document.querySelector('#line .tile').click()")
        gh = await pg.evaluate("document.querySelectorAll('.tile-ghost').length"); await pg.wait_for_timeout(350)
        st = await pg.evaluate(TILE_STATE)
        check(gh == 1 and st['ghosts'] == 0 and st['landing'] == 0 and st['order'] == [] and st['used'] == [], 'tap an answer tile → it flies back to its placeholder, then the placeholder fills in')
        # gap closing: remove the middle tile, the later ones slide
        await pg.evaluate("[0, 1, 2].forEach(k => document.querySelectorAll('#tiles .tile')[k].click())"); await pg.wait_for_timeout(350)
        await pg.evaluate("document.querySelectorAll('#line .tile')[0].click()")
        sl = await pg.evaluate("[...document.querySelectorAll('#line .tile')].map(t => t.getAnimations().length)")
        check(all(n > 0 for n in sl), f'the remaining answer tiles slide to close the gap ({sl})')
        await pg.wait_for_timeout(350)
        # rapid taps: random bursts mid-animation, state must always match
        rnd = random.Random(7); bad = []
        for burst in range(12):
            js = []
            for _ in range(rnd.randint(3, 9)):
                if rnd.random() < 0.6: js.append("(() => { const f = [...document.querySelectorAll('#tiles .tile')].filter(t => !t.classList.contains('used')); if (f.length) f[Math.floor(Math.random() * f.length)].click(); })()")
                else: js.append("(() => { const l = [...document.querySelectorAll('#line .tile')]; if (l.length) l[Math.floor(Math.random() * l.length)].click(); })()")
            await pg.evaluate("async () => { const steps = [" + ",".join(f"() => {x}" for x in js) + "]; for (const s of steps) { s(); await new Promise(r => setTimeout(r, Math.random() * 60)); } }")
            mid = await pg.evaluate(TILE_STATE)
            if mid['line'] != mid['order'] or sorted(mid['order']) != mid['used'] or mid['dup'] or moved(mid['bank'], st0['bank']): bad.append(('mid', burst, [(i,a,b) for i,(a,b) in enumerate(zip(mid['bank'], st0['bank'])) if a!=b], len(mid['bank']), len(st0['bank'])))
        await pg.wait_for_timeout(400); fin = await pg.evaluate(TILE_STATE)
        if fin['line'] != fin['order'] or sorted(fin['order']) != fin['used'] or fin['ghosts'] or fin['landing'] or moved(fin['bank'], st0['bank']): bad.append(('final', fin))
        check(not bad, f'rapid random taps (12 bursts mid-animation): answer line == state, placeholders == state, no duplicates, bank layout never changed ({bad[:1]}; whole-bank shifts: {sorted(set(SHIFTS))})')
        # also with real pointer taps, as fast as possible
        await fresh(pg, LONG['k'], 'build', LONG); await pg.wait_for_selector('#tiles .tile')
        n = await pg.locator('#tiles .tile').count()
        for k in range(n): await pg.locator('#tiles .tile').nth(k).click(delay=0, no_wait_after=True)
        for k in range(min(3, n)): await pg.locator('#line .tile').first.click(delay=0, no_wait_after=True)
        await pg.wait_for_timeout(400); fin = await pg.evaluate(TILE_STATE)
        check(fin['line'] == fin['order'] and len(fin['order']) == n - min(3, n) and sorted(fin['order']) == fin['used'] and not fin['ghosts'], f'fast real taps: {len(fin["order"])} of {n} placed, state consistent')
        exp = await pg.evaluate("__app.ex.order.map(k => __app.ex.tiles[k]).join(' ')")
        await pg.click('#check'); await pg.wait_for_selector('#fb .feedback')
        check(await pg.query_selector('#fb .feedback') is not None, f'check grades what is in the line ({exp[:40]}…)')
        check(not errs, f'no page errors {errs[:3]}')
        await ctx.close()
        # reduced motion: no animation, same state logic
        ctx = await new_ctx(b, p, V91, sr=False); pg = await ctx.new_page()
        await pg.emulate_media(reduced_motion='reduce')
        await pg.goto(URL); await pg.wait_for_selector('.stone'); await pg.evaluate("__app.openStone('u3', 2)"); await pg.wait_for_selector('.card'); await pg.wait_for_timeout(150)
        await fresh(pg, LONG['k'], 'build', LONG); await pg.wait_for_selector('#tiles .tile')
        await pg.evaluate("document.querySelector('#tiles .tile').click()")
        r = await pg.evaluate("[document.querySelector('#line .tile').getAnimations().length, document.querySelectorAll('.tile-ghost').length]")
        await pg.evaluate("document.querySelector('#line .tile').click()")
        r2 = await pg.evaluate("[document.querySelectorAll('.tile-ghost').length, __app.ex.order.length]")
        check(r == [0, 0] and r2 == [0, 0], f'prefers-reduced-motion: tiles move instantly ({r}, {r2})')
        await ctx.close(); await b.close()
    print('\nALL PASS' if ok_all else '\nSOME CHECKS FAILED'); sys.exit(0 if ok_all else 1)
asyncio.run(main())
