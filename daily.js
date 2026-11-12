/* Daily practice minutes + streak. Pure functions on plain objects; uses the device's local calendar day. */
(function (root) {
  const MIN = 60000, IDLE_MS = 60000, GOAL_MIN = 15;
  const SEED = { count: 1090, lastDay: '2026-11-11' }; // Duolingo streak carried over; Nov 11 2026 already counted
  const pad = n => (n < 10 ? '0' : '') + n;
  function dayKey(ms) { const d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function keyToDate(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d, 12); } // noon: DST-safe
  function dayDiff(a, b) { return Math.round((keyToDate(b) - keyToDate(a)) / 864e5); } // whole local days from a to b
  function nextMidnight(ms) { const d = new Date(ms); d.setHours(24, 0, 0, 0); return d.getTime(); }
  function addDays(k, n) { const d = keyToDate(k); d.setDate(d.getDate() + n); return dayKey(d.getTime()); }

  const entry = (daily, k) => daily[k] = daily[k] || { ms: 0, sessions: 0 };
  // credit active time between `from` and `to`; activity stops IDLE_MS after the last input; split at local midnight
  function accrue(daily, from, to, lastInput) {
    const end = Math.min(to, lastInput + IDLE_MS);
    let t = from, added = 0;
    while (t < end) {
      const cut = Math.min(end, nextMidnight(t));
      entry(daily, dayKey(t)).ms += cut - t; added += cut - t; t = cut;
    }
    return added;
  }
  const minutesOn = (daily, k) => Math.floor(((daily[k] && daily[k].ms) || 0) / MIN);

  // ---- streak: { count, lastDay } where lastDay is the last local day with a completed lesson/session
  function seed() { return { count: SEED.count, lastDay: SEED.lastDay, seeded: true }; }
  function current(streak, today) { // what to show today
    if (!streak || !streak.lastDay || !streak.count) return { count: 0, doneToday: false };
    const gap = dayDiff(streak.lastDay, today);
    if (gap <= 0) return { count: streak.count, doneToday: true };
    if (gap === 1) return { count: streak.count, doneToday: false };
    return { count: 0, doneToday: false, broken: true }; // a full local day was missed
  }
  function complete(streak, today) { // call when a lesson / practice / review / story / test is finished
    const s = Object.assign({ count: 0, lastDay: null }, streak || {});
    const gap = s.lastDay ? dayDiff(s.lastDay, today) : Infinity;
    if (gap <= 0) return s; // already counted today (or clock went backwards)
    s.count = gap === 1 ? (s.count || 0) + 1 : 1;
    s.lastDay = today;
    return s;
  }
  function edit(streak, n, today, doneToday) { // "my streak is n": counts today if a session is done today, else ends yesterday
    const s = Object.assign({}, streak || {}); n = Math.max(0, Math.floor(+n || 0));
    s.count = n; s.lastDay = n ? (doneToday ? today : addDays(today, -1)) : null; s.edited = Date.now();
    return s;
  }
  const Daily = { MIN, IDLE_MS, GOAL_MIN, SEED, dayKey, dayDiff, addDays, nextMidnight, accrue, minutesOn, seed, current, complete, edit };
  if (typeof module !== 'undefined') module.exports = Daily; else root.Daily = Daily;
})(typeof window !== 'undefined' ? window : globalThis);
