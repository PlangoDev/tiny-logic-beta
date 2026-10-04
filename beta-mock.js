// A stand-in for beta.js with the same window.Beta API, for trying every screen without a server.
// index.html loads it instead of beta.js whenever the address has ?mock. It never downloads or saves anything.
//
//   ?mock=ready     every computer ready to download (the default)
//   ?mock=done      your computer already downloaded, the others ready
//   ?mock=blocked   one done, two blocked (with the reasons the server would give)
//   ?mock=mixed     one done, one blocked, one ready
//   ?mock=closed    downloads are closed            ?mock=bad      a broken link
//   ?mock=nolink    no #k= in the address           ?mock=mobile   on a phone or tablet
//   ?mock=network   the server can't be reached (works again on retry)
//   ?mock=fail      a download fails part way (works again on retry)
//   ?mock=already   the server says this copy was already downloaded
// Extras:  &os=macos|windows|linux   pretend to be that computer     &tester=7   the tester number
//          &auto=promise|download    flip the switch / start a download by themselves (for screenshots)
//          &hold=0.6                 freeze the download at 60% of the fetch      &boot=0|1  skip / force the intro
(() => {
  'use strict';
  const q = new URLSearchParams(location.search);
  const mode = q.get('mock') || 'ready';
  const tester = Number(q.get('tester') || 7);
  const hold = q.has('hold') ? Number(q.get('hold')) : null;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fail = (code, message) => Object.assign(new Error(message), { code, message });
  const SIZES = { macos: 18_874_368 + 412_310, windows: 9_437_184 + 77_120, linux: 12_163_072 + 5_330 };
  const OTHER_NET = 'This link already downloaded Beta 1 on a different network. Download this one from the same network as your first download (your home Wi-Fi, say).';
  let retries = 0;
  const got = new Set();

  function token() {
    if (mode === 'nolink') return null;
    const m = /[#&]k=([A-Za-z0-9_-]{16,64})/.exec(location.hash);
    return m ? m[1] : 'mockTokenForTesting0123';
  }

  function detectOS() {
    if (mode === 'mobile') return 'mobile';
    const os = q.get('os');
    if (os) return os === 'none' ? null : os;
    const ua = navigator.userAgent;
    return /Windows/.test(ua) ? 'windows' : /Mac/.test(ua) ? 'macos' : /Linux|X11/.test(ua) ? 'linux' : null;
  }

  function platforms() {
    const mine = detectOS() && detectOS() !== 'mobile' ? detectOS() : 'macos';
    const p = {};
    for (const os of ['macos', 'windows', 'linux']) p[os] = { state: 'ready', size: SIZES[os] };
    if (mode === 'done') p[mine].state = 'done';
    if (mode === 'blocked' || mode === 'mixed') {
      const others = ['macos', 'windows', 'linux'].filter((o) => o !== mine);
      p[mine].state = 'done';
      p[others[0]] = { state: 'blocked', reason: OTHER_NET, size: SIZES[others[0]] };
      if (mode === 'blocked') p[others[1]] = { state: 'blocked', reason: 'This build is paused for Linux while Mazell fixes something. Check back soon!', size: SIZES[others[1]] };
    }
    for (const os of got) p[os].state = 'done';
    return p;
  }

  async function status() {
    await sleep(450);
    if (mode === 'nolink') throw fail('no-link', 'This beta is invite-only.');
    if (mode === 'bad') throw fail('bad-link', "That link doesn't work. Check you copied all of it, or ask Mazell for a new one.");
    if (mode === 'closed') throw fail('closed', 'Beta downloads are closed.');
    if (mode === 'network' && retries++ === 0) throw fail('network', "Couldn't reach the download server. Check your connection and try again.");
    return { tester, build: 'beta-1', buildName: 'Beta 1', closed: false, platforms: platforms() };
  }

  async function download(os, onProgress = () => {}) {
    const p = platforms()[os];
    if (!p) throw fail('failed', 'Unknown computer.');
    onProgress({ phase: 'claim', loaded: 0, total: 1 });
    await sleep(600);
    if (mode === 'already' || p.state === 'done') throw fail('already', 'This link already downloaded Beta 1 for this computer.');
    if (p.state === 'blocked') throw fail('blocked', p.reason);
    const total = p.size;
    let loaded = 0;
    while (loaded < total) {
      await sleep(70);
      loaded = Math.min(total, loaded + Math.round(total / 40 * (0.6 + Math.random() * 0.8)));
      if (hold != null && loaded / total >= hold) {
        onProgress({ phase: 'fetch', loaded: Math.round(total * hold), total });
        return new Promise(() => {});        // stays here (for screenshots)
      }
      onProgress({ phase: 'fetch', loaded, total });
      if (mode === 'fail' && retries === 0 && loaded > total * 0.45) {
        retries++;
        throw fail('network', 'The download stopped. Check your connection and try again.');
      }
    }
    onProgress({ phase: 'decrypt', loaded: 0, total: 1 });
    await sleep(450);
    onProgress({ phase: 'stamp', loaded: 0, total: 1 });
    await sleep(450);
    onProgress({ phase: 'save', loaded: 0, total: 1 });
    await sleep(350);
    got.add(os);
    const stamp = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    return { fileName: `TinyLogic-${os}-beta-1.zip`, stamp };
  }

  window.Beta = { token, detectOS, status, download };

  // &auto: press the page's own controls, the way a person would.
  const auto = q.get('auto');
  if (auto) {
    const wait = async (sel, ms = 8000) => {
      for (let t = 0; t < ms; t += 100) {
        const el = document.querySelector(sel);
        if (el && !el.closest('[hidden]')) return el;
        await sleep(100);
      }
      return null;
    };
    (async () => {
      const knife = await wait('#knife');
      await sleep(900);
      knife?.click();
      if (auto === 'download') {
        await sleep(1400);
        const btn = document.querySelector('.card.yours[data-state="ready"] .dl') || document.querySelector('.card[data-state="ready"] .dl');
        btn?.click();
      }
    })();
  }
})();
