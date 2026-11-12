// Apple's Aerial manifests, read without dependencies: tar files on sylvan.apple.com holding entries.json, whose assets are the films:
//   {assets: [{id, accessibilityLabel: the place, categories, "url-1080-H264", "url-4K-SDR", "url-4K-SDR-240FPS", ...}], categories}
// resources-16.tar (the one tvOS used, and the open-source Aerial screen saver for macOS) has 114 films, each as 1080p H.264 and as
// 4K HEVC SDR at 30 frames a second. The newer list (resources-27-0-1.tar, macOS 27) has those 114 under the same ids and 50 more,
// but only as one file each: 4K HEVC Main 10, high tier, level 6.1, at 240 frames a second (HFR_TYPE), which few TVs decode.
// films() keeps what the screen saver needs: an id, the place, and the address of each of those three files. Only addresses of files
// on Apple's host are kept, and they are turned into plain http: sylvan.apple.com's certificate chains to Apple's own root, which
// neither Node nor the TV's browser trusts, and the host answers the same files over http. merge() puts the lists together.
// The places' names in other languages are in the same tar (names(): a binary plist {language: {localizedNameKey: name}}, the
// language as fr, fr_CA, zh_TW); place() picks the one for the screen saver's language.
'use strict';

const HOST = /^https?:\/\/sylvan\.apple\.com\/[\w\/.-]{1,280}\.(?:mov|mp4)$/;
const ID = /^[\w-]{1,64}$/;
// the 240 fps file, as a MIME type the screen saver page asks the TV about (MediaSource.isTypeSupported) before it plays one
const HFR_TYPE = 'video/mp4; codecs="hvc1.2.4.H183.B0"; width=3840; height=2160; framerate=240';
// the macOS-only films: the desktop pictures that move (light and dark, landscape and portrait) and the Mac colours
const SKIP_CATEGORY = /^AerialCategory(?:Dynamic|Mac)$/;

// a file in a tar archive (ustar or plain), by its name or a name ending in /<name>; null when it is not there
function tarFile(buf, name) {
  let o = 0;
  while (o + 512 <= buf.length) {
    const h = buf.slice(o, o + 512);
    if (h[0] === 0) break; // the two empty blocks at the end
    const str = (a, b) => {
      const s = h.toString('latin1', a, b);
      const z = s.indexOf('\0');
      return z >= 0 ? s.slice(0, z) : s;
    };
    const prefix = h.toString('latin1', 257, 262) === 'ustar' ? str(345, 500) : '';
    const n = (prefix ? prefix + '/' : '') + str(0, 100);
    const size = parseInt(str(124, 136).trim() || '0', 8);
    if (!(size >= 0)) return null;
    const type = String.fromCharCode(h[156] || 48);
    const start = o + 512;
    if ((type === '0' || type === '\0') && (n === name || n.slice(-name.length - 1) === '/' + name || n === './' + name))
      return buf.slice(start, start + size);
    o = start + Math.ceil(size / 512) * 512;
  }
  return null;
}

const BP = require('./bplist');
const LANG = /^[a-z]{2,3}(?:_[A-Za-z0-9]{2,4})?$/;

