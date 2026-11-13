"""v9.1: the repeat-after-me mic can never lock the app (Colby's iPhone froze after tapping the mic).
Mocked SpeechRecognition failure modes: never fires anything (hang), throws on start(), onerror not-allowed / audio-capture,
ignores stop(), keeps sending sound events with no result (hard cap), plus the normal success path. Each time the lesson must
stay usable: Skip / Can't speak now enabled and on top, the card comes back, two failures turn speaking off with a toast and the
🤐 pill, the pill turns it back on. Audio (recorded clip + device TTS) is released before start(); the main thread stays free."""
import asyncio, json, sys, os, re
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'v8_e2e.py')).read().split('async def main')[0]
exec(src)

MOCK = """
window.__sr = { mode: 'ok', say: null, starts: 0, stops: 0, aborts: 0, inst: null, relBefore: [] };
class FakeSR {
  start() { __sr.starts++; __sr.inst = this; __sr.relBefore.push(window.__rel || 0);
    const m = __sr.mode;
    if (m === 'throw') throw new DOMException('start failed', 'InvalidStateError');
    if (m === 'hang' || m === 'stophang') return;                          // never fires onresult / onend / onerror
    if (m === 'sound') { this._iv = setInterval(() => this.onsoundstart && this.onsoundstart(), 200); return; }  // sound, never a result
    if (m.startsWith('error:')) { setTimeout(() => { this.onerror && this.onerror({ error: m.slice(6) }); this.onend && this.onend(); }, 60); return; }
    if (m === 'nomatch') { setTimeout(() => { this.onnomatch && this.onnomatch({}); this.onend && this.onend(); }, 60); return; }
    setTimeout(() => { const res = [].concat(__sr.say || '').map(t => ({ transcript: t, confidence: 0.9 })); res.isFinal = true;
      this.onresult && this.onresult({ results: [res], resultIndex: 0 }); this.onend && this.onend(); }, 80); }
  stop() { __sr.stops++; if (__sr.mode === 'stophang' || __sr.mode === 'hang') return; this.onend && setTimeout(() => this.onend && this.onend(), 30); }
  abort() { __sr.aborts++; clearInterval(this._iv); }
}
window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR;
"""

async def usable(pg, what):
    """Skip / Can't speak now present, enabled, and the topmost element at their centre (nothing covering them)"""
    r = await pg.evaluate("""(() => ['#skip', '#cantSpeak'].map(sel => { const b = document.querySelector(sel); if (!b) return [sel, 'missing'];
      let q = b.getBoundingClientRect(); if (q.top < 0 || q.bottom > innerHeight) { b.scrollIntoView({ block: 'center' }); q = b.getBoundingClientRect(); }
      const top = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
      return [sel, !b.disabled && getComputedStyle(b).pointerEvents !== 'none' && (top === b || b.contains(top)) || (top ? top.outerHTML.slice(0, 80) : 'none')]; }))()""")
    check(all(x[1] is True for x in r), f'{what}: Skip and Can\'t speak now enabled and not covered ({r})')

async def cont(pg):
    await pg.wait_for_timeout(500)  # the app ignores a Continue tap within ~0.4 s of answering (anti double-tap)
    i = await pg.evaluate("__app.run.i"); await pg.click('#next'); await pg.wait_for_timeout(150)
    pg._moved = await pg.evaluate(f"!!__app.run && __app.run.i > {i}")

async def speak_card(pg, wid='llanta'):
    short = await pg.evaluate(f"__app.content.units.flatMap(u => u.sentences).find(s => s.k === '{wid}' && s.es.split(' ').length <= 9)")
    await fresh_entry(pg, wid, 'speak', f", sent: {json.dumps(short)}"); await pg.wait_for_selector('#mic')
    return short

