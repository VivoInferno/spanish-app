#!/usr/bin/env python3
"""v9: record every Spanish string the app speaks with Microsoft neural voices (edge-tts, no account) into audio/.

  pip install edge-tts playwright && playwright install chromium   (ffmpeg on PATH)
  python3 tools/build_audio.py            # from the repo root; re-run after content changes

The app itself lists what it can speak (window.__app.speakables(): words, sentences, story lines with speaker tags,
grammar items, tap-hint words, Settings samples), so this never drifts from the code. Each clip is named by a hash of
voice + rate + bitrate + normalized text, so a rebuild only records new/changed text and deletes clips nothing uses.
Story casting: narrator = Dalia (main voice); characters get voices by gender from content.json "speakers", in order of
appearance, never the narrator's voice, recurring characters keep the same voice where possible."""
import asyncio, functools, hashlib, http.server, json, os, shutil, socketserver, subprocess, sys, tempfile, threading, unicodedata, re
import edge_tts
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'audio')
RATE = '-5%'          # a touch slower than default for a learner; the app's speed slider scales from here
KBPS = 32             # mono 24 kHz MP3; speech stays clear and a typical clip is 5–15 KB
# trim edge-tts's lead-in and ~0.9 s tail to 50/150 ms: smaller files and snappier replies (bump TRIM if this filter changes)
TRIM = 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.15,areverse'
VOICES = {            # id → edge-tts voice. Only Dalia and Jorge are es-MX; other characters use nearby Latin American voices.
    'dalia': 'es-MX-DaliaNeural', 'jorge': 'es-MX-JorgeNeural',
    'paloma': 'es-US-PalomaNeural', 'alonso': 'es-US-AlonsoNeural',
    'salome': 'es-CO-SalomeNeural', 'gonzalo': 'es-CO-GonzaloNeural',
}
MAIN, SECOND = 'dalia', 'jorge'
POOL = {'m': ['jorge', 'alonso', 'gonzalo'], 'f': ['paloma', 'salome']}
FIXED = {'Mariana': 'paloma', 'Sofía': 'salome', 'Laura': 'salome', 'Sr. Ortega': 'jorge'}  # recurring characters

norm = lambda t: re.sub(r'\s+', ' ', unicodedata.normalize('NFC', str(t))).strip().lower()  # = Rec.norm in audio.js
def clip_hash(vid, text): return hashlib.sha1(f'{VOICES[vid]}|{RATE}|{KBPS}|{TRIM}|{norm(text)}'.encode()).hexdigest()[:14]

def cast_story(lines, genders):
    cast, used = {'': MAIN}, set()
    for l in lines:
        s = l['s']
        if not s or s in cast: continue
        g = genders.get(s, 'f')
        pref = [FIXED[s]] if s in FIXED else []
        cands = pref + POOL[g] + POOL['m' if g == 'f' else 'f']  # same gender first; only if a story runs out, borrow
        pick = next((v for v in cands if v not in used), POOL[g][0])
        cast[s] = pick; used.add(pick)
    return cast

async def speakables():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    handler = functools.partial(Quiet, directory=ROOT)
    with socketserver.TCPServer(('127.0.0.1', 0), handler) as srv:
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        async with async_playwright() as p:
            b = await p.chromium.launch(); pg = await b.new_page()
            await pg.goto(f'http://127.0.0.1:{srv.server_address[1]}/'); await pg.wait_for_function('window.__app && __app.content')
            data = await pg.evaluate('__app.speakables()'); await b.close()
        srv.shutdown()
    return data

async def record(vid, text, dest, sem):
    async with sem:
        for attempt in range(4):
            try:
                with tempfile.TemporaryDirectory() as td:
                    raw = os.path.join(td, 'raw.mp3')
                    await edge_tts.Communicate(text, VOICES[vid], rate=RATE).save(raw)
                    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', raw, '-af', TRIM, '-ac', '1', '-ar', '24000', '-b:a', f'{KBPS}k', '-map_metadata', '-1', dest + '.tmp.mp3'], check=True)
                    os.replace(dest + '.tmp.mp3', dest); return True
            except Exception as e:
                if attempt == 3: print('FAILED', vid, text[:60], e, file=sys.stderr); return False
                await asyncio.sleep(2 * (attempt + 1))

async def main():
    content = json.load(open(os.path.join(ROOT, 'content.json')))
    genders = content.get('speakers', {})
    data = await speakables()
    casts = {u['id']: cast_story(u['story']['lines'], genders) for u in content['units']}
    jobs = {}  # (vid, norm) → text
    for t in data['main']: jobs.setdefault((MAIN, norm(t)), t)
    for uid, spk, t in data['story']: jobs.setdefault((casts[uid].get(spk, MAIN), norm(t)), t)
    for t in data['second']: jobs.setdefault((SECOND, norm(t)), t)
    os.makedirs(OUT, exist_ok=True)
    files = {}
    todo = []
    for (vid, key), text in jobs.items():
        h = clip_hash(vid, text); files.setdefault(vid, {})[key] = h
        dest = os.path.join(OUT, h + '.mp3')
        if not os.path.exists(dest): todo.append((vid, text, dest))
    print(f'{len(jobs)} clips ({len(todo)} to record) in {len(files)} voices')
    sem = asyncio.Semaphore(8); done = 0
    async def run(j):
        nonlocal done
        ok = await record(*j, sem); done += 1
        if done % 200 == 0: print(f'  {done}/{len(todo)}')
        return ok
    results = await asyncio.gather(*(run(j) for j in todo))
    failed = [todo[i] for i, ok in enumerate(results) if not ok]
    for vid, text, dest in failed: files[vid].pop(norm(text), None)
    keep = {h + '.mp3' for m in files.values() for h in m.values()}
    removed = 0
    for f in os.listdir(OUT):
        if f.endswith('.mp3') and f not in keep: os.remove(os.path.join(OUT, f)); removed += 1
    man = {'v': 1, 'main': MAIN, 'second': SECOND, 'voices': {k: VOICES[k] for k in sorted({v for m in [files] for v in m})},
           'rate': RATE, 'kbps': KBPS, 'cast': casts, 'files': {v: dict(sorted(m.items())) for v, m in sorted(files.items())}}
    with open(os.path.join(OUT, 'manifest.json'), 'w') as f: json.dump(man, f, ensure_ascii=False, separators=(',', ':'), sort_keys=False)
    size = sum(os.path.getsize(os.path.join(OUT, f)) for f in keep if os.path.exists(os.path.join(OUT, f)))
    print(f'recorded {len(todo) - len(failed)}, failed {len(failed)}, removed {removed}; {len(keep)} files, {size / 1e6:.1f} MB '
          f'+ manifest {os.path.getsize(os.path.join(OUT, "manifest.json")) / 1e3:.0f} KB')
    for v, m in files.items(): print(f'  {v:8s} {VOICES[v]:22s} {len(m)} clips')
    sys.exit(1 if failed else 0)

if __name__ == '__main__':
    asyncio.run(main())
