/* FSRS-4.5 scheduler (default weights), per item. Grades: 1 Again, 2 Hard, 3 Good, 4 Easy. */
(function (root) {
  const W = [0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755];
  const DECAY = -0.5, FACTOR = 19 / 81, RETENTION = 0.9, DAY = 86400000, MAX_IVL = 3650;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const initD = g => clamp(W[4] - (g - 3) * W[5], 1, 10);
  const initS = g => W[g - 1];
  function retrievability(elapsedDays, s) { return Math.pow(1 + FACTOR * elapsedDays / s, DECAY); }
  function nextInterval(s) { return clamp(Math.round(s / FACTOR * (Math.pow(RETENTION, 1 / DECAY) - 1)), 1, MAX_IVL); }
  function nextD(d, g) { const d1 = d - W[6] * (g - 3); return clamp(W[7] * initD(4) + (1 - W[7]) * d1, 1, 10); }
  function recallS(d, s, r, g) {
    const hard = g === 2 ? W[15] : 1, easy = g === 4 ? W[16] : 1;
    return s * (1 + Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * (Math.exp(W[10] * (1 - r)) - 1) * hard * easy);
  }
  function forgetS(d, s, r) { return Math.min(s, W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r))); }
  function newCard() { return { s: 0, d: 0, reps: 0, lapses: 0, last: 0, due: 0 }; }
  function review(card, g, now) {
    now = now || Date.now();
    const c = Object.assign(newCard(), card);
    if (!c.reps || !c.s) { c.s = initS(g); c.d = initD(g); }
    else {
      const t = Math.max(0, (now - c.last) / DAY);
      const r = retrievability(t, c.s);
      if (t < 0.5) {
        // same-day re-review: only nudge stability (FSRS short-term behaviour, simplified)
        c.d = nextD(c.d, g);
        c.s = g === 1 ? Math.min(c.s, forgetS(c.d, c.s, r)) : c.s * (g === 4 ? 1.3 : 1.0);
      } else {
        c.d = nextD(c.d, g);
        c.s = g === 1 ? forgetS(c.d, c.s, r) : recallS(c.d, c.s, r, g);
      }
    }
    if (g === 1) c.lapses += 1;
    c.reps += 1; c.last = now;
    // a miss comes back next day (in-session relearning is handled by the session queue)
    c.due = now + (g === 1 ? Math.max(0.6, Math.min(1, c.s)) * DAY : nextInterval(c.s) * DAY);
    return c;
  }
  // Mark as known: push far out so it rarely reappears (used for placement + "too easy").
  function markKnown(card, now, days) {
    now = now || Date.now();
    const c = Object.assign(newCard(), card);
    c.s = Math.max(c.s || 0, days || 90); c.d = initD(4); c.reps = Math.max(1, c.reps); c.last = now;
    c.due = now + nextInterval(c.s) * DAY; c.known = true;
    return c;
  }
  function currentR(card, now) { if (!card || !card.reps) return 0; return retrievability(Math.max(0, ((now || Date.now()) - card.last) / DAY), card.s); }
  const api = { review, markKnown, newCard, retrievability, currentR, nextInterval, DAY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SRS = api;
})(this);
