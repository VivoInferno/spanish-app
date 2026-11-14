"""v8: tile placeholders, speech-bubble prompts with tap hints + new-word highlight, 3-choice word picker (both directions),
repeat-after-me speaking drill (mocked SpeechRecognition: success, retry, permission denied, unavailable, Can't speak now + pill),
flip cards (check + flip = miss), synonym credit with Mexican-usage notes, voice choice (Mónica first on the iPhone list, Settings picker),
lossless migration from v4 / v5 / v7 exports, test still 12 + 3. Screenshots: screens/v8-*.png (WebKit iPhone 15)."""
import asyncio, json, sys, os, re
from playwright.async_api import async_playwright
import os as _os, sys as _sys; _sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__))); import wkshim  # box WebKit can't decode MP3
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8787/'
ENGINE = sys.argv[2] if len(sys.argv) > 2 else 'chromium'
OUT = '/workspace/spanish-app/screens'; os.makedirs(OUT, exist_ok=True)
KEY = 'spanish-app-state-v1'
FIX = '/workspace/spanish-app/tests/fixtures/'
ok_all = True
def check(cond, msg):
    global ok_all
    print(('PASS ' if cond else 'FAIL ') + msg); ok_all = ok_all and bool(cond)
def shot(name): return f'{OUT}/{name}.png' if ENGINE == 'webkit' else f'{OUT}/{name}-{ENGINE}.png'
strip_meta = lambda d: {k: v for k, v in d.items() if k not in ('exportedAt', 'app', 'appVersion')}

MOCK_SR = """
window.__sr = { say: null, error: null, starts: 0, lang: null };
class MockSR { start() { __sr.starts++; __sr.lang = this.lang; __sr.maxAlt = this.maxAlternatives; setTimeout(() => {
    if (__sr.error) { this.onerror && this.onerror({ error: __sr.error }); this.onend && this.onend(); return; }
    const res = [].concat(__sr.say || '').map(t => ({ transcript: t, confidence: 0.9 }));
    this.onresult && this.onresult({ results: [res], resultIndex: 0 }); this.onend && this.onend(); }, 60); }
  stop() {} abort() {} }
window.SpeechRecognition = MockSR; window.webkitSpeechRecognition = MockSR;
"""
NO_SR = "delete window.SpeechRecognition; delete window.webkitSpeechRecognition"
MOCK_TTS = """
// automation taps are deliberate: same as Chromium (navigator.webdriver), so the 450 ms double-tap guard stays out of the way
try { if (!navigator.webdriver) Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => true, configurable: true }); } catch (e) {}
window.__voices = []; window.__spoken = [];
const mk = (name, lang, uri) => ({ name, lang, voiceURI: uri || name, localService: true, default: false });
window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; this.lang = ''; this.voice = null; this.rate = 1; } };
if (window.speechSynthesis) {
  const def = (k, f) => { for (const o of [speechSynthesis, Object.getPrototypeOf(speechSynthesis)]) try { Object.defineProperty(o, k, { value: f, configurable: true, writable: true }); } catch (e) {} };
  def('getVoices', () => window.__voices);
  def('speak', u => { window.__spoken.push({ text: u.text, voice: u.voice && u.voice.name, lang: u.lang, pitch: u.pitch }); });
  def('cancel', () => {});
  // default = what Colby's iPhone web app actually lists (v8.1): Mónica + Paulina (+ an English voice). Tests can set __voiceList first.
  setTimeout(() => { window.__voices = (window.__voiceList || [['Mónica', 'es-ES'], ['Paulina', 'es-MX'], ['Samantha', 'en-US']]).map(a => mk(...a));
    try { speechSynthesis.dispatchEvent(new Event('voiceschanged')); } catch (e) {} }, 400);
}
"""

async def new_ctx(b, p, fixture=None, sr=True, device=True):
    dev = dict(p.devices['iPhone 15']) if ENGINE == 'webkit' else dict(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True)
    ctx = await b.new_context(**dev, timezone_id='America/Mexico_City', service_workers='block')
    await ctx.add_init_script(MOCK_SR if sr else NO_SR); await ctx.add_init_script(MOCK_TTS)
    if device:  # v8/v8.1 device-voice checks: hide the v9 recorded-audio manifest so speech goes through Web Speech
        await ctx.route('**/audio/manifest.json', lambda r: r.fulfill(status=200, content_type='application/json', body='{}'))
    if fixture is not None:
        await ctx.add_init_script(f"if (!localStorage.getItem('{KEY}')) localStorage.setItem('{KEY}', {json.dumps(json.dumps(fixture))})")
    return ctx

