// iCloud Shared Albums as a photo source for Home's wallpapers (an add-on that provides "wallpapers", see helper/wallpapers.js):
//   dataDir/photos/<photo guid>.jpg   photos of the albums, downloaded by a sync and kept, so showing one never needs Apple
//   dataDir/index.json                what each file is (size, Apple's checksum, album), each album's name, partition host and last
//                                     error, and how the last sync went; only listed files are deleted
// The settings (the albums' tokens, hidden photos) are this add-on's settings in config.json (addons.icloud.settings). A token is what
// follows "#" in the album's public link and is all it takes to read the album: it goes only into the path of requests to Apple's
// shared-streams hosts, shows as its last four characters at most and is not logged.
//
// Apple's public shared-album web API is undocumented; it is the one the album's page on icloud.com uses:
//   POST https://p<NN>-sharedstreams.icloud.com/<token>/sharedstreams/webstream {"streamCtag":null}
//     -> 200 {streamName, photos: [{photoGuid, dateCreated, mediaAssetType?, derivatives: {<key>: {checksum, fileSize, width, height}}}]}
//     -> 330 when the album lives on another partition: the host is in the X-Apple-MMe-Host header or the body field of that name
//   POST .../webasseturls {"photoGuids": [...]}
//     -> 200 {items: {<derivative checksum>: {url_location, url_path, url_expiry}}, locations: {<host>: {scheme, hosts}}}
// The partition of the first request is read from the token (base 62); a wrong guess is corrected by the 330. Only https requests to
// p<NN>-sharedstreams.icloud.com, and downloads from hosts under icloud-content.com or icloud.com, are made; every redirect is checked.
// The phone page (settings(): a short-lived server on the LAN, port 8804, needs the code shown on the TV) adds and removes albums and
// hides photos.
const crypto = require('crypto'),
  fs = require('fs'),
  http = require('http'),
  path = require('path'),
  { URL } = require('url');
const phone = require('./phone');

const LIMITS = { photos: 300, bytes: 100 * 1024 * 1024, file: 12 * 1024 * 1024, albums: 10 };
const PAIR_PORT = 8804, // after the Agent tools page (8803)
  PAIR_MS = 15 * 60 * 1000,
  SYNC_MS = 6 * 3600 * 1000,
  HOPS = 3, // partition moves (330) or redirects followed at most
  BATCH = 25, // photos per webasseturls request; the signed addresses expire in hours, so each batch is downloaded right away
  MIN_LONG = 1024; // a derivative smaller than this on its long side (Apple's thumbnails) is never a wallpaper
const TOKEN = /^[A-Za-z0-9_-]{10,64}$/,
  GUID = /^[A-Za-z0-9-]{8,64}$/,
  SUM = /^[A-Za-z0-9]{8,128}$/,
  ALBUM = /^[0-9a-f]{12}$/,
  STREAM_HOST = /^p\d{1,4}-sharedstreams\.icloud\.com$/,
  LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// the token of a public link (https://www.icloud.com/sharedalbum/#<token>, with or without a language in the path or a photo after
// ";"), or a bare token; '' for anything else
function parseLink(s) {
  const t = String(s || '').trim();
  if (TOKEN.test(t)) return t;
  const m =
    /^https:\/\/(?:www\.)?icloud\.com\/sharedalbum\/(?:[A-Za-z]{2}(?:[-_][A-Za-z]{2,4})?\/)?#([A-Za-z0-9_-]{10,64})(?:;[A-Za-z0-9_-]{0,80})?$/.exec(
      t
    );
  return m ? m[1] : '';
}
const albumId = token => crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
const hint = token => '…' + String(token).slice(-4);

