// Tiny Logic beta: talks to the gatekeeper, fetches the encrypted build, decrypts it and stamps this copy before
// saving it. The stamp goes into the game's executable (16 bytes after a marker); on a Mac the executable's code
// signature hashes each page, so the pages the stamp touches get their hashes redone (an ad-hoc signature has
// nothing else to update). Each zip keeps the executable stored uncompressed, so stamping is a patch + a new CRC.
(() => {
  const API = 'https://tiny-logic-beta.tinylogic.workers.dev';
  const MARK = Uint8Array.of(0x14, 0x94, 0x19, 0xae, 0x92, 0xa3, 0xa3, 0x2a, 0x79, 0x9c, 0x2f, 0x35, 0x83, 0x1b, 0x7c, 0x54);
  const subtle = globalThis.crypto.subtle;

  // ---- stamping -------------------------------------------------------------------------------------------------

  function find(data, needle) {
    const hits = [];
    const first = needle[0];
    for (let i = data.indexOf(first); i >= 0 && i <= data.length - needle.length; i = data.indexOf(first, i + 1)) {
      let k = 1;
      while (k < needle.length && data[i + k] === needle[k]) k++;
      if (k === needle.length) hits.push(i);
    }
    return hits;
  }

  let crcTable = null;
  function crc32(data) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
    }
    let c = 0xffffffff;
    for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // A Mach-O executable (thin or universal) whose bytes at `offsets` changed: redo those pages' hashes in every
  // code directory of the slices they're in. Anything else (Windows, Linux) is left as it is.
  async function resign(b, offsets) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const slices = [];
    if (dv.getUint32(0, false) === 0xcafebabe) {
      const n = dv.getUint32(4, false);
      for (let i = 0; i < n; i++) slices.push([dv.getUint32(8 + i * 20 + 8, false), dv.getUint32(8 + i * 20 + 12, false)]);
    } else if (dv.getUint32(0, true) === 0xfeedfacf) {
      slices.push([0, b.length]);
    } else {
      return 0;
    }
    let pages = 0;
    for (const [off, size] of slices) {
      const mine = offsets.filter((o) => o >= off && o < off + size);
      if (!mine.length) continue;
      if (dv.getUint32(off, true) !== 0xfeedfacf) throw new Error('unknown executable slice');
      let c = off + 32;
      let sig = null;
      for (let i = 0, n = dv.getUint32(off + 16, true); i < n; i++) {
        if (dv.getUint32(c, true) === 0x1d) sig = dv.getUint32(c + 8, true);  // LC_CODE_SIGNATURE: dataoff
        c += dv.getUint32(c + 4, true);
      }
      if (sig === null) throw new Error('the executable is not signed');
      const sb = off + sig;
      if (dv.getUint32(sb, false) !== 0xfade0cc0) throw new Error('unknown signature');
      let dirs = 0;
      for (let i = 0, n = dv.getUint32(sb + 8, false); i < n; i++) {
        const cd = sb + dv.getUint32(sb + 12 + i * 8 + 4, false);
        if (dv.getUint32(cd, false) !== 0xfade0c02) continue;  // a code directory
        const hashAt = dv.getUint32(cd + 16, false), slots = dv.getUint32(cd + 28, false), limit = dv.getUint32(cd + 32, false);
        const hashSize = b[cd + 36], pageSize = 2 ** b[cd + 39];
        const alg = { 1: 'SHA-1', 2: 'SHA-256', 3: 'SHA-256', 4: 'SHA-384' }[b[cd + 37]];
        if (!alg) throw new Error('unknown signature hash');
        const touched = new Set(mine.flatMap((o) => [Math.floor((o - off) / pageSize), Math.floor((o - off + 15) / pageSize)]));
        for (const p of touched) {
          if (p >= slots) throw new Error('stamp outside the signed pages');
          const page = b.subarray(off + p * pageSize, off + Math.min((p + 1) * pageSize, limit));
          b.set(new Uint8Array(await subtle.digest(alg, page)).subarray(0, hashSize), cd + hashAt + p * hashSize);
          pages++;
        }
        dirs++;
      }
      if (!dirs) throw new Error('no code directory');
    }
    return pages;
  }

  // Writes `stamp` (16 bytes) after every marker in the zip's stored entries; returns how many were stamped.
  async function stampZip(z, stamp) {
    const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
    let end = -1;
    for (let i = z.length - 22; i >= Math.max(0, z.length - 22 - 65535); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        end = i;
        break;
      }
    }
    if (end < 0) throw new Error('not a zip');
    let p = dv.getUint32(end + 16, true);
    let stamped = 0;
    for (let n = 0, count = dv.getUint16(end + 10, true); n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('broken zip');
      const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
      const local = dv.getUint32(p + 42, true);
      if (method === 0 && size > 64) {
        const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
        const data = z.subarray(start, start + size);
        const hits = find(data, MARK);
        if (hits.length) {
          for (const h of hits) data.set(stamp, h + 16);
          await resign(data, hits.map((h) => h + 16));
          const crc = crc32(data);
          dv.setUint32(p + 16, crc, true);
          if (flags & 8) {  // (the CRC sits in a descriptor after the data)
            const d = start + size + (dv.getUint32(start + size, true) === 0x08074b50 ? 4 : 0);
            dv.setUint32(d, crc, true);
          } else {
            dv.setUint32(local + 14, crc, true);
          }
          stamped += hits.length;
        }
      }
      p += 46 + dv.getUint16(p + 28, true) + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
    }
    if (!stamped) throw new Error('nothing to stamp');
    return stamped;
  }

  globalThis.TLStamp = { stampZip, crc32, find, MARK };
  if (typeof window === 'undefined') return;

  // ---- the page's side ------------------------------------------------------------------------------------------

  const fail = (code, message) => Object.assign(new Error(message), { code, message });
  const unhex = (s) => new Uint8Array(s.match(/../g).map((x) => parseInt(x, 16)));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');

  function token() {
    const m = /[#&]k=([A-Za-z0-9_-]{16,64})/.exec(location.hash);
    return m ? m[1] : null;
  }

  function detectOS() {
    const ua = navigator.userAgent || '';
    const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;  // (an iPad asking for the desktop site)
    if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua) || touchMac) return 'mobile';
    if (/Windows/.test(ua)) return 'windows';
    if (/Macintosh|Mac OS X/.test(ua)) return 'macos';
    if (/Linux|X11|CrOS/.test(ua)) return 'linux';
    return null;
  }

  async function post(path, body) {
    let r;
    try {
      r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch {
      throw fail('network', "Couldn't reach the download server. Check your connection and try again.");
    }
    let data = {};
    try {
      data = await r.json();
    } catch {
      /* (an empty or broken answer: handled below) */
    }
    if (!r.ok) throw fail(data.code || 'failed', data.message || 'Something went wrong on the server.');
    return data;
  }

  async function status() {
    const t = token();
    if (!t) throw fail('no-link', 'This beta is invite-only.');
    return post('/status', { t, os: detectOS() });
  }

  async function download(os, onProgress = () => {}) {
    const t = token();
    if (!t) throw fail('no-link', 'This beta is invite-only.');
    onProgress({ phase: 'claim', loaded: 0, total: 1 });
    const c = await post('/claim', { t, os });

    let res;
    try {
      res = await fetch(new URL(c.file, location.href), { cache: 'no-store' });
    } catch {
      throw fail('network', 'The download stopped. Check your connection and try again.');
    }
    if (!res.ok || !res.body) throw fail('failed', "Couldn't fetch the build (" + res.status + ').');
    const total = c.size || Number(res.headers.get('Content-Length')) || 0;
    const parts = [];
    let loaded = 0;
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        loaded += value.length;
        onProgress({ phase: 'fetch', loaded, total: Math.max(total, loaded) });
      }
    } catch {
      throw fail('network', 'The download stopped. Check your connection and try again.');
    }
    const box = new Uint8Array(loaded);
    let at = 0;
    for (const part of parts) box.set(part, at), (at += part.length);
    if (c.sha256 && hex(await subtle.digest('SHA-256', box)) !== c.sha256) throw fail('failed', 'The download came through damaged. Try again.');

    onProgress({ phase: 'decrypt', loaded: 0, total: 1 });
    let zip;
    try {
      const key = await subtle.importKey('raw', unb64(c.key), 'AES-GCM', false, ['decrypt']);
      zip = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: box.subarray(0, 12) }, key, box.subarray(12)));
    } catch {
      throw fail('failed', "Couldn't unlock the build. Try again, or message Mazell.");
    }

    onProgress({ phase: 'stamp', loaded: 0, total: 1 });
    try {
      await stampZip(zip, unhex(c.stamp));
    } catch (e) {
      throw fail('failed', "Couldn't prepare your copy (" + e.message + '). Message Mazell.');
    }

    onProgress({ phase: 'save', loaded: 0, total: 1 });
    const url = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = c.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 120000);
    try {
      await post('/done', { t, claim: c.claim });
    } catch {
      /* (the copy is saved; an unfinished claim only means the same computer may download it again) */
    }
    return { fileName: c.name, stamp: c.stamp };
  }

  window.Beta = { token, detectOS, status, download };
})();
