/* Sound (Web Audio, synthesized, offline), haptics and small animations. No assets, no delays. */
(function (root) {
  let ctx = null, master = null, unlocked = false, getSettings = () => ({});
  const reduced = () => root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const soundOn = () => getSettings().sound !== false;
  const animOn = () => getSettings().anim !== false && !reduced();
  const speaking = () => root.speechSynthesis && root.speechSynthesis.speaking;

  function unlock() { // iOS: create/resume the AudioContext inside a user gesture
    try {
      if (!ctx) {
        const AC = root.AudioContext || root.webkitAudioContext; if (!AC) return;
        ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.22; master.connect(ctx.destination);
      }
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
      if (!unlocked) { // iOS: playing a silent buffer inside the gesture fully unlocks output
        const b = ctx.createBuffer(1, 1, 22050), src = ctx.createBufferSource(); src.buffer = b; src.connect(ctx.destination); src.start(0); unlocked = true;
      }
    } catch (e) { /* audio unavailable */ }
  }
  // one note: osc -> envelope -> master
  function note(freq, start, dur, { type = 'sine', gain = 0.5, attack = 0.006, glideTo = null } = {}) {
    const t0 = ctx.currentTime + start, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  const ready = () => { if (!soundOn() || !ctx) return false; if (ctx.state !== 'running') ctx.resume().catch(() => {}); return ctx.state === 'running'; };
  const sounds = {
    correct() { if (!ready()) return; // bright rising two-note chime (C6 → G6) with a soft octave shimmer
      note(1046.5, 0, 0.16, { type: 'triangle', gain: 0.45 }); note(2093, 0, 0.10, { gain: 0.08 });
      note(1568, 0.085, 0.32, { type: 'triangle', gain: 0.5 }); note(3136, 0.085, 0.18, { gain: 0.07 }); },
    miss() { if (!ready()) return; // soft, low, slightly falling — not a buzzer
      note(329.6, 0, 0.22, { type: 'sine', gain: 0.35, attack: 0.015, glideTo: 277 });
      note(246.9, 0.09, 0.28, { type: 'sine', gain: 0.28, attack: 0.02, glideTo: 220 }); },
    tap() { if (!ready() || speaking()) return; note(880, 0, 0.035, { type: 'sine', gain: 0.12, attack: 0.002, glideTo: 660 }); },
    stone() { if (!ready()) return; [783.99, 1046.5, 1318.5].forEach((f, i) => note(f, i * 0.06, 0.35, { type: 'triangle', gain: 0.28 })); },
    goal() { if (!ready()) return; // daily goal reached: soft rising E–G#–B–E, a little brighter than "complete"
      [659.25, 830.61, 987.77, 1318.5].forEach((f, i) => note(f, i * 0.09, 0.5, { type: 'triangle', gain: 0.24, attack: 0.012 }));
      note(2637, 0.3, 0.25, { gain: 0.05 }); },
    pause() { if (!ready()) return; // "can't listen now": two soft falling notes, quieter than a miss
      note(698.46, 0, 0.12, { type: 'sine', gain: 0.16, attack: 0.004 }); note(523.25, 0.07, 0.2, { type: 'sine', gain: 0.14, attack: 0.006 }); },
    complete() { if (!ready()) return; // gentle C-major chord, lightly arpeggiated
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => note(f, i * 0.05, 0.9 - i * 0.05, { type: 'triangle', gain: 0.22, attack: 0.02 })); }
  };
  const vibrate = p => { try { if (getSettings().sound !== false && navigator.vibrate) navigator.vibrate(p); } catch (e) { /* ignore */ } };

  function retrigger(el, cls) { if (!el || !animOn()) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
  function confetti() {
    if (!animOn() || !document.body.animate) return;
    const colors = ['#0f766e', '#2dd4bf', '#facc15', '#f97316', '#3b82f6', '#22c55e'];
    const layer = document.createElement('div'); layer.className = 'fx-layer'; document.body.appendChild(layer);
    const cx = root.innerWidth / 2, cy = root.innerHeight * 0.35;
    for (let i = 0; i < 28; i++) {
      const p = document.createElement('i'); p.style.background = colors[i % colors.length];
      p.style.left = cx + 'px'; p.style.top = cy + 'px'; layer.appendChild(p);
      const a = Math.random() * Math.PI * 2, r = 80 + Math.random() * 140;
      const dx = Math.cos(a) * r, dy = Math.sin(a) * r * 0.8 + 60, rot = (Math.random() * 720 - 360) | 0;
      p.animate([{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${rot}deg) scale(.6)`, opacity: 0 }],
        { duration: 700 + Math.random() * 200, easing: 'cubic-bezier(.15,.7,.3,1)', fill: 'forwards' });
    }
    setTimeout(() => layer.remove(), 1000);
  }
  function sparkle(cx, cy) {
    if (!document.body.animate) return;
    const layer = document.createElement('div'); layer.className = 'fx-layer'; document.body.appendChild(layer);
    for (let i = 0; i < 12; i++) {
      const p = document.createElement('i'); p.className = 'spark'; p.style.left = cx + 'px'; p.style.top = cy + 'px'; layer.appendChild(p);
      const a = (i / 12) * Math.PI * 2, r = 38 + Math.random() * 22;
      p.animate([{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(a) * r}px), calc(-50% + ${Math.sin(a) * r}px)) scale(.3)`, opacity: 0 }],
        { duration: 550, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' });
    }
    setTimeout(() => layer.remove(), 700);
  }
  function applyClasses() { document.documentElement.classList.toggle('no-anim', !animOn()); }

  const FX = {
    init(fn) {
      getSettings = fn;
      ['pointerdown', 'touchstart', 'touchend', 'click', 'keydown'].forEach(ev => root.addEventListener(ev, unlock, { capture: true, passive: true }));
      // subtle tap on plain buttons; answer buttons get the correct/miss sound instead, speaker buttons stay silent
      root.addEventListener('click', e => {
        const b = e.target.closest && e.target.closest('button, label.btn');
        if (!b || b.disabled || b.matches('.opt, #check, #skip, .speak, #play, #slow, #cantListen')) return;
        sounds.tap();
      }, true);
      applyClasses();
      if (root.matchMedia) root.matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', applyClasses);
    },
    applyClasses,
    correct(els) { sounds.correct(); vibrate(12); (els || []).forEach(el => retrigger(el, 'fx-pop')); retrigger(document.querySelector('main.card'), 'fx-flash-ok'); },
    miss(els) { sounds.miss(); vibrate([25, 40, 25]); (els || []).forEach(el => retrigger(el, 'fx-shake')); retrigger(document.querySelector('main.card'), 'fx-flash-bad'); },
    complete() { sounds.complete(); vibrate([15, 30, 15]); confetti(); },
    stone(el) { // a completed stepping stone: soft chime, pop + ring, a few sparkles from the stone
      sounds.stone(); vibrate(15);
      if (!el || !animOn()) return;
      retrigger(el, 'fx-stone');
      const r = el.getBoundingClientRect(); sparkle(r.left + r.width / 2, r.top + r.height / 2);
    },
    goal(el) { // daily minutes goal hit: chime, bar glow + pop, sparkles from the bar
      sounds.goal(); vibrate([12, 40, 12]);
      if (!el || !animOn()) return;
      retrigger(el, 'fx-goal');
      const bar = el.querySelector('.mbar') || el, r = bar.getBoundingClientRect(); sparkle(r.left + r.width / 2, r.top + r.height / 2);
    },
    pause(el) { sounds.pause(); vibrate(8); retrigger(el, 'fx-pop'); retrigger(document.querySelector('main.card'), 'fx-dim'); },
    sounds
  };
  root.FX = FX;
})(window);
