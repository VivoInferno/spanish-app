"""v9.8 short dictation: "type what you hear" never plays more than 7 words (aim 4-7). A long example sentence has a
short `dict` chunk with the same target word; only dictation uses it (cloze, tiles, say-it keep the full sentence).
Grading stays tolerant (accents, capitals, punctuation). 🐢 slow replay is there. Screenshot: screens/v98-dictation.png.
Also v9.8: after every listen (say-it, repeat-after-me, 🎤 voice build) the mic is fully released and Safari's audio session goes
back to 'playback' (iOS was left on the low-quality phone-call route until the lesson ended)."""
import asyncio, json, sys, os, re
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'v8_e2e.py')).read().split('async def main')[0]
exec(src)

MIC_MOCK = """
window.__m = { starts: 0, stops: 0, aborts: 0, live: 0, typeAtStart: [], mode: 'ok', say: '', gum: 0, tracks: [], audios: 0 };
window.__sessLog = [];
(() => { let t = 'auto'; Object.defineProperty(navigator, 'audioSession', { configurable: true, value: { get type() { return t; }, set type(v) { t = v; __sessLog.push(v); } } }); })();
if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { __m.gum++; const tr = { readyState: 'live', stop() { this.readyState = 'ended'; } }; __m.tracks.push(tr); return { getTracks: () => [tr], getAudioTracks: () => [tr] }; };
const _A = window.Audio; window.Audio = function (...a) { __m.audios++; return new _A(...a); }; window.Audio.prototype = _A.prototype;
class MicSR { start() { __m.starts++; __m.live++; this._live = true; __m.typeAtStart.push(navigator.audioSession.type);
    if (__m.mode === 'hang') return;
    setTimeout(() => { if (!this._live) return; const res = [{ transcript: __m.say, confidence: 0.9 }]; res.isFinal = true; this.onresult && this.onresult({ results: [res], resultIndex: 0 }); this._end(); }, 80); }
  _end() { if (this._live) { this._live = false; __m.live--; } this.onend && this.onend(); }
  stop() { __m.stops++; if (this._live) { this._live = false; __m.live--; } }
  abort() { __m.aborts++; if (this._live) { this._live = false; __m.live--; } } }
window.SpeechRecognition = MicSR; window.webkitSpeechRecognition = MicSR;
"""
NW = lambda t: len([x for x in re.sub(r'[¿?¡!.,;:“”"]', '', t).split() if x])

