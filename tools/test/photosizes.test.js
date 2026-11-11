// Photos the Apple TV way: the size of a picture read from its first bytes (JPEG frame header and EXIF orientation, PNG, WebP; invented
// headers here), kept in the Wallpapers index and listed for Home and the screen saver; Home's Photos on Home (landscape only by default,
// all when a library has no landscape photo); the screen saver's slides (a portrait photo paired with the next one, in order) and its
// settings (Ken Burns or Classic; Aerials, photos or both).
const fs = require('fs'),
  path = require('path');
const { ok, call, req, memoryConfig, run, tmp } = require('./lib');

// ---- invented picture headers ----
const u16 = n => Buffer.from([n >> 8, n & 255]);
// a JPEG: SOI, an APP0, optional more segments, then a frame header (SOF0, or another kind) with the size, and the end
function jpeg(w, h, opts) {
  const o = opts || {};
  const seg = (m, body) => Buffer.concat([Buffer.from([0xff, m]), u16(body.length + 2), body]);
  const parts = [Buffer.from([0xff, 0xd8]), seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1'))];
  if (o.orientation) {
    // EXIF, big-endian TIFF: one directory with one entry, Orientation (0x0112, SHORT, 1 value)
    const tiff = Buffer.concat([
      Buffer.from('MM\0\x2a', 'latin1'),
      Buffer.from([0, 0, 0, 8]),
      u16(1),
      u16(0x0112),
      u16(3),
      Buffer.from([0, 0, 0, 1]),
      u16(o.orientation),
      Buffer.from([0, 0]),
      Buffer.from([0, 0, 0, 0]),
    ]);
    parts.push(seg(0xe1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff])));
  }
  if (o.pad) parts.push(seg(0xe2, Buffer.alloc(o.pad, 1)));
  if (o.pad2) parts.push(seg(0xe3, Buffer.alloc(o.pad2, 1)));
  parts.push(seg(0xdb, Buffer.alloc(65, 0))); // a quantisation table before the frame
  parts.push(seg(0xc4, Buffer.alloc(20, 0))); // DHT: not a frame header although it is in c0..cf
  parts.push(seg(o.sof || 0xc0, Buffer.concat([Buffer.from([8]), u16(h), u16(w), Buffer.from([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])])));
  parts.push(Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}
function png(w, h) {
  const b = Buffer.alloc(40);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}
