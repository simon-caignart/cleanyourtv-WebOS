// Apple's Aerial manifest, read without dependencies: a tar file (resources-16.tar on sylvan.apple.com, the one the open-source Aerial
// screen saver for macOS uses for tvOS) holding entries.json, whose assets are the films:
//   {assets: [{id, accessibilityLabel: the place, shotID, "url-1080-H264", "url-1080-SDR", "url-4K-SDR", ...}], categories, version}
// films() keeps what the screen saver needs: an id, the place, and the address of the 1080p H.264 and the 4K HEVC SDR file. Only
// addresses of files on Apple's host are kept, and they are turned into plain http: sylvan.apple.com's certificate chains to Apple's own
// root, which neither Node nor the TV's browser trusts, and the host answers the same files over http.
'use strict';

const HOST = /^https?:\/\/sylvan\.apple\.com\/[\w\/.-]{1,200}\.(?:mov|mp4)$/;
const ID = /^[\w-]{1,64}$/;

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

const plain = u => {
  const s = String(u || '');
  return HOST.test(s) ? s.replace(/^https:/, 'http:') : '';
};
// the place, as one short line
const line = s =>
  String(s || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

// entries.json (text or parsed) -> [{id, title, h264, hevc}]: the films with a place and at least one file; each id once
function films(entries) {
  let j = entries;
  if (typeof j === 'string' || Buffer.isBuffer(j)) {
    try {
      j = JSON.parse(String(j));
    } catch (_) {
      return [];
    }
  }
  const out = [],
    seen = {};
  for (const a of (j && Array.isArray(j.assets) ? j.assets : []).slice(0, 1000)) {
    if (!a || typeof a !== 'object' || !ID.test(String(a.id || '')) || seen[a.id]) continue;
    const f = { id: String(a.id), title: line(a.accessibilityLabel), h264: plain(a['url-1080-H264']), hevc: plain(a['url-4K-SDR']) };
    if (!f.title || (!f.h264 && !f.hevc)) continue;
    seen[a.id] = 1;
    out.push(f);
  }
  return out;
}

module.exports = { tarFile, films };
