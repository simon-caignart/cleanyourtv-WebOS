// A reader for Apple's binary property lists ("bplist00"), enough for the place names in the Aerial manifest
// (TVIdleScreenStrings.bundle/Contents/Resources/Localizable.nocache.loctable: {language: {key: name}}).
// The layout: the header "bplist00", the objects, a table of their offsets, and a trailer in the last 32 bytes: the size of an offset,
// the size of an object reference, the number of objects, the top object and where the offset table starts. Each object starts with a
// marker byte: the high four bits are its kind, the low four its length (15: the length follows as an integer object).
// Kinds read: null and booleans, integers, reals, dates (as seconds), data (a Buffer), ASCII, UTF-16 and UTF-8 strings, arrays and dicts
// (as plain objects with string keys). Anything else, a reference out of range, or nesting that loops, throws.
'use strict';

const MAX_DEPTH = 32;

function uint(b, o, n) {
  if (n <= 6) return b.readUIntBE(o, n);
  if (n === 8) return b.readUInt32BE(o) * 4294967296 + b.readUInt32BE(o + 4);
  throw new Error('bplist: an integer of ' + n + ' bytes');
}

function parse(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 40 || buf.toString('latin1', 0, 8) !== 'bplist00') throw new Error('bplist: not a bplist00');
  const t = buf.length - 32;
  const offSize = buf[t + 6],
    refSize = buf[t + 7],
    count = uint(buf, t + 8, 8),
    top = uint(buf, t + 16, 8),
    table = uint(buf, t + 24, 8);
  if (!(offSize >= 1 && offSize <= 8 && refSize >= 1 && refSize <= 8) || top >= count || table + count * offSize > t)
    throw new Error('bplist: a broken trailer');
  const done = {};

  function offset(ref) {
    if (!(ref < count)) throw new Error('bplist: a reference out of range');
    const o = uint(buf, table + ref * offSize, offSize);
    if (o < 8 || o >= table) throw new Error('bplist: an offset out of range');
    return o;
  }
  // the length of the object at o (its low four bits, or the integer after the marker) and where its content starts
  function size(o) {
    const low = buf[o] & 15;
    if (low !== 15) return { n: low, at: o + 1 };
    const m = buf[o + 1];
    if (m >> 4 !== 1) throw new Error('bplist: a broken length');
    const w = 1 << (m & 15);
    return { n: uint(buf, o + 2, w), at: o + 2 + w };
  }
  function bytes(at, n) {
    if (at + n > table) throw new Error('bplist: an object past the end');
    return buf.slice(at, at + n);
  }
  function refs(at, n) {
    const b = bytes(at, n * refSize),
      out = [];
    for (let i = 0; i < n; i++) out.push(uint(b, i * refSize, refSize));
    return out;
  }

  function object(ref, depth) {
    if (depth > MAX_DEPTH) throw new Error('bplist: nested too deep');
    if (Object.prototype.hasOwnProperty.call(done, ref)) return done[ref];
    const o = offset(ref),
      m = buf[o],
      kind = m >> 4;
    let v;
    if (kind === 0) {
      if (m === 0x00) v = null;
      else if (m === 0x08) v = false;
      else if (m === 0x09) v = true;
      else throw new Error('bplist: marker ' + m.toString(16));
    } else if (kind === 1) {
      const w = 1 << (m & 15);
      v = w <= 8 ? uint(bytes(o + 1, w), 0, w) : uint(bytes(o + 1, w), w - 8, 8);
    } else if (kind === 2 || m === 0x33) {
      const w = kind === 2 ? 1 << (m & 15) : 8,
        b = bytes(o + 1, w);
      v = w === 4 ? b.readFloatBE(0) : b.readDoubleBE(0);
    } else {
      const s = size(o);
      if (kind === 4) v = Buffer.from(bytes(s.at, s.n));
      else if (kind === 5) v = bytes(s.at, s.n).toString('latin1');
      else if (kind === 7) v = bytes(s.at, s.n).toString('utf8');
      else if (kind === 6)
        v = Buffer.from(bytes(s.at, s.n * 2))
          .swap16()
          .toString('utf16le');
      else if (kind === 10) v = refs(s.at, s.n).map(r => object(r, depth + 1));
      else if (kind === 13) {
        const r = refs(s.at, s.n * 2);
        v = {};
        for (let i = 0; i < s.n; i++) {
          const k = object(r[i], depth + 1);
          if (typeof k !== 'string') throw new Error('bplist: a key that is not a string');
          if (k !== '__proto__') v[k] = object(r[s.n + i], depth + 1);
        }
      } else throw new Error('bplist: marker ' + m.toString(16));
    }
    done[ref] = v;
    return v;
  }
  return object(top, 0);
}

module.exports = { parse };