function webp(kind, w, h) {
  const b = Buffer.alloc(40);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(32, 4);
  b.write('WEBP', 8, 'latin1');
  b.write(kind, 12, 'latin1');
  if (kind === 'VP8 ') {
    Buffer.from([0x9d, 0x01, 0x2a]).copy(b, 23);
    b.writeUInt16LE(w, 26);
    b.writeUInt16LE(h, 28);
  } else if (kind === 'VP8L') {
    b[20] = 0x2f;
    b.writeUInt32LE(((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14), 21);
  } else {
    b.writeUIntLE(w - 1, 24, 3);
    b.writeUIntLE(h - 1, 27, 3);
  }
  return b;
}

run(async () => {
  const W = req('wallpapers');
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  ok(same(W.imageSize(jpeg(4032, 3024)), [4032, 3024]), 'a JPEG: the frame header, after the other segments (not DHT)');
  ok(same(W.imageSize(jpeg(1200, 1600, { sof: 0xc2 })), [1200, 1600]), 'a progressive JPEG');
  ok(
    same(W.imageSize(jpeg(4032, 3024, { orientation: 6 })), [3024, 4032]) &&
      same(W.imageSize(jpeg(4032, 3024, { orientation: 8 })), [3024, 4032]) &&
      same(W.imageSize(jpeg(4032, 3024, { orientation: 3 })), [4032, 3024]),
    'a phone photo taken upright (EXIF orientation 6 or 8) is shown turned: portrait; upside down (3) stays as it is'
  );
  ok(same(W.imageSize(png(1080, 1920)), [1080, 1920]), 'a PNG: IHDR');
  ok(
    same(W.imageSize(webp('VP8 ', 1920, 1080)), [1920, 1080]) &&
      same(W.imageSize(webp('VP8L', 300, 500)), [300, 500]) &&
      same(W.imageSize(webp('VP8X', 5000, 3000)), [5000, 3000]),
    'a WebP: lossy (VP8), lossless (VP8L) and extended (VP8X)'
  );
  ok(
    W.imageSize(Buffer.from('<svg width="10"/>')) === null && W.imageSize(jpeg(10, 10).slice(0, 30)) === null && W.imageSize(null) === null,
    'not a picture, or a JPEG cut before its frame header: no size'
  );
  // a JPEG whose frame header comes after a large EXIF block: read further than the first 64 KB
  const big = path.join(tmp, 'big-exif.jpg');
  fs.writeFileSync(big, jpeg(3000, 4000, { pad: 65000, pad2: 30000 }));
  ok(same(W.fileSize(big), [3000, 4000]), 'a frame header past the first 64 KB of the file is found');

  // ---- landscape or portrait ----
  ok(
    W.isLandscape([1920, 1080]) &&
      W.isLandscape([1200, 1000]) &&
      !W.isLandscape([1199, 1000]) &&
      !W.isLandscape([1000, 1000]) &&
      !W.isLandscape([1080, 1920]) &&
      W.isLandscape(undefined) &&
      W.isLandscape([0, 0]),
    'landscape is at least 1.2 times as wide as tall (a square-ish photo is portrait); a size not known counts as landscape'
  );
  const sizes = { 'u/a': [1920, 1080], 'u/b': [1080, 1920], 's/x/c': [1000, 1000] };
  ok(
    same(W.homePhotos(['u/a', 'u/b', 's/x/c', 'l/unsplash'], sizes, 'landscape'), ['u/a', 'l/unsplash']) &&
      same(W.homePhotos(['u/a', 'u/b'], sizes, 'all'), ['u/a', 'u/b']) &&
      same(W.homePhotos(['u/b', 's/x/c'], sizes, 'landscape'), ['u/b', 's/x/c']),
    'Home: the landscape photos (and a live source), all of them with All, and all of them when none is landscape'
  );

  // ---- the library: sizes read once, kept in the index, listed for Home and the screen saver ----
  const src = path.join(tmp, 'src-photos');
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, 'tall.png'), png(800, 1200));
  const mods = [
    {
      id: 'album',
      name: 'Album',
      mod: { wallpapers: { label: 'Album', list: () => ['tall'], file: id => (id === 'tall' ? path.join(src, 'tall.png') : '') } },
    },
  ];
  const config = memoryConfig({});
  const wp = W.create({ config, feature: n => (n === 'addons' ? { providers: w => (w === 'wallpapers' ? mods : []) } : null) });
  ok(wp.addUpload(jpeg(4032, 3024)) === '' && wp.addUpload(jpeg(4032, 3024, { orientation: 6 })) === '', 'two uploads');
  let r = await call(wp, '/api/wallpapers/list');
  const ups = r.j.photos.filter(id => /^u\//.test(id));
  const wide = ups.filter(id => r.j.sizes[id][0] === 4032)[0];
  ok(
    r.j.photos.length === 3 &&
      same(r.j.sizes['s/album/tall'], [800, 1200]) &&
      wide &&
      r.j.sizes[ups.filter(id => id !== wide)[0]][0] === 3024,
    'the list has every photo with its size: ' + JSON.stringify(r.j.sizes)
  );
  ok(
    same(r.j.home, [wide]) && r.j.homeMode === 'landscape',
    'Home gets the landscape photos only, by default: ' + JSON.stringify(r.j.home)
  );
  const index = JSON.parse(fs.readFileSync(path.join(process.env.CYTV_DIR, 'wallpapers', 'index.json'), 'utf8'));
  ok(
    Object.keys(index.sizes).length === 3 && index.sizes['s/album/tall'][2],
    "the sizes are kept in the index, a source's with its file's state"
  );
  // a source's photo replaced by another under the same id: read again
  fs.writeFileSync(path.join(src, 'tall.png'), png(1600, 900));
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(path.join(src, 'tall.png'), later, later);
  r = await call(wp, '/api/wallpapers/list');
  ok(same(r.j.sizes['s/album/tall'], [1600, 900]) && r.j.home.indexOf('s/album/tall') >= 0, "a source's photo that changed is read again");
  const stamp = r.j.stamp;
  r = await call(wp, '/api/wallpapers/set', 'POST', { home: 'all' });
  ok(r.j.home === 'all' && config.get().wallpapers.home === 'all', 'Photos on Home: All is saved');
  r = await call(wp, '/api/wallpapers/list');
  ok(r.j.home.length === 3 && r.j.stamp !== stamp, 'with All, Home gets every photo, and the stamp changes so Home reads the list again');
  await call(wp, '/api/wallpapers/set', 'POST', { home: 'landscape' });
  ok(!('home' in config.get().wallpapers), 'Landscape only is the default: nothing is saved for it');

  // ---- the screen saver: the slides and the settings ----
  const S = req('screensaver');
  const z = { L1: [1920, 1080], L2: [4000, 3000], P1: [1080, 1920], P2: [3000, 4000], P3: [900, 1000] };
  ok(
    same(S.slides(['P1', 'L1', 'P2', 'L2', 'P3'], z), [
      { a: 'L1' },
      { a: 'P1', b: 'P2', portrait: true },
      { a: 'L2' },
      { a: 'P3', portrait: true },
    ]),
    'a portrait photo waits for the next portrait one; the two share a slide where the second came; one left over is alone'
  );
  ok(
    same(S.slides(['l/unsplash', '/api/screensaver/scene/fog'], {}), [{ a: 'l/unsplash' }, { a: '/api/screensaver/scene/fog' }]),
    'a photo whose size is not known (a live source, a scene) is a landscape slide'
  );
  const all = S.slides(S.shuffle(Object.keys(z)), z);
  ok(
    all.reduce((n, s) => n + (s.b ? 2 : 1), 0) === 5 && all.filter(s => s.b).length === 1,
    'every photo is in the slides once, whatever the shuffle'
  );
  let films = [];
  const cfg2 = memoryConfig({});
  const ss = S.create({
    config: cfg2,
    luna: async () => ({ returnValue: true }),
    feature: n =>
      n === 'addons'
        ? { providers: what => (what === 'videos' && films.length ? [{ id: 'aerials', mod: { videos: { list: () => films } } }] : []) }
        : null,
  });
  r = await call(ss, '/api/screensaver/photos');
  ok(r.j.style === 'kenburns' && r.j.every === 16 && r.j.show === 'photos', 'by default Ken Burns, 16 s a photo; photos without films');
  films = [{ id: 'f', url: 'http://sylvan.apple.com/Videos/f.mov', title: 'Iceland' }];
  r = await call(ss, '/api/screensaver/photos');
  ok(r.j.show === 'aerials', 'with an add-on that has films, Aerials by default');
  r = await call(ss, '/api/screensaver/set', 'POST', { style: 'classic', show: 'both' });
  ok(r.j.style === 'classic' && r.j.show === 'both' && r.j.films === 1, 'the settings are saved: ' + JSON.stringify(r.j));
  r = await call(ss, '/api/screensaver/photos');
  ok(r.j.style === 'classic' && r.j.every === 25 && r.j.show === 'both', 'Classic is 25 s a photo; both: films and photos in turn');
  films = [];
  r = await call(ss, '/api/screensaver/photos');
  ok(r.j.show === 'photos', 'without films again, photos whatever the setting');
  await call(ss, '/api/screensaver/set', 'POST', { style: 'kenburns', show: '', junk: 1 });
  await call(ss, '/api/screensaver/set', 'POST', { style: 'zoom', show: 'tv' });
  ok(cfg2.get().screensaver === undefined, 'the defaults are not saved, and other values are refused');
});
