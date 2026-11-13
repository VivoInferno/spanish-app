"""v9: recorded neural audio. Dalia (es-MX) for words, drills, narration; story characters in their cast voices; tap-hint words;
slow replay 0.75×; fallback to the device voice (Mónica) for anything not recorded or when play() fails; Can't listen still mutes
auto-play; speaking drill still works; Settings › Voices = Natural (default) / Device, persists; every speakable string has a clip;
offline audio cache fills in the background; lossless v8.1 → v9. Screenshot: screens/v9-voices.png (WebKit iPhone 15)."""
import asyncio, json, sys, os, re
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'v8_e2e.py')).read().split('async def main')[0]
exec(src)  # URL, ENGINE, check(), new_ctx() with recogniser + Web Speech mocks (Mónica + Paulina)

MOCK_PLAY = """
window.__audioLog = []; window.__audioMiss = []; window.__plays = []; window.__rejectPlay = false;
HTMLMediaElement.prototype.play = function () {
  if (String(this.src).startsWith('data:')) return Promise.resolve(); // first-tap unlock
  if (window.__rejectPlay) return Promise.reject(new DOMException('blocked', 'NotAllowedError'));
  window.__plays.push({ src: this.src, rate: this.playbackRate }); return Promise.resolve(); };
HTMLMediaElement.prototype.pause = function () {};
"""

async def ctx9(b, p, fixture):
    if ENGINE == 'webkit':  # Playwright's ephemeral WebKit contexts drop Cache Storage on reload; a persistent profile behaves like Safari
        import tempfile
        dev = {k: v for k, v in p.devices['iPhone 15'].items() if k != 'default_browser_type'}
        ctx = await p.webkit.launch_persistent_context(tempfile.mkdtemp(prefix='v9wk'), **dev, timezone_id='America/Mexico_City', service_workers='block')
        for js in (wkshim.SHIM, MOCK_SR, MOCK_TTS): await ctx.add_init_script(js)
        await ctx.add_init_script(f"if (!localStorage.getItem('{KEY}')) localStorage.setItem('{KEY}', {json.dumps(json.dumps(fixture))})")
    else: ctx = await new_ctx(b, p, fixture, device=False)
    await ctx.add_init_script(MOCK_PLAY)
    pg = ctx.pages[0] if ctx.pages else await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    await pg.goto(URL); await pg.wait_for_selector('.stone'); await pg.wait_for_timeout(700)
    return ctx, pg, errs

async def last(pg): await pg.wait_for_timeout(150); return await pg.evaluate("__audioLog.slice(-1)[0] || null")
async def path_for(pg, text, voice='null'): return await pg.evaluate(f"Rec.lookup(Rec.man, {json.dumps(text)}, {voice})")

