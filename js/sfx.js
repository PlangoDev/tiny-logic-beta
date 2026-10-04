// Sound effects, made the way the game makes them: little square / triangle / sine / noise voices with pitch
// sweeps and plucky envelopes, rendered into short buffers on the fly. No audio files. Browsers only let a page make
// sound after a click or key press, so nothing plays until unlock() runs inside one.
(() => {
  'use strict';
  const KEY = 'tlbeta.mute';
  let ctx = null, out = null;
  let muted = false;
  try { muted = localStorage.getItem(KEY) === '1'; } catch { /* (storage blocked: start with sound on) */ }
  const cache = new Map();
  let seed = 0x9e3779b9;
  const noise = () => {        // the game's xorshift, so the noise has the same grain
    seed ^= seed << 13; seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5; seed >>>= 0;
    return (seed >>> 8) * (2 / 16777216) - 1;
  };

  // A voice: [wave, f0, f1, dur, delay, vol, duty, swell]. Waves: q square, t triangle, s sine, n noise.
  function render(voices) {
    const rate = ctx.sampleRate;
    const len = Math.ceil(Math.max(...voices.map((v) => v[3] + v[4])) * rate) + 8;
    const buf = ctx.createBuffer(1, len, rate);
    const o = buf.getChannelData(0);
    for (const [wave, f0, f1, dur, delay, vol, duty = 0.5, swell = false] of voices) {
      let phase = 0, lp = 0;
      const start = Math.floor(delay * rate), n = Math.floor(dur * rate);
      for (let i = 0; i < n; i++) {
        const t = i / rate, k = i / n;
        const f = f0 * Math.pow(f1 / f0, k);
        phase += f / rate;
        phase -= Math.floor(phase);
        let s;
        if (wave === 'q') s = phase < duty ? 1 : -1;
        else if (wave === 't') s = 4 * Math.abs(phase - 0.5) - 1;
        else if (wave === 's') s = Math.sin(phase * 6.2831853);
        else {
          const cut = swell ? 0.01 + 0.45 * k * k : 0.02 + 0.5 * (1 - k) * (1 - k);
          lp += (noise() - lp) * cut;
          s = lp * 2.2;
        }
        const env = swell ? k * k * Math.min(1, (1 - k) * 25) : Math.min(1, t / 0.004) * Math.pow(1 - k, 1.6);
        o[start + i] += s * env * vol;
      }
    }
    return buf;
  }

  function fire(buf, when = 0) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(out);
    src.start(ctx.currentTime + when);
  }

  const ready = () => ctx && !muted && ctx.state === 'running';

  // The game's sound list (src/core/Audio.cpp), plus a few for this page.
  const R = {
    hover: (p) => [['q', 900 * p, 1350 * p, 0.045, 0, 0.07, 0.25]],
    tick: (p) => [['q', 1900 * p, 1500 * p, 0.022, 0, 0.05, 0.5]],
    click: (p) => [['q', 480 * p, 960 * p, 0.07, 0, 0.12, 0.5]],
    switch: (p) => [['n', 3000, 3000, 0.03, 0, 0.12], ['q', 220 * p, 180 * p, 0.05, 0, 0.1, 0.3]],
    confirm: (p) => [['q', 660 * p, 660 * p, 0.07, 0, 0.11], ['q', 990 * p, 990 * p, 0.12, 0.07, 0.11], ['t', 1320 * p, 1320 * p, 0.16, 0.07, 0.12]],
    pop: (p) => [['t', 380 * p, 1100 * p, 0.09, 0, 0.2]],
    zap: (p) => [['q', 2400 * p, 150 * p, 0.18, 0, 0.06, 0.2], ['n', 1, 1, 0.12, 0, 0.05]],
    boom: (p) => [['s', 140 * p, 34 * p, 0.7, 0, 0.55], ['n', 1, 1, 0.55, 0, 0.32], ['q', 70 * p, 40 * p, 0.35, 0, 0.12]],
    whoosh: () => [['n', 1, 1, 0.45, 0, 0.14]],
    thump: (p) => [['s', 78 * p, 36 * p, 0.32, 0, 0.8], ['n', 1, 1, 0.12, 0, 0.06]],
    riser: (p) => [['n', 1, 1, 1.1 * p, 0, 0.22, 0.5, true], ['q', 110, 880, 1.1 * p, 0, 0.05, 0.5, true]],
    crtOn: () => [['s', 50, 120, 0.2, 0, 0.55], ['n', 1, 1, 0.1, 0, 0.2], ['s', 7600, 7900, 0.7, 0.05, 0.018]],
    crtOff: () => [['s', 1500, 70, 0.5, 0, 0.14], ['n', 1, 1, 0.35, 0, 0.14]],
    snore: (p) => [['n', 1, 1, 1.2 * p, 0, 0.07, 0.5, true], ['t', 70, 60, 1.2 * p, 0, 0.05, 0.5, true]],
    knock: (p) => [0, 1].flatMap((i) => [['s', 190 * p, 110 * p, 0.07, i * 0.13, 0.55], ['n', 1, 1, 0.04, i * 0.13, 0.2]]),
    error: (p) => [['q', 200 * p, 170 * p, 0.09, 0, 0.12], ['q', 200 * p, 150 * p, 0.12, 0.11, 0.12]],
    // made for the page
    powerUp: () => [['q', 110, 880, 0.42, 0, 0.07, 0.5], ['t', 55, 440, 0.5, 0, 0.12], ['n', 1, 1, 0.25, 0, 0.08]],
    stamp: () => [['s', 160, 60, 0.12, 0, 0.5], ['n', 1, 1, 0.06, 0, 0.18], ['q', 1200, 1600, 0.04, 0.05, 0.05]],
  };
  // Random ones get a fresh buffer every time; the rest are kept by name + pitch.
  const RANDOM = {
    sparkle: (p) => [0, 1, 2, 3].map((i) => ['t', (1800 + 700 * (noise() + 1)) * p, 2600 * p, 0.06, i * 0.045, 0.05]),
    glitch: () => [['n', 1, 1, 0.14, 0, 0.2], ...[0, 1, 2, 3].map((i) => ['q', 300 + 900 * (noise() + 1), 200, 0.035, i * 0.03, 0.07])],
  };

  function play(name, pitch = 1, when = 0) {
    if (!ready()) return;
    if (RANDOM[name]) return fire(render(RANDOM[name](pitch)), when);
    const key = name + '@' + pitch.toFixed(3);
    let buf = cache.get(key);
    if (!buf) {
      if (!R[name]) return;
      buf = render(R[name](pitch));
      if (cache.size > 300) cache.clear();
      cache.set(key, buf);
    }
    fire(buf, when);
  }

  // One musical note (the game's Audio::note).
  function note(hz, dur, delay = 0, vol = 0.1, wave = 'q', duty = 0.25) {
    if (!ready()) return;
    const key = ['n', hz.toFixed(1), dur, vol, wave, duty].join();
    let buf = cache.get(key);
    if (!buf) {
      buf = render([[wave, hz, hz, dur, 0, vol, duty]]);
      cache.set(key, buf);
    }
    fire(buf, delay);
  }
  const hz = (semis) => 440 * Math.pow(2, semis / 12);   // semitones from A4

  // Mazell's voice: a blip every couple of letters, pitched by the letter (src/game/Guide.cpp).
  function voice(ch, base = 260) {
    note(base * (1 + 0.07 * (ch.charCodeAt(0) % 6)), 0.045, 0, 0.045, 'q', 0.35);
  }

  function fanfare() {
    // C E G C', a held chord under it, a sparkle on top
    [3, 7, 10, 15].forEach((s, i) => note(hz(s), i === 3 ? 0.42 : 0.12, i * 0.09, 0.075, 'q', 0.5));
    [3 - 12, 10 - 12].forEach((s) => note(hz(s), 0.6, 0.27, 0.11, 't'));
    note(hz(22), 0.3, 0.36, 0.035, 't');
    play('sparkle', 1.2, 0.3);
    play('sparkle', 1.5, 0.48);
  }

  function chime(up = true) {
    (up ? [12, 16, 19] : [19, 16, 12]).forEach((s, i) => note(hz(s), 0.08, i * 0.06, 0.06, 'q', 0.5));
  }

  function unlock() {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        // A soft low-pass and a little headroom keep the square waves from sounding harsh.
        const soft = ctx.createBiquadFilter();
        soft.type = 'lowpass';
        soft.frequency.value = 9000;
        out = ctx.createGain();
        out.gain.value = 0.5;
        out.connect(soft).connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
    } catch { /* (no audio on this browser: the page works silently) */ }
  }

  function setMuted(m) {
    muted = m;
    try { localStorage.setItem(KEY, m ? '1' : '0'); } catch { /* (not remembered: fine) */ }
  }

  window.SFX = {
    unlock, play, note, voice, fanfare, chime, hz,
    get muted() { return muted; },
    setMuted,
    get live() { return ready(); },
  };
})();
