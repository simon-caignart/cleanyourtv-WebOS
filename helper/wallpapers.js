// Wallpapers: your own photos as the launcher's background:
//   D/wallpapers/upload/<random>.jpg   photos uploaded from a phone (the phone page scales them before sending)
// More photos come from add-ons that provide "wallpapers" (Immich, Unsplash, ...; docs/development/addons.md): see "photo sources" below.
// D/wallpapers/index.json says what each upload is; only files listed there are ever deleted. (D/wallpapers/immich/ is what an earlier
// version synced from Immich, kept until the Immich add-on takes it over or you remove it.)
// The settings are the wallpapers section of config.json: {size: '4k'|'hd' (4K is the default: Home is drawn at the panel's 3840 x 2160),
// home: 'all' (Photos on Home), mix: {mode: 'count' (By number of photos; Equal per source when absent), weights: {u|<add-on>: 0.5|2|4}}}.
// The order of the photos (wallmix.js) is one for Home and the screen saver, kept in D/wallpapers/mix.json.
// API (loopback, our apps): GET /api/wallpapers/status, GET /api/wallpapers/list, GET /api/wallpapers/photo/u/<id>,
// POST /api/wallpapers/next (Home's next photo), POST /api/wallpapers/set {size, home, mix, weight: {source, value}}, POST /api/wallpapers/pair, POST /api/wallpapers/remove-uploads,
// POST /api/wallpapers/disconnect (removes the old Immich data of an earlier version). The phone page (POST pair) is a short-lived server on the LAN, port 8791, that needs the code shown
// on the TV; its API is under /api/ on that port.
const fs = require('fs'),
  http = require('http'),
  path = require('path'),
  crypto = require('crypto');
const P = require('./paths'),
  web = require('./web'),
  i18n = require('./i18n'),
  nc = require('./netcompat'),
  mix = require('./wallmix');

const DIR = P.D + '/wallpapers',
  UP = DIR + '/upload',
  IM = DIR + '/immich',
  INDEX = DIR + '/index.json',
  MIXFILE = DIR + '/mix.json';
const LIMITS = { uploads: 100, bytes: 150 * 1024 * 1024, file: 12 * 1024 * 1024 };
const PAIR_PORT = 8791, // after the Share-log page's range (8768-8790)
  PAIR_MS = 15 * 60 * 1000;
const ID = /^[a-f0-9]{16}$/;

// what a file is, from its first bytes: only JPEG, PNG and WebP are kept
function imageType(b) {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 8 && b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return '';
}
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

// The size of a picture as it is shown, from its first bytes: [width, height], or null. JPEG: the frame header (SOF), turned when
// the EXIF orientation says the camera was held on its side (5 to 8: browsers show such a photo turned); PNG: IHDR; WebP: VP8, VP8L or
// VP8X. A JPEG's frame header can come after a large EXIF block, so a caller that read too little gets null and reads more.
function imageSize(b) {
  if (!b || b.length < 16) return null;
  const type = imageType(b);
  if (type === 'png')
    return b.length >= 24 && b.toString('latin1', 12, 16) === 'IHDR' ? dims(b.readUInt32BE(16), b.readUInt32BE(20)) : null;
  if (type === 'webp') {
    const kind = b.toString('latin1', 12, 16);
    if (kind === 'VP8 ' && b.length >= 30) return dims(b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff);
    if (kind === 'VP8L' && b.length >= 25 && b[20] === 0x2f) {
      const bits = b.readUInt32LE(21);
      return dims((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
    }
    if (kind === 'VP8X' && b.length >= 30) return dims(b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1);
    return null;
  }
  if (type !== 'jpg') return null;
  let o = 2,
    turned = false;
  while (o + 9 < b.length) {
    if (b[o] !== 0xff) return null;
    const m = b[o + 1];
    if (m === 0xff) {
      o++;
      continue;
    }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      o += 2;
      continue;
    }
    const len = b.readUInt16BE(o + 2);
    if (m === 0xe1 && b.toString('latin1', o + 4, o + 10) === 'Exif\0\0')
      turned = exifTurned(b.slice(o + 10, Math.min(b.length, o + 2 + len)));
    // the frame headers: baseline, progressive and the rarer ones; not DHT (c4), JPG (c8) or DAC (cc)
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      const h = b.readUInt16BE(o + 5),
        w = b.readUInt16BE(o + 7);
      return turned ? dims(h, w) : dims(w, h);
    }
    if (m === 0xda || m === 0xd9) return null;
    o += 2 + len;
  }
  return null;
}
const dims = (w, h) => (w > 0 && h > 0 ? [w, h] : null);
// does the EXIF orientation (tag 0x0112 in the first directory) turn the picture by a quarter (5 to 8)?
function exifTurned(t) {
  try {
    const le = t.toString('latin1', 0, 2) === 'II';
    const u16 = i => (le ? t.readUInt16LE(i) : t.readUInt16BE(i)),
      u32 = i => (le ? t.readUInt32LE(i) : t.readUInt32BE(i));
    const d = u32(4),
      n = u16(d);
    for (let i = 0; i < n && d + 2 + i * 12 + 12 <= t.length; i++) {
      const e = d + 2 + i * 12;
      if (u16(e) === 0x0112) return u16(e + 8) >= 5 && u16(e + 8) <= 8;
    }
  } catch (_) {}
  return false;
}
// the size of a picture file, reading only its start (more when a JPEG's frame header comes late), or null
function fileSize(f) {
  let fd;
  try {
    fd = fs.openSync(f, 'r');
    for (const n of [65536, 1048576]) {
      const b = Buffer.alloc(n);
      const got = fs.readSync(fd, b, 0, n, 0);
      const s = imageSize(b.slice(0, got));
      if (s || got < n) return s;
    }
  } catch (_) {
  } finally {
    if (fd !== undefined)
      try {
        fs.closeSync(fd);
      } catch (_) {}
  }
  return null;
}
// a landscape photo: clearly wider than tall (a square-ish one counts as portrait); a size not known counts as landscape
const LANDSCAPE = 1.2;
const isLandscape = size => !size || !(size[0] > 0 && size[1] > 0) || size[0] / size[1] >= LANDSCAPE;
// what Home shows: only the landscape photos (the default), or all ('all'); a library without a landscape photo shows them all
function homePhotos(ids, sizes, mode) {
  if (mode === 'all') return ids.slice();
  const l = ids.filter(id => isLandscape(sizes[id]));
  return l.length ? l : ids.slice();
}