async def main():
    async with async_playwright() as p:
        b = await (p.webkit if ENGINE == 'webkit' else p.chromium).launch()
        V7 = strip_meta(json.load(open(FIX + 'v7-export.json')))
        V81 = dict(V7, settings=dict(V7['settings'], voice='', voice2='', anim=False)); V81['schema'] = 5; V81['speakPauseUntil'] = 0
        ctx, pg, errs = await ctx9(b, p, V81)
        s = await pg.evaluate("__app.state")
        check(await pg.evaluate("__app.version") == 'v9.1' and s['items'] == V81['items'] and s['daily'] == V81['daily'] and s['streak'] == V81['streak'] and s['path'] == V81['path']
              and s['settings']['voiceMode'] == 'recorded' and s['settings']['anim'] is False and s['settings']['voice2'] == '' and s['schema'] == 5,
              'v8.1 data → v9 losslessly (items, path, daily, streak, settings kept; voiceMode = recorded)')
        man = await pg.evaluate("Rec.man && { main: Rec.man.main, voices: Rec.man.voices, n: Object.values(Rec.man.files).reduce((a, m) => a + Object.keys(m).length, 0) }")
        check(man and man['main'] == 'dalia' and man['voices']['dalia'] == 'es-MX-DaliaNeural' and man['n'] > 1000 and await pg.evaluate("__app.recorded"), f'manifest loaded: Dalia main, {man and man["n"]} clips')

        # ---- coverage: every string the app can speak has a recording ----
        miss = await pg.evaluate("""(() => { const C = __app.content, m = Rec.man, out = [];
          const need = (t, v) => { if (t && !Rec.lookup(m, t, v)) out.push(t); };
          const sp = __app.speakables(); sp.main.forEach(t => need(t)); sp.story.forEach(([u, s, t]) => need(t, Rec.castFor(m, u, s)));
          for (const u of C.units) for (const w of u.words) for (const ex of ['es2en', 'en2es', 'cloze', 'listen', 'listenS', 'flip', 'speak', 'build', 'buildEn', 'pick', 'pickEn'])
            for (let i = 0; i < 3; i++) { let e; try { e = __app.makeExercise({ id: 'w:' + w.id, ex }); } catch (err) { continue; }
              [e.speakNow, e.listen, e.sayEs, e.speakAfter, e.bigEs, e.back, e.reveal && e.reveal.es].forEach(t => need(t)); }
          for (const p of Object.keys(C.patterns)) for (let i = 0; i < 6; i++) { const e = __app.makeExercise({ id: 'p:' + p }); need(e.speakAfter); }
          return [...new Set(out)]; })()""")
        check(not miss, f'every word, sentence, story line, grammar item, drill prompt and tap-hint word has a clip (missing: {miss[:5]})')

        # ---- lesson audio ----
        uid = await pg.evaluate("__app.content.units.map(u => u.id).find(id => { const q = __app.introQueue(id); return q[1] && q[1].id.startsWith('w:') && q[1].intro; })")
        await pg.evaluate(f"__app.openStone('{uid}', 0)"); await pg.wait_for_selector('#go'); await pg.click('#go'); await pg.wait_for_selector('.speak')
        w = await pg.evaluate("__app.entry.id.startsWith('w:') ? __app.content.units.flatMap(u => u.words).find(x => 'w:' + x.id === __app.entry.id).es : null")
        NR = await pg.evaluate("Math.max(0.6, Math.min(1.3, (__app.state.settings.rate || 0.9) / 0.9))")  # speed slider: 0.9 = as recorded
        a = await last(pg)
        check(w and a and a['src'] == await path_for(pg, w) and abs(a['rate'] - NR) < 1e-9 and await pg.evaluate("__spoken.length") == 0, f'new word auto-plays the Dalia recording ({w}), not the device voice')
        check(await pg.evaluate("__plays.length > 0 && __plays.slice(-1)[0].src.startsWith('blob:')"), 'played through the unlocked audio element from a blob: URL')
        await pg.click('.speak'); a = await last(pg); check(a['src'] == await path_for(pg, w), '🔊 replays it')
        await pg.click('#go'); await pg.wait_for_timeout(200)
        await pg.evaluate("__app.forceEx('listen')"); await pg.wait_for_selector('#slow')
        txt = await pg.evaluate("__app.ex.listen"); a = await last(pg)
        await pg.click('#slow'); b2 = await last(pg); await pg.click('#play'); c = await last(pg)
        check(a['src'] == await path_for(pg, txt) and b2['rate'] == 0.75 and abs(c['rate'] - NR) < 1e-9 and b2['src'] == a['src'], f'dictation plays the clip; slow replay at 0.75×, normal at the slider speed ({a["rate"]}/{b2["rate"]}/{c["rate"]})')
        # tap-hint word
        await pg.evaluate("__app.forceEx('es2en')"); await pg.wait_for_timeout(150)
        tok = pg.locator('.tok[data-g]').first
        if await tok.count():
            g = await tok.get_attribute('data-g'); await tok.click(); a = await last(pg)
            check(a and a['src'] == await path_for(pg, g), f'tapping a word plays its recording ({g})')
        else: check(False, 'tap-hint word present')
        # fallbacks
        await pg.evaluate("__spoken.length = 0; __app.speak('Palabra que nadie grabó todavía.')"); await pg.wait_for_timeout(100)
        sp = await pg.evaluate("__spoken.slice(-1)[0] || null")
        check(sp and sp['voice'] == 'Mónica' and 'Palabra que nadie grabó todavía.' in await pg.evaluate("__audioMiss"), 'text with no recording falls back to the device voice (Mónica)')
        await pg.evaluate(f"__spoken.length = 0; __rejectPlay = true; __app.speak({json.dumps(w)})"); await pg.wait_for_timeout(300)
        sp = await pg.evaluate("__spoken.slice(-1)[0] || null"); await pg.evaluate("__rejectPlay = false")
        check(sp and sp['text'] == w and sp['voice'] == 'Mónica', 'if the recording can\'t play (blocked/offline), the device voice says it instead')
        # Can't listen
        await pg.evaluate("__app.forceEx('listen')"); await pg.wait_for_selector('#cantListen'); await pg.click('#cantListen'); await pg.wait_for_timeout(200)
        n0 = await pg.evaluate("__audioLog.length + __spoken.length")
        await pg.click('#quit'); await pg.wait_for_selector('.stone'); await pg.evaluate("__app.openStone('u9', 0)"); await pg.wait_for_selector('#go'); await pg.wait_for_timeout(200)
        check(await pg.evaluate("__app.listenPaused()") and await pg.evaluate("__audioLog.length + __spoken.length") == n0, "Can't listen now: auto-play stays muted with recorded audio too")
        await pg.click('#quit'); await pg.wait_for_selector('.stone'); await pg.evaluate("__app.state.listenPauseUntil = 0")

        # ---- story voices ----
        await pg.evaluate("__audioLog.length = 0; __app.openStone('u10', 1)"); await pg.wait_for_selector('.story')
        for _ in range(80):
            if await pg.query_selector('.stone'): break
            if await pg.query_selector('#ssay #mic') or (await pg.query_selector('#stile') and await pg.query_selector('#skip')): await pg.click('#skip')
            elif await pg.query_selector('.squestion .opt') and not await pg.query_selector('.squestion .opt.right'): await pg.locator('.squestion .opt').first.click()
            elif await pg.query_selector('#next'): await pg.click('#next')
            await pg.wait_for_timeout(40)
        heard = await pg.evaluate("""(() => { const m = Rec.man, log = new Set(__audioLog.map(a => a.src)), out = {};
          const voiceOf = src => Object.keys(m.files).find(v => Object.values(m.files[v]).some(h => 'audio/' + h + '.mp3' === src));
          __app.content.units.find(u => u.id === 'u10').story.lines.forEach(l => { const v = Object.keys(m.files).find(v => log.has(Rec.lookup(m, l.es, v))); if (v) (out[l.s || '(narrator)'] = out[l.s || '(narrator)'] || []).push(v); });
          Object.keys(out).forEach(k => out[k] = [...new Set(out[k])]); return out; })()""")
        check(heard.get('(narrator)') == ['dalia'] and heard.get('Mark') == ['jorge'] and heard.get('Don Rafa') == ['alonso'] and heard.get('Doña Chela') == ['paloma'],
              f'story: narrator Dalia, Mark Jorge, Don Rafa Alonso, Doña Chela Paloma ({heard})')
        await pg.evaluate("__app.openStone('ta1', 1)"); await pg.wait_for_selector('.story')
        for _ in range(30):
            if await pg.query_selector('[data-spk="Mariana"]'): break
            if await pg.query_selector('#ssay #mic') or (await pg.query_selector('#stile') and await pg.query_selector('#skip')): await pg.click('#skip')
            elif await pg.query_selector('.squestion .opt') and not await pg.query_selector('.squestion .opt.right'): await pg.locator('.squestion .opt').first.click()
            elif await pg.query_selector('#next'): await pg.click('#next')
            await pg.wait_for_timeout(40)
        btn = pg.locator('[data-spk="Mariana"]').first
        if await btn.count():
            say = await btn.get_attribute('data-say'); await btn.click(); a = await last(pg)
            check(a['src'] == await path_for(pg, say, "'paloma'"), "tapping 🔊 on Mariana's line replays it in her voice (Paloma)")
        else: check(False, 'Mariana line found')
        await pg.click('#quit'); await pg.wait_for_selector('.stone')

        # ---- speaking drill still works with recorded prompts ----
        await pg.evaluate("__app.openStone('u9', 0)"); await pg.wait_for_selector('#go'); await pg.click('#go'); await pg.wait_for_timeout(150)
        short = await pg.evaluate("__app.content.units.find(u => u.id === 'u9').sentences.find(s => s.k === 'llanta' && s.es.split(' ').length <= 9)")
        await fresh_entry(pg, 'llanta', 'speak', f", sent: {json.dumps(short)}"); await pg.wait_for_selector('#mic')
        a = await last(pg); check(a and a['src'] == await path_for(pg, short['es']), 'repeat-after-me plays the recorded sentence')
        await pg.evaluate(f"__sr.say = {json.dumps(re.sub(r'[¿?¡!.,;:]', '', short['es']).lower())}"); await pg.click('#mic'); await pg.wait_for_selector('#fb .feedback')
        check(await pg.query_selector('.feedback.good') is not None, 'speaking it is still graded correct')
        await pg.click('#quit'); await pg.wait_for_selector('.stone')

        # ---- Settings ----
        await pg.click('#prog'); await pg.wait_for_selector('#voiceMode')
        opts = await pg.evaluate("[...document.querySelectorAll('#voiceMode option')].map(o => [o.value, o.textContent.trim(), o.selected])")
        check(opts == [['recorded', 'Natural voices (recorded)', True], ['device', 'Device voices', False]], f'Settings › Voices: Natural (recorded) is the default, Device is the option ({opts})')
        await pg.click('#recTest'); a1 = await last(pg); await pg.click('#recTest'); a2 = await last(pg)
        check(a1['src'] == await path_for(pg, 'Hola, así sueno. ¿Se lo mando mañana?') and a2['src'] == await path_for(pg, '¡Hola! Yo soy la segunda voz de las historias.', "'jorge'"), 'Test plays Dalia, then Jorge')
        await pg.evaluate("__spoken.length = 0"); await pg.click('#voiceTest'); await pg.wait_for_timeout(100)
        check((await pg.evaluate("__spoken.slice(-1)[0]"))['voice'] == 'Mónica', 'device-voice Test still uses the device voice (Mónica)')
        await pg.evaluate("document.getElementById('voiceMode').closest('.set').scrollIntoView({block: 'start'}); window.scrollBy(0, -60)"); await pg.wait_for_timeout(500)
        if ENGINE == 'webkit': await pg.screenshot(path=f'{OUT}/v9-voices.png')
        await pg.select_option('#voiceMode', 'device'); await pg.wait_for_timeout(200)
        n = await pg.evaluate("__audioLog.length"); await pg.evaluate("__spoken.length = 0; __app.speak('el trámite')"); await pg.wait_for_timeout(100)
        check(await pg.evaluate("__app.state.settings.voiceMode") == 'device' and await pg.evaluate("__audioLog.length") == n and (await pg.evaluate("__spoken.slice(-1)[0]"))['voice'] == 'Mónica', 'Device voices: everything goes through Web Speech (Mónica)')
        await pg.reload(); await pg.wait_for_selector('.stone'); await pg.wait_for_timeout(600)
        check(await pg.evaluate("__app.state.settings.voiceMode") == 'device' and not await pg.evaluate("__app.recorded"), 'voice mode survives reload')
        await pg.click('#prog'); await pg.wait_for_selector('#voiceMode'); await pg.select_option('#voiceMode', 'recorded'); await pg.wait_for_timeout(200)
        check(await pg.evaluate("__app.recorded"), 'back to Natural voices')

        # ---- offline audio cache ----
        await pg.reload(); await pg.wait_for_selector('.stone')
        need = await pg.evaluate("__app.offlineAudio().length")
        for _ in range(40):
            have = await pg.evaluate("Rec.cachedCount()")
            if have >= need: break
            await pg.wait_for_timeout(500)
        check(need > 100 and have >= need, f'background cache holds the audio for the current units ({have}/{need} clips)')
        uaud = await pg.evaluate("__app.unitAudio('ta5')"); await pg.evaluate("__app.openStone('ta5', 0)"); await pg.wait_for_timeout(2500)
        got = await pg.evaluate(f"caches.open('espanol-audio').then(c => Promise.all({json.dumps(uaud)}.map(p => c.match(p)))).then(r => r.filter(Boolean).length)")
        check(got == len(uaud), f'opening a unit caches all its clips ({got}/{len(uaud)})')
        check(not errs, f'no page errors {errs[:3]}')
        await ctx.close()
        # a clip that is in the manifest but can't be fetched (404 / offline and not cached) → device voice
        ctx, pg, errs = await ctx9(b, p, V81)
        await ctx.route('**/audio/*.mp3', lambda r: r.fulfill(status=404, body=''))
        await pg.evaluate("__spoken.length = 0; __app.speak('Así suena ahora.')"); await pg.wait_for_timeout(400)
        sp = await pg.evaluate("__spoken.slice(-1)[0] || null")
        check(sp and sp['text'] == 'Así suena ahora.', 'missing file (404, not cached) → device voice')
        await ctx.close()
        if ENGINE == 'chromium':  # real decoding + service worker offline (the box WebKit has no MP3 decoder)
            ctx = await b.new_context(viewport={'width': 390, 'height': 844}); await ctx.add_init_script(NO_SR)
            pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto(URL); await pg.wait_for_function("navigator.serviceWorker.controller !== null", timeout=15000); await pg.wait_for_function("window.Rec && Rec.man")
            clip = await pg.evaluate("Rec.lookup(Rec.man, 'Hola, así sueno. ¿Se lo mando mañana?')")
            await pg.evaluate("Rec.prefetch(__app.offlineAudio())"); await ctx.set_offline(True)
            info = await pg.evaluate(f"""(async () => {{ const r = await fetch('{clip}'); const u = URL.createObjectURL(await r.blob()); const a = new Audio(); a.src = u;
              await new Promise((ok, no) => {{ a.onloadedmetadata = ok; a.onerror = () => no(new Error('decode')); setTimeout(ok, 4000); }}); return [r.status, a.duration]; }})()""")
            await pg.reload(); await pg.wait_for_selector('#go, .stone', timeout=10000)
            man_off = await pg.evaluate("!!(window.Rec && Rec.man)"); await ctx.set_offline(False)
            check(info[0] == 200 and 1 < info[1] < 8, f'offline: the clip comes from the cache and decodes as real audio ({info[0]}, {info[1]:.2f} s)')
            check(man_off, 'offline reload still has the audio manifest (precached with the app)')
            await ctx.close()
        await b.close()
    print('\nALL PASS' if ok_all else '\nSOME CHECKS FAILED'); sys.exit(0 if ok_all else 1)
asyncio.run(main())
