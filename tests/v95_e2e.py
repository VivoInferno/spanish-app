"""v9.5: (1) numbers: digits and Spanish number words are the same answer (ciento cincuenta = 150), with a quiet
"Also written: 150" note; (2) Undo after hiding a word (Too easy · hide for months, I already know this, Not a priority):
a 7 s snackbar above the footer that restores the SRS card, the park entry (g:<word> too) and the lesson queue, plus a
Recently hidden list in Progress and long-press Unhide; (3) voice input: a 🎤 Say it button next to Check on typed cards
(live interim text, editable, never auto-submitted) and tile builders (heard words glide onto the matching tiles, unmatched
words shown), hidden by the 🤐 pause and when the mic is refused. Lossless v9.x → v9.5.
Screenshots (WebKit iPhone 15): screens/v95-number-note.png, screens/v95-undo-toast.png, screens/v95-voice-build.png."""
import asyncio, json, sys, os, re
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'v8_e2e.py')).read().split('async def main')[0]
exec(src)

VMOCK = """
// interim + final results, like iOS: __sr.script = [[ms, text, final], ...]; __sr.error = 'not-allowed' to refuse
window.__sr = { script: null, error: null, starts: 0, lang: null, interim: null, inst: null };
class VSR { start() { __sr.starts++; __sr.lang = this.lang; __sr.interim = this.interimResults; __sr.inst = this; const me = this;
    if (__sr.error) { setTimeout(() => { me.onerror && me.onerror({ error: __sr.error }); me.onend && me.onend(); }, 40); return; }
    (__sr.script || []).forEach(([ms, t, fin]) => setTimeout(() => { const r = [{ transcript: t, confidence: 0.9 }]; r.isFinal = !!fin;
      me.onresult && me.onresult({ results: [r], resultIndex: 0 }); if (fin) me.onend && me.onend(); }, ms)); }
  stop() { setTimeout(() => this.onend && this.onend(), 20); } abort() {} }
window.SpeechRecognition = VSR; window.webkitSpeechRecognition = VSR;
"""

async def answer(pg, right=True):
    """answer the card on screen (right or wrong). Returns False when the run is over."""
    e = await pg.evaluate("__app.run && __app.entry")
    if not e: return False
    if e.get('theme') or e.get('intro') or e.get('rule'):
        await pg.click('#go'); await pg.wait_for_timeout(120); return True
    ex = await pg.evaluate("({kind: __app.ex.kind, answer: __app.ex.answer, answers: __app.ex.answers, tiles: __app.ex.tiles})")
    if ex['kind'] == 'mc':
        opts = await pg.query_selector_all('.opt'); texts = [await o.inner_text() for o in opts]
        await opts[texts.index(ex['answer']) if right else next(i for i, t in enumerate(texts) if t != ex['answer'])].click()
    elif ex['kind'] == 'build':
        if right:
            used = set()
            for wtok in re.sub(r'[¿?¡!.,;:]', '', ex['answers'][0]).split():
                for k, t in enumerate(ex['tiles']):
                    if k not in used and t == wtok: used.add(k); await pg.click(f'#tiles .tile[data-k="{k}"]'); break
            await pg.click('#check')
        else: await pg.click('#skip')
    elif ex['kind'] == 'speak': await pg.click('#cantSpeak'); await pg.wait_for_timeout(300); return True
    else:
        if right: await pg.fill('#ans', ex['answers'][0]); await pg.click('#check')
        else: await pg.click('#skip')
    await pg.wait_for_selector('#next'); await pg.click('#next'); await pg.wait_for_timeout(60); return True

