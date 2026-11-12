/* "Can't listen now": a 10-minute pause on audio-only exercises. Pure helpers, shared by the app and unit tests. */
(function (root) {
  const PAUSE_MS = 10 * 60000;
  const AUDIO = ['listen', 'listenS']; // exercise types you can't do without hearing audio
  const isAudio = type => AUDIO.includes(type);
  // the non-audio equivalent: a heard sentence becomes a read cloze (if the word has sentences), a heard word becomes read-and-translate
  const substitute = (type, hasSentence) => type === 'listenS' && hasSentence ? 'cloze' : 'es2en';
  const paused = (until, now) => !!until && now < until;
  const minutesLeft = (until, now) => paused(until, now) ? Math.max(1, Math.ceil((until - now) / 60000)) : 0;
  const start = now => now + PAUSE_MS;
  const Listen = { PAUSE_MS, AUDIO, isAudio, substitute, paused, minutesLeft, start };
  if (typeof module !== 'undefined') module.exports = Listen; else root.Listen = Listen;
})(typeof window !== 'undefined' ? window : globalThis);
