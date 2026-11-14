"""v9.3: accents never graded (á/a, ñ/n, ü/u … are fully correct, FSRS Good, quiet "Spelled:" note), no grammar/story item whose
options differ only by accents or spelling, and spoken-style grammar drills (build the reply from tiles / say it) mixed into
practice while placement and the unit test stay choose-the-right-form. Lossless v9.1/v9.2 → v9.3."""
import asyncio, json, sys, os, re
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'v8_e2e.py')).read().split('async def main')[0]
exec(src)

async def tap(pg, loc):
    await loc.scroll_into_view_if_needed(); bb = await loc.bounding_box()
    await pg.mouse.click(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2); await pg.wait_for_timeout(120)

FOLD = "s => s.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/[¿?¡!.,;:\"'()\\-\\s]/g, '')"

async def main():
    async with async_playwright() as p:
        b = await (p.webkit if ENGINE == 'webkit' else p.chromium).launch()
        V7 = strip_meta(json.load(open(FIX + 'v7-export.json')))
        V91 = dict(V7, settings=dict(V7['settings'], voice='', voice2='', voiceMode='recorded', anim=True)); V91['schema'] = 5; V91['speakPauseUntil'] = 0
        V91['parked'] = dict(V7.get('parked', {}), **{'g:costera': {'at': 1, 'word': 'costera'}})  # a v9.2 'g:' park must survive
        ctx = await new_ctx(b, p, V91, sr=False)
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL); await pg.wait_for_selector('.stone'); await pg.wait_for_timeout(500)
        s = await pg.evaluate("__app.state")
        check(await pg.evaluate("__app.version") == 'v9.3' and s['items'] == V91['items'] and s['path'] == V91['path'] and s['daily'] == V91['daily']
              and s['streak'] == V91['streak'] and 'g:costera' in s['parked'], 'v9.2 data → v9.3 losslessly (items, path, daily, streak, g: parks)')

        # ---------- 1. accent-insensitive grading in the app ----------
        w = await pg.evaluate("""(() => { const C = __app.content; for (const u of C.units) for (const w of u.words) if (/[áéíóúñü]/.test(w.es) && !/[A-Z]/.test(w.es)) return { id: w.id, es: w.es, u: u.id }; })()""")
        await pg.evaluate(f"__app.openStone('{w['u']}', 2)"); await pg.wait_for_selector('.card'); await pg.wait_for_timeout(200)
        async def answer_as(typed):
            await pg.evaluate(f"""(() => {{ const r = __app.run; r.answered = false; delete r.firstDone['w:{w['id']}']; delete __app.state.items['w:{w['id']}'];
              r.queue[r.i] = {{ id: 'w:{w['id']}' }}; __app.forceEx('en2es'); }})()""")
            await pg.wait_for_selector('#ans'); await pg.fill('#ans', typed); await pg.click('#check'); await pg.wait_for_selector('#fb .feedback')
            fb = await pg.inner_text('#fb .feedback'); cls = await pg.get_attribute('#fb .feedback', 'class')
            warn = await pg.query_selector('#fb .warn, #fb .bad'); card = await pg.evaluate(f"JSON.parse(JSON.stringify(__app.state.items['w:{w['id']}']))")
            return fb, cls, warn, card
        bare = await pg.evaluate("s => s.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')", w['es'])
        fb_a, cls_a, warn_a, card_a = await answer_as(bare)
        await pg.wait_for_timeout(500)
        fb_e, cls_e, warn_e, card_e = await answer_as(w['es'])
        same = all(card_a.get(k) == card_e.get(k) for k in ('s', 'd', 'reps', 'lapses', 'state'))
        check('good' in cls_a and not warn_a and fb_a.startswith('✓ Correct') and 'Spelled:' in fb_a and w['es'] in fb_a,
              f'"{bare}" for "{w["es"]}": ✓ Correct with a quiet "Spelled: {w["es"]}" (no warning)')
        check(same and 'Spelled:' not in fb_e, f'FSRS: the accent-free answer is graded exactly like the accented one (s {card_a.get("s")} = {card_e.get("s")}, d {card_a.get("d")} = {card_e.get("d")})')
        if ENGINE == 'webkit':
            await answer_as(bare); await pg.screenshot(path=f'{OUT}/v93-spelled.png')
        await pg.click('#quit'); await pg.wait_for_selector('.stone')

        # ---------- 2. no option set is an accent / spelling quiz (content and the exercises the app builds) ----------
        bad = await pg.evaluate(f"""(() => {{ const fold = {FOLD}, C = __app.content, bad = [];
          const sets = Object.entries(C.patterns).flatMap(([k, p]) => p.items.map((it, i) => [k + '#' + i, it.o])).concat(C.units.flatMap(u => u.story.qs.map((q, i) => [u.id + ' q' + i, q.o])));
          sets.forEach(([id, o]) => o.forEach((a, i) => o.slice(i + 1).forEach(b => {{ if (fold(a) === fold(b)) bad.push(id + ': ' + a + ' / ' + b); }})));
          return bad; }})()""")
        check(not bad, f'no grammar or story question has options that differ only by accents / ñ / spacing ({bad[:3]})')
        await pg.evaluate("__app.openStone('ta1', 2)"); await pg.wait_for_selector('.card'); await pg.wait_for_timeout(200)
        r = await pg.evaluate(f"""(() => {{ const fold = {FOLD}, C = __app.content, bad = []; let tiles = 0, mc = 0, speak = 0;
          Object.entries(C.patterns).forEach(([k, p]) => p.items.forEach((it, i) => {{
            const m = __app.makeExercise({{ id: 'p:' + k, itemIdx: i, ex: 'mc' }}); mc++;
            m.options.forEach((a, j) => m.options.slice(j + 1).forEach(b => {{ if (fold(a) === fold(b)) bad.push('mc ' + k + i); }}));
            const t = __app.makeExercise({{ id: 'p:' + k, itemIdx: i, ex: 'ptiles' }});
            if (t.kind === 'build') {{ tiles++; const tok = t.tiles.map(fold), uniq = new Set(tok);
              // a distractor tile never folds to the same word as a tile in the answer
              const ans = new Set(t.answers[0].replace(/[¿?¡!.,;:“”"]/g, '').split(/\\s+/).filter(Boolean).map(fold));
              const extra = t.tiles.length - ans.size; if (tok.filter(x => ans.has(x)).length > t.answers[0].split(/\\s+/).length) bad.push('tiles ' + k + i + ' ' + t.tiles.join('|')); }}
          }}));
          for (let n = 0; n < 200; n++) {{ const e = __app.makeExercise({{ id: 'p:clitic_usted' }}); if (e.kind === 'speak') speak++; }}
          return {{ bad, tiles, mc }}; }})()""")
        check(not r['bad'] and r['tiles'] > 100, f"every grammar item as choose-the-form ({r['mc']}) and as tiles ({r['tiles']}): no accent-only twins ({r['bad'][:3]})")
        kinds = await pg.evaluate("(() => { const c = {}; for (let n = 0; n < 300; n++) { const e = __app.makeExercise({ id: 'p:clitic_usted' }); c[e.kind] = (c[e.kind] || 0) + 1; } return c; })()")
        check(kinds.get('mc', 0) > 100 and kinds.get('build', 0) > 40, f'practice mixes spoken-style grammar drills in (300 draws: {kinds})')

        # build the reply from tiles: client conversation item, real taps
        idx = await pg.evaluate("__app.content.patterns.clitic_usted.items.findIndex(it => it.q.startsWith('¿Me manda el contrato?'))")
        await pg.evaluate(f"(() => {{ const r = __app.run; r.answered = false; r.queue[r.i] = {{ id: 'p:clitic_usted', itemIdx: {idx} }}; __app.forceEx('ptiles'); }})()")
        await pg.wait_for_selector('#tiles .tile')
        ui = await pg.evaluate("({ bubble: document.querySelector('.bubble') && document.querySelector('.bubble').textContent.trim(), cue: (document.querySelector('.pat-en') || {}).textContent, ans: __app.ex.answers[0], tiles: __app.ex.tiles.slice(), label: document.querySelector('.label').textContent })")
        check('¿Me manda el contrato?' in (ui['bubble'] or '') and (ui['cue'] or '').startswith('Reply:') and ui['ans'] == 'Sí, ahorita se lo mando.', f"tiles: client question in the bubble, English cue, build “{ui['ans']}” ({ui['label']}; bank {ui['tiles']})")
        words = re.sub(r'[¿?¡!.,]', '', ui['ans']).split()
        for wd in words:
            k = await pg.evaluate(f"__app.ex.tiles.findIndex((t, k) => t === {json.dumps(wd)} && !__app.ex.order.includes(k))")
            await tap(pg, pg.locator(f'#tiles .tile[data-k="{k}"]'))
        await pg.wait_for_timeout(300); await pg.click('#check'); await pg.wait_for_selector('#fb .feedback')
        check(await pg.query_selector('#fb .feedback.good') is not None, 'tapping the reply in order is correct')
        if ENGINE == 'webkit': await pg.screenshot(path=f'{OUT}/v93-grammar-tiles.png')
        await pg.wait_for_timeout(500)
        # wrong pronoun tile → wrong
        await pg.evaluate(f"(() => {{ const r = __app.run; r.answered = false; delete r.firstDone['p:clitic_usted']; r.queue[r.i] = {{ id: 'p:clitic_usted', itemIdx: {idx} }}; __app.forceEx('ptiles'); }})()")
        await pg.wait_for_selector('#tiles .tile')
        alt = await pg.evaluate("__app.ex.tiles.find(t => !__app.ex.answers[0].split(/[\\s,.]+/).includes(t))")
        if alt:
            seq = [alt if x == 'se' and alt in ('te', 'le', 'me') else alt if x == 'lo' and alt in ('la', 'las', 'los') else x for x in words]
            for wd in seq:
                k = await pg.evaluate(f"__app.ex.tiles.findIndex((t, k) => t === {json.dumps(wd)} && !__app.ex.order.includes(k))")
                if k >= 0: await tap(pg, pg.locator(f'#tiles .tile[data-k="{k}"]'))
            await pg.wait_for_timeout(300); await pg.click('#check'); await pg.wait_for_selector('#fb .feedback')
            check(seq == words or await pg.query_selector('#fb .feedback.miss') is not None, f'swapping in the distractor “{alt}” is wrong ({" ".join(seq)})')
        await pg.wait_for_timeout(500)
        # say it: with a recogniser available the speak variant appears; without one it falls back to tiles
        sp = await pg.evaluate(f"(() => {{ const r = __app.run; r.answered = false; r.queue[r.i] = {{ id: 'p:clitic_usted', itemIdx: {idx} }}; __app.forceEx('pspeak'); return [__app.ex.kind, __app.speakOk()]; }})()")
        check(sp[0] == ('speak' if sp[1] else 'build'), f'say-it variant: {sp[0]} (speech available: {sp[1]})')
        await pg.click('#quit'); await pg.wait_for_selector('.stone')

        # ---------- 3. unit test and placement stay choose-the-right-form ----------
        await pg.evaluate("__app.openStone('ta1', 3)"); await pg.wait_for_selector('.card'); await pg.wait_for_timeout(200)
        tk = await pg.evaluate("(() => { const c = {}; for (let n = 0; n < 60; n++) { const e = __app.makeExercise({ id: 'p:clitic_usted' }); c[e.kind] = (c[e.kind] || 0) + 1; } return [__app.run.mode, c]; })()")
        check(tk[0] == 'test' and list(tk[1].keys()) == ['mc'], f'unit test: grammar stays choose-the-right-form ({tk})')
        await pg.click('#quit'); await pg.wait_for_selector('.stone')
        check(not errs, f'no page errors {errs[:2]}')
        await ctx.close()
        # with a recogniser: the say-it variant is repeat-after-me of the reply, with the English cue
        ctx = await new_ctx(b, p, V91, sr=True); pg = await ctx.new_page()
        await pg.goto(URL); await pg.wait_for_selector('.stone'); await pg.evaluate("__app.openStone('ta1', 2)"); await pg.wait_for_selector('.card')
        sp = await pg.evaluate(f"(() => {{ const r = __app.run; r.answered = false; r.queue[r.i] = {{ id: 'p:clitic_usted', itemIdx: {idx} }}; __app.forceEx('pspeak'); return {{ kind: __app.ex.kind, say: __app.ex.sayEs, cue: (document.querySelector('.pat-en') || {{}}).textContent, mic: !!document.getElementById('mic') }}; }})()")
        check(sp['kind'] == 'speak' and sp['say'] == 'Sí, ahorita se lo mando.' and sp['mic'] and 'send it to you' in (sp['cue'] or ''), f'say-it variant with speech on: repeat “{sp["say"]}” ({sp["cue"]})')
        kinds = await pg.evaluate("(() => { const c = {}; for (let n = 0; n < 300; n++) { const e = __app.makeExercise({ id: 'p:clitic_usted' }); c[e.kind] = (c[e.kind] || 0) + 1; } return c; })()")
        check(all(kinds.get(k, 0) > 20 for k in ('mc', 'build', 'speak')), f'with speech on, practice mixes choose / tiles / say-it ({kinds})')
        await ctx.close(); await b.close()
    print('\nALL PASS' if ok_all else '\nSOME CHECKS FAILED'); sys.exit(0 if ok_all else 1)
asyncio.run(main())