// the partition Apple keeps the album on, read from the token: a token that starts with "A" names it in its second character, any other
// in its second and third (base 62, digits, then A-Z, then a-z)
function firstHost(token) {
  const v = c => B62.indexOf(c);
  const n = token.charAt(0) === 'A' ? v(token.charAt(1)) : v(token.charAt(1)) * 62 + v(token.charAt(2));
  const p = n >= 1 && n <= 9999 ? n : 1;
  return 'p' + (p < 10 ? '0' : '') + p + '-sharedstreams.icloud.com';
}
// a host a photo may be downloaded from: a name under icloud-content.com or icloud.com, nothing else (no address, no port)
function assetHost(h) {
  const host = String(h || '');
  if (!host || host.length > 253) return false;
  const l = host.split('.');
  const top = l.slice(-2).join('.');
  return l.length >= 3 && (top === 'icloud-content.com' || top === 'icloud.com') && l.every(x => LABEL.test(x));
}
// a full address that is https on such a host, else ''
function assetUrl(u) {
  let x;
  try {
    x = new URL(String(u));
  } catch (_) {
    return '';
  }
  return x.protocol === 'https:' && !x.port && !x.username && !x.password && assetHost(x.hostname) ? x.toString() : '';
}

// the photos of a webstream answer, newest first: videos are skipped, and so are derivatives that are not a picture of a size
// (a video's "PosterFrame" or "720p")
function parseStream(j) {
  if (!j || typeof j !== 'object' || !Array.isArray(j.photos)) throw new Error('Apple sent an answer the TV does not understand');
  const photos = [];
  for (const p of j.photos) {
    if (!p || typeof p !== 'object' || !GUID.test(String(p.photoGuid || ''))) continue;
    if (String(p.mediaAssetType || '').toLowerCase() === 'video') continue;
    const ds = p.derivatives && typeof p.derivatives === 'object' ? p.derivatives : {};
    const derivs = [];
    for (const k of Object.keys(ds)) {
      const d = ds[k];
      if (!/^\d{1,5}(?:-\d{1,2})?$/.test(k) || !d || typeof d !== 'object') continue;
      const w = +d.width || 0,
        h = +d.height || 0,
        sum = String(d.checksum || '');
      if (w > 0 && h > 0 && SUM.test(sum)) derivs.push({ sum, w, h, bytes: +d.fileSize || 0 });
    }
    if (!derivs.length) continue;
    photos.push({ guid: p.photoGuid, at: Date.parse(p.dateCreated || p.batchDateCreated || '') || 0, derivs });
  }
  photos.sort((a, b) => b.at - a.at);
  return {
    name:
      String(j.streamName || '')
        .trim()
        .slice(0, 80) || 'Shared album',
    photos,
  };
}

// the derivatives to try for a photo, best first: the smallest whose long side covers the picture size (3840 for 4K, 1920 for Full
// HD), else the largest; never a thumbnail and never one larger than a file may be
function pick(derivs, size) {
  const want = size === 'hd' ? 1920 : 3840,
    long = d => Math.max(d.w, d.h);
  const ok = derivs.filter(d => long(d) >= MIN_LONG && !(d.bytes > LIMITS.file));
  const covers = ok.filter(d => long(d) >= want).sort((a, b) => long(a) - long(b) || a.bytes - b.bytes);
  const smaller = ok.filter(d => long(d) < want).sort((a, b) => long(b) - long(a) || b.bytes - a.bytes);
  return covers.concat(smaller);
}

const isJpeg = b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const message = e => String((e && e.message) || e);