function create(ctx) {
  const config = ctx.config;
  const cfg = () => Object.assign({ size: '4k' }, config.get().wallpapers || {});
  const icfg = () => Object.assign({ url: '', key: '', albums: [], hidden: [] }, cfg().immich || {});
  const setCfg = fn =>
    config.update('wallpapers', c => {
      c.wallpapers = Object.assign({}, c.wallpapers || {}); // the size is written only when it is chosen
      fn(c.wallpapers);
    });

  // ---- the index of the files ----
  let index = null;
  function idx() {
    if (index) return index;
    try {
      index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
    } catch (_) {
      index = {};
    }
    index.upload = Array.isArray(index.upload) ? index.upload : [];
    index.immich = index.immich && typeof index.immich === 'object' ? index.immich : {};
    index.sync = index.sync || { state: 'idle', at: 0, error: '', ok: 0 };
    // the size of each photo, by its id in the list: [width, height, what the file was (a source's photo can be replaced)]
    index.sizes = index.sizes && typeof index.sizes === 'object' ? index.sizes : {};
    return index;
  }
  function saveIdx() {
    nc.mkdirp(DIR);
    fs.writeFileSync(INDEX + '.tmp', JSON.stringify(idx()));
    fs.renameSync(INDEX + '.tmp', INDEX);
  }
  const usedBytes = () => idx().upload.reduce((n, u) => n + (u.bytes || 0), 0);
  // your photos are for root only, as the settings are
  const mkdir = d => {
    nc.mkdirp(d);
    try {
      fs.chmodSync(DIR, 0o700);
    } catch (_) {}
  };
  const unlink = f => {
    try {
      fs.unlinkSync(f);
    } catch (_) {}
  };

  // ---- uploads ----
  function addUpload(buf) {
    const type = imageType(buf);
    if (!type) return 'not a JPEG, PNG or WebP picture';
    if (buf.length > LIMITS.file) return 'the picture is larger than 12 MB';
    if (idx().upload.length >= LIMITS.uploads) return 'there are ' + LIMITS.uploads + ' uploads already: remove some first';
    if (usedBytes() + buf.length > LIMITS.bytes) return 'Wallpapers is full (150 MB): remove some photos first';
    mkdir(UP);
    const id = crypto.randomBytes(8).toString('hex'),
      file = id + '.' + type;
    fs.writeFileSync(path.join(UP, file + '.tmp'), buf, { mode: 0o600 });
    fs.renameSync(path.join(UP, file + '.tmp'), path.join(UP, file));
    idx().upload.push({ id, file, bytes: buf.length, at: Date.now() });
    const sz = imageSize(buf);
    if (sz) idx().sizes['u/' + id] = sz;
    saveIdx();
    return '';
  }
  function removeUpload(id) {
    const u = idx().upload.filter(x => x.id === id)[0];
    if (!u) return false;
    unlink(path.join(UP, u.file));
    idx().upload = idx().upload.filter(x => x.id !== id);
    saveIdx();
    return true;
  }
  function removeUploads() {
    for (const u of idx().upload) unlink(path.join(UP, u.file));
    idx().upload = [];
    saveIdx();
  }

  // ---- Immich of earlier versions ----
  // Immich is an add-on now (addons/catalog/immich). A TV that had it keeps the settings (config.json: wallpapers.immich) and the photos
  // (wallpapers/immich/) until the add-on is installed, which takes them over once (adoptLegacy); "Remove old Immich data" deletes them.
  const legacyOn = () => {
    const c = icfg();
    return !!(c.url && c.key) || Object.keys(idx().immich).length > 0;
  };
  let adopting = false;
  async function adoptLegacy() {
    if (adopting || !legacyOn()) return;
    const s = sources().filter(x => x.id === 'immich' && typeof x.mod.wallpapers.adopt === 'function')[0];
    if (!s) return;
    adopting = true;
    try {
      const r = await s.mod.wallpapers.adopt({ settings: icfg(), photos: idx().immich, dir: IM });
      if (r && r.ok) removeLegacy();
    } catch (e) {
      console.error('wallpapers: the Immich add-on could not take over the old settings: ' + ((e && e.message) || e));
    }
    adopting = false;
  }
  function removeLegacy() {
    for (const id of Object.keys(idx().immich)) unlink(path.join(IM, idx().immich[id].file));
    idx().immich = {};
    idx().sync = { state: 'idle', at: 0, error: '', ok: 0 };
    saveIdx();
    setCfg(w => {
      delete w.immich;
    });
  }

  // ---- photo sources: add-ons that provide "wallpapers" ----
  // A source is the object `wallpapers` on the module an add-on returns from create():
  //   label            the name in the manager
  //   list()           ids of the photos it has now, each a file it can hand out (letters, digits, - _ .; at most 500)
  //   file(id)         the absolute path of that photo (a JPEG, PNG or WebP), or ''
  //   live: true       it also offers one photo at a time that is not kept on the TV: Home asks next() each time it shows that entry
  //   next()           (live) -> {url, credit}: an https address of the picture and the text Home shows in a corner (the photographer)
  //   push()           (live, optional) -> {url, credit} or null: a photo for Home to show now, once (Home asks every few seconds)
  //   status()         -> {summary, error}: one line for the manager (photos, last sync, what went wrong)
  //   settings(o)      -> {url, code, qr, seconds}: starts a short-lived page on the LAN for its settings (o.stop: close it)
  //   taken()          (optional) -> {id: ms}: when each photo was taken, so a burst of shots is spread over the rotation
  // The photos are listed as s/<add-on>/<id> and a live source as l/<add-on>. A source that throws offers nothing and is logged once.
  const SRC_PHOTO = /^[\w.-]{1,64}$/,
    SRC_MAX = 500,
    warned = {};
  const sources = () => {
    const a = ctx.feature && ctx.feature('addons');
    return a && a.providers ? a.providers('wallpapers').filter(s => s.mod.wallpapers && typeof s.mod.wallpapers === 'object') : [];
  };
  const srcOf = id => sources().filter(s => s.id === id)[0];
  function guard(s, fn, fallback) {
    try {
      return fn();
    } catch (e) {
      if (!warned[s.id]) {
        warned[s.id] = 1;
        console.error('wallpapers: source ' + s.id + ': ' + ((e && e.message) || e));
      }
      return fallback;
    }
  }
  const srcPhotos = s => {
    const l = guard(s, () => s.mod.wallpapers.list(), []);
    return (Array.isArray(l) ? l : [])
      .filter((x, i, all) => typeof x === 'string' && SRC_PHOTO.test(x) && all.indexOf(x) === i)
      .slice(0, SRC_MAX);
  };
  const line = (v, n) =>
    String(v || '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .slice(0, n);
  const srcFile = (addon, id) => {
    const s = srcOf(addon);
    if (!s || !SRC_PHOTO.test(id)) return '';
    const f = guard(s, () => s.mod.wallpapers.file(id), '');
    if (typeof f !== 'string' || !path.isAbsolute(f) || !MIME[f.split('.').pop().toLowerCase()]) return '';
    try {
      const st = fs.statSync(f);
      return st.isFile() && st.size <= LIMITS.file * 2 ? f : '';
    } catch (_) {
      return '';
    }
  };
  function sendSrcPhoto(res, addon, id) {
    const f = srcFile(addon, id);
    if (!f) return web.notFound(res);
    res.writeHead(200, { 'content-type': MIME[f.split('.').pop().toLowerCase()], 'cache-control': 'max-age=3600' });
    fs.createReadStream(f).pipe(res);
  }
  // a live photo: the address goes into a CSS url() on Home, so only a plain https address is passed on
  const livePhoto = r => {
    if (typeof r.url !== 'string' || !/^https:\/\/[^\s"'()\\]{4,600}$/.test(r.url))
      return { error: 'the source gave no usable picture address' };
    return { url: r.url, credit: line(r.credit, 120) };
  };
  // the live photo each source last gave Home (from next() or push()): the screen saver shows that one (liveCurrent)
  const lastLive = {};
  async function liveNext(addon) {
    const s = srcOf(addon);
    if (!s || s.mod.wallpapers.live !== true || typeof s.mod.wallpapers.next !== 'function') return { error: 'not a live source' };
    try {
      const r = (await s.mod.wallpapers.next()) || {};
      const p = r.error ? { error: line(r.error, 160) } : livePhoto(r);
      if (p.url) lastLive[addon] = p;
      return p;
    } catch (e) {
      return { error: line((e && e.message) || e, 160) };
    }
  }
  // what Home has now from a live source, for the screen saver: next() hands out a new photo on every call, so asking it again would
  // show another photo than Home and make Home skip one. Before Home asked at all (a fresh start of the service) it asks once, and
  // that photo waits for Home (forHome): Home's next request gets it instead of another one, so both show the same photo.
  const forHome = {};
  async function liveCurrent(addon) {
    const s = srcOf(addon);
    if (!s || s.mod.wallpapers.live !== true) return { error: 'not a live source' };
    if (lastLive[addon]) return lastLive[addon];
    const p = await liveNext(addon);
    if (p.url) forHome[addon] = true;
    return p;
  }
  // Home's request (/api/wallpapers/live/<add-on>): the photo the screen saver fetched first, once, else the source's next one
  async function liveForHome(addon) {
    if (forHome[addon] && lastLive[addon]) {
      delete forHome[addon];
      return lastLive[addon];
    }
    delete forHome[addon];
    return liveNext(addon);
  }
  // a photo a live source wants Home to show now (Unsplash: the one "Test key and save" fetched), handed out once; Home asks every few
  // seconds while a live entry is in its list
  function pushNow() {
    for (const s of sources()) {
      const w = s.mod.wallpapers;
      if (w.live !== true || typeof w.push !== 'function') continue;
      const r = guard(s, () => w.push(), null);
      if (r && !r.error) {
        const p = livePhoto(r);
        if (p.url) {
          lastLive[s.id] = p;
          return { id: 'l/' + s.id, url: p.url, credit: p.credit };
        }
      }
    }
    return { id: '', url: '', credit: '' };
  }
  async function srcSettings(addon, stop) {
    const s = srcOf(addon);
    if (!s || typeof s.mod.wallpapers.settings !== 'function') return { error: 'this source has no settings page' };
    try {
      const r = (await s.mod.wallpapers.settings({ stop: !!stop })) || {};
      if (r.error) return { error: line(r.error, 160) };
      return stop
        ? {}
        : { url: line(r.url, 200), code: line(r.code, 12), qr: line(r.qr, 240), seconds: +r.seconds > 0 ? Math.round(+r.seconds) : 0 };
    } catch (e) {
      return { error: line((e && e.message) || e, 160) };
    }
  }
  const sourceStatus = () =>
    sources().map(s => {
      const w = s.mod.wallpapers,
        st = guard(s, () => (typeof w.status === 'function' ? w.status() : {}), {}) || {};
      return {
        id: s.id,
        label: line(w.label || s.name, 40),
        photos: srcPhotos(s).length,
        live: w.live === true,
        summary: line(st.summary, 120),
        error: line(st.error, 160),
        settings: typeof w.settings === 'function',
        weight: mix.weightOf(mixCfg().weights, s.id),
      };
    });

  // ---- the order: one shuffle bag per source, the sources in turn by weight (wallmix.js) ----
  const mixCfg = () => {
    const m = cfg().mix || {};
    return { mode: m.mode === 'count' ? 'count' : 'equal', weights: m.weights && typeof m.weights === 'object' ? m.weights : {} };
  };
  let mixState = null,
    mixTimer = null;
  const taken = () => {
    const out = {};
    for (const s of sources()) {
      if (typeof s.mod.wallpapers.taken !== 'function') continue;
      const t = guard(s, () => s.mod.wallpapers.taken(), {}) || {};
      for (const id of Object.keys(t)) if (+t[id] > 0) out['s/' + s.id + '/' + id] = +t[id];
    }
    return out;
  };
  // the state brought in line with the library, and the options a pick needs; home: only what Home shows (Photos on Home)
  function mixNow(home) {
    if (!mixState) {
      try {
        mixState = JSON.parse(fs.readFileSync(MIXFILE, 'utf8'));
      } catch (_) {
        mixState = {};
      }
    }
    const ids = list(),
      t = taken(),
      m = mixCfg();
    mixState = mix.reconcile(mixState, ids, t, Math.random);
    let ok = () => true;
    if (home) {
      const set = {};
      for (const id of homePhotos(ids, sizes(ids), homeMode())) set[id] = 1;
      ok = id => set[id] === 1;
    }
    return { mode: m.mode, weights: m.weights, taken: t, ok };
  }
  // written 20 s after a change, not on every photo of the screen saver (flash wear); flush() writes it now
  function saveMix(now) {
    clearTimeout(mixTimer);
    mixTimer = null;
    const write = () => {
      mixTimer = null;
      try {
        nc.mkdirp(DIR);
        fs.writeFileSync(MIXFILE + '.tmp', JSON.stringify(mixState));
        fs.renameSync(MIXFILE + '.tmp', MIXFILE);
      } catch (_) {}
    };
    if (now) return mixState && write();
    mixTimer = setTimeout(write, 20000);
    if (mixTimer.unref) mixTimer.unref();
  }
  // Home's next photo
  function next() {
    const o = mixNow(true),
      id = mix.take(mixState, o);
    saveMix();
    return { id: id || '' };
  }
  // the screen saver's next n photos (all of them, portraits too), and the ones it drew
  const plan = n => mix.peek(mixState, n, mixNow(false));
  function shown(ids) {
    const o = mixNow(false),
      have = {};
    for (const id of list()) have[id] = 1;
    mix.mark(mixState, (Array.isArray(ids) ? ids : []).filter(id => typeof id === 'string' && have[id] === 1).slice(0, 8), o);
    saveMix();
  }

  // ---- what the TV shows ----
  function list() {
    let out = idx().upload.map(u => 'u/' + u.id);
    for (const s of sources()) {
      out = out.concat(srcPhotos(s).map(id => 's/' + s.id + '/' + id));
      if (s.mod.wallpapers.live === true) out.push('l/' + s.id);
    }
    return out;
  }
  // {id: [width, height]} of the photos in the list whose size is known. Read from each file's first bytes once and kept in the index:
  // an upload when it arrives (and an older one the first time it is asked for), a source's photo the first time it is listed and
  // again when its file changes. A live source's photo is not kept on the TV: unknown, which counts as landscape.
  function sizes(ids) {
    const kept = idx().sizes,
      out = {},
      now = {};
    let changed = false;
    for (const id of ids) {
      let f = '',
        tag = '';
      const su = /^u\/(.+)$/.exec(id),
        ss = /^s\/([^/]+)\/(.+)$/.exec(id);
      if (su) f = photoFile('u', su[1]);
      else if (ss) {
        f = srcFile(ss[1], ss[2]);
        try {
          const st = f ? fs.statSync(f) : null;
          tag = st ? st.size + ':' + Math.round(st.mtimeMs) : '';
        } catch (_) {
          f = '';
        }
      }
      if (!f) continue;
      let k = kept[id];
      if (!k || (k[2] || '') !== tag) {
        const z = fileSize(f);
        k = z ? (tag ? [z[0], z[1], tag] : z) : null;
        changed = true;
      }
      if (k) {
        now[id] = k;
        out[id] = [k[0], k[1]];
      }
    }
    if (changed || Object.keys(kept).length !== Object.keys(now).length) {
      idx().sizes = now;
      try {
        saveIdx();
      } catch (_) {}
    }
    return out;
  }
  // Wallpapers' Photos on Home: 'landscape' (the default) or 'all'
  const homeMode = () => (cfg().home === 'all' ? 'all' : 'landscape');
  // a number that changes whenever the set of photos changes: the launcher reads the list again then
  const stamp = () => {
    const l = list();
    // Photos on Home is part of it: Home's list changes with it
    return (
      l.length +
      ':' +
      crypto
        .createHash('md5')
        .update(l.join(',') + (homeMode() === 'all' ? '|all' : ''))
        .digest('hex')
        .slice(0, 8)
    );
  };
  function status() {
    const out = {
      size: cfg().size === 'hd' ? 'hd' : '4k',
      home: homeMode(),
      uploads: idx().upload.length,
      total: list().length,
      bytes: usedBytes(),
      mix: mixCfg().mode,
      weight: mix.weightOf(mixCfg().weights, 'u'),
      limits: LIMITS,
      pair: pair ? { url: pair.url, code: pair.code, until: pair.until } : null,
    };
    // only when an add-on provides photos, so the reply is the same without any
    const src = sourceStatus();
    if (src.length) out.sources = src;
    // only a TV that had Immich before it became an add-on
    if (legacyOn()) out.legacyImmich = { photos: Object.keys(idx().immich).length, configured: !!(icfg().url && icfg().key) };
    return out;
  }
  function photoFile(src, id) {
    if (src === 'u' && ID.test(id)) {
      const u = idx().upload.filter(x => x.id === id)[0];
      return u ? path.join(UP, u.file) : '';
    }
    return '';
  }
  function sendPhoto(res, src, id, cache) {
    const f = photoFile(src, id);
    if (!f || !fs.existsSync(f)) return web.notFound(res);
    res.writeHead(200, { 'content-type': MIME[f.split('.').pop()] || 'image/jpeg', 'cache-control': cache || 'max-age=86400' });
    fs.createReadStream(f).pipe(res);
  }

  // ---- the phone page: LAN, short-lived, the code shown on the TV in every request (header x-code) ----
  let pair = null;
  function startPair() {
    stopPair();
    const code = String(nc.randomInt(100000, 1000000));
    let bad = 0;
    const srv = http.createServer((req, res) => phone(req, res, code, () => ++bad));
    pair = { code, srv, url: 'http://' + web.lanIp() + ':' + PAIR_PORT, until: Date.now() + PAIR_MS, timer: setTimeout(stopPair, PAIR_MS) };
    const out = { url: pair.url, code, qr: pair.url + '/#' + code, seconds: PAIR_MS / 1000 };
    return new Promise(resolve => {
      srv.on('error', e => {
        stopPair();
        resolve({ error: 'the phone page could not start: ' + e.message });
      });
      srv.listen(PAIR_PORT, '0.0.0.0', () => resolve(out));
    });
  }
  // while the page is used it stays open (up to an hour after it was opened)
  function touch() {
    if (!pair) return;
    clearTimeout(pair.timer);
    pair.until = Math.min(Date.now() + PAIR_MS, (pair.opened || (pair.opened = Date.now())) + 3600 * 1000);
    pair.timer = setTimeout(stopPair, pair.until - Date.now());
  }
  function stopPair() {
    if (!pair) return;
    clearTimeout(pair.timer);
    try {
      pair.srv.close();
    } catch (_) {}
    pair = null;
  }
  function rawBody(req, max) {
    return new Promise((resolve, reject) => {
      const b = [];
      let n = 0;
      req.on('data', c => {
        n += c.length;
        if (n > max) {
          reject(new Error('the picture is larger than 12 MB'));
          req.destroy();
        } else b.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(b)));
      req.on('error', reject);
    });
  }
  async function phone(req, res, code, wrong) {
    const u = req.url.split('?')[0],
      json = (o, c) => {
        res.writeHead(c || 200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(o));
      };
    if (req.method === 'GET' && u === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(phonePage(i18n.lang(req, config.get().lang)));
    }
    if (u.indexOf('/api/') !== 0) return web.notFound(res);
    if (req.headers['x-code'] !== code) {
      if (wrong() >= 8) stopPair();
      return json({ error: 'wrong code' }, 403);
    }
    touch();
    try {
      if (u === '/api/state') return json(Object.assign(status(), { pair: null, uploadsList: idx().upload.map(x => x.id) }));
      let m = /^\/api\/photo\/(u)\/([0-9a-f-]{16,36})$/i.exec(u);
      if (m && req.method === 'GET') return sendPhoto(res, m[1], m[2], 'private, max-age=3600');
      if (req.method !== 'POST') return json({ error: 'not found' }, 404);
      if (u === '/api/upload') {
        const err = addUpload(await rawBody(req, LIMITS.file));
        return json(err ? { error: err } : { ok: true, uploads: idx().upload.length }, err ? 400 : 200);
      }
      const b = await web.body(req, 16384);
      if (u === '/api/upload/delete') return json({ ok: removeUpload(String(b.id || '')) });
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String(e.message || e) }, 400);
    }
  }

  // ---- the service's API ----
  async function handle(req, res, u, body) {
    const json = (o, c) => web.json(res, o, c);
    const m = /^\/api\/wallpapers\/photo\/(u)\/([0-9a-f-]{16,36})$/i.exec(u);
    if (m) return sendPhoto(res, m[1], m[2]);
    const ms = /^\/api\/wallpapers\/photo\/s\/([a-z][a-z0-9-]{1,31})\/([\w.-]{1,64})$/.exec(u);
    if (ms) return sendSrcPhoto(res, ms[1], ms[2]);
    const ml = /^\/api\/wallpapers\/live\/([a-z][a-z0-9-]{1,31})$/.exec(u);
    if (ml) return json(await liveForHome(ml[1]));
    if (u === '/api/wallpapers/push') return json(pushNow());
    if (u === '/api/wallpapers/next' && req.method === 'POST') return json(next());
    if (u === '/api/wallpapers/status') return json(status());
    if (u === '/api/wallpapers/list') {
      const l = list(),
        z = sizes(l);
      // home: the photos Home shows (Photos on Home); sizes for the screen saver, which pairs portrait photos
      return json({ photos: l, stamp: stamp(), home: homePhotos(l, z, homeMode()), sizes: z, homeMode: homeMode() });
    }
    if (req.method !== 'POST') return web.notFound(res);
    const b = await body(req);
    if (u === '/api/wallpapers/set') {
      if (b.size === '4k' || b.size === 'hd')
        setCfg(w => {
          w.size = b.size;
        });
      if (b.home === 'all' || b.home === 'landscape')
        setCfg(w => {
          if (b.home === 'all') w.home = 'all';
          else delete w.home;
        });
      if (b.mix === 'count' || b.mix === 'equal')
        setCfg(w => {
          const m = Object.assign({}, w.mix);
          if (b.mix === 'count') m.mode = 'count';
          else delete m.mode;
          w.mix = m;
        });
      const wt = b.weight || {};
      if ((wt.source === 'u' || /^[a-z][a-z0-9-]{1,31}$/.test(String(wt.source))) && mix.WEIGHTS.indexOf(wt.value) >= 0)
        setCfg(w => {
          const m = Object.assign({}, w.mix),
            ws = Object.assign({}, m.weights);
          if (wt.value === 1) delete ws[wt.source];
          else ws[wt.source] = wt.value;
          m.weights = ws;
          w.mix = m;
        });
      return json(status());
    }
    const mset = /^\/api\/wallpapers\/source\/([a-z][a-z0-9-]{1,31})\/settings$/.exec(u);
    if (mset) {
      const r = await srcSettings(mset[1], b.stop === true);
      return json(r, r.error ? 400 : 200);
    }
    if (u === '/api/wallpapers/pair') return json(b.stop ? (stopPair(), {}) : await startPair());
    if (u === '/api/wallpapers/remove-uploads') {
      removeUploads();
      return json(status());
    }
    if (u === '/api/wallpapers/disconnect') {
      removeLegacy();
      return json(status());
    }
    return web.notFound(res);
  }

  return {
    name: 'wallpapers',
    prefix: '/api/wallpapers/',
    handle,
    status,
    stamp,
    adoptLegacy,
    addUpload,
    list,
    sizes,
    homeMode,
    mixMode: () => mixCfg().mode,
    phone,
    liveCurrent,
    next,
    plan,
    shown,
    flush: () => saveMix(true),
  };
}

// the phone page: Upload photos. Plain script for iOS Safari and Android Chrome; photos are scaled in
// the browser (to 3840 or 1920 pixels on the long side) before they are sent, which also turns an iPhone's HEIC into JPEG. It is in the
// phone's language: the fixed text is translated here, the script's own texts by t() with the translations it uses (i18n.js).
const PHONE_JS = `var code='',S={},MAX=3840,$=function(i){return document.getElementById(i)};
/* a text with its %s / %d filled in, in order, then in the page's language (a template's plural form follows the number) */
function fm(s){var a=arguments,n=1;return t(s.replace(/%[sd]/g,function(){return a[n++]}))}
function api(p,b,ct){return new Promise(function(ok,no){var x=new XMLHttpRequest();x.open(b===undefined?'GET':'POST','/api/'+p);x.setRequestHeader('x-code',code);
 if(ct)x.setRequestHeader('content-type',ct);x.onload=function(){var j={};try{j=JSON.parse(x.responseText)}catch(e){}if(x.status===403){showLogin(t('Wrong code.'));no(j)}else ok(j)};x.onerror=function(){no({error:t('The TV did not answer. Is the phone on the same Wi-Fi?')})};
 x.send(b===undefined?null:(ct?b:JSON.stringify(b)))})}
function msg(t,e){$('msg').innerHTML=t?'<p class="m'+(e?' e':'')+'"></p>':'';if(t)$('msg').firstChild.textContent=t}
function showLogin(t){$('login').className='';$('main').className='hide';$('sum').textContent=t||''}
function ago(x){if(!x)return t('never');var m=Math.round((Date.now()-x)/60000);return m<1?t('just now'):m<60?fm('%d min ago',m):m<1440?fm('%d h ago',Math.round(m/60)):fm('%d days ago',Math.round(m/1440))}
function state(){return api('state').then(function(s){S=s;MAX=s.size==='hd'?1920:3840;$('login').className='hide';$('main').className='';
 $('sum').textContent=fm('Local uploads: %d · Total: %d photos (%d of 150 MB)',s.uploads,s.total,Math.round(s.bytes/1048576));
 $('un').textContent=fm('%d of %d',s.uploads,s.limits.uploads);var g='';(s.uploadsList||[]).forEach(function(id){g+='<div class=ph><img loading=lazy src="" data-s="u/'+id+'"><button data-d="'+id+'">×</button></div>'});$('ug').innerHTML=g;thumbs($('ug'))})}
function thumbs(el){[].forEach.call(el.querySelectorAll('img[data-s]'),function(im){var x=new XMLHttpRequest();x.open('GET','/api/photo/'+im.getAttribute('data-s'));x.setRequestHeader('x-code',code);x.responseType='blob';
 x.onload=function(){if(x.status===200)im.src=URL.createObjectURL(x.response)};x.send()})}
/* scale in the browser: the long side to MAX pixels, JPEG; a file the browser cannot draw is sent as it is when it is small enough */
function scaled(file){return new Promise(function(ok){var u=URL.createObjectURL(file),im=new Image();im.onload=function(){var w=im.naturalWidth,h=im.naturalHeight,k=Math.min(1,MAX/Math.max(w,h));
 var c=document.createElement('canvas');c.width=Math.round(w*k);c.height=Math.round(h*k);c.getContext('2d').drawImage(im,0,0,c.width,c.height);URL.revokeObjectURL(u);c.toBlob(function(b){ok(b||file)},'image/jpeg',0.9)};
 im.onerror=function(){URL.revokeObjectURL(u);ok(file)};im.src=u})}
function upload(files){var list=[].slice.call(files),n=0,okN=0,errs=[];$('prog').className='';msg('');
 (function next(){if(n>=list.length){$('prog').className='hide';msg(fm('%d of %d photos uploaded.',okN,list.length)+(errs.length?' '+errs[0]:''),!!errs.length&&!okN);state();return}
  var f=list[n];$('pt').textContent=fm('Photo %d of %d · preparing',n+1,list.length);$('pb').style.width=Math.round(n/list.length*100)+'%';
  scaled(f).then(function(b){var x=new XMLHttpRequest();x.open('POST','/api/upload');x.setRequestHeader('x-code',code);x.setRequestHeader('content-type',b.type||'application/octet-stream');
   x.upload.onprogress=function(e){if(e.lengthComputable)$('pb').style.width=Math.round((n+e.loaded/e.total)/list.length*100)+'%';$('pt').textContent=fm('Photo %d of %d · sending',n+1,list.length)};
   x.onload=function(){var j={};try{j=JSON.parse(x.responseText)}catch(e){}if(x.status===200)okN++;else errs.push((f.name||t('A photo'))+': '+t(j.error||'refused'));n++;next()};
   x.onerror=function(){errs.push(t('The TV did not answer.'));n++;next()};x.send(b)})})()}
$('f').onchange=function(){if(this.files.length)upload(this.files);this.value=''};
$('ug').onclick=function(e){var d=e.target.getAttribute('data-d');if(d)api('upload/delete',{id:d}).then(state)};
$('go').onclick=function(){code=$('code').value.trim();state().catch(function(){})};
code=(location.hash||'').slice(1);if(/^\\d{6}$/.test(code))state().catch(function(){});else showLogin();
`;
function phonePage(lang) {
  const T = s => web.esc(i18n.tr(lang, s));
  return (
    `<!doctype html><html lang=${lang}><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Wallpapers</title>
<style>*{box-sizing:border-box}body{font:17px -apple-system,system-ui,sans-serif;background:#0d0e12;color:#eee;margin:0;padding:20px 16px 60px;max-width:640px;margin:0 auto}
h1{font-size:26px;margin:4px 0 4px}h2{font-size:20px;margin:28px 0 10px}p{color:#aaa;margin:6px 0}.m{padding:12px 14px;border-radius:12px;background:#1d2a1f;margin:12px 0}.m.e{background:#3a1717}
button,input,label.b{font:inherit;display:block;width:100%;padding:14px;border-radius:12px;border:1px solid #333;background:#1a1b21;color:#eee;margin:8px 0;text-align:center}
button.p,label.b{background:#f5f6f8;color:#111;font-weight:600;border:0}input{text-align:left}.row{display:flex;gap:10px}.row>*{flex:1}
.tabs{display:flex;gap:8px;margin:16px 0}.tabs button{margin:0}.tabs .on{background:#f5f6f8;color:#111}.hide{display:none}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.ph{position:relative;aspect-ratio:16/9;border-radius:10px;overflow:hidden;background:#222}
.ph img{width:100%;height:100%;object-fit:cover;display:block}.ph button{position:absolute;right:4px;top:4px;width:32px;height:32px;padding:0;margin:0;border-radius:16px;background:rgba(0,0,0,.7);border:0;color:#fff}
.ph.off img{opacity:.3}.al{display:flex;align-items:center;gap:12px;padding:12px;border-radius:12px;background:#1a1b21;margin:6px 0}.al input{width:22px;height:22px;margin:0}
.bar{height:8px;border-radius:4px;background:#333;overflow:hidden;margin:8px 0}.bar i{display:block;height:100%;width:0;background:#f5f6f8}small{color:#888}</style>
<h1>Wallpapers</h1><p id=sum>${T('Connecting to the TV…')}</p>
<div id=login class=hide><p>${T('Enter the code shown on the TV.')}</p><input id=code inputmode=numeric autocomplete=one-time-code><button class=p id=go>${T('Continue')}</button></div>
<div id=main class=hide>
<div id=msg></div>
<section id=up><label class=b for=f>${T('Choose photos')}</label><input id=f type=file accept="image/*" multiple class=hide>
<div id=prog class=hide><div class=bar><i id=pb></i></div><p id=pt></p></div>
<h2>${T('Uploaded')} <small id=un></small></h2><div class=grid id=ug></div></section>
</div>
` +
    i18n.script(lang, PHONE_JS) +
    '<script>' +
    PHONE_JS +
    '</script></html>'
  );
}

module.exports = { create, imageType, imageSize, fileSize, isLandscape, homePhotos, LANDSCAPE, LIMITS, PAIR_PORT };
