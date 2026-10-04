// The beta page itself: the intro, Mazell's greeting, the promise switch, the download cards and every other
// screen. It only talks to window.Beta (token / detectOS / status / download).
(() => {
  'use strict';
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const params = new URLSearchParams(location.search);
  const calm = () => FX.calm;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* (private window: not remembered) */ } },
  };
  const pad = (n) => String(n ?? 0).padStart(2, '0');
  const mb = (b) => (b / 1048576).toFixed(1) + ' MB';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const centre = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };

  const FACE = { idle: 0, talk: 1, blink: 2, smile: 3, wide: 4, sleep: 5, pjIdle: 6, pjTalk: 7, pjWide: 8 };
  const OS = {
    macos: { name: 'MACOS', short: 'Mac', icon: 'icon_mac', color: 'var(--cyan)', cpu: 'UNIVERSAL',
      line: 'For any Mac, Apple silicon or Intel: one app runs on both.' },
    windows: { name: 'WINDOWS', short: 'Windows', icon: 'icon_win', color: 'var(--blue)', cpu: '64-BIT',
      line: 'For 64-bit Windows PCs. Unzip it and play: there is nothing to install.' },
    linux: { name: 'LINUX', short: 'Linux', icon: 'icon_linux', color: 'var(--orange)', cpu: 'X86-64',
      line: 'For x86-64 Linux with glibc 2.39 or newer (Fedora 40+, Ubuntu 24.04+).' },
  };

  // ================================================================ sound plumbing
  const unlock = () => SFX.unlock();
  addEventListener('pointerdown', unlock, { capture: true });
  addEventListener('keydown', unlock, { capture: true });

  const muteBtn = $('#mute');
  function showMute() {
    muteBtn.setAttribute('aria-pressed', String(SFX.muted));
    muteBtn.setAttribute('aria-label', SFX.muted ? 'Sound is off. Turn sound on' : 'Sound is on. Turn sound off');
  }
  muteBtn.addEventListener('click', () => {
    SFX.setMuted(!SFX.muted);
    showMute();
    SFX.chime(true);
  });
  showMute();

  // A blip when the mouse finds something you can press, pitched by what it is.
  const HOVER = [['.knife', 0.8], ['.inbtn', 0.9], ['.btn', 1], ['.card', 0.75], ['.icon-btn', 1.15], ['.shot', 0.85],
    ['.sleeper-btn', 0.7], ['.logo .l', 1.3], ['.bubble', 0.9], ['.brand', 1.1]];
  let hovered = null, lastHover = 0;
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    for (const [sel, p] of HOVER) {
      const el = e.target.closest(sel);
      if (!el) continue;
      if (el !== hovered && performance.now() - lastHover > 45 && !el.disabled) {
        lastHover = performance.now();
        SFX.play('hover', sel === '.logo .l' ? p + 0.08 * [...el.parentNode.children].indexOf(el) : p);
      }
      hovered = el;
      return;
    }
    hovered = null;
  });

  // ================================================================ Mazell talks (typewriter + voice blips)
  // Markup like the game's: *yellow*  ^green^  %red%  _cyan_  ~pink~
  function parse(s) {
    const out = [];
    const marks = { '*': 'y', '^': 'g', '%': 'r', _: 'c', '~': 'k' };
    let cls = '';
    for (const ch of s) {
      if (marks[ch]) { cls = cls === marks[ch] ? '' : marks[ch]; continue; }
      out.push([ch, cls]);
    }
    return out;
  }
  const plain = (s) => s.replace(/[*^%_~]/g, '');

  class Talk {
    constructor(root, opts = {}) {
      this.root = root;
      this.face = $('.face', root);
      this.say_ = $('.say', root);
      this.pips = $('.pips', root);
      this.full = $('.sr-only', root);
      this.voiceBase = opts.voice || 260;
      this.faces = opts.faces || { idle: FACE.idle, talk: FACE.talk, blink: FACE.blink };
      this.pages = [];
      this.i = 0;
      this.raf = 0;
      const go = (e) => { if (e.target.closest('a')) return; this.advance(true); };
      $('.bubble', root).addEventListener('click', go);
      $('.bubble', root).addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.advance(true); }
      });
      $('.next', root).addEventListener('click', (e) => { e.stopPropagation(); this.advance(true); });
    }

    say(pages, { face, onDone } = {}) {
      this.pages = pages.map(parse);
      this.restFace = face ?? this.faces.idle;
      this.onDone = onDone;
      this.i = 0;
      this.full.textContent = pages.map(plain).join(' ');
      this.pips.innerHTML = pages.length > 1 ? pages.map(() => '<i></i>').join('') : '';
      this.page();
    }

    page() {
      cancelAnimationFrame(this.raf);
      clearTimeout(this.auto);
      this.shown = 0;
      this.voiced = 0;
      this.t = 0;
      this.last = 0;
      this.root.classList.remove('waiting');
      this.root.classList.add('talking');
      $$('i', this.pips).forEach((p, k) => p.classList.toggle('on', k <= this.i));
      if (calm()) this.shown = this.pages[this.i].length;
      this.raf = requestAnimationFrame((n) => this.tick(n));
    }

    tick(now) {
      const dt = Math.min(0.05, (now - (this.last || now)) / 1000);
      this.last = now;
      this.t += dt;
      const text = this.pages[this.i];
      const was = Math.floor(this.shown);
      this.shown = Math.min(text.length, this.shown + dt * 50);
      const n = Math.floor(this.shown);
      for (let k = Math.max(was, this.voiced); k < n; k++) {
        const ch = text[k][0];
        if (ch !== ' ' && k % 2 === 0) SFX.voice(ch, this.voiceBase);
      }
      this.voiced = n;
      this.draw(n, n < text.length);
      const typing = n < text.length;
      let f = this.restFace;
      if (typing) f = this.t % 0.16 < 0.08 ? this.faces.talk : this.faces.idle;
      else if (this.t % 3.4 < 0.12 && this.faces.blink != null && this.restFace === this.faces.idle) f = this.faces.blink;
      this.face.style.setProperty('--f', f);
      if (!typing && this.root.classList.contains('talking')) this.finished();
      this.raf = requestAnimationFrame((x) => this.tick(x));
    }

    draw(n, caret) {
      const text = this.pages[this.i];
      let html = '', cls = null;
      for (let k = 0; k < n; k++) {
        const [ch, c] = text[k];
        if (c !== cls) { if (cls) html += '</span>'; if (c) html += `<span class="${c}">`; cls = c; }
        html += esc(ch);
      }
      if (cls) html += '</span>';
      if (caret) html += '<span class="caret"></span>';
      if (html !== this.html) { this.say_.innerHTML = html; this.html = html; }
    }

    finished() {
      this.root.classList.remove('talking');
      const more = this.i < this.pages.length - 1;
      this.root.classList.toggle('waiting', more);
      if (more) {
        const len = this.pages[this.i].length;
        this.auto = setTimeout(() => this.advance(false), 1700 + len * 38);
      } else if (this.onDone) {
        const cb = this.onDone;
        this.onDone = null;
        cb();
      }
    }

    advance(byHand) {
      const text = this.pages[this.i];
      if (!text) return;
      if (this.shown < text.length) {
        this.shown = text.length;
        return;
      }
      if (this.i < this.pages.length - 1) {
        if (byHand) SFX.play('tick', 0.8);
        this.i++;
        this.page();
      }
    }
  }

  // ================================================================ boards: parts and wires in game pixels
  function put(el, x, y, w, h) {
    el.style.setProperty('--x', x);
    el.style.setProperty('--y', y);
    el.style.setProperty('--w', w);
    el.style.setProperty('--h', h);
    return el;
  }

  function wire(layer, pts, color) {
    // Each run of the wire is a 1 px outline under a 4 px core; sparks travel the way the points go.
    const segs = [];
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      const v = x0 === x1;
      const a = v ? Math.min(y0, y1) : Math.min(x0, x1), len = v ? Math.abs(y1 - y0) : Math.abs(x1 - x0);
      const o = document.createElement('i'), c = document.createElement('i');
      o.className = 'w';
      c.className = 'wc' + (v ? ' v' : '');
      if (v) { put(o, x0 - 3, a - 3, 6, len + 6); put(c, x0 - 2, a - 2, 4, len + 4); }
      else { put(o, a - 3, y0 - 3, len + 6, 6); put(c, a - 2, y0 - 2, len + 4, 4); }
      for (const e of [o, c]) e.style.setProperty('--wire', color);
      c.style.setProperty('--flow', (v ? y1 > y0 : x1 > x0) ? 'normal' : 'reverse');
      layer.prepend(o);
      layer.append(c);
      segs.push(o, c);
    }
    return { lit(on) { segs.forEach((s) => s.classList.toggle('lit', on)); } };
  }

  function fit(board, w, h, max = 3) {
    board.style.setProperty('--bw', w);
    board.style.setProperty('--bh', h);
    const scale = () => {
      const panel = board.closest('.panel') || board.parentNode;
      let avail = panel.clientWidth - (innerWidth <= 720 ? 36 : 64);
      if (board.id === 'promise-board' && innerWidth > 1000) avail = Math.min(avail - 360, w * max);
      let s = Math.min(max, Math.floor(avail / w));
      if (s < 2) s = Math.max(1, Math.floor((avail / w) * 4) / 4);
      board.style.setProperty('--bs', s);
    };
    scale();
    addEventListener('resize', scale);
  }

  const RED = '#e5484d', YEL = '#f5d33c', WHITE = '#c9c8da', CYAN = '#58d6e8', PINK = '#f078c8';

  // ================================================================ screens
  const SCREENS = ['loading', 'main', 'invite', 'closed', 'mobile', 'error'];
  function show(name) {
    for (const s of SCREENS) $('#screen-' + s).hidden = s !== name;
    document.body.dataset.screen = name;
  }

  // ================================================================ the intro: a CRT powering on
  let bootDone;
  function boot() {
    const mode = params.get('boot') === '1' ? 'full' : params.get('boot') === '0' ? 'none'
      : store.get('tlbeta.booted') === '1' ? 'quick' : 'full';
    if (mode === 'none') return Promise.resolve();
    const crt = $('#crt');
    if (mode === 'quick' || calm()) {
      if (calm()) return Promise.resolve();
      crt.classList.add('run', 'quick');
      return sleep(420).then(() => crt.classList.remove('run', 'quick'));
    }
    const el = $('#boot');
    el.hidden = false;
    return new Promise((resolve) => {
      let gone = false;
      const go = (e) => {
        if (gone) return;
        if (e.type === 'keydown' && ['Tab', 'Shift', 'Meta', 'Alt', 'Control'].includes(e.key)) return;
        gone = true;
        e.preventDefault();
        SFX.unlock();
        el.classList.add('pressed');
        SFX.play('click');
        store.set('tlbeta.booted', '1');
        setTimeout(() => {
          SFX.play('crtOn');
          el.classList.add('gone');
          crt.classList.add('run');
          setTimeout(() => SFX.play('whoosh'), 180);
        }, 140);
        setTimeout(() => {
          el.hidden = true;
          crt.classList.remove('run');
          resolve();
        }, 140 + 560);
        removeEventListener('keydown', go);
      };
      el.addEventListener('click', go);
      addEventListener('keydown', go);
    });
  }

  function dropLogo(logo) {
    const letters = $$('.l', logo);
    letters.forEach((l, i) => l.style.setProperty('--i', i));
    logo.classList.add('drop');
    letters.forEach((l, i) => setTimeout(() => SFX.play('tick', 0.7 + i * 0.07), i * 70 + 200));
    setTimeout(() => {
      logo.classList.remove('drop');
      SFX.play('confirm');
      SFX.play('sparkle', 1, 0.05);
      const [x, y] = centre(logo);
      FX.burst(x, y, 34, ['#f5d33c', '#fff2a8', '#ffffff'], { speed: 240, up: 60, life: 0.8 });
    }, letters.length * 70 + 520);
  }

  // ================================================================ main: greeting, promise, cards
  let st = null, promised = false, busy = null;
  const local = {};               // per computer: { state, msg } that outranks the server's answer for now
  let talkMain;
  let promiseBoard;

  function greet() {
    const n = pad(st.tester);
    const any = Object.values(st.platforms || {}).some((p) => p.state === 'done');
    const pages = any ? [
      `HEY *TESTER #${n}*! WELCOME BACK!`,
      `YOUR COPY IS ALREADY OUT THERE. NEED IT ON ANOTHER KIND OF COMPUTER TOO? IT'S ALL DOWN BELOW.`,
      `AND THANK YOU AGAIN. ^EVERY BUG YOU FIND^ MAKES THE GAME BETTER FOR EVERYONE WHO COMES NEXT. ♥`,
    ] : [
      `HEY *TESTER #${n}*! YOU MADE IT!`,
      `THIS IS *TINY LOGIC*. YOU START WITH ONE LITTLE TRANSISTOR AND END UP BUILDING A WHOLE COMPUTER.`,
      `YOU'RE ONE OF THE VERY FIRST PEOPLE TO PLAY IT. ^THANK YOU.^ SERIOUSLY. IT MEANS THE WORLD TO ME.`,
      `ONE TINY THING FIRST: FLIP THAT SWITCH DOWN THERE TO PROMISE YOU'LL KEEP IT SECRET. ↓`,
    ];
    talkMain.say(pages);
  }

  function buildPromise() {
    const board = $('#promise-board');
    fit(board, 196, 118, 3);
    const layer = $('.wires', board);
    put($('.battery', board), 0, 60, 16, 48);
    $$('.resistor', board).forEach((r) => put(r, 96, 45, 48, 16));
    put($('.led-wrap', board), 150, 29, 48, 48);
    put($('#knife', board), 20, 0, 72, 62);
    put($('.flip-me', board), 64, 2, 70, 10);
    const wires = [
      wire(layer, [[8, 62], [8, 53], [22, 53]], RED),
      wire(layer, [[90, 53], [98, 53]], YEL),
      wire(layer, [[142, 53], [152, 53]], YEL),
      wire(layer, [[174, 74], [174, 113], [8, 113], [8, 105]], WHITE),
    ];
    promiseBoard = { board, wires };
    const knife = $('#knife');
    knife.addEventListener('click', () => (promised ? unpromise() : promise()));
    // hovering the handle gives it a tiny wiggle, like it wants to be pulled
    knife.addEventListener('pointerenter', () => { if (!promised && !swinging) setFrame(1); });
    knife.addEventListener('pointerleave', () => { if (!promised && !swinging) setFrame(0); });
  }

  let swinging = false;
  const setFrame = (f) => $('#knife').style.setProperty('--kf', f);
  async function swing(from, to) {
    swinging = true;
    const step = from < to ? 1 : -1;
    for (let f = from; f !== to + step; f += step) {
      setFrame(f);
      if (!calm()) await sleep(f === from ? 0 : 26 + Math.abs(f - from) * 4);
    }
    swinging = false;
  }

  async function promise() {
    if (promised || swinging) return;
    promised = true;
    const knife = $('#knife');
    knife.setAttribute('aria-checked', 'true');
    SFX.play('whoosh');
    await swing(0, 7);
    // contact: a clack, a spark where the blade meets the clip, the current goes round
    SFX.play('switch');
    SFX.play('zap', 1.2);
    const r = knife.getBoundingClientRect();
    FX.burst(r.left + r.width * 0.8, r.top + r.height * 0.82, 26, ['#ffffff', '#f5d33c', '#58d6e8'], { speed: 220, up: 80, life: 0.6 });
    FX.shake($('#promise'), 4, 220);
    const { board, wires } = promiseBoard;
    board.classList.add('lit');
    $('#promise').classList.add('on');
    for (let i = 0; i < wires.length; i++) {
      wires[i].lit(true);
      SFX.play('tick', 1 + i * 0.18);
      await sleep(calm() ? 0 : 70);
    }
    $('.led-wrap', board).classList.add('lit');
    SFX.play('pop', 1.1);
    const [lx, ly] = centre($('.led-wrap', board));
    FX.burst(lx, ly, 22, ['#5fe08a', '#b5f6cb', '#ffffff'], { speed: 150, up: 70, life: 0.7 });
    await sleep(calm() ? 0 : 160);
    // the downloads power up one after another
    SFX.play('powerUp');
    document.body.classList.add('powered');
    FX.surge(2.5);
    const cards = $$('.card');
    for (let i = 0; i < cards.length; i++) {
      await sleep(calm() ? 0 : 140);
      render(cards[i].dataset.os);
      cards[i].classList.remove('power-on');
      void cards[i].offsetWidth;
      cards[i].classList.add('power-on');
      SFX.play('pop', 0.9 + i * 0.15);
    }
    await sleep(200);
    SFX.play('confirm', 1.1);
    talkMain.say([`^PROMISE ACCEPTED!^ THE DOWNLOADS ARE ON. PICK YOUR COMPUTER AND HAVE FUN!`], { face: FACE.smile });
    const first = $('.card.yours') || cards[0];
    const box = first?.getBoundingClientRect();
    if (box && (box.bottom > innerHeight || box.top < 0)) first.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'center' });
  }

  async function unpromise() {
    if (!promised || busy || swinging) return;
    promised = false;
    const knife = $('#knife');
    knife.setAttribute('aria-checked', 'false');
    SFX.play('switch', 0.8);
    SFX.play('crtOff');
    promiseBoard.wires.forEach((w) => w.lit(false));
    promiseBoard.board.classList.remove('lit');
    $('.led-wrap', promiseBoard.board).classList.remove('lit');
    $('#promise').classList.remove('on');
    document.body.classList.remove('powered');
    $$('.card').forEach((c) => render(c.dataset.os));
    await swing(7, 0);
  }

  // ---------------------------------------------------------------- cards
  function buildCards() {
    const wrap = $('#cards');
    wrap.innerHTML = '';
    const mine = Beta.detectOS();
    for (const os of Object.keys(OS)) {
      if (!st.platforms?.[os]) continue;
      const info = OS[os];
      const card = $('#card-tpl').content.firstElementChild.cloneNode(true);
      card.dataset.os = os;
      card.style.setProperty('--c', info.color);
      card.setAttribute('aria-label', info.short);
      $('.card-icon', card).src = `art/${info.icon}.png`;
      $('.card-name', card).textContent = info.name;
      $('.card-line', card).textContent = info.line;
      if (os === mine) {
        card.classList.add('yours');
        $('.card-tag', card).hidden = false;
      }
      $('.dl', card).addEventListener('click', () => download(os));
      wrap.append(card);
      render(os);
    }
  }

  function chipsFor(os) {
    const p = st.platforms[os];
    return `<span class="chipstat"><span class="k px">SIZE</span><span class="v px">${p.size ? mb(p.size) : '?'}</span></span>` +
      `<span class="chipstat"><span class="k px">CPU</span><span class="v px">${OS[os].cpu}</span></span>`;
  }

  function render(os) {
    const card = $(`.card[data-os="${os}"]`);
    if (!card) return;
    const p = st.platforms[os] || { state: 'blocked' };
    const l = local[os];
    let state = promised ? (l?.state || p.state) : 'locked';
    if (busy === os) state = 'busy';
    card.dataset.state = state;
    $('.chips', card).innerHTML = chipsFor(os);
    const dl = $('.dl', card);
    dl.disabled = !!busy;
    $('.dl-label', dl).textContent = state === 'error' ? 'TRY AGAIN' : 'DOWNLOAD';
    $('img', dl).src = state === 'error' ? 'art/icon_retry.png' : 'art/icon_down.png';
    dl.setAttribute('aria-label', (state === 'error' ? 'Try again: download for ' : 'Download for ') + OS[os].short);
    const msg = $('.card-msg', card);
    if (state === 'done') {
      msg.innerHTML = `<img src="art/icon_check.png" alt=""><p><span class="px title">DOWNLOADED ✓</span>${esc(l?.msg || p.reason ||
        `This link already got its copy for ${OS[os].short}.`)}</p>` +
        `<button class="btn btn-ghost how" type="button"><img src="art/icon_folder.png" alt=""><span class="px">HOW TO OPEN IT</span></button>`;
      $('.how', msg).addEventListener('click', () => { SFX.play('click'); openInstall(os, null); });
    } else if (state === 'blocked') {
      msg.innerHTML = `<img src="art/icon_lock.png" alt=""><p><span class="px title">NOT FROM HERE</span>${esc(l?.msg || p.reason ||
        "This one can't be downloaded with your link right now.")}</p>`;
    } else if (state === 'error') {
      msg.innerHTML = `<img src="art/icon_warn.png" alt=""><p><span class="px title">OOPS!</span>${esc(l?.msg || 'Something went wrong.')}</p>`;
    }
  }

  // ---------------------------------------------------------------- downloading
  const PHASES = ['claim', 'fetch', 'decrypt', 'stamp', 'save'];
  const PHASE_NAME = { claim: 'CLAIMING', fetch: 'FETCHING', decrypt: 'UNLOCKING', stamp: 'STAMPING', save: 'SAVING' };

  async function download(os) {
    if (busy || !promised) return;
    busy = os;
    delete local[os];
    $$('.card').forEach((c) => render(c.dataset.os));
    const card = $(`.card[data-os="${os}"]`);
    const prog = $('.progress', card);
    const fill = $('.pfill', prog);
    $('.pbits', prog).textContent = Array.from({ length: 64 }, () => (Math.random() < 0.5 ? '0' : '1')).join('').replace(/(.{8})/g, '$1 ');
    fill.style.setProperty('--pc', 0);
    $$('.pleds li', prog).forEach((li) => (li.className = ''));
    SFX.play('click');
    SFX.chime(true);
    let phase = null, lastTick = 0;
    const onProgress = ({ phase: ph, loaded = 0, total = 0 }) => {
      if (ph !== phase) {
        phase = ph;
        const at = PHASES.indexOf(ph);
        $$('.pleds li', prog).forEach((li, i) => (li.className = i < at ? 'done' : i === at ? 'now' : ''));
        $('.phase-name', prog).textContent = PHASE_NAME[ph] || ph.toUpperCase();
        $('.phase-num', prog).textContent = '';
        if (at > 0) SFX.play('confirm', 0.8 + at * 0.08);
        if (ph === 'stamp') SFX.play('stamp');
        fill.style.setProperty('--pc', ph === 'claim' ? 3 : ph === 'fetch' ? 4 : 100);
      }
      if (ph === 'fetch' && total > 0) {
        const pc = Math.max(4, Math.min(100, (loaded / total) * 100));
        fill.style.setProperty('--pc', pc.toFixed(1));
        $('.phase-num', prog).textContent = `${mb(loaded)} / ${mb(total)}`;
        if (pc - lastTick >= 4) {
          lastTick = pc;
          SFX.play('tick', 0.8 + pc / 110);
        }
      }
    };
    try {
      const res = await Beta.download(os, onProgress);
      $$('.pleds li', prog).forEach((li) => (li.className = 'done'));
      await sleep(calm() ? 0 : 380);
      busy = null;
      local[os] = { state: 'done', msg: `Saved as ${res.fileName}. Look in your Downloads folder.` };
      $$('.card').forEach((c) => render(c.dataset.os));
      celebrate(card);
      openInstall(os, res);
    } catch (e) {
      busy = null;
      const code = e?.code || 'failed';
      if (code === 'closed') return closed();
      if (code === 'no-link' || code === 'bad-link') return invite(code === 'bad-link', e.message);
      local[os] = code === 'already' ? { state: 'done', msg: e.message }
        : code === 'blocked' ? { state: 'blocked', msg: e.message }
          : { state: 'error', msg: e?.message || 'Something went wrong while making your copy. Try again in a moment.' };
      $$('.card').forEach((c) => render(c.dataset.os));
      if (code !== 'already') {
        SFX.play('error');
        card.classList.remove('shake');
        void card.offsetWidth;
        card.classList.add('shake');
      } else SFX.play('confirm');
    }
    refresh();
  }

  async function refresh() {
    try {
      const fresh = await Beta.status();
      if (fresh.closed) return closed();
      st = fresh;
      for (const os of Object.keys(local)) if (local[os].state !== 'error' && st.platforms[os]?.state === local[os].state) delete local[os];
      $$('.card').forEach((c) => render(c.dataset.os));
    } catch (e) {
      if (e?.code === 'closed') closed();
    }
  }

  function celebrate(card) {
    const [x, y] = centre(card);
    FX.flash();
    FX.shake(document.getElementById('app'), 5, 300);
    FX.burst(x, y - 40, 70, undefined, { speed: 320, up: 160 });
    setTimeout(() => FX.burst(x - 120, y, 30, undefined, { speed: 220, up: 140 }), 140);
    setTimeout(() => FX.burst(x + 120, y, 30, undefined, { speed: 220, up: 140 }), 260);
    SFX.play('boom', 1.6);
    SFX.fanfare();
    FX.surge(3);
    talkMain.say([`*YOU'VE GOT IT!* TELL ME EVERYTHING THAT BREAKS, AND HAVE FUN BUILDING. ♥`], { face: FACE.smile });
  }

  // ---------------------------------------------------------------- how to open it
  const key = (t) => `<span class="key">${t}</span>`;
  function steps(os, file) {
    if (os === 'macos') return [
      ['icon_zip', 'Open the zip in your Downloads folder (double-click it).'],
      ['icon_folder', `Drag <strong>TinyLogic.app</strong> into <strong>Applications</strong>, then open it.`],
      ['icon_shield', `macOS says it can't check the app: the beta isn't notarized yet. Click ${key('DONE')}.`],
      ['icon_gear', `Open <strong>System Settings › Privacy &amp; Security</strong>, scroll down, click ${key('OPEN ANYWAY')} and open Tiny Logic again.`],
    ];
    if (os === 'windows') return [
      ['icon_zip', `Right-click the zip and choose <strong>Extract All</strong>.`],
      ['icon_win', `Open the new folder and double-click <strong>TinyLogic.exe</strong>.`],
      ['icon_shield', `If “Windows protected your PC” pops up, click ${key('MORE INFO')}, then ${key('RUN ANYWAY')}.`],
    ];
    return [
      ['icon_zip', `Unzip it: <code>unzip ${esc(file || 'TinyLogic-linux.zip')}</code> (or right-click › Extract).`],
      ['icon_term', `In the new folder, run <code>./TinyLogic</code>.`],
      ['icon_linux', `It needs glibc 2.39 or newer: Fedora 40+, Ubuntu 24.04+ or anything as fresh.`],
    ];
  }

  function openInstall(os, res) {
    const box = $('#install');
    const title = res ? `GOT IT!` : 'HOW TO OPEN IT';
    const stamp = res?.stamp ? res.stamp.toUpperCase().replace(/(.{8})(?=.)/g, '$1 ') : '';
    box.innerHTML = `
      <div class="got">
        <div class="face-wrap"><div class="face" role="img" aria-label="Mazell, smiling"></div></div>
        <div>
          <h2 class="got-title" aria-label="${title}">${[...title].map((c, i) => c === ' ' ? ' ' : `<span style="--i:${i}" aria-hidden="true">${c}</span>`).join('')}</h2>
          ${res ? `<p class="got-file">Your copy for ${OS[os].short} is saved as <code>${esc(res.fileName)}</code>. Look in your Downloads folder.</p>`
    : `<p class="got-file">Your copy for ${OS[os].short} is already downloaded. Here's how to get it going.</p>`}
        </div>
      </div>
      ${stamp ? `<div class="stamp">
        <span class="stamp-k px">COPY ID</span>
        <span class="stamp-v px">${stamp}</span>
        <button class="btn btn-ghost btn-small copy-id" type="button"><img src="art/icon_copy.png" alt=""><span class="px">COPY</span></button>
        <p class="stamp-note">This ID is stamped inside your copy and tied to your tester number. If a copy ever leaks, it says
          whose it was. Keep it somewhere, in case Mazell asks which copy you have.</p>
      </div>` : ''}
      <h3 class="h px"><img src="art/${OS[os].icon}.png" alt="">HOW TO OPEN IT ON ${OS[os].name === 'MACOS' ? 'A MAC' : OS[os].name}</h3>
      <ol class="steps">${steps(os, res?.fileName).map(([ic, t], i) => `<li style="--i:${i}"><img src="art/${ic}.png" alt=""><p>${t}</p></li>`).join('')}</ol>
      <div class="install-foot">
        <span>Found a bug or something confusing? Tell Mazell: that's what the beta is for.</span>
        <button class="btn btn-ghost btn-small to-cards" type="button"><span class="px">↑ OTHER COMPUTERS</span></button>
      </div>`;
    $('.face', box).style.setProperty('--f', FACE.smile);
    $('.copy-id', box)?.addEventListener('click', async (e) => {
      const ok = await copy(res.stamp.toUpperCase());
      $('.px', e.currentTarget).textContent = ok ? 'COPIED ✓' : 'SELECT IT';
      SFX.play(ok ? 'confirm' : 'error');
    });
    $('.to-cards', box).addEventListener('click', () => {
      SFX.play('click');
      $('#cards').scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'center' });
    });
    box.hidden = false;
    setTimeout(() => {
      box.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'start' });
      box.focus({ preventScroll: true });
    }, res ? 650 : 60);
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const t = document.createElement('textarea');
      t.value = text;
      t.setAttribute('readonly', '');
      t.style.position = 'fixed';
      t.style.opacity = '0';
      document.body.append(t);
      t.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { /* (no clipboard at all) */ }
      t.remove();
      return ok;
    }
  }

  async function main() {
    show('main');
    const name = (st.buildName || 'Beta').toUpperCase();
    $('#build-tag').textContent = name;
    $('#hero-build').textContent = 'PRIVATE ' + name;
    talkMain = new Talk($('#talk-main'));
    buildPromise();
    buildCards();
    dropLogo($('.logo'));
    await sleep(calm() ? 0 : 900);
    greet();
  }

  // ================================================================ toys: a gate you can poke
  function toy(boardEl, { chip, labels, out, color }) {
    fit(boardEl, 174, 114, 3);
    boardEl.innerHTML = '<div class="wires"></div>';
    const layer = $('.wires', boardEl);
    const ins = [];
    const ws = [
      wire(layer, [[44, 24], [60, 24], [60, 50], [74, 50]], CYAN),
      wire(layer, [[44, 84], [66, 84], [66, 61], [74, 61]], PINK),
    ];
    const wo = wire(layer, [[117, 55], [132, 55]], YEL);
    labels.forEach((lab, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'part inbtn';
      b.innerHTML = '<img src="art/in_off.png" alt="">';
      b.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-label', `Input ${lab.name}`);
      put(b, -2, i ? 60 : 0, 48, 48);
      boardEl.append(b);
      const l = put(document.createElement('span'), -2, i ? 106 : 46, 48, 9);
      l.className = 'lbl px';
      l.textContent = lab.name;
      boardEl.append(l);
      ins.push({ b, l, on: false, stuck: lab.stuck });
    });
    const c = put(document.createElement('img'), 72, 40, 48, 32);
    c.className = 'part';
    c.src = `art/${chip}.png`;
    c.alt = chip === 'chip_nand' ? 'A NAND chip' : 'An AND chip';
    boardEl.append(c);
    const led = put(document.createElement('div'), 128, 31, 48, 48);
    led.className = 'part led-wrap';
    led.innerHTML = `<span class="glow"></span><img class="off" src="art/led_${color}_off.png" alt=""><img class="on" src="art/led_${color}_on.png" alt="">`;
    boardEl.append(led);
    const ol = put(document.createElement('span'), 124, 81, 52, 9);
    ol.className = 'lbl px';
    ol.textContent = out;
    boardEl.append(ol);
    return { ins, ws, wo, led, ol };
  }

  function nandToy() {
    const t = toy($('#toy-nand'), { chip: 'chip_nand', labels: [{ name: 'A' }, { name: 'B' }], out: 'LIGHT', color: 'green' });
    const cap = $('#toy-nand-caption');
    const sync = (poked) => {
      const [a, b] = t.ins.map((x) => x.on);
      const lit = !(a && b);
      t.ins.forEach((x, i) => {
        $('img', x.b).src = `art/in_${x.on ? 'on' : 'off'}.png`;
        x.b.setAttribute('aria-pressed', String(x.on));
        x.l.classList.toggle('hot', x.on);
        t.ws[i].lit(x.on);
      });
      t.wo.lit(lit);
      t.ol.classList.toggle('hot', lit);
      const was = t.led.classList.contains('lit');
      t.led.classList.toggle('lit', lit);
      cap.innerHTML = a && b ? `<b>A:1 B:1</b> → the light goes <b>OFF</b>. Both on is the only way to switch it off. From this one little gate you can build a whole computer.`
        : a || b ? `<b>A:${+a} B:${+b}</b> → still on. A NAND's light only goes out when <b>both</b> inputs are on. Keep going!`
          : `<b>A:0 B:0</b> → the light is on. A NAND's light stays on <b>unless both</b> inputs are on. Tap A and B.`;
      if (poked && was !== lit) {
        SFX.play('pop', lit ? 1.2 : 0.7);
        if (!lit) {
          const [x, y] = centre(t.led);
          FX.burst(x, y, 40, undefined, { speed: 200, up: 120 });
          SFX.play('sparkle');
        }
      }
    };
    t.ins.forEach((x) => x.b.addEventListener('click', () => {
      x.on = !x.on;
      SFX.play('switch', x.on ? 1.2 : 0.9);
      sync(true);
    }));
    sync(false);
  }

  function andToy() {
    const t = toy($('#toy-and'), { chip: 'chip_and', labels: [{ name: 'YOU' }, { name: 'LINK', stuck: true }], out: 'LIGHT', color: 'green' });
    const cap = $('#toy-and-caption');
    const say = (html) => { cap.innerHTML = html; };
    say('An AND gate only lights up when <b>both</b> of its inputs are on. Tap <b>YOU</b>.');
    const [you, link] = t.ins;
    link.b.classList.add('stuck');
    link.b.setAttribute('aria-label', 'Input LINK: needs your personal link');
    you.b.addEventListener('click', () => {
      you.on = !you.on;
      SFX.play('switch', you.on ? 1.2 : 0.9);
      $('img', you.b).src = `art/in_${you.on ? 'on' : 'off'}.png`;
      you.b.setAttribute('aria-pressed', String(you.on));
      you.l.classList.toggle('hot', you.on);
      t.ws[0].lit(you.on);
      say(you.on ? '<b>YOU:1 LINK:0</b> → no light. You showed up (thank you!) but the other half is your personal link.'
        : 'An AND gate only lights up when <b>both</b> of its inputs are on. Tap <b>YOU</b>.');
    });
    link.b.addEventListener('click', () => {
      SFX.play('error');
      link.b.classList.remove('nope');
      void link.b.offsetWidth;
      link.b.classList.add('nope');
      say('<b>LINK</b> is stuck at 0: only your personal invite link can switch it on. Mazell has those.');
    });
  }

  // ================================================================ the other screens
  function invite(bad, message) {
    show('invite');
    $('#invite-title').textContent = bad ? "THAT LINK DIDN'T WORK" : 'INVITE ONLY';
    $('#invite-body').textContent = bad
      ? (message || "Check you copied the whole link (the part after #k= matters), or ask Mazell for a fresh one.")
      : 'This beta is invite-only: ask Mazell for your personal link.';
    const t = new Talk($('#talk-invite'));
    andToy();
    setTimeout(() => t.say(bad ? [
      `HMM. *THAT LINK DOESN'T LOOK RIGHT.*`,
      `MAYBE THE END GOT CUT OFF WHEN IT WAS COPIED? THE PART AFTER *#K=* MATTERS.`,
      `COPY THE WHOLE LINK AND TRY AGAIN, OR ASK ME FOR A FRESH ONE.`,
    ] : [
      `OH, HI THERE!`,
      `THIS BETA IS *INVITE-ONLY*: EVERY TESTER GETS THEIR OWN PERSONAL LINK.`,
      `IF I INVITED YOU, OPEN THE LINK FROM YOUR MESSAGE. IF NOT, ASK ME FOR ONE! ♥`,
    ]), calm() ? 0 : 500);
  }

  let snores = 0, snoreTimer = 0;
  function closed() {
    show('closed');
    const face = $('#sleeper .face');
    const btn = $('#sleeper');
    const said = $('#sleeper-say');
    face.style.setProperty('--f', FACE.sleep);
    clearInterval(snoreTimer);
    snoreTimer = setInterval(() => { if (snores++ < 4 && !btn.classList.contains('awake')) SFX.play('snore'); }, 5200);
    let awakeT = 0;
    btn.onclick = () => {
      SFX.play('knock');
      SFX.play('pop', 0.7);
      btn.classList.add('awake');
      face.style.setProperty('--f', FACE.pjWide);
      said.textContent = pick(['HUH? OH, HI! THE DOWNLOADS ARE CLOSED FOR NOW. ZZZ...', 'FIVE MORE MINUTES... THE NEXT BETA IS COMING, PROMISE.', "MMF. THANKS FOR TESTING. YOU'RE THE BEST. ZZZ..."]);
      clearTimeout(awakeT);
      awakeT = setTimeout(() => {
        btn.classList.remove('awake');
        face.style.setProperty('--f', FACE.sleep);
      }, 2200);
    };
  }
  const pick = (a) => a[(Math.random() * a.length) | 0];

  function mobile(status) {
    show('mobile');
    const t = new Talk($('#talk-mobile'));
    const n = status ? `*TESTER #${pad(status.tester)}*` : '*THERE*';
    nandToy();
    setTimeout(() => t.say([
      `HEY ${n}! YOU'RE ON A PHONE OR TABLET.`,
      `TINY LOGIC RUNS ON *COMPUTERS*: MAC, WINDOWS AND LINUX.`,
      `OPEN THIS SAME LINK ON YOUR COMPUTER AND YOUR DOWNLOAD WILL BE WAITING. ^SEE YOU THERE!^`,
    ]), calm() ? 0 : 500);
    const link = location.href;
    $('#mail-link').href = `mailto:?subject=${encodeURIComponent('My Tiny Logic beta link')}&body=${encodeURIComponent(
      'Open this on my computer to download the Tiny Logic beta:\n\n' + link + '\n')}`;
    $('#mail-link').addEventListener('click', () => SFX.play('click'));
    $('#copy-link').addEventListener('click', async () => {
      const ok = await copy(link);
      $('#copied').textContent = ok ? 'COPIED! NOW OPEN IT ON YOUR COMPUTER.' : "COULDN'T COPY: USE EMAIL INSTEAD.";
      SFX.play(ok ? 'confirm' : 'error');
      if (ok) {
        const [x, y] = centre($('#copy-link'));
        FX.burst(x, y, 30, ['#5fe08a', '#ffffff', '#f5d33c'], { speed: 180, up: 100 });
      }
    });
  }

  function trouble(message) {
    show('error');
    $('#error-body').textContent = message || "The download server didn't answer. Check your internet connection and try again.";
    SFX.play('error');
    const btn = $('#retry');
    btn.onclick = async () => {
      SFX.play('click');
      const u = $('.unplugged');
      u.classList.add('plugging');
      await sleep(calm() ? 0 : 480);
      SFX.play('zap');
      await sleep(calm() ? 0 : 200);
      u.classList.remove('plugging');
      start();
    };
  }

  // ================================================================ which screen?
  async function start() {
    const os = Beta.detectOS();
    if (!Beta.token()) { await bootDone; return invite(false); }
    show('loading');
    try {
      st = await Beta.status();
    } catch (e) {
      await bootDone;
      const code = e?.code;
      if (code === 'no-link') return invite(false);
      if (code === 'bad-link') return invite(true, e.message);
      if (code === 'closed') return closed();
      if (os === 'mobile') return mobile(null);
      return trouble(e?.message);
    }
    await bootDone;
    if (st.closed) return closed();
    if (os === 'mobile') return mobile(st);
    main();
  }

  bootDone = boot();
  start();
})();