async def main():
    async with async_playwright() as p:
        b = await (p.webkit if ENGINE == 'webkit' else p.chromium).launch()
        V7 = strip_meta(json.load(open(FIX + 'v7-export.json')))
        V9 = dict(V7, settings=dict(V7['settings'], voice='', voice2='', voiceMode='recorded', anim=True)); V9['schema'] = 5; V9['speakPauseUntil'] = 0
        V9['parked'] = {'g:costera': {'at': 1, 'word': 'costera'}}; V9['rulesSeen'] = {}; V9['pace'] = {}
        ctx = await new_ctx(b, p, V9, sr=False); await ctx.add_init_script(VMOCK)
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL); await pg.wait_for_selector('.stone'); await pg.wait_for_timeout(400)
        s = await pg.evaluate("__app.state")
        check(await pg.evaluate("__app.version") == 'v9.6' and s['items'] == V9['items'] and s['path'] == V9['path'] and s['daily'] == V9['daily']
              and s['streak'] == V9['streak'] and s['parked'] == V9['parked'] and s['hidden'] == [], 'v9.x data → v9.5 losslessly (items, path, daily, streak, g: parks; hidden = [])')

        # ---------- 1. numbers ----------
        await pg.evaluate("__app.openStone('u4', 2)"); await pg.wait_for_selector('.card'); await pg.wait_for_timeout(200)
        await pg.evaluate("__app.state.rulesSeen = Object.fromEntries(Object.keys(__app.content.patterns).map(k => [k, 1]))")
        await fresh_entry(pg, 'caseta', 'listenS'); await pg.wait_for_selector('#ans')
        await pg.evaluate("__app.ex.answers = ['Pagamos 150 pesos por la caseta.']")
        await pg.fill('#ans', 'Pagamos ciento cincuenta pesos por la caseta'); await pg.click('#check'); await pg.wait_for_selector('#fb .feedback')
        nn = await pg.evaluate("({ good: !!document.querySelector('#fb .feedback.good'), note: (document.querySelector('#fb .also-written') || {}).textContent, res: __app.ex.res })")
        check(nn['good'] and nn['res']['result'] == 'exact' and nn['note'] == 'Also written: 150', f'“ciento cincuenta” for 150: correct + quiet “Also written: 150” ({nn["note"]})')
        if ENGINE == 'webkit': await pg.wait_for_timeout(900); await pg.screenshot(path=f'{OUT}/v95-number-note.png')
        await pg.wait_for_timeout(500); await pg.click('#next'); await pg.wait_for_timeout(250)
        await fresh_entry(pg, 'caseta', 'listenS'); await pg.wait_for_selector('#ans')
        await pg.evaluate("__app.ex.answers = ['Pagamos ciento cincuenta pesos por la caseta.']")
        await pg.fill('#ans', 'Pagamos $150 por la caseta'); await pg.click('#check'); await pg.wait_for_selector('#fb .feedback')
        nn = await pg.evaluate("({ good: !!document.querySelector('#fb .feedback.good'), note: (document.querySelector('#fb .also-written') || {}).textContent })")
        check(nn['good'] and nn['note'] == 'Also written: ciento cincuenta', f'“$150” for “ciento cincuenta pesos”: correct, note shows the words ({nn["note"]})')
        await pg.wait_for_timeout(500); await pg.click('#next'); await pg.wait_for_timeout(250)
        await fresh_entry(pg, 'caseta', 'listenS'); await pg.wait_for_selector('#ans')
        await pg.evaluate("__app.ex.answers = ['Pagamos 150 pesos por la caseta.']")
        await pg.fill('#ans', 'Pagamos ciento cincuenta y uno pesos por la caseta'); await pg.click('#check'); await pg.wait_for_selector('#fb .feedback')
        check(await pg.query_selector('#fb .feedback.miss') is not None, 'a different number (151 for 150) is still wrong')
        await pg.wait_for_timeout(500); await pg.click('#next'); await pg.wait_for_timeout(250)

        # gender / number agreement: correct + quiet "Natural:" note; a person change is still wrong
        for typed, want, good in (('La cotización ya está hecho; ahorita se los mando', 'La cotización ya está hecha; ahorita se la mando.', True),
                                  ('La cotización ya está hecha; ahorita me la mando', 'La cotización ya está hecha; ahorita se la mando.', False)):
            await fresh_entry(pg, 'caseta', 'listenS'); await pg.wait_for_selector('#ans')
            await pg.evaluate(f"__app.ex.answers = [{json.dumps(want)}]; __app.ex.reveal = {{ es: {json.dumps(want)}, en: 'The quote is ready; I’ll send it to you right away.' }}; __app.ex.speakAfter = {json.dumps(want)}")
            await pg.fill('#ans', typed); await pg.click('#check'); await pg.wait_for_selector('#fb .feedback')
            r = await pg.evaluate("({ good: !!document.querySelector('#fb .feedback.good'), note: (document.querySelector('#fb .natural') || {}).textContent || '', res: __app.ex.res.result })")
            if good: check(r['good'] and r['res'] == 'agree' and r['note'].startswith('Natural: La cotización ya está hecha'), f'gender slip (hecho / se los) counts, with “{r["note"]}”')
            else: check(not r['good'], 'se → me (who gets it) is still wrong')
            if good and ENGINE == 'webkit': await pg.wait_for_timeout(800); await pg.screenshot(path=f'{OUT}/v95-natural-note.png')
            await pg.wait_for_timeout(500); await pg.click('#next'); await pg.wait_for_timeout(250)
        # ---------- 2. Undo: Too easy · hide for months ----------
        await fresh_entry(pg, 'caseta', 'en2es'); await pg.wait_for_selector('#ans')
        await pg.fill('#ans', await pg.evaluate("__app.ex.answers[0]")); await pg.click('#check'); await pg.wait_for_selector('#easy')
        before = await pg.evaluate("JSON.stringify(__app.state.items['w:caseta'])")
        await pg.wait_for_timeout(500); await pg.click('#easy'); await pg.wait_for_selector('#undo-toast .undo-btn'); await pg.wait_for_timeout(300)
        hid = await pg.evaluate("__app.state.items['w:caseta']")
        geo = await pg.evaluate("""(() => { const t = document.getElementById('undo-toast'), u = t.querySelector('.undo-btn').getBoundingClientRect(), r = t.getBoundingClientRect(),
            f = document.querySelector('footer'), fr = f && f.getBoundingClientRect(); return { msg: t.textContent, bw: u.width, bh: u.height, bottom: r.bottom, ftop: fr ? fr.top : innerHeight, vh: innerHeight,
            free: [...(f ? f.querySelectorAll('button') : [])].every(b => { const q = b.getBoundingClientRect(), e = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return e === b || b.contains(e); }) }; })()""")
        check(hid['known'] and 'hidden for months' in geo['msg'], f'Too easy → hidden for months + Undo snackbar ({geo["msg"]})')
        check(geo['bw'] >= 44 and geo['bh'] >= 44 and geo['bottom'] <= geo['ftop'] + 1 and geo['free'], f'Undo is a big target (≥44 px) above the footer, footer buttons uncovered ({geo})')
        if ENGINE == 'webkit': await pg.screenshot(path=f'{OUT}/v95-undo-toast.png')
        await pg.click('#undo-toast .undo-btn'); await pg.wait_for_timeout(200)
        after = await pg.evaluate("JSON.stringify(__app.state.items['w:caseta'])")
        check(after == before and await pg.evaluate("__app.state.hidden.length") == 0, 'Undo restores the exact SRS card from before the hide')
        # the snackbar goes away on its own
        await fresh_entry(pg, 'caseta', 'en2es'); await pg.fill('#ans', await pg.evaluate("__app.ex.answers[0]")); await pg.click('#check'); await pg.wait_for_selector('#easy')
        await pg.wait_for_timeout(500); await pg.click('#easy'); await pg.wait_for_selector('#undo-toast')
        await pg.wait_for_timeout(7600)
        check(await pg.query_selector('#undo-toast') is None, 'the snackbar disappears after ~7 s')

        # ---------- 3. Undo: Not a priority (course word, current card) ----------
        await fresh_entry(pg, 'llanta', 'en2es'); await pg.wait_for_selector('#ans')
        await pg.evaluate("__app.run.queue.splice(__app.run.i + 2, 0, { id: 'w:llanta', practice: true })")
        qlen = await pg.evaluate("__app.run.queue.filter(e => e.id === 'w:llanta').length")
        await pg.evaluate("(() => { const el = document.querySelector('[data-w=\"llanta\"]'); })()")
        await pg.evaluate("__app.openWordMenu ? __app.openWordMenu('llanta', 200, 300) : null")
        has_menu = await pg.query_selector('#wm-act')
        if has_menu:
            await pg.click('#wm-act'); await pg.wait_for_selector('#undo-toast .undo-btn')
            st = await pg.evaluate("({ parked: !!__app.state.parked.llanta, q: __app.run.queue.slice(__app.run.i).filter(e => e.id === 'w:llanta').length, msg: document.getElementById('undo-toast').textContent })")
            check(st['parked'] and st['q'] == 0 and 'parked until C2' in st['msg'], f'Not a priority parks it, skips the card and offers Undo ({st})')
            await pg.click('#undo-toast .undo-btn'); await pg.wait_for_timeout(200)
            st = await pg.evaluate("({ parked: !!__app.state.parked.llanta, q: __app.run.queue.slice(__app.run.i).filter(e => e.id === 'w:llanta').length })")
            check(not st['parked'] and st['q'] == qlen, f'Undo unparks it and puts its {qlen} cards back in the lesson ({st})')
            # g: word (not a course word)
            await pg.evaluate("__app.openWordMenu('g:hamaca', 200, 300, 'hamaca')"); await pg.click('#wm-act'); await pg.wait_for_selector('#undo-toast .undo-btn')
            check(await pg.evaluate("!!__app.state.parked['g:hamaca']"), 'a non-course word is parked as g:hamaca')
            await pg.click('#undo-toast .undo-btn'); await pg.wait_for_timeout(150)
            check(await pg.evaluate("!__app.state.parked['g:hamaca'] && !!__app.state.parked['g:costera']"), 'Undo removes the g:hamaca entry (other g: parks untouched)')
        else:
            check(False, 'openWordMenu exposed on __app')

        # ---------- 4. Recently hidden in Progress + long-press Unhide ----------
        await fresh_entry(pg, 'caseta', 'en2es'); await pg.fill('#ans', await pg.evaluate("__app.ex.answers[0]")); await pg.click('#check'); await pg.wait_for_selector('#easy')
        before = await pg.evaluate("JSON.stringify(__app.state.items['w:caseta'])")
        await pg.wait_for_timeout(500); await pg.click('#easy'); await pg.wait_for_timeout(200)
        await pg.evaluate("__app.openWordMenu('g:hamaca', 200, 300, 'hamaca')"); await pg.click('#wm-act'); await pg.wait_for_timeout(200)
        await pg.click('#quit'); await pg.wait_for_selector('.stone'); await pg.click('#prog'); await pg.wait_for_selector('#parked')
        rh = await pg.evaluate("[...document.querySelectorAll('#recent-hidden li')].map(li => li.textContent)")
        first_is_list = await pg.evaluate("(() => { const h = [...document.querySelectorAll('h3')].find(x => x.textContent === 'Parked words'); const n = h && h.nextElementSibling; return !!n && n.classList.contains('recent-head'); })()")
        check(len(rh) == 2 and 'hamaca' in rh[0] and 'caseta' in rh[1] and 'hidden for months' in rh[1] and first_is_list, f'Progress: Recently hidden at the top of Parked words, newest first ({rh})')
        await pg.click('#recent-hidden li:nth-child(2) .unhide'); await pg.wait_for_timeout(150)
        check(await pg.evaluate("JSON.stringify(__app.state.items['w:caseta'])") == before, 'Unhide restores the hidden-for-months card')
        await pg.click('#recent-hidden .unhide'); await pg.wait_for_timeout(150)
        check(await pg.evaluate("!__app.state.parked['g:hamaca'] && !document.querySelector('#recent-hidden')"), 'Unhide brings back the parked g: word too; list empties')
        await pg.click('#back'); await pg.wait_for_selector('.stone')
        # long-press menu on a word hidden for months
        await pg.evaluate("__app.openStone('u4', 2)"); await pg.wait_for_selector('.card'); await pg.wait_for_timeout(200)
        await fresh_entry(pg, 'caseta', 'en2es'); await pg.fill('#ans', await pg.evaluate("__app.ex.answers[0]")); await pg.click('#check'); await pg.wait_for_selector('#easy')
        before = await pg.evaluate("JSON.stringify(__app.state.items['w:caseta'])")
        await pg.wait_for_timeout(500); await pg.click('#easy'); await pg.wait_for_timeout(200)
        await pg.evaluate("__app.openWordMenu('caseta', 200, 300)"); await pg.wait_for_selector('#wm-unhide')
        await pg.click('#wm-unhide'); await pg.wait_for_timeout(150)
        check(await pg.evaluate("JSON.stringify(__app.state.items['w:caseta'])") == before and await pg.evaluate("!__app.state.hidden.some(h => h.id === 'w:caseta')"), 'long-press a word hidden for months → Unhide restores it')

        # ---------- 5. voice input: typed card ----------
        await pg.evaluate("__app.state.items['w:caseta'] = { s: 1, d: 5, reps: 1, last: Date.now() - 86400000, due: Date.now() }")  # ordinary card again
        await fresh_entry(pg, 'caseta', 'listenS'); await pg.wait_for_selector('#vmic')
        vg = await pg.evaluate("""(() => { const m = document.getElementById('vmic').getBoundingClientRect(), c = document.getElementById('check').getBoundingClientRect(), f = document.querySelector('footer').getBoundingClientRect();
            return { w: m.width, h: m.height, inFooter: m.top >= f.top - 1 && m.bottom <= f.bottom + 1, nextToCheck: Math.abs(m.top - c.top) < 30 && m.right <= c.left + 1 }; })()""")
        check(vg['w'] >= 56 and vg['h'] >= 44 and vg['inFooter'] and vg['nextToCheck'], f'typed card: big 🎤 Say it next to Check, inside the footer ({vg})')
        await pg.evaluate("__sr.script = [[60, 'Pagamos 150', false], [160, 'Pagamos 150 pesos por la caseta', true]]")
        await pg.click('#vmic'); await pg.wait_for_timeout(110)
        mid = await pg.evaluate("document.getElementById('ans').value")
        await pg.wait_for_timeout(300)
        fin = await pg.evaluate("({ v: document.getElementById('ans').value, answered: __app.run.answered, lang: __sr.lang, interim: __sr.interim, ro: document.getElementById('ans').readOnly })")
        check(mid == 'Pagamos 150' and fin['v'] == 'Pagamos 150 pesos por la caseta' and fin['lang'] == 'es-MX' and fin['interim'] is True, f'speech fills the box live (interim “{mid}” → “{fin["v"]}”), es-MX')
        check(not fin['answered'] and not fin['ro'], 'never auto-submitted: still editable, waits for Check')
        await pg.evaluate("__app.ex.answers = ['Pagamos ciento cincuenta pesos por la caseta.']")
        await pg.click('#check'); await pg.wait_for_selector('#fb .feedback')
        check(await pg.query_selector('#fb .feedback.good') is not None, 'Check grades the spoken text with the normal tolerant check (150 = ciento cincuenta)')
        await pg.wait_for_timeout(500); await pg.click('#next'); await pg.wait_for_timeout(250)
        # English answer → en-US
        await fresh_entry(pg, 'caseta', 'es2en'); await pg.wait_for_selector('#vmic')
        await pg.evaluate("__sr.script = [[60, 'toll booth', true]]"); await pg.click('#vmic'); await pg.wait_for_timeout(250)
        check(await pg.evaluate("__sr.lang") == 'en-US' and await pg.evaluate("document.getElementById('ans').value") == 'toll booth', 'translate-to-English card listens in en-US')
        await pg.click('#skip'); await pg.wait_for_timeout(100); await pg.wait_for_timeout(500); await pg.click('#next'); await pg.wait_for_timeout(250)

        # ---------- 6. voice input: tile builder ----------
        sent = await pg.evaluate("__app.content.units.flatMap(u => u.sentences).find(s => s.k === 'caseta')")
        fh = await pg.evaluate("document.querySelector('footer') ? [...document.querySelectorAll('footer .btn')].map(b => b.getBoundingClientRect().height) : []")
        await fresh_entry(pg, 'caseta', 'build', f", sent: {json.dumps(sent)}"); await pg.wait_for_selector('#tiles .tile')
        fh = await pg.evaluate("[document.getElementById('skip'), document.getElementById('vmic'), document.getElementById('check')].map(b => Math.round(b.getBoundingClientRect().height))")
        check(await pg.query_selector('#vmic') is not None and max(fh) <= 64, f'tile builder: 🎤 Say it next to Check, footer stays one short row (heights {fh})')
        target = await pg.evaluate("__app.ex.answers[0]")
        said = re.sub(r'[.,!?¿¡]', '', target).lower().replace('150', 'ciento cincuenta') + ' este'
        await pg.evaluate(f"__sr.script = [[60, {json.dumps(said)}, true]]"); await pg.click('#vmic'); await pg.wait_for_timeout(1200)
        tb = await pg.evaluate("({ v: __app.ex.order.map(k => __app.ex.tiles[k]).join(' '), heard: document.getElementById('vheard').textContent, miss: [...document.querySelectorAll('#vheard .vmiss')].map(x => x.textContent), answered: __app.run.answered })")
        norm = lambda x: re.sub(r'[^\w ]', '', x.lower()).split()
        check(norm(tb['v']) == norm(target) and tb['miss'] == ['este'] and 'Heard:' in tb['heard'] and not tb['answered'],
              f'said “{said}” → tiles glide into “{tb["v"]}”, “este” shown as unmatched, not submitted ({tb["heard"]})')
        if ENGINE == 'webkit': await pg.wait_for_timeout(300); await pg.screenshot(path=f'{OUT}/v95-voice-build.png')
        await pg.click('#check'); await pg.wait_for_selector('#fb .feedback')
        check(await pg.query_selector('#fb .feedback.good') is not None, 'Check grades the voice-built answer')
        await pg.wait_for_timeout(500); await pg.click('#next'); await pg.wait_for_timeout(250)

        # ---------- 7. unit test has it too; 🤐 pause hides it; a refused mic hides it with a note ----------
        await pg.click('#quit'); await pg.wait_for_selector('.stone')
        await pg.evaluate("__app.openStone('u4', 3)"); await pg.wait_for_selector('.card'); await pg.wait_for_timeout(200)
        await fresh_entry(pg, 'caseta', 'flip'); await pg.wait_for_selector('#ans')
        check(await pg.query_selector('#vmic') is not None and await pg.evaluate("__app.run.mode") == 'test', 'unit test: flip card has 🎤 Say it too')
        await pg.evaluate("__sr.error = 'not-allowed'"); await pg.click('#vmic'); await pg.wait_for_timeout(250)
        nb = await pg.evaluate("({ btn: !!document.getElementById('vmic'), note: document.getElementById('vheard').textContent, check: !!document.getElementById('check') })")
        check(not nb['btn'] and 'type it instead' in nb['note'] and nb['check'], f'mic refused → button hidden with a short note, card still works ({nb["note"]})')
        await fresh_entry(pg, 'caseta', 'flip'); await pg.wait_for_selector('#ans')
        check(await pg.query_selector('#vmic') is None, 'stays hidden for the session after a refusal')
        await pg.evaluate("(() => { __app.state.speakPauseUntil = 0; sessionStorage.removeItem('speech-blocked'); })()")
        await pg.click('#quit'); await pg.wait_for_selector('.stone'); await pg.reload(); await pg.wait_for_selector('.stone')
        await pg.evaluate("__sr.error = null; __app.state.speakPauseUntil = Date.now() + 600000")
        await pg.evaluate("__app.openStone('u4', 2)"); await pg.wait_for_selector('.card'); await pg.wait_for_timeout(200)
        await fresh_entry(pg, 'caseta', 'en2es'); await pg.wait_for_selector('#ans')
        check(await pg.query_selector('#vmic') is None, '🤐 speaking paused → no mic on typed cards')
        await pg.evaluate("__app.state.speakPauseUntil = 0"); await fresh_entry(pg, 'caseta', 'en2es'); await pg.wait_for_selector('#ans')
        check(await pg.query_selector('#vmic') is not None, 'pause over → mic back')

        if await pg.query_selector('#quit'): await pg.click('#quit'); await pg.wait_for_selector('.stone')
        # rule-card pacing is planned when the session is built: N already includes it, nothing is inserted later
        await pg.evaluate("__app.state.rulesSeen = {}; __app.state.pace = {}")
        await pg.evaluate("__app.openStone('u2', 2)"); await pg.wait_for_selector('.card'); await pg.wait_for_timeout(200)
        plan = await pg.evaluate("""(() => { const q = __app.run.queue, out = {}; q.forEach((e, k) => { if (e.id && e.id.startsWith('p:') && !e.intro && !(e.id in out)) { let n = 0; while (q[k + n] && q[k + n].id === e.id) n++; out[e.id] = n; } }); return { out, n: __app.counts().n, len: q.length }; })()""")
        steps = 0; grew = False
        while steps < 12 and await pg.evaluate("!!__app.run"):
            await answer(pg, right=True); steps += 1
            st_ = await pg.evaluate("__app.run ? { extra: __app.run.queue.filter(e => !e.retry).length, n: __app.counts().n } : null")
            if st_ and (st_['extra'] > plan['len'] or st_['n'] != plan['n']): grew = True  # (a missed drill's retry copy is allowed)
        check(plan['out'] and all(v >= 3 for v in plan['out'].values()) and not grew, f'new grammar patterns get their 3 paced drills in the plan (N = {plan["n"]}); the queue never grows ({plan["out"]})')
        await pg.evaluate("__app.state.rulesSeen = Object.fromEntries(Object.keys(__app.content.patterns).map(k => [k, 1]))")
        # ---------- 8. wrong answers cycle to the back; N never changes; done when every drill is right ----------
        if await pg.query_selector('#quit'): await pg.click('#quit'); await pg.wait_for_selector('.stone')
        await pg.evaluate("__app.state.speakPauseUntil = Date.now() + 3600000; __app.state.listenPauseUntil = 0")  # no repeat-after-me in this loop
        for mode, stone in (('practice', 2), ('test', 3)):
            await pg.evaluate(f"__app.openStone('u5', {stone})"); await pg.wait_for_selector('.card'); await pg.wait_for_timeout(200)
            while await pg.evaluate("!!(__app.entry && (__app.entry.theme || __app.entry.intro || __app.entry.rule))"): await answer(pg)
            if mode == 'practice':  # v9.6: practice opens with the grammar focus block (its 2 contrasts are practice-only); miss a graded vocab drill
                await pg.evaluate("(() => { const r = __app.run, q = r.queue, j = q.findIndex((e, k) => k > r.i && e.id.startsWith('w:')); const t = q[r.i]; q[r.i] = q[j]; q[j] = t; __app.nextCard(); })()"); await pg.wait_for_timeout(150)
            c0 = await pg.evaluate("__app.counts()"); q0 = await pg.evaluate("__app.run.queue.map(e => e.key)")
            first = await pg.evaluate("({ id: __app.entry.id, key: __app.entry.key, i: __app.run.i, item: __app.ex.item ? __app.content.patterns[__app.entry.id.slice(2)].items.indexOf(__app.ex.item) : null })")
            srs_before = await pg.evaluate(f"JSON.stringify(__app.state.items[{json.dumps(first['id'])}] || null)")
            await answer(pg, right=False)
            q1 = await pg.evaluate("__app.run.queue.map(e => ({ key: e.key, id: e.id, retry: e.retry || 0, itemIdx: e.itemIdx }))"); c1 = await pg.evaluate("__app.counts()")
            srs_miss = await pg.evaluate(f"__app.state.items[{json.dumps(first['id'])}]")
            check(len(q1) == len(q0) + 1 and [x['key'] for x in q1[:-1]] == q0 and q1[-1]['key'] == first['key'] and q1[-1]['retry'] == 1
                  and (first['item'] is None or q1[-1]['itemIdx'] == first['item']), f'[{mode}] a miss adds no drills: the same item moves to the back ({first["id"]})')
            check(c1 == {'done': 0, 'n': c0['n']} and c0['done'] == 0, f'[{mode}] bar stays 0/{c0["n"]} after the miss (N unchanged) ({c1})')
            check(mode == 'test' or (srs_miss and srs_miss.get('lapses', 0) >= 0 and json.dumps(srs_miss) != srs_before), f'[{mode}] the first attempt is graded (Again)')
            srs_after_miss = json.dumps(srs_miss, separators=(',', ':'))
            seen_retry, mono, steps = 0, True, 0
            last_done = 0
            while steps < 80:
                e = await pg.evaluate("__app.run && __app.entry")
                if not e: break
                if e.get('key') == first['key'] and e.get('retry'): seen_retry += 1
                ok_ = await answer(pg, right=True); steps += 1
                c = await pg.evaluate("__app.run ? __app.counts() : null")
                if c:
                    mono = mono and c['n'] == c0['n'] and c['done'] >= last_done; last_done = c['done']
                if not ok_: break
            check(seen_retry == 1 and mono, f'[{mode}] the missed drill came back once at the end; N stayed {c0["n"]} and the bar only moved forward')
            if mode == 'practice':
                check(await pg.evaluate("!__app.run") and await pg.evaluate("!!__app.state.path.done['u5'] && __app.state.path.done['u5'][2]") is not None, '[practice] the session ends once every drill is right')
                now_srs = await pg.evaluate(f"JSON.stringify(__app.state.items[{json.dumps(first['id'])}])")
                check(json.dumps(json.loads(now_srs), separators=(',', ':')) == srs_after_miss, '[practice] the right retry is practice only (SRS card unchanged since the miss)')
            else:
                t = await pg.evaluate("__app.state.path.tests['u5']")
                h1 = await pg.inner_text('h1')
                check(t['total'] == 15 and t['best'] == 14 and h1.strip() == '14 / 15', f'[test] the score counts first attempts only: {h1} (retry right, still 14 / 15)')
                await pg.click('#home'); await pg.wait_for_selector('.stone')
        # story: a missed question comes back after the last line
        await pg.evaluate("__app.openStone('u5', 1)"); await pg.wait_for_timeout(400)
        missed, retried, fin = None, False, False
        for _ in range(120):
            if await pg.query_selector('.squestion .opt') and not await pg.query_selector('.squestion .opt.right'):
                is_retry = await pg.query_selector('.sq-retry') is not None
                q = await pg.evaluate("(() => { const st = __app.story.u.story, o = [...document.querySelectorAll('.squestion .opt')].map(b => b.dataset.o); return st.qs.find(x => x.o.length === o.length && x.o.every(v => o.includes(v))); })()")
                if missed is None: missed = q['q']; await pg.click(f'.squestion .opt[data-o="{q["o"][1]}"]')
                else:
                    if is_retry and q['q'] == missed: retried = True
                    await pg.click(f'.squestion .opt[data-o="{q["o"][0]}"]')
                await pg.wait_for_timeout(150)
            if await pg.query_selector('#stile') and await pg.query_selector('#check'):
                ex = await pg.evaluate("({tiles: __app.story.tile.ex.tiles, answers: __app.story.tile.ex.answers})"); used = []
                for wt in re.sub(r'[¿?¡!.,;:“”"]', '', ex['answers'][0]).split():
                    for k, tt in enumerate(ex['tiles']):
                        if k not in used and tt == wt: used.append(k); await pg.click(f'#tiles .tile[data-k="{k}"]'); break
                await pg.click('#check'); await pg.wait_for_timeout(150)
            if await pg.query_selector('#cantSpeak'): await pg.click('#cantSpeak'); await pg.wait_for_timeout(300)
            nx = await pg.query_selector('#next')
            if not nx:
                if await pg.query_selector('.stone'): fin = True; break
                await pg.wait_for_timeout(150); continue
            await pg.wait_for_timeout(450); await nx.click(); await pg.wait_for_timeout(200)
            if await pg.evaluate("!__app.story"): fin = True; break
        check(missed and retried and fin, f'story: the missed question came back after the last line, and the story finished once it was right ({missed})')
        check(not errs, f'no page errors {errs[:2]}')
        await b.close()
    print('\nALL PASS' if ok_all else '\nSOME CHECKS FAILED'); sys.exit(0 if ok_all else 1)
asyncio.run(main())