const plain = u => {
  const s = String(u || '');
  return HOST.test(s) ? s.replace(/^https:/, 'http:') : '';
};
// the place, as one short line; a label that is a shot's code (GG_A_DAY_BLUFFS_C35_V25_HFR_HEVC) is no place
const line = s => {
  const t = String(s || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return /^[A-Z0-9]+(?:_[A-Z0-9]+)+$/.test(t) ? '' : t;
};

// the loctable (a Buffer) -> {language: {key: name}}, only the languages and the strings; {} when it cannot be read
function names(buf) {
  let t;
  try {
    t = BP.parse(buf);
  } catch (_) {
    return {};
  }
  const out = {};
  for (const l of Object.keys(t && typeof t === 'object' ? t : {}))
    if (LANG.test(l) && t[l] && typeof t[l] === 'object' && !Array.isArray(t[l])) out[l] = t[l];
  return out;
}

// a film's names, {language: name}: from the table by its key, or the ones it was kept with (films.json); only those that differ from
// the title
function namesOf(a, table, title) {
  const out = {},
    key = String(a.localizedNameKey || '');
  for (const l of Object.keys(table))
    if (key && typeof table[l][key] === 'string') {
      const n = line(table[l][key]);
      if (n && n !== title) out[l] = n;
    }
  const kept = a.names && typeof a.names === 'object' ? a.names : {};
  for (const l of Object.keys(kept).slice(0, 100))
    if (LANG.test(l) && !out[l]) {
      const n = line(kept[l]);
      if (n && n !== title) out[l] = n;
    }
  return out;
}

// entries.json (text or parsed) -> [{id, title, names, h264, hevc, hfr}]: the films with at least one file, each id once, without the
// macOS-only ones; title: the place in English ('' where there is none), from the names (table, see names()) or the manifest's label
function films(entries, table) {
  const tb = table && typeof table === 'object' ? table : {};
  let j = entries;
  if (typeof j === 'string' || Buffer.isBuffer(j)) {
    try {
      j = JSON.parse(String(j));
    } catch (_) {
      return [];
    }
  }
  const skip = {};
  for (const c of j && Array.isArray(j.categories) ? j.categories : [])
    if (c && SKIP_CATEGORY.test(String(c.localizedNameKey || ''))) skip[String(c.id)] = 1;
  const out = [],
    seen = {};
  for (const a of (j && Array.isArray(j.assets) ? j.assets : []).slice(0, 1000)) {
    if (!a || typeof a !== 'object' || !ID.test(String(a.id || '')) || seen[a.id]) continue;
    if (a.variant || (Array.isArray(a.categories) && a.categories.some(c => skip[String(c)]))) continue;
    const key = String(a.localizedNameKey || '');
    const title = line(tb.en && typeof tb.en[key] === 'string' ? tb.en[key] : '') || line(a.accessibilityLabel);
    const f = {
      id: String(a.id),
      title,
      names: namesOf(a, tb, title),
      h264: plain(a['url-1080-H264']),
      hevc: plain(a['url-4K-SDR']),
      hfr: plain(a['url-4K-SDR-240FPS']),
    };
    if (!f.h264 && !f.hevc && !f.hfr) continue;
    seen[a.id] = 1;
    out.push(f);
  }
  return out;
}

// several lists of films (the newest first) -> one: the films in the newest list's order, then those only older lists have; each
// place and file from the newest list that has it
function merge(lists) {
  const out = [],
    by = {};
  for (const l of lists)
    for (const f of l || []) {
      const m = by[f.id];
      if (!m) out.push((by[f.id] = Object.assign({}, f)));
      else {
        for (const k of ['title', 'h264', 'hevc', 'hfr']) if (!m[k] && f[k]) m[k] = f[k];
        if (!Object.keys(m.names || {}).length && f.names) m.names = f.names;
      }
    }
  return out;
}

// the place in a language (fr-FR, fr_CA, pt, zh-Hant-TW): the name for that language and region, else for the language, else for the
// language in any region, else the title (English)
function place(f, lang) {
  const n = (f && f.names) || {};
  const p = String(lang || '')
    .replace(/-/g, '_')
    .split('_');
  const base = p[0].toLowerCase() === 'nb' || p[0].toLowerCase() === 'nn' ? 'no' : p[0].toLowerCase();
  if (/^[a-z]{2,3}$/.test(base)) {
    const region = p
      .slice(1)
      .filter(x => /^(?:[A-Za-z]{2}|\d{3})$/.test(x))
      .pop();
    if (region && n[base + '_' + region.toUpperCase()]) return n[base + '_' + region.toUpperCase()];
    if (n[base]) return n[base];
    const any = Object.keys(n).filter(l => l.indexOf(base + '_') === 0)[0];
    if (any) return n[any];
  }
  return (f && f.title) || '';
}

module.exports = { tarFile, films, merge, names, place, HFR_TYPE };