async def main():
    async with async_playwright() as p:
        b = await (p.webkit if ENGINE == 'webkit' else p.chromium).launch()
        V7 = strip_meta(json.load(open(FIX + 'v7-export.json')))
        V97 = dict(V7, settings=dict(V7['settings'], voice='', voice2='', voiceMode='recorded', anim=True)); V97['schema'] = 5; V97['speakPauseUntil'] = 0
        V97['parked'] = {}; V97['rulesSeen'] = {}; V97['pace'] = {}; V97['focusLog'] = []; V97['wordPractice'] = {'u1': 1, 'u2': 1, 'ta1': 1}; V97['wpMigrated'] = 1
        V97['path'] = json.loads(json.dumps(V7['path'])); V97['path']['done']['ta1'] = [True, True, True, True]
        ctx = await new_ctx(b, p, V97, sr=False, device=False)
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL); await pg.wait_for_selector('.stone'); await pg.wait_for_timeout(400)
        s = await pg.evaluate("__app.state")
        check(await pg.evaluate("__app.version") == 'v9.8' and s['items'] == V97['items'] and s['path'] == V97['path'] and s['wordPractice'] == V97['wordPractice'] and s['daily'] == V97['daily'],
              'v9.7 data → v9.8 losslessly (items, path, word practice, daily)')

        # ---------- 1. every dictation item, every unit ----------
        r = await pg.evaluate("""(() => { const out = { max: 0, long: [], n: 0, dict: 0, wrongAns: 0 };
          __app.content.units.forEach(u => u.sentences.forEach(s => { const ex = __app.makeExercise({ id: 'w:' + s.k, ex: 'listenS', sent: s }); out.n++;
            const n = ex.listen.replace(/[¿?¡!.,;:“”"]/g, '').split(/\\s+/).filter(Boolean).length; out.max = Math.max(out.max, n); if (n > 7) out.long.push(ex.listen);
            if (s.dict) out.dict += ex.listen === s.dict.es ? 1 : 0; if (ex.answers[0] !== ex.listen || ex.reveal.es !== ex.listen) out.wrongAns++; }));
          return out; })()""")
        check(r['max'] <= 7 and not r['long'], f"all {r['n']} sentence dictations are 7 words or fewer (max {r['max']}) {r['long'][:3]}")
        check(r['dict'] >= 100 and r['wrongAns'] == 0, f"long sentences dictate their short chunk ({r['dict']}); answer and reveal match what is played")
        # random dictation in every kind of session (word-level + sentence-level, any card strength)
        r2 = await pg.evaluate("""(() => { let max = 0, n = 0; const C = __app.content, S = __app.state;
          for (let i = 0; i < 1500; i++) { const u = C.units[i % C.units.length], w = u.words[i % u.words.length]; const id = 'w:' + w.id; const keep = S.items[id];
            S.items[id] = Object.assign({}, keep || { s: 1, d: 5, due: 0, reps: 1, lapses: 0, last: 0, state: 2 }, { s: i % 2 ? 20 : 1 });
            const ex = __app.makeExercise({ id, ex: i % 3 ? 'listenS' : 'listen' }); if (keep) S.items[id] = keep; else delete S.items[id];
            if (ex.audio && ex.kind === 'type') { n++; max = Math.max(max, ex.listen.replace(/[¿?¡!.,;:“”"]/g, '').split(/\\s+/).filter(Boolean).length); } }
          return { max, n }; })()""")
        check(r2['n'] > 1000 and r2['max'] <= 7, f"{r2['n']} random dictations (words + sentences): max {r2['max']} words")
        modes = {}
        for uid, st, mode in [('u4', 'w', 'words'), ('u3', 2, 'practice'), ('u3', 3, 'test')]:
            await pg.evaluate(f"__app.openStone('{uid}', {json.dumps(st)})"); await pg.wait_for_timeout(250)
            m = await pg.evaluate("""(() => { let max = 0, n = 0; __app.run.queue.forEach(e => { if (!e.id || !e.id.startsWith('w:')) return;
                for (const t of ['listen', 'listenS']) { const ex = __app.makeExercise(Object.assign({}, e, { ex: t })); if (ex.audio && ex.kind === 'type') { n++; max = Math.max(max, ex.listen.replace(/[¿?¡!.,;:“”"]/g, '').split(/\\s+/).filter(Boolean).length); } } });
                return { mode: __app.run.mode, max, n }; })()""")
            modes[mode] = m; await pg.click('#quit'); await pg.wait_for_selector('.stone')
        check(all(m['max'] <= 7 and m['n'] > 0 for m in modes.values()), f"Word practice, Practice and the Unit test: dictation ≤ 7 words ({modes})")
        story = await pg.evaluate("__app.content.units.every(u => !u.story.lines.some(l => l.dict))")
        check(story, 'stories have no type-what-you-hear (nothing to shorten there)')
        # ---------- 2. other drills keep the full sentence ----------
        cl = await pg.evaluate("""(() => { const s = __app.content.units.find(u => u.id === 'u3').sentences[1]; const c = __app.makeExercise({ id: 'w:' + s.k, ex: 'cloze', sent: s });
            const b = __app.makeExercise({ id: 'w:' + s.k, ex: 'build', sent: s }); return { cloze: c.clozeEs, build: b.answers[0], full: s.es }; })()""")
        check(cl['cloze'] == cl['full'].replace('presupuesto', '_____') and cl['build'] == cl['full'], 'cloze and tiles still use the full original sentence')

        # ---------- 3. UI: dictation of a formerly long sentence, tolerant grading, slow replay ----------
        sent = await pg.evaluate("__app.content.units.find(u => u.id === 'u3').sentences[1]")
        await pg.evaluate("__app.openStone('u3', 2)"); await pg.wait_for_selector('.card'); await pg.wait_for_timeout(200)
        while await pg.evaluate("!!(__app.entry && (__app.entry.rule || __app.entry.theme))"): await pg.click('#go'); await pg.wait_for_timeout(150)
        await pg.evaluate(f"(() => {{ const r = __app.run; r.answered = false; r.queue[r.i] = Object.assign({{}}, r.queue[r.i], {{ id: 'w:{sent['k']}', key: 990001 }}); __app.forceEx('listenS', {json.dumps(sent)}); }})()")
        await pg.wait_for_selector('#ans')
        ui = await pg.evaluate("({ listen: __app.ex.listen, play: !!document.getElementById('play'), slow: !!document.getElementById('slow'), label: __app.ex.label })")
        check(ui['listen'] == 'Mándame el presupuesto antes de la junta.' and ui['play'] and ui['slow'], f"plays the short chunk “{ui['listen']}” with 🔊 Play and 🐢 Slow")
        await pg.click('#slow')
        await pg.wait_for_timeout(400)
        await pg.fill('#ans', 'mandame el presupuesto antes de la junta')
        if ENGINE == 'webkit': await pg.wait_for_timeout(300)
        await pg.click('#check'); await pg.wait_for_selector('#fb .feedback')
        good = await pg.evaluate("!!document.querySelector('#fb .feedback.good')")
        check(good, 'no accent, no capital, no period: still correct (grading as tolerant as before)')
        await pg.wait_for_timeout(500)
        if ENGINE == 'webkit': await pg.screenshot(path=f'{OUT}/v98-dictation.png')
        else: await pg.screenshot(path=f'{OUT}/v98-dictation-{ENGINE}.png')
        await pg.click('#next'); await pg.wait_for_timeout(150)
        await pg.evaluate(f"(() => {{ const r = __app.run; r.answered = false; r.queue[r.i] = Object.assign({{}}, r.queue[r.i], {{ id: 'w:{sent['k']}', key: 990002 }}); __app.forceEx('listenS', {json.dumps(sent)}); }})()")
        await pg.wait_for_selector('#ans'); await pg.fill('#ans', 'mandame el presupuesto despues de la junta'); await pg.click('#check'); await pg.wait_for_selector('#fb .feedback')
        check(await pg.evaluate("!!document.querySelector('#fb .feedback.miss')"), 'a wrong word is still wrong')
        await pg.click('#next'); await pg.wait_for_timeout(150); await pg.click('#quit'); await pg.wait_for_selector('.stone')

        # ---------- 4. mic release: audio session back to playback after every listen ----------
        ctx2 = await new_ctx(b, p, V97, sr=False, device=False); await ctx2.add_init_script(MIC_MOCK)
        pg = await ctx2.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL); await pg.wait_for_selector('.stone'); await pg.wait_for_timeout(300)
        word = await pg.evaluate("__app.content.units.find(u => u.id === 'u3').sentences.find(s => s.es.split(' ').length <= 9)")
        await pg.evaluate("__app.openStone('u3', 2)"); await pg.wait_for_selector('.card'); await pg.wait_for_timeout(200)
        while await pg.evaluate("!!(__app.entry && (__app.entry.rule || __app.entry.theme))"): await pg.click('#go'); await pg.wait_for_timeout(150)
        async def fresh(ex, key):
            await pg.evaluate(f"(() => {{ const r = __app.run; r.answered = false; r.queue[r.i] = Object.assign({{}}, r.queue[r.i], {{ id: 'w:{word['k']}', key: {key} }}); __app.forceEx('{ex}', {json.dumps(word)}); }})()")
            await pg.wait_for_timeout(120)
        async def state():
            return await pg.evaluate("({ log: __sessLog.slice(), type: navigator.audioSession.type, live: __m.live, open: __app.micOpen, rec: __app.recActive, starts: __m.starts, at: __m.typeAtStart.slice(), gum: __m.gum, tracksLive: __m.tracks.filter(t => t.readyState === 'live').length })")
        results = []
        # (a) repeat-after-me (say it), a right answer
        await fresh('speak', 991001); await pg.wait_for_selector('#mic')
        await pg.evaluate(f"__m.say = {json.dumps(re.sub(r'[¿?¡!.,;:“”"]', '', word['es']).lower())}; __sessLog.length = 0")
        await pg.click('#mic'); await pg.wait_for_timeout(500)
        st = await state(); results.append(('say it', st))
        check(st['at'][-1] == 'play-and-record' and st['log'] == ['play-and-record', 'playback'] and st['type'] == 'playback' and st['live'] == 0 and not st['open'] and not st['rec'],
              f"repeat-after-me: session play-and-record only while listening, back to playback after; recogniser released ({st['log']})")
        # next tap: the <audio> element and the effects AudioContext are rebuilt for the playback route
        before = await pg.evaluate("(window.__c1 = FX.ctx, __m.audios)")
        await pg.click('#next'); await pg.wait_for_timeout(250)
        after = await pg.evaluate("({ audios: __m.audios, newCtx: !window.__c1 || FX.ctx !== window.__c1, oldClosed: !window.__c1 || window.__c1.state === 'closed' })")
        check(after['audios'] > before and after['newCtx'] and after['oldClosed'], f"the next tap builds a fresh audio element + AudioContext ({before} → {after})")
        # (b) 🎤 voice build on a tile drill
        await fresh('build', 991002); await pg.wait_for_selector('#vmic')
        await pg.evaluate(f"__m.say = {json.dumps(re.sub(r'[¿?¡!.,;:“”"]', '', word['es']).lower())}; __sessLog.length = 0")
        await pg.click('#vmic'); await pg.wait_for_timeout(500)
        st = await state(); results.append(('voice build', st))
        check(st['at'][-1] == 'play-and-record' and st['log'] == ['play-and-record', 'playback'] and st['live'] == 0 and not st['open'], f"🎤 voice build: back to playback after the listen ({st['log']})")
        await pg.click('#skip'); await pg.wait_for_timeout(150); await pg.click('#next'); await pg.wait_for_timeout(150)
        # (c) 🎤 on a typed card, stopped by tapping Stop
        await fresh('flip', 991003); await pg.wait_for_selector('#vmic')
        await pg.evaluate("__m.mode = 'hang'; __sessLog.length = 0")
        await pg.click('#vmic'); await pg.wait_for_timeout(200); await pg.click('#vmic'); await pg.wait_for_timeout(2000)
        st = await state(); results.append(('stop tap', st))
        check(st['log'] == ['play-and-record', 'playback'] and st['live'] == 0 and not st['open'] and not st['rec'], f"tap Stop on a hung recogniser: released, back to playback ({st['log']})")
        # (d) quitting the lesson while listening
        await pg.evaluate("__sessLog.length = 0"); await pg.click('#vmic'); await pg.wait_for_timeout(200)
        await pg.click('#quit'); await pg.wait_for_selector('.stone'); await pg.wait_for_timeout(100)
        st = await state(); results.append(('quit', st))
        check(st['log'] == ['play-and-record', 'playback'] and st['live'] == 0 and not st['open'], f"leaving the lesson mid-listen releases the mic ({st['log']})")
        # (e) watchdog timeout
        await pg.evaluate("window.__micTimes = [400, 900, 200]; __m.mode = 'hang'")
        await pg.evaluate("__app.openStone('u3', 2)"); await pg.wait_for_timeout(200)
        while await pg.evaluate("!!(__app.entry && (__app.entry.rule || __app.entry.theme))"): await pg.click('#go'); await pg.wait_for_timeout(150)
        await fresh('speak', 991004); await pg.wait_for_selector('#mic'); await pg.evaluate("__sessLog.length = 0")
        await pg.click('#mic'); await pg.wait_for_timeout(1300)
        st = await state(); results.append(('timeout', st))
        check(st['log'] == ['play-and-record', 'playback'] and st['live'] == 0 and not st['open'], f"watchdog timeout: released, back to playback ({st['log']})")
        check(st['gum'] == 0 and st['tracksLive'] == 0, 'no getUserMedia stream or level meter is ever opened (no tracks left live)')
        await pg.click('#quit')
        check(not errs, f'no page errors {errs[:3]}')
        await b.close()
    print('ALL PASS' if ok_all else 'SOME FAILED'); sys.exit(0 if ok_all else 1)

asyncio.run(main())