function create(ctx) {
  const fetch = ctx.fetch,
    util = ctx.util,
    PH = path.join(ctx.dataDir, 'photos'),
    INDEX = path.join(ctx.dataDir, 'index.json');
  // the stored albums, checked: an id is always the one of its token
  const cfg = () => {
    const s = Object.assign({ albums: [], hidden: [] }, ctx.settings.get());
    const albums = (Array.isArray(s.albums) ? s.albums : [])
      .filter(a => a && TOKEN.test(String(a.token || '')))
      .map(a => ({ id: albumId(a.token), token: a.token }));
    const hidden = (Array.isArray(s.hidden) ? s.hidden : []).filter(x => typeof x === 'string' && GUID.test(x));
    return { albums, hidden };
  };
  const save = o => ctx.settings.set(o);

  // ---- the index of the files ----
  let index = null;
  function idx() {
    if (index) return index;
    try {
      index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
    } catch (_) {
      index = {};
    }
    index.photos = index.photos && typeof index.photos === 'object' ? index.photos : {};
    index.albums = index.albums && typeof index.albums === 'object' ? index.albums : {};
    index.sync = index.sync || { state: 'idle', at: 0, error: '', ok: 0, done: 0 };
    return index;
  }
  function saveIdx() {
    util.mkdirp(ctx.dataDir);
    fs.writeFileSync(INDEX + '.tmp', JSON.stringify(idx()), { mode: 0o600 });
    fs.renameSync(INDEX + '.tmp', INDEX);
  }
  const unlink = f => {
    try {
      fs.unlinkSync(f);
    } catch (_) {}
  };
  const albumState = id => idx().albums[id] || (idx().albums[id] = { host: '', name: '', count: 0, error: '', ok: 0 });
  const shown = () => {
    const hid = cfg().hidden;
    return Object.keys(idx().photos).filter(id => hid.indexOf(id) < 0);
  };
  const usedBytes = () => Object.keys(idx().photos).reduce((n, k) => n + (idx().photos[k].bytes || 0), 0);
  function dropPhoto(id) {
    const p = idx().photos[id];
    if (p && typeof p.file === 'string' && !/[\\/]/.test(p.file)) unlink(path.join(PH, p.file));
    delete idx().photos[id];
  }

  // ---- Apple: one POST to the album's partition, following a 330 to another partition of the strict pattern ----
  async function apple(token, host, endpoint, payload) {
    let h = host;
    for (let hop = 0; hop <= HOPS; hop++) {
      if (!STREAM_HOST.test(h)) throw new Error('Apple named a server the TV does not trust');
      const r = await fetch.read('https://' + h + '/' + token + '/sharedstreams/' + endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'text/plain',
          Accept: 'application/json',
          Origin: 'https://www.icloud.com',
          Referer: 'https://www.icloud.com/',
        },
        body: JSON.stringify(payload),
        redirects: 0,
        anyStatus: true,
        idleMs: 30000,
        totalMs: 120000,
        maxBytes: 24 << 20,
      });
      if (r.status === 330) {
        let next = r.headers['x-apple-mme-host'];
        if (!next)
          try {
            next = JSON.parse(r.body.toString('utf8'))['X-Apple-MMe-Host'];
          } catch (_) {}
        h = String(next || '')
          .trim()
          .toLowerCase();
        continue;
      }
      if (r.status === 404 || r.status === 401 || r.status === 403 || r.status === 410)
        throw new Error('Apple does not find this album: it was deleted or its Public Website is off');
      if (r.status === 429 || r.status === 503) throw new Error('Apple is busy: the TV tries again later');
      if (r.status !== 200) throw new Error('Apple answered ' + r.status);
      let j;
      try {
        j = JSON.parse(r.body.toString('utf8'));
      } catch (_) {
        throw new Error('Apple sent an answer the TV does not understand');
      }
      return { host: h, json: j };
    }
    throw new Error('Apple moved the album too many times');
  }
  async function readAlbum(token, host) {
    const r = await apple(token, host || firstHost(token), 'webstream', { streamCtag: null });
    return Object.assign({ host: r.host }, parseStream(r.json));
  }
  // the download addresses of some photos, by derivative checksum; an address on a host that is not Apple's is left out
  async function assetUrls(token, host, guids) {
    const r = await apple(token, host, 'webasseturls', { photoGuids: guids });
    const items = (r.json && r.json.items) || {},
      locs = (r.json && r.json.locations) || {},
      out = {};
    for (const sum of Object.keys(items)) {
      const it = items[sum];
      if (!SUM.test(sum) || !it || typeof it.url_path !== 'string' || it.url_path.charAt(0) !== '/') continue;
      const loc = String(it.url_location || '').toLowerCase();
      const scheme = locs[loc] && locs[loc].scheme;
      if (scheme && scheme !== 'https') continue;
      if (!assetHost(loc) || /[\s\\]/.test(it.url_path) || it.url_path.length > 4096) continue;
      const u = assetUrl('https://' + loc + it.url_path);
      if (u && new URL(u).hostname === loc) out[sum] = u;
    }
    return out;
  }
  // one picture, following at most a few redirects, each to an Apple host over https
  async function getPicture(url) {
    let u = url;
    for (let hop = 0; hop <= HOPS; hop++) {
      const r = await fetch.read(u, { redirects: 0, anyStatus: true, idleMs: 30000, totalMs: 180000, maxBytes: LIMITS.file });
      if (r.status >= 300 && r.status < 400 && r.headers.location) {
        let next = '';
        try {
          next = assetUrl(new URL(String(r.headers.location), u).toString());
        } catch (_) {}
        if (!next) throw new Error('Apple redirected the picture to a server the TV does not trust');
        u = next;
        continue;
      }
      if (r.status !== 200) throw new Error('Apple answered ' + r.status + ' for a picture');
      if (!isJpeg(r.body)) throw new Error('not a JPEG picture');
      return r.body;
    }
    throw new Error('too many redirects for a picture');
  }

  // ---- adding and removing albums ----
  async function addLinks(text) {
    const parts = String(text || '')
      .split(/[\s,]+/)
      .filter(Boolean)
      .slice(0, 20);
    if (!parts.length) return { error: 'paste the link of a shared album' };
    const added = [],
      errors = [];
    for (const part of parts) {
      const token = parseLink(part);
      if (!token) {
        errors.push({ album: '', error: 'not the link of an iCloud Shared Album' });
        continue;
      }
      const c = cfg(),
        id = albumId(token);
      if (c.albums.some(a => a.id === id)) {
        errors.push({ album: hint(token), error: 'this album is already on the TV' });
        continue;
      }
      if (c.albums.length >= LIMITS.albums) {
        errors.push({ album: hint(token), error: 'at most ' + LIMITS.albums + ' albums' });
        continue;
      }
      try {
        const a = await readAlbum(token);
        const st = albumState(id);
        Object.assign(st, { host: a.host, name: a.name, count: a.photos.length, error: '', ok: Date.now() });
        // read again: the settings may have changed while Apple answered
        const now = cfg().albums.filter(x => x.id !== id);
        save({ albums: now.map(x => ({ token: x.token })).concat([{ token }]) });
        saveIdx();
        added.push({ id, name: a.name, count: a.photos.length });
        ctx.log('album ' + hint(token) + ' added (' + a.photos.length + ' photos)');
      } catch (e) {
        errors.push({ album: hint(token), error: message(e) });
      }
    }
    if (added.length) sync();
    return { ok: added.length > 0, added, errors };
  }
  function removeAlbum(id) {
    const c = cfg();
    if (!c.albums.some(a => a.id === id)) return { error: 'no such album' };
    save({ albums: c.albums.filter(a => a.id !== id).map(a => ({ token: a.token })) });
    for (const pid of Object.keys(idx().photos)) if (idx().photos[pid].album === id) dropPhoto(pid);
    delete idx().albums[id];
    saveIdx();
    return { ok: true };
  }
  function disconnect() {
    for (const id of Object.keys(idx().photos)) dropPhoto(id);
    idx().albums = {};
    idx().sync = { state: 'idle', at: 0, error: '', ok: 0, done: 0 };
    saveIdx();
    save({ albums: [], hidden: [] });
  }

  // ---- the sync: new or changed photos are downloaded, photos that left an album are deleted (only files the index lists) ----
  let syncing = null,
    again = false;
  // one sync at a time; a request during a sync (an album added, Sync now) runs it once more afterwards, within the same promise
  function sync() {
    if (syncing) {
      again = true;
      return syncing;
    }
    syncing = (async () => {
      do {
        again = false;
        await doSync().catch(e => ctx.log('sync failed: ' + message(e)));
      } while (again);
      syncing = null;
    })();
    return syncing;
  }
  async function doSync() {
    const c = cfg(),
      st = idx().sync,
      cur = idx().photos;
    if (!c.albums.length) return;
    st.state = 'syncing';
    st.error = '';
    st.done = 0;
    try {
      util.mkdirp(PH);
      const mine = {},
        failed = {},
        want = [],
        seen = {};
      c.albums.forEach(a => (mine[a.id] = a));
      // photos of an album that is no longer on the TV go first
      for (const id of Object.keys(cur)) if (!mine[cur[id].album]) dropPhoto(id);
      for (const id of Object.keys(idx().albums)) if (!mine[id]) delete idx().albums[id];
      for (const a of c.albums) {
        const as = albumState(a.id);
        try {
          const r = await readAlbum(a.token, as.host);
          Object.assign(as, { host: r.host, name: r.name, count: r.photos.length, error: '', ok: Date.now() });
          for (const p of r.photos)
            if (!seen[p.guid]) {
              seen[p.guid] = 1;
              want.push(Object.assign({ album: a.id }, p));
            }
        } catch (e) {
          // Apple did not answer for this album: its photos stay as they are
          as.error = message(e);
          failed[a.id] = 1;
          ctx.log('album ' + hint(a.token) + ': ' + as.error);
        }
      }
      const failedCount = Object.keys(failed).length;
      if (failedCount === c.albums.length) throw new Error(albumState(c.albums[0].id).error);
      // only photos with a derivative worth showing at this picture size
      const size = ctx.env.wallpaperSize() === 'hd' ? 'hd' : '4k';
      want.forEach(w => (w.tries = pick(w.derivs, size)));
      want.splice(0, want.length, ...want.filter(w => w.tries.length));
      want.sort((x, y) => y.at - x.at);
      const stay = Object.keys(cur).filter(id => failed[cur[id].album]);
      const keep = want.filter(w => !(cur[w.guid] && failed[cur[w.guid].album])).slice(0, Math.max(0, LIMITS.photos - stay.length));
      const keepIds = {};
      stay.concat(keep.map(w => w.guid)).forEach(id => (keepIds[id] = 1));
      for (const id of Object.keys(cur)) if (!keepIds[id]) dropPhoto(id);
      saveIdx();
      if (!want.length && !failedCount) st.error = 'the albums have no photos the TV can show';

      const todo = keep.filter(w => {
        const have = cur[w.guid];
        return !(have && have.size === size && w.tries.some(d => d.sum === have.sum) && fs.existsSync(path.join(PH, have.file)));
      });
      let full = false,
        failedDl = 0;
      for (const a of c.albums) {
        const mineTodo = todo.filter(w => w.album === a.id);
        for (let i = 0; i < mineTodo.length && !full; i += BATCH) {
          const batch = mineTodo.slice(i, i + BATCH);
          let urls;
          try {
            urls = await assetUrls(
              a.token,
              albumState(a.id).host,
              batch.map(w => w.guid)
            );
          } catch (e) {
            failedDl += batch.length;
            st.error = message(e);
            if (!st.done && failedDl >= 5) throw e;
            continue;
          }
          for (const w of batch) {
            if (usedBytes() > LIMITS.bytes - 2 * 1024 * 1024) {
              full = true;
              break;
            }
            const got = await downloadOne(w, urls, size);
            if (got) st.done++;
            else failedDl++;
            if (!got && failedDl >= 5 && !st.done) throw new Error(lastDownloadError || 'the photos could not be downloaded');
            if (st.done && st.done % 10 === 0) saveIdx();
          }
        }
      }
      st.ok = Date.now();
      const notes = [];
      if (failedCount) notes.push(failedCount + (failedCount === 1 ? ' album' : ' albums') + ' could not be read');
      if (full) notes.push('the TV keeps at most ' + Math.round(LIMITS.bytes / 1048576) + ' MB: not every photo was downloaded');
      else if (failedDl) notes.push(failedDl + ' photos could not be downloaded');
      if (notes.length) st.error = notes.join(' · ');
      ctx.log('sync: ' + st.done + ' new, ' + Object.keys(cur).length + ' on the TV' + (st.error ? ', ' + st.error : ''));
    } catch (e) {
      st.error = message(e);
    }
    st.state = 'idle';
    st.at = Date.now();
    saveIdx();
  }
  let lastDownloadError = '';
  // the best derivative that comes as a JPEG; true when the photo is on the TV
  async function downloadOne(w, urls, size) {
    const cur = idx().photos,
      tmp = path.join(PH, w.guid + '.tmp');
    for (const d of w.tries.slice(0, 2)) {
      if (!urls[d.sum]) continue;
      try {
        const body = await getPicture(urls[d.sum]);
        fs.writeFileSync(tmp, body, { mode: 0o600 });
        fs.renameSync(tmp, path.join(PH, w.guid + '.jpg'));
        cur[w.guid] = { file: w.guid + '.jpg', bytes: body.length, sum: d.sum, size, album: w.album, at: w.at };
        return true;
      } catch (e) {
        lastDownloadError = message(e);
      }
    }
    unlink(tmp);
    if (!w.tries.some(d => urls[d.sum])) lastDownloadError = 'Apple gave no address for a photo';
    return false;
  }

  // ---- what Home's wallpapers ask of a source ----
  const ago = t => {
    if (!t) return 'never';
    const m = Math.round((Date.now() - t) / 60000);
    return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago';
  };
  function details() {
    const c = cfg(),
      s = idx().sync,
      onTv = {};
    Object.keys(idx().photos).forEach(id => {
      const a = idx().photos[id].album;
      onTv[a] = (onTv[a] || 0) + 1;
    });
    return {
      configured: c.albums.length > 0,
      albums: c.albums.map(a => {
        const as = idx().albums[a.id] || {};
        return { id: a.id, hint: hint(a.token), name: as.name || '', count: as.count || 0, photos: onTv[a.id] || 0, error: as.error || '' };
      }),
      photos: shown().length,
      hidden: c.hidden.length,
      state: s.state,
      lastSync: s.ok || 0,
      tried: s.at || 0,
      error: s.error || '',
      done: s.done || 0,
    };
  }
  function status() {
    const d = details();
    if (!d.configured) return { summary: 'no album yet · set up from your phone', error: '' };
    return {
      summary: d.state === 'syncing' ? 'syncing… ' + d.done + ' new' : d.photos + ' photos · synced ' + ago(d.lastSync),
      error: d.error,
    };
  }
  const file = id => {
    const p = GUID.test(String(id)) && idx().photos[id];
    return p && shown().indexOf(id) >= 0 ? path.join(PH, p.file) : '';
  };

  // ---- the phone page: LAN, short-lived, the code shown on the TV in every request (header x-code) ----
  let pair = null;
  function stopPair() {
    if (!pair) return;
    clearTimeout(pair.timer);
    try {
      pair.srv.close();
    } catch (_) {}
    pair = null;
  }
  // while the page is used it stays open (up to an hour after it was opened)
  function touch() {
    if (!pair) return;
    clearTimeout(pair.timer);
    pair.until = Math.min(Date.now() + PAIR_MS, (pair.opened || (pair.opened = Date.now())) + 3600 * 1000);
    pair.timer = setTimeout(stopPair, pair.until - Date.now());
  }
  function body(req) {
    return new Promise((resolve, reject) => {
      const b = [];
      let n = 0;
      req.on('data', c => {
        n += c.length;
        if (n > 16384) {
          reject(new Error('too large'));
          req.destroy();
        } else b.push(c);
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(b).toString('utf8') || '{}'));
        } catch (_) {
          resolve({});
        }
      });
      req.on('error', reject);
    });
  }
  async function handlePhone(req, res, code, wrong) {
    const u = req.url.split('?')[0],
      json = (o, c) => {
        res.writeHead(c || 200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(o));
      };
    if (req.method === 'GET' && u === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(phone.page(util.i18n, esc, util.i18n.lang(req, ctx.env.lang())));
    }
    if (u.indexOf('/api/') !== 0) {
      res.writeHead(404);
      return res.end();
    }
    if (req.headers['x-code'] !== code) {
      if (wrong() >= 8) stopPair();
      return json({ error: 'wrong code' }, 403);
    }
    touch();
    try {
      if (u === '/api/state') return json(details());
      const m = /^\/api\/photo\/([A-Za-z0-9-]{8,64})$/.exec(u);
      if (m && req.method === 'GET') {
        const p = idx().photos[m[1]];
        if (!p || /[\\/]/.test(p.file)) return json({ error: 'not found' }, 404);
        res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=3600' });
        return fs.createReadStream(path.join(PH, p.file)).pipe(res);
      }
      if (req.method !== 'POST') return json({ error: 'not found' }, 404);
      const b = await body(req);
      if (u === '/api/add') return json(await addLinks(b.links));
      if (u === '/api/remove') return json(removeAlbum(String(b.id || '')));
      if (u === '/api/sync') {
        sync();
        return json({ ok: true });
      }
      if (u === '/api/photos') {
        const hid = cfg().hidden,
          cur = idx().photos;
        return json({
          photos: Object.keys(cur)
            .sort((x, y) => (cur[y].at || 0) - (cur[x].at || 0))
            .map(id => ({ id, hidden: hid.indexOf(id) >= 0 })),
        });
      }
      if (u === '/api/hide') {
        const id = String(b.id || '');
        if (!GUID.test(id)) return json({ error: 'bad id' }, 400);
        const hid = cfg().hidden.filter(x => x !== id);
        if (b.hidden) hid.push(id);
        save({ hidden: hid.slice(-1000) });
        return json({ ok: true });
      }
      if (u === '/api/disconnect') {
        disconnect();
        return json({ ok: true });
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: message(e) }, 400);
    }
  }
  function settings(o) {
    stopPair();
    if (o && o.stop) return {};
    const code = String(util.randomInt(100000, 1000000));
    let bad = 0;
    const srv = http.createServer((req, res) => handlePhone(req, res, code, () => ++bad));
    pair = { code, srv, until: Date.now() + PAIR_MS, timer: setTimeout(stopPair, PAIR_MS) };
    const url = 'http://' + util.lanIp() + ':' + PAIR_PORT;
    return new Promise(resolve => {
      srv.on('error', e => {
        stopPair();
        resolve({ error: 'the phone page could not start: ' + e.message });
      });
      srv.listen(PAIR_PORT, '0.0.0.0', () => resolve({ url, code, qr: url + '/#' + code, seconds: PAIR_MS / 1000 }));
    });
  }

  // the automatic sync: every six hours; shortly after a start only when the last one is more than a day old
  const timers = [];
  function start() {
    if (idx().sync.state === 'syncing') idx().sync.state = 'idle'; // a sync the last run did not finish
    const t = setInterval(() => sync(), SYNC_MS);
    if (t.unref) t.unref();
    timers.push(t);
    if (Date.now() - (idx().sync.ok || 0) > 24 * 3600 * 1000 && cfg().albums.length) {
      const t2 = setTimeout(() => sync(), 15 * 60 * 1000);
      if (t2.unref) t2.unref();
      timers.push(t2);
    }
  }
  function stop() {
    timers.splice(0).forEach(t => clearTimeout(t));
    stopPair();
  }

  return {
    start,
    stop,
    wallpapers: { label: 'iCloud Shared Album', list: shown, file, status, settings },
    // for the tests
    sync,
    details,
  };
}

module.exports = { create, parseLink, parseStream, pick, firstHost, assetHost, assetUrl, albumId, LIMITS, PAIR_PORT };