async def main():
    async with async_playwright() as p:
        b = await (p.webkit if ENGINE == 'webkit' else p.chromium).launch()
        V7 = strip_meta(json.load(open(FIX + 'v7-export.json')))
        V9 = dict(V7, settings=dict(V7['settings'], voice='', voice2='', voiceMode='recorded', anim=False)); V9['schema'] = 5; V9['speakPauseUntil'] = 0
        ctx = await new_ctx(b, p, V9, sr=False, device=False); await ctx.add_init_script(MOCK)
        pg = await ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL); await pg.wait_for_selector('.stone'); await pg.wait_for_timeout(600)
        s = await pg.evaluate("__app.state")
        check(await pg.evaluate("__app.version") == 'v9.1' and s['items'] == V9['items'] and s['path'] == V9['path'] and s['daily'] == V9['daily'] and s['streak'] == V9['streak'] and s['settings']['voiceMode'] == 'recorded',
              'v9 data → v9.1 losslessly')
        await pg.evaluate("window.__rel = 0; const o = Rec.release; Rec.release = () => { __rel++; o(); }; window.__cancels = 0; const f = () => { __cancels++; }; for (const o of [speechSynthesis, Object.getPrototypeOf(speechSynthesis)]) try { Object.defineProperty(o, 'cancel', { value: f, configurable: true, writable: true }); } catch (e) {}")
        await pg.evaluate("__app.openStone('u9', 0)"); await pg.wait_for_selector('#go'); await pg.click('#go'); await pg.wait_for_timeout(150)

        # ---- normal path still works, and audio is released before start() ----
        short = await speak_card(pg)
        await pg.evaluate(f"__sr.mode = 'ok'; __sr.say = {json.dumps(re.sub(r'[¿?¡!.,;:]', '', short['es']).lower())}; __cancels = 0")
        await pg.click('#mic'); await pg.wait_for_selector('#fb .feedback')
        check(await pg.query_selector('.feedback.good') is not None, 'normal path: saying the line is graded correct')
        check(await pg.evaluate("__sr.relBefore.slice(-1)[0] >= 1 && __cancels >= 1"), 'recorded clip released and device speech cancelled before start()')

        # ---- 1. hang: never fires anything (real 8 s watchdog) ----
        await speak_card(pg); await pg.evaluate("__sr.mode = 'hang'")
        await pg.click('#mic'); await pg.wait_for_timeout(150)
        lab = await pg.inner_text('#mic .mic-label')
        check('Listening' in lab and 'stop' in lab and await pg.evaluate("document.getElementById('mic').classList.contains('on')"), f'visible listening state with tap-to-stop ({lab})')
        await usable(pg, 'while listening')
        drift = await pg.evaluate("""new Promise(ok => { let n = 0, worst = 0, t = performance.now(); const tick = () => { const now = performance.now(); worst = Math.max(worst, now - t - 50); t = now; if (++n < 20) setTimeout(tick, 50); else ok(worst); }; setTimeout(tick, 50); })""")
        check(drift < 150, f'main thread free while listening (worst timer drift {drift:.0f} ms)')
        await pg.wait_for_timeout(8300)
        check(await pg.evaluate("!__app.recActive && !document.getElementById('mic').classList.contains('on')") and 'Tap to speak' in await pg.inner_text('#mic .mic-label')
              and 'didn’t respond' in await pg.inner_text('#heard') and await pg.evaluate("__app.micFails") == 1 and await pg.evaluate("__sr.aborts") >= 1,
              'hang: watchdog aborts after ~8 s and gives the card back (mic usable again)')
        await usable(pg, 'after the timeout')
        # second failure this session → speaking drills off, toast, pill
        await pg.evaluate("window.__micTimes = [600, 1200, 300]")
        await pg.click('#mic'); await pg.wait_for_timeout(900)
        toast = await pg.evaluate("(document.getElementById('toast') || {}).textContent || ''")
        check(await pg.evaluate("__app.speechBlocked") and await pg.evaluate("__app.ex.kind") != 'speak' and await pg.query_selector('#spOff') is not None and 'speaking drills are off' in toast,
              f'second hang: speaking drills off for the session, card becomes a normal exercise, toast + 🤐 pill ({toast})')
        await pg.fill('#ans', 'x') if await pg.query_selector('#ans') else None
        await pg.click('#skip'); await pg.wait_for_selector('#fb .feedback'); await cont(pg)
        await pg.wait_for_timeout(200)
        check(pg._moved, 'lesson continues to the next card')
        await pg.click('#spOff'); await pg.wait_for_timeout(100)
        check(not await pg.evaluate("__app.speechBlocked") and await pg.evaluate("__app.micFails") == 0 and await pg.query_selector('#spOff') is None, '🤐 pill turns speaking drills back on')

        # ---- 2. start() throws ----
        await speak_card(pg); await pg.evaluate("__sr.mode = 'throw'")
        await pg.click('#mic'); await pg.wait_for_timeout(150)
        check(await pg.evaluate("__app.ex.kind") == 'speak' and not await pg.evaluate("__app.recActive") and 'Tap to speak' in await pg.inner_text('#mic .mic-label') and await pg.evaluate("__app.micFails") == 1,
              'start() throws: no crash, card stays usable')
        await usable(pg, 'after start() threw')
        await pg.click('#skip'); await pg.wait_for_selector('#fb .feedback')
        check(await pg.query_selector('#fb .feedback .bad') is not None, 'Skip grades it and shows the answer')
        await cont(pg); await pg.wait_for_timeout(200)
        check(pg._moved, 'continue after a throw')
        await speak_card(pg, 'fuga' if await pg.evaluate("__app.content.units.flatMap(u => u.sentences).some(s => s.k === 'fuga' && s.es.split(' ').length <= 9)") else 'llanta')
        await pg.click('#mic'); await pg.wait_for_timeout(200)
        check(await pg.evaluate("__app.speechBlocked") and await pg.evaluate("__app.ex.kind") != 'speak', 'second throw: speaking off for the session')
        await pg.evaluate("__app.unblockSpeech()")

        # ---- 3/4. onerror not-allowed / audio-capture ----
        for err in ['not-allowed', 'audio-capture']:
            await speak_card(pg); await pg.evaluate(f"__sr.mode = 'error:{err}'")
            await pg.click('#mic'); await pg.wait_for_timeout(300)
            toast = await pg.evaluate("(document.getElementById('toast') || {}).textContent || ''")
            check(await pg.evaluate("__app.speechBlocked") and await pg.evaluate("__app.ex.kind") != 'speak' and await pg.query_selector('#spOff') is not None and 'off for now' in toast,
                  f'onerror {err}: speaking off at once, card rebuilt, toast + pill ({toast})')
            await pg.click('#skip'); await pg.wait_for_selector('#fb .feedback'); await cont(pg); await pg.wait_for_timeout(200)
            check(pg._moved, f'lesson continues after {err}')
            await pg.click('#spOff'); await pg.wait_for_timeout(80)

        # ---- 5. Skip / Can't speak now while a hung recogniser is listening ----
        await pg.evaluate("window.__micTimes = null")
        await speak_card(pg); await pg.evaluate("__sr.mode = 'hang'"); await pg.click('#mic'); await pg.wait_for_timeout(100)
        await pg.click('#skip'); await pg.wait_for_selector('#fb .feedback')
        check(not await pg.evaluate("__app.recActive") and not await pg.evaluate("document.querySelector('.mic.on')"), 'Skip while listening: recogniser aborted, answer shown')
        await cont(pg); await pg.wait_for_timeout(200)
        await speak_card(pg); await pg.click('#mic'); await pg.wait_for_timeout(100)
        await pg.click('#cantSpeak'); await pg.wait_for_timeout(400)
        check(not await pg.evaluate("__app.recActive") and await pg.evaluate("__app.speakPaused()") and await pg.evaluate("__app.ex.kind") != 'speak', "Can't speak now while listening: aborted, 10-minute pause, card rebuilt")
        await pg.evaluate("__app.state.speakPauseUntil = 0"); await pg.wait_for_timeout(1100)

        # ---- 6. tap to stop, but iOS never answers the stop ----
        await pg.evaluate("window.__micTimes = [8000, 12000, 300]")
        await speak_card(pg); await pg.evaluate("__sr.mode = 'stophang'"); await pg.click('#mic'); await pg.wait_for_timeout(100)
        await pg.click('#mic'); await pg.wait_for_timeout(60); lab = await pg.inner_text('#mic .mic-label'); await pg.wait_for_timeout(400)
        check('Checking' in lab and not await pg.evaluate("__app.recActive") and 'Tap to speak' in await pg.inner_text('#mic .mic-label') and await pg.evaluate("__sr.stops") >= 1,
              'tap to stop: if the recogniser never ends, the card comes back after 1.5 s')

        # ---- 7. sound events but never a result: hard cap ----
        await pg.evaluate("window.__micTimes = [500, 1500, 300]; __sr.mode = 'sound'")
        await pg.click('#mic'); await pg.wait_for_timeout(900)
        still = await pg.evaluate("__app.recActive"); await pg.wait_for_timeout(900)
        check(still and not await pg.evaluate("__app.recActive"), 'sound but no result: idle timer keeps waiting, hard cap aborts')
        await pg.evaluate("__app.unblockSpeech(); window.__micTimes = [600, 1200, 300]")

        # ---- 8. onnomatch ----
        await speak_card(pg); await pg.evaluate("__sr.mode = 'nomatch'"); await pg.click('#mic'); await pg.wait_for_timeout(250)
        check(not await pg.evaluate("__app.recActive") and 'make that out' in await pg.inner_text('#heard') and await pg.evaluate("__app.ex.kind") == 'speak', 'onnomatch: friendly retry message, mic usable')
        await pg.click('#quit'); await pg.wait_for_selector('.stone')

        # ---- 9. story "say the line" with a hung recogniser ----
        await pg.evaluate("__sr.mode = 'hang'")
        found = False
        for uid in ['u1', 'u2', 'u3', 'u4', 'u5', 'u6']:
            await pg.evaluate(f"__app.openStone('{uid}', 1)"); await pg.wait_for_selector('.story')
            for _ in range(40):
                if await pg.query_selector('#ssay #mic'): found = True; break
                if await pg.query_selector('.stone'): break
                if await pg.query_selector('#stile') and await pg.query_selector('#skip'): await pg.click('#skip')
                elif await pg.query_selector('.squestion .opt') and not await pg.query_selector('.squestion .opt.right'): await pg.locator('.squestion .opt').first.click()
                elif await pg.query_selector('#next'): await pg.click('#next')
                await pg.wait_for_timeout(40)
            if found: break
            if not await pg.query_selector('.stone'): await pg.click('#quit'); await pg.wait_for_selector('.stone')
        if found:
            await pg.click('#ssay #mic'); await pg.wait_for_timeout(100); await usable(pg, 'story say-the-line while listening')
            await pg.wait_for_timeout(800)
            check(not await pg.evaluate("__app.recActive") and await pg.query_selector('#ssay #mic') is not None, 'story: watchdog gives the line back')
            await pg.click('#skip'); await pg.wait_for_timeout(200)
            check(await pg.query_selector('#ssay #mic') is None and (await pg.query_selector('#next') is not None or await pg.query_selector('.squestion') is not None or await pg.query_selector('.stone') is not None), 'story: Skip moves on')
        else: check(False, 'found a story say-the-line moment')
        check(not errs, f'no page errors {errs[:3]}')
        await b.close()
    print('\nALL PASS' if ok_all else '\nSOME CHECKS FAILED'); sys.exit(0 if ok_all else 1)
asyncio.run(main())
