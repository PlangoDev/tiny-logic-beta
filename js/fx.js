// The living board behind the page (dot grid, faint traces, sparks running along them) and the pixel particles
// for celebrations. Both canvases are drawn at half resolution and scaled up pixelated, so every spark is a chunky
// game pixel and the work per frame stays tiny. Nothing runs while the tab is hidden.
(() => {
  'use strict';
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  const K = 2;                    // canvas pixel = 2 CSS pixels
  const G = 16;                   // the board grid, in canvas pixels (32 CSS px)
  const COLORS = ['#f5d33c', '#5fe08a', '#58d6e8', '#f078c8', '#e5484d', '#5282f0', '#f28c28'];

  // ---------------------------------------------------------------- background
  const bg = document.getElementById('bg');
  const g = bg.getContext('2d');
  const still = document.createElement('canvas');
  const sg = still.getContext('2d');
  let W = 0, H = 0, traces = [], sparks = [], surge = 0, last = 0, raf = 0;

  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[(Math.random() * a.length) | 0];

  function layTraces() {
    // Random right-angle walks along the grid, like wires on a board someone has been busy on.
    traces = [];
    const cols = Math.ceil(W / G), rows = Math.ceil(H / G);
    const count = Math.max(6, Math.round((cols * rows) / 90));
    for (let n = 0; n < count; n++) {
      let x = (Math.random() * cols) | 0, y = (Math.random() * rows) | 0;
      let dir = (Math.random() * 4) | 0;
      const pts = [[x * G + G / 2, y * G + G / 2]];
      const steps = 3 + ((Math.random() * 5) | 0);
      for (let s = 0; s < steps; s++) {
        const len = 2 + ((Math.random() * 6) | 0);
        x += [1, 0, -1, 0][dir] * len;
        y += [0, 1, 0, -1][dir] * len;
        pts.push([x * G + G / 2, y * G + G / 2]);
        dir = (dir + (Math.random() < 0.5 ? 1 : 3)) % 4;
      }
      let total = 0;
      const segs = [];
      for (let i = 1; i < pts.length; i++) {
        const l = Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1]);
        segs.push([pts[i - 1], pts[i], total, l]);
        total += l;
      }
      traces.push({ pts, segs, total, color: pick(COLORS) });
    }
  }

  function paintStill() {
    still.width = W; still.height = H;
    sg.fillStyle = '#1c1b2a';
    sg.fillRect(0, 0, W, H);
    sg.fillStyle = '#2b2940';
    for (let y = G / 2; y < H; y += G) for (let x = G / 2; x < W; x += G) sg.fillRect(x, y, 1, 1);
    for (const t of traces) {
      // a 2 px core with a darker outline, very dim, and a pad at each end
      for (const [a, b] of t.segs) {
        sg.fillStyle = '#17151f';
        sg.fillRect(Math.min(a[0], b[0]) - 2, Math.min(a[1], b[1]) - 2, Math.abs(a[0] - b[0]) + 4, Math.abs(a[1] - b[1]) + 4);
      }
      sg.fillStyle = mix(t.color, 0.09);
      for (const [a, b] of t.segs) sg.fillRect(Math.min(a[0], b[0]) - 1, Math.min(a[1], b[1]) - 1, Math.abs(a[0] - b[0]) + 2, Math.abs(a[1] - b[1]) + 2);
      for (const p of [t.pts[0], t.pts[t.pts.length - 1]]) {
        sg.fillStyle = '#17151f'; sg.fillRect(p[0] - 3, p[1] - 3, 6, 6);
        sg.fillStyle = mix(t.color, 0.2); sg.fillRect(p[0] - 2, p[1] - 2, 4, 4);
      }
    }
  }

  function mix(hex, k) {           // the colour faded into the board
    const n = parseInt(hex.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255], b = [28, 27, 42];
    return `rgb(${c.map((v, i) => Math.round(b[i] + (v - b[i]) * k)).join(',')})`;
  }

  function at(t, d) {
    for (const [a, b, s, l] of t.segs) {
      if (d <= s + l) {
        const k = (d - s) / l;
        return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
      }
    }
    return t.pts[t.pts.length - 1];
  }

  function spawn() {
    const t = pick(traces);
    if (!t) return;
    sparks.push({ t, d: 0, v: rnd(30, 70) * (surge > 0 ? 2.2 : 1), c: t.color });
  }

  function resize() {
    W = Math.ceil(innerWidth / K);
    H = Math.ceil(innerHeight / K);
    bg.width = W; bg.height = H;
    layTraces();
    paintStill();
    sparks = [];
    g.drawImage(still, 0, 0);
  }

  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    surge = Math.max(0, surge - dt);
    const want = Math.max(4, traces.length * (surge > 0 ? 1.4 : 0.4));
    if (sparks.length < want && Math.random() < (surge > 0 ? 0.9 : 0.06)) spawn();
    g.drawImage(still, 0, 0);
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.d += s.v * dt;
      if (s.d >= s.t.total) { sparks.splice(i, 1); continue; }
      // a short fading trail of whole pixels behind a bright head
      for (let j = 6; j >= 0; j--) {
        const p = at(s.t, Math.max(0, s.d - j * 2));
        g.globalAlpha = j === 0 ? 1 : 0.5 * (1 - j / 7);
        g.fillStyle = j === 0 ? '#ffffff' : s.c;
        g.fillRect(Math.round(p[0]) - 1, Math.round(p[1]) - 1, 2, 2);
      }
      g.globalAlpha = 1;
    }
    if (!calm.matches) raf = requestAnimationFrame(frame);
  }

  function start() {
    if (!raf && !calm.matches && !document.hidden) { last = 0; raf = requestAnimationFrame(frame); }
  }

  let rs = 0;
  addEventListener('resize', () => { clearTimeout(rs); rs = setTimeout(() => { resize(); start(); }, 120); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) start(); });
  calm.addEventListener?.('change', () => { resize(); start(); });
  resize();
  start();

  // ---------------------------------------------------------------- particles
  const fx = document.getElementById('fx');
  const f = fx.getContext('2d');
  let parts = [], fraf = 0, flast = 0;

  function fxSize() {
    fx.width = Math.ceil(innerWidth / K);
    fx.height = Math.ceil(innerHeight / K);
  }
  fxSize();
  addEventListener('resize', fxSize);

  function burst(x, y, n = 40, colors = COLORS, opts = {}) {
    if (calm.matches) n = Math.min(n, 8);
    const speed = opts.speed || 160, up = opts.up ?? 120, grav = opts.grav ?? 340;
    for (let i = 0; i < n; i++) {
      const a = opts.spread != null ? -Math.PI / 2 + rnd(-opts.spread, opts.spread) : rnd(0, Math.PI * 2);
      const v = rnd(0.35, 1) * speed;
      parts.push({
        x: x / K, y: y / K,
        vx: Math.cos(a) * v / K, vy: (Math.sin(a) * v - up) / K,
        g: grav / K, life: rnd(0.6, 1.3) * (opts.life || 1), age: 0,
        c: pick(colors), s: Math.random() < 0.25 ? 2 : 1,
      });
    }
    if (!fraf) { flast = 0; fraf = requestAnimationFrame(fxFrame); }
  }

  function fxFrame(now) {
    fraf = 0;
    const dt = Math.min(0.05, (now - (flast || now)) / 1000);
    flast = now;
    f.clearRect(0, 0, fx.width, fx.height);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.age += dt;
      if (p.age >= p.life) { parts.splice(i, 1); continue; }
      p.vy += p.g * dt;
      p.vx *= 0.99;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const k = 1 - p.age / p.life;
      // twinkle near the end, like the game's sparkles
      if (k < 0.3 && ((p.age * 20) | 0) % 2) continue;
      f.fillStyle = p.c;
      f.fillRect(Math.round(p.x), Math.round(p.y), p.s + 1, p.s + 1);
      f.fillStyle = 'rgba(255,255,255,.9)';
      f.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }
    if (parts.length) fraf = requestAnimationFrame(fxFrame);
    else f.clearRect(0, 0, fx.width, fx.height);
  }

  // ---------------------------------------------------------------- screen moments
  function flash() {
    const el = document.getElementById('flash');
    el.classList.remove('go');
    void el.offsetWidth;
    el.classList.add('go');
  }

  function shake(el = document.getElementById('app'), amount = 6, ms = 320) {
    if (calm.matches || !el.animate) return;
    const frames = [];
    for (let i = 0; i < 8; i++) {
      const k = 1 - i / 8;
      frames.push({ transform: `translate(${Math.round(rnd(-1, 1) * amount * k)}px, ${Math.round(rnd(-1, 1) * amount * k)}px)` });
    }
    frames.push({ transform: 'none' });
    el.animate(frames, { duration: ms, easing: 'steps(9)' });
  }

  window.FX = {
    burst, flash, shake,
    surge(s = 2.5) { surge = s; for (let i = 0; i < 10; i++) spawn(); start(); },
    get calm() { return calm.matches; },
  };
})();