async def fresh_entry(page, wid, ex, extra=''):
    """put a not-yet-graded word on the current card and render it as exercise type ex"""
    await page.evaluate(f"(() => {{ const r = __app.run; r.answered = false; delete r.firstDone['w:{wid}']; r.queue[r.i] = {{ id: 'w:{wid}' {extra} }}; __app.forceEx('{ex}'); }})()")
    await page.wait_for_timeout(80)

async def main():
    async with async_playwright() as p:
        b = await (p.webkit if ENGINE == 'webkit' else p.chromium).launch()
        errors = []
        # ---------------- migration: v4, v5, v7 exports load losslessly (localStorage and import) ----------------
        for name in ['v4', 'v5', 'v7']:
            raw = strip_meta(json.load(open(FIX + name + '-export.json')))
            ctx = await new_ctx(b, p, raw); page = await ctx.new_page(); page.on('pageerror', lambda e: errors.append(str(e)))
            await page.goto(URL); await page.wait_for_selector('.stone')
            s = await page.evaluate("__app.state"); stored = await page.evaluate(f"JSON.parse(localStorage.getItem('{KEY}'))")
            same = ['items', 'pstats', 'parked', 'placementDone', 'created', 'sessions'] + (['daily', 'streak', 'parkedDefaults'] if name != 'v4' else []) + (['listenPauseUntil'] if name == 'v7' else [])
            diff = [k for k in same if k in raw and s.get(k) != raw[k]]
            pd = [u for u, st in (raw.get('path') or {}).get('done', {}).items() if s['path']['done'].get(u) != st]
            check(not diff and not pd and s['schema'] == 5 and s['speakPauseUntil'] == 0 and s['settings']['voice'] == '' and stored['items'] == raw['items'],
                  f'{name} export → v8 (schema 5) keeps {len(raw["items"])} SRS items, path, settings{", daily, streak" if name != "v4" else ""} under the same key {diff} {pd}')
            ok = await page.evaluate(f"__app.importBackup({json.dumps(json.dumps(json.load(open(FIX + name + '-export.json'))))})")
            s2 = await page.evaluate("__app.state")
            check(ok and s2['items'] == raw['items'] and s2['schema'] == 5, f'{name} export imports via Backup with no loss')
            await ctx.close()

        # ---------------- main session (v7 data, mocked recogniser + voices) ----------------
        V7 = strip_meta(json.load(open(FIX + 'v7-export.json')))
        ctx = await new_ctx(b, p, V7); page = await ctx.new_page(); page.on('pageerror', lambda e: errors.append(str(e)))
        await page.goto(URL); await page.wait_for_selector('.stone')
        check(await page.evaluate("__app.version") == 'v9.3', 'app version is v9.3')
        await page.wait_for_timeout(700)

        # ---- voice choice ----
        check(await page.evaluate("__app.voice && __app.voice.name") == 'Mónica', 'automatic voice = Mónica once voiceschanged fires (iPhone list: Mónica + Paulina)')
        # ---- intro stone of an untouched unit: picker right after a new word, new-word highlight ----
        await page.evaluate("__app.openStone('u10', 0)"); await page.click('#go'); await page.click('#go')
        await page.wait_for_function("__app.ex && __app.ex.kind"); ex = await page.evaluate("__app.ex")
        check(ex['kind'] == 'mc' and ex.get('pick') and len(ex['options']) == 3 and ex['answer'] in ex['options'] and len(set(ex['options'])) == 3, f'first check after a new word is the 3-choice picker ({ex.get("label")})')
        check(await page.locator('.opt.big-opt').count() == 3, 'three large stacked buttons')
        check(await page.locator('.bubble .tok.new').count() >= 1 and 'New word' in (await page.text_content('.newlabel')), 'new word highlighted in the bubble + "New word" label')
        spk = await page.evaluate("__spoken.slice(-1)[0]")
        check(spk and spk['voice'] == 'Mónica', f'lesson audio uses the chosen voice ({spk})')
        await page.click(f'.opt:text-is("{ex["answer"]}")')
        check(await page.query_selector('.feedback.good') is not None, 'correct pick graded correct')
        await page.click('#next')
        # distractors come from the section's vocab, both directions
        dd = await page.evaluate("""(() => { const sec = new Set(__app.content.sections.find(s => s.units).units.flatMap(u => __app.content.units.find(x => x.id === u).words.map(w => w.es)));
            const secEn = new Set(__app.content.units.flatMap(u => u.words.map(w => w.en))); let bad = 0, dirs = new Set();
            for (let r = 0; r < 60; r++) for (const id of ['arreglar', 'junta', 'llanta', 'sobremesa']) { const a = __app.pickExercise(id, false), b = __app.pickExercise(id, true);
              if (a.options.some(o => !sec.has(o)) || new Set(a.options).size !== 3) bad++; if (b.options.some(o => !secEn.has(o)) || new Set(b.options).size !== 3) bad++; dirs.add(!!a.bubbleEn); dirs.add(!b.bubbleEn); }
            return [bad, dirs.size]; })()""")
        check(dd[0] == 0, f'picker distractors are 3 distinct section words, both directions ({dd})')
        await fresh_entry(page, 'retraso', 'pick'); await page.wait_for_timeout(250)
        check(await page.locator('.bubble.en').count() == 1 and await page.locator('.opt.big-opt').count() == 3, 'English word → Spanish picker')
        await page.screenshot(path=shot('v8-word-picker'))

        # ---- speech bubble + hint popover ----
        hs = await page.evaluate("__app.content.units.find(u => u.id === 'u10').sentences.filter(s => s.es.split(' ').length <= 7)[0]")
        await page.evaluate(f"(() => {{ const r = __app.run; r.answered = false; r.queue[r.i] = {{ id: 'w:{hs['k']}' }}; __app.forceEx('buildEn', {json.dumps(hs)}); }})()")
        await page.wait_for_selector('.bubble.es .tok'); await page.wait_for_timeout(500); await page.evaluate("scrollTo(0, 0)")
        deco = await page.evaluate("getComputedStyle(document.querySelector('.bubble .tok')).textDecorationStyle || getComputedStyle(document.querySelector('.bubble .tok')).webkitTextDecorationStyle")
        check(deco == 'dotted', f'Spanish words in the bubble have dotted underlines ({deco})')
        check(await page.locator('.bubble .bubble-spk').count() == 1, 'bubble has a speaker button')
        n0 = await page.evaluate("__spoken.length"); await page.click('.bubble .bubble-spk')
        check(await page.evaluate(f"__spoken.length > {n0} && __spoken.slice(-1)[0].lang.startsWith('es')"), 'speaker plays the Spanish line')
        tok = page.locator('.bubble .tok.new').first if await page.locator('.bubble .tok.new').count() else page.locator('.bubble .tok').first
        word = await tok.inner_text(); await tok.click(); await page.wait_for_timeout(150)
        hint = await page.inner_text('.hint-pop') if await page.query_selector('.hint-pop') else ''
        g = await page.evaluate(f"__app.gloss({json.dumps(word)})")
        check(hint and g and g['en'] in hint, f'tapping "{word}" shows its English hint ({hint!r})')
        await page.screenshot(path=shot('v8-bubble-hint'))
        miss = await page.evaluate("""(() => { const m = []; document.querySelectorAll('.bubble .tok').forEach(t => { if (!__app.gloss(t.dataset.g)) m.push(t.dataset.g); }); return m; })()""")
        check(not miss, f'every word in the bubble has a hint {miss}')
        await page.click('.label'); check(await page.query_selector('.hint-pop') is None, 'tapping elsewhere closes the hint')

        # ---- tile placeholders ----
        sent = await page.evaluate("__app.content.units.find(u => u.id === 'u2').sentences.find(s => s.es.split(' ').length >= 6 && s.es.split(' ').length <= 9)")
        await page.evaluate(f"__app.forceEx('build', {json.dumps(sent)})"); await page.wait_for_selector('#tiles .tile')
        rects = lambda: page.evaluate("[...document.querySelectorAll('#tiles .tile')].map(t => { const r = t.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y + scrollY), Math.round(r.width), Math.round(r.height)]; })")
        await page.wait_for_timeout(600)  # let the card's slide-in animation finish
        r0 = await rects(); bank_y0 = await page.evaluate("document.getElementById('tiles').getBoundingClientRect().top + scrollY")
        want = re.sub(r'[¿?¡!.,;:“”"]', '', sent['es']).split(); tiles = await page.evaluate("__app.ex.tiles"); used = []
        for wt in want[:4]:
            for k, t in enumerate(tiles):
                if k not in used and t == wt: used.append(k); await page.click(f'#tiles .tile[data-k="{k}"]'); break
        r1 = await rects()
        print('   r0', r0[:4], 'r1', r1[:4]); check(r0 == r1 and await page.evaluate("document.getElementById('tiles').getBoundingClientRect().top + scrollY") == bank_y0, 'picking 4 tiles: no tile in the bank moves or resizes')
        ph = await page.evaluate(f"(() => {{ const t = document.querySelector('#tiles .tile[data-k=\"{used[0]}\"]'), cs = getComputedStyle(t); return [t.classList.contains('used'), cs.visibility, cs.color, cs.backgroundColor, cs.pointerEvents]; }})()")
        check(ph[0] and ph[1] == 'visible' and ph[2] in ('rgba(0, 0, 0, 0)', 'transparent') and ph[3] not in ('rgba(0, 0, 0, 0)',) and ph[4] == 'none', f'a picked tile leaves a grey empty slot ({ph})')
        check(await page.locator('#line .tile').count() == 4, 'placed tiles sit on the answer lines')
        await page.screenshot(path=shot('v8-tiles-placeholders'))
        await page.click(f'#line .tile[data-k="{used[1]}"]')
        back = await page.evaluate(f"!document.querySelector('#tiles .tile[data-k=\"{used[1]}\"]').classList.contains('used')")
        n_line = await page.locator('#line .tile').count(); r2 = await rects()
        check(back and n_line == 3 and r2 == r0, f'tapping a placed tile returns it to its slot (bank still unmoved) {back} {n_line} {r2 == r0}')
        lh = await page.evaluate("document.getElementById('line').getBoundingClientRect().height")
        check(lh >= 3 * 45, f'answer area still reserves 3 rows ({lh}px)')

        # ---- flip card ----
        await fresh_entry(page, 'brindar', 'flip'); await page.wait_for_selector('#flipCard')
        check(await page.get_attribute('#ans', 'placeholder') == 'Type in Spanish' and await page.locator('.flipstack').count() == 1 and await page.is_visible('#skip') and await page.is_visible('#check'), 'flip card: English on a card stack, Type in Spanish input, Flip + Check')
        fv = await page.evaluate("['.face.front', '.face.back'].map(q => getComputedStyle(document.querySelector(q)).visibility)")
        check(fv == ['visible', 'hidden'], f'front of the card shows only the English (answer hidden) {fv}')
        await page.screenshot(path=shot('v8-flip-front'))
        await page.fill('#ans', 'brindar'); await page.click('#check')
        check(await page.query_selector('.feedback.good') is not None, 'typed answer on a flip card graded correct')
        await fresh_entry(page, 'anfitrion', 'flip'); await page.wait_for_selector('#flipCard')
        before = await page.evaluate("__app.state.items['w:anfitrion'] || null")
        await page.fill('#ans', 'el anfitrin'); await page.click('#check')
        check(await page.query_selector('.feedback.good .typo') is not None or await page.query_selector('.ok.typo') is not None, 'one-letter typo on a flip card is still correct (v7 rule)')
        await fresh_entry(page, 'soler', 'flip'); await page.wait_for_selector('#flipCard')
        before = await page.evaluate("__app.state.items['w:soler'] || null")
        await page.click('#skip'); await page.wait_for_timeout(700)
        fv = await page.evaluate("['.face.front', '.face.back'].map(q => getComputedStyle(document.querySelector(q)).visibility)")
        check(fv == ['hidden', 'visible'], f'after flipping only the Spanish side shows {fv}')
        after = await page.evaluate("__app.state.items['w:soler']")
        check(await page.evaluate("document.getElementById('flipCard').classList.contains('flipped')") and 'Flipped' in await page.inner_text('.feedback.miss'), 'Flip turns the card over and shows the answer')
        check(after and ((before is None and after['reps'] == 1 and abs(after['s'] - 0.4872) < 1e-3) or (before and after['lapses'] >= before.get('lapses', 0) and after['s'] <= before['s'])), f'flipping counts as a miss for FSRS ({before} → {after})')
        await page.screenshot(path=shot('v8-flip-back'))

        # ---- synonym credit ----
        await fresh_entry(page, 'arreglar', 'en2es'); prev = await page.evaluate("__app.state.items['w:arreglar'] || null")
        await page.fill('#ans', 'reparar'); await page.click('#check')
        fb = await page.inner_text('#fb'); cur = await page.evaluate("__app.state.items['w:arreglar']")
        check('Correct' in fb and 'arreglar is more common' in fb and await page.query_selector('.feedback.good .alt-note') is not None, f'reparar for arreglar: green Correct + Mexican-usage note')
        check((prev is None and abs(cur['s'] - 3.7145) < 1e-3) or (prev and cur['lapses'] == prev['lapses']), f'a synonym is FSRS-correct (Good) ({prev} → {cur})')
        await page.screenshot(path=shot('v8-synonym-note'))
        await fresh_entry(page, 'arreglar', 'listen'); await page.fill('#ans', 'reparar'); await page.click('#check')
        check(await page.query_selector('.feedback.miss') is not None, 'dictation (listen) does not accept a synonym: it targets the form')
        cz = await page.evaluate("""(() => { for (let i = 0; i < 200; i++) { const e = __app.makeExercise({ id: 'w:arreglar', ex: 'cloze' }); if (e.answers[0] === 'arreglaron') return [Check.checkAlt('repararon', e.answers, e.opts, e.alts).result, Check.checkAlt('arreglaron', e.answers, e.opts, e.alts).result]; } return null; })()""")
        check(cz == ['alt', 'exact'], f'cloze blank accepts the conjugated synonym (repararon) ({cz})')

        # ---- repeat after me (mocked recogniser) ----
        SPK = await page.evaluate("__app.content.units.flatMap(u => u.words.filter(w => u.sentences.some(s => s.k === w.id && s.es.split(' ').length >= 3 && s.es.split(' ').length <= 9)).map(w => w.id))")
        print('   words with short sentences:', len(SPK))
        short = await page.evaluate("__app.content.units.find(u => u.id === 'u9').sentences.find(s => s.k === 'llanta' && s.es.split(' ').length <= 9)")
        await fresh_entry(page, 'llanta', 'speak', f", sent: {json.dumps(short)}"); await page.wait_for_selector('#mic')
        check(await page.evaluate("__app.ex.kind") == 'speak' and await page.is_visible('#cantSpeak') and short['es'] in (await page.inner_text('.bubble')).replace('🔊', '').strip(), 'speaking drill: sentence in a bubble, big mic, Can\'t speak now')
        await page.screenshot(path=shot('v8-speaking'))
        prev = await page.evaluate("__app.state.items['w:llanta'] || null")
        await page.evaluate(f"__sr.say = {json.dumps(re.sub(r'[¿?¡!.,;:]', '', short['es']).lower())}"); await page.click('#mic'); await page.wait_for_selector('#fb .feedback')
        cur = await page.evaluate("__app.state.items['w:llanta']")
        check(await page.query_selector('.feedback.good') is not None and await page.evaluate("__sr.lang") == 'es-MX', 'saying the line (no punctuation, lower case) is graded correct; recogniser set to es-MX')
        check(cur and (prev is None or cur['reps'] == prev['reps'] + 1), 'speaking result goes to FSRS')
        await fresh_entry(page, SPK[1], 'speak'); await page.wait_for_selector('#mic')
        await page.evaluate("__sr.say = 'hola buenos días'"); await page.click('#mic'); await page.wait_for_timeout(300)
        check('Try again' in await page.inner_text('#heard') and not await page.evaluate("__app.run.answered"), 'a mismatch shows what was heard and allows a second try')
        await page.click('#mic'); await page.wait_for_selector('#fb .feedback')
        check(await page.query_selector('.feedback.miss') is not None, 'second mismatch is graded wrong')
        # permission denied: silently replaced, no grade
        wb = SPK[2]; await fresh_entry(page, wb, 'speak'); await page.wait_for_selector('#mic'); prev = await page.evaluate(f"__app.state.items['w:{wb}'] || null")
        await page.evaluate("__sr.error = 'not-allowed'; __sr.say = null"); await page.click('#mic'); await page.wait_for_timeout(400)
        k = await page.evaluate(f"[__app.ex.kind, __app.run.answered, __app.speechBlocked, __app.state.items['w:{wb}'] || null]")
        check(k[0] != 'speak' and not k[1] and k[2] and k[3] == prev, f'mic permission denied: drill replaced (v9.1: with a short toast + 🤐 pill), nothing graded ({k[:3]})')
        kinds = await page.evaluate(f"Array.from({{length: 40}}, () => __app.makeExercise({{ id: 'w:{wb}', ex: 'speak' }}).kind)")
        check('speak' not in kinds, 'no more speaking drills this session after a denial')
        await page.evaluate("__app.unblockSpeech(); __sr.error = null")
        # can't speak now
        wr = SPK[3]; await fresh_entry(page, wr, 'speak'); await page.wait_for_selector('#cantSpeak'); prev = await page.evaluate(f"__app.state.items['w:{wr}'] || null")
        await page.click('#cantSpeak'); await page.wait_for_timeout(400)
        k = await page.evaluate(f"[__app.ex.kind, __app.run.answered, __app.speakPaused(), __app.state.items['w:{wr}'] || null, __app.state.speakPauseUntil - Date.now()]")
        check(k[0] != 'speak' and not k[1] and k[2] and k[3] == prev and 590000 < k[4] <= 600000, f"Can't speak now: same item, non-speaking format, no penalty, paused 10 min ({k[0]})")
        check(await page.is_visible('#spInd') and 'min' in await page.inner_text('#spInd'), '🤐 pill shows minutes left')
        kinds = await page.evaluate(f"Array.from({{length: 40}}, () => __app.makeExercise({{ id: 'w:{wr}', ex: 'speak' }}).kind)")
        check('speak' not in kinds, 'no speaking drills while paused')
        await page.click('#spInd'); await page.wait_for_timeout(100)
        check(not await page.evaluate("__app.speakPaused()") and await page.query_selector('#spInd') is None, 'tapping the pill turns speaking back on')
        await page.click('#quit'); await page.wait_for_selector('.stone')

        # ---- the unit test still 12 + 3, with the new formats in it ----
        tq = await page.evaluate("(() => { const out = {}; for (let r = 0; r < 20; r++) { const q = __app.testQueue('u10'); out.len = (out.len || new Set()).add(q.length); out.builds = (out.builds || new Set()).add(q.filter(e => e.ex === 'build').length); q.forEach(e => out[e.ex] = (out[e.ex] || 0) + 1); } out.len = [...out.len]; out.builds = [...out.builds]; return out; })()")
        check(tq['len'] == [15] and tq['builds'] == [3] and all(tq.get(t) for t in ['flip', 'pick', 'speak', 'cloze', 'listen', 'en2es']), f'unit test stays 12 vocab + 3 sentences, using flip / pick / speak / cloze / listen / en2es ({tq})')
        mix = await page.evaluate("""(() => { const c = {}; ['u1','u2','u9','u10'].forEach(u => { for (let r = 0; r < 15; r++) { __app.introQueue(u).forEach(e => { if (e.ex) c['i:' + e.ex] = (c['i:' + e.ex] || 0) + 1; }); __app.practiceQueue(u).forEach(e => { if (e.ex) c['p:' + e.ex] = (c['p:' + e.ex] || 0) + 1; }); } });
            const ids = __app.content.units.flatMap(u => u.words.map(w => w.id)); for (let r = 0; r < 10; r++) ids.forEach(id => { const k = __app.makeExercise({ id: 'w:' + id }); const t = k.pick ? 'pick' : k.flip ? 'flip' : k.kind; c['r:' + t] = (c['r:' + t] || 0) + 1; }); return c; })()""")
        check(all(mix.get(k) for k in ['i:pick', 'i:pickEn', 'i:flip', 'i:speak', 'p:flip', 'p:speak', 'p:pickEn', 'r:pick', 'r:flip', 'r:speak', 'r:build']), f'new drills are mixed into intro, practice and review ({mix})')

        # ---- story: hints on lines + one say-the-line moment ----
        await page.evaluate("__app.openStone('u10', 1)"); await page.wait_for_selector('.story')
        await page.locator('.story .ses .tok').first.click(); await page.wait_for_timeout(120)
        check(await page.query_selector('.hint-pop') is not None, 'story words can be tapped for a hint')
        said = False
        for _ in range(80):
            if await page.query_selector('#ssay #mic'):
                line = await page.evaluate("__app.story.u.story.lines[__app.story.say.after].es")
                await page.evaluate(f"__sr.say = {json.dumps(line)}"); await page.click('#ssay #mic'); await page.wait_for_selector('#ssay .feedback')
                said = said or await page.query_selector('#ssay .feedback.good') is not None
                await page.click('#next'); continue
            if await page.query_selector('.squestion .opt') and not await page.query_selector('.squestion .opt.right'):
                await page.locator('.squestion .opt').first.click()
                if not await page.query_selector('#next'): print('   DEBUG story', (await page.inner_html('main'))[-1500:], await page.inner_html('footer'))
                await page.click('#next'); continue
            if await page.query_selector('#stile') and await page.query_selector('#skip'):
                await page.click('#skip'); await page.click('#next'); continue
            if await page.query_selector('#next'): await page.click('#next')
            if await page.query_selector('.stone'): break
        check(said, 'story has a say-the-line drill, graded with the recogniser')
        check(await page.query_selector('.stone') is not None and await page.evaluate("__app.state.path.done.u10[1]"), 'story completes')
        sv = await page.evaluate("[...new Set(__spoken.map(s => s.voice))]")
        check(set(sv) == {'Mónica', 'Paulina'}, f'lessons + stories use Mónica, with Paulina for the second character ({sv})')

        # ---- Settings voice picker ----
        await page.click('#prog'); await page.wait_for_selector('#voiceSel')
        opts = await page.evaluate("[...document.querySelectorAll('#voiceSel option')].map(o => o.textContent.trim())")
        check(len(opts) == 3 and opts[0].startswith('Automatic') and 'Mónica' in opts[0] and not any('Samantha' in o for o in opts) and opts[1].startswith('Mónica'), f'voice picker lists installed Spanish voices, best first ({opts})')
        await page.select_option('#voiceSel', 'Paulina'); await page.wait_for_timeout(100)
        check(await page.evaluate("__app.state.settings.voice") == 'Paulina' and await page.evaluate("__app.voice.name") == 'Paulina' and await page.evaluate("__spoken.slice(-1)[0].voice") == 'Paulina', 'choosing a voice saves it and speaks a sample with it')
        await page.click('#voiceTest'); check(await page.evaluate("__spoken.slice(-1)[0].voice") == 'Paulina', 'Test button plays the chosen voice')
        await page.screenshot(path=shot('v8-voice-settings'))
        await page.reload(); await page.wait_for_selector('.stone'); await page.wait_for_timeout(800)
        check(await page.evaluate("__app.voice && __app.voice.name") == 'Paulina', 'chosen voice survives a reload')
        await page.click('#prog'); await page.select_option('#voiceSel', ''); await page.wait_for_timeout(100)
        check(await page.evaluate("__app.voice.name") == 'Mónica', 'back to Automatic → Mónica')
        await ctx.close()

        # ---------------- no recogniser (some iOS builds / standalone PWA): speaking drills never appear ----------------
        ctx = await new_ctx(b, p, V7, sr=False); page = await ctx.new_page(); page.on('pageerror', lambda e: errors.append(str(e)))
        await page.goto(URL); await page.wait_for_selector('.stone')
        kinds = await page.evaluate("Array.from({length: 60}, (_, i) => __app.makeExercise({ id: 'w:' + ['llanta','arreglar','junta'][i % 3], ex: 'speak' }).kind)")
        check('speak' not in kinds and not await page.evaluate("__app.speakOk()"), f'no SpeechRecognition: speak items silently become other drills ({sorted(set(kinds))})')
        await page.evaluate("__app.openStone('u10', 1)"); await page.wait_for_selector('.story')
        check(await page.evaluate("__app.story.say") is None, 'no say-the-line in stories without a recogniser')
        await ctx.close()
        check(not errors, f'no page errors {errors[:3]}')
        await b.close()
    print('\nALL PASS' if ok_all else '\nSOME CHECKS FAILED'); sys.exit(0 if ok_all else 1)
asyncio.run(main())
