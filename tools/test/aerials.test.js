// Films for the screen saver (helper/screensaver.js GET /api/screensaver/videos) and the Aerials add-on (addons/catalog/aerials): the
// manifests' tar and entries.json are read without dependencies (invented fixtures here, not Apple's), only films on Apple's host are
// kept and turned into plain http, the macOS-only films are left out, the newest list and the older one are put together (the older
// one gives the files the newest lacks), the list survives a restart, the quality picks the file, a film with only the 240 fps file
// carries its type, the places' names in other languages are read from the tar's binary plist (bplist.js) and picked for the screen
// saver's language, and the screen saver hands the page the films of the first add-on that has some, checked.
const fs = require('fs'),
  path = require('path');
const { root, tmp, ok, call, serve, req, memoryConfig, run } = require('./lib');

const dir = path.join(root, 'addons', 'catalog', 'aerials');
const F = require(path.join(dir, 'films.js'));
const BP = require(path.join(dir, 'bplist.js'));

// a binary plist (bplist00) of a value, as Apple writes one: strings ASCII or UTF-16, integers, booleans, null, arrays, dicts; each
// object once, then the offset table (4 bytes an offset) and the trailer (2 bytes a reference)
function bplist(value) {
  const objs = [];
  const len = (kind, n) => (n < 15 ? Buffer.from([(kind << 4) | n]) : Buffer.from([(kind << 4) | 15, 0x11, n >> 8, n & 255]));
  const ref = n => Buffer.from([n >> 8, n & 255]);
  function add(v) {
    const i = objs.length;
    objs.push(null);
    let b;
    if (v === null) b = Buffer.from([0]);
    else if (v === true || v === false) b = Buffer.from([v ? 9 : 8]);
    else if (typeof v === 'number') b = Buffer.from([0x12, v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255]);
    else if (typeof v === 'string' && /^[\x00-\x7f]*$/.test(v)) b = Buffer.concat([len(5, v.length), Buffer.from(v, 'latin1')]);
    else if (typeof v === 'string') b = Buffer.concat([len(6, v.length), Buffer.from(v, 'utf16le').swap16()]);
    else if (Array.isArray(v)) b = Buffer.concat([len(10, v.length)].concat(v.map(x => ref(add(x)))));
    else {
      const k = Object.keys(v);
      const kr = k.map(x => ref(add(x))),
        vr = k.map(x => ref(add(v[x])));
      b = Buffer.concat([len(13, k.length)].concat(kr, vr));
    }
    objs[i] = b;
    return i;
  }
  add(value);
  const head = Buffer.from('bplist00', 'latin1');
  const offsets = [];
  let at = head.length;
  for (const b of objs) {
    offsets.push(at);
    at += b.length;
  }
  const table = Buffer.alloc(objs.length * 4);
  offsets.forEach((o, i) => table.writeUInt32BE(o, i * 4));
  const trailer = Buffer.alloc(32);
  trailer[6] = 4;
  trailer[7] = 2;
  trailer.writeUInt32BE(objs.length, 12);
  trailer.writeUInt32BE(at, 28);
  return Buffer.concat([head].concat(objs, [table, trailer]));
}

// the places' names, as Apple's Localizable.nocache.loctable has them (invented names)
const LOC = {
  LocProvenance: { en: 1, fr: 1 },
  en: { GG_NIGHT_NAME: 'Golden Gate Night', GG_DAY_NAME: 'Golden Gate Day', GB_NAME: 'Glacier Bay at dawn' },
  fr: { GG_NIGHT_NAME: 'Golden Gate de nuit', GG_DAY_NAME: 'Golden Gate le jour', GB_NAME: 'Baie des Glaciers à l’aube' },
  fr_CA: { GG_NIGHT_NAME: 'Golden Gate la nuit' },
  pt_BR: { GG_NIGHT_NAME: 'Golden Gate à Noite' },
  no: { GG_NIGHT_NAME: 'Golden Gate om natten' },
  ja: { GG_NIGHT_NAME: '夜のゴールデンゲート' },
  none: { GG_NIGHT_NAME: 'x' },
};

// a tar archive of [name, content] files, as tar writes it (ustar headers, 512-byte blocks, two empty blocks at the end)
function tar(files) {
  const parts = [];
  for (const [name, content] of files) {
    const body = Buffer.from(content);
    const h = Buffer.alloc(512);
    h.write(name, 0, 'latin1');
    h.write('0000644\0', 100, 'latin1');
    h.write('0000000\0', 108, 'latin1');
    h.write('0000000\0', 116, 'latin1');
    h.write(body.length.toString(8).padStart(11, '0') + '\0', 124, 'latin1');
    h.write('00000000000\0', 136, 'latin1');
    h.write(name.slice(-1) === '/' ? '5' : '0', 156, 'latin1');
    h.write('ustar\0' + '00', 257, 'latin1');
    h.fill(' ', 148, 156);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += h[i];
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'latin1');
    parts.push(h, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

const ENTRIES = {
  version: 1,
  assets: [
    {
      id: 'A1',
      accessibilityLabel: 'Glacier Bay',
      'url-1080-H264': 'https://sylvan.apple.com/Videos/A1_2K_AVC.mov',
      'url-4K-SDR': 'https://sylvan.apple.com/Aerials/2x/Videos/A1_4K_HEVC.mov',
      'url-4K-HDR': 'https://sylvan.apple.com/Aerials/2x/Videos/A1_4K_HDR.mov',
    },
    { id: 'A2', accessibilityLabel: 'Red\nSea  Coral', 'url-4K-SDR': 'https://sylvan.apple.com/Aerials/2x/Videos/A2_4K_HEVC.mov' },
    { id: 'A3', accessibilityLabel: 'Elsewhere', 'url-1080-H264': 'https://example.com/A3.mov' },
    { id: 'A4', 'url-1080-H264': 'https://sylvan.apple.com/Videos/A4.mov' },
    { id: 'A1', accessibilityLabel: 'Twice', 'url-1080-H264': 'https://sylvan.apple.com/Videos/A1b.mov' },
    { id: '../x', accessibilityLabel: 'Bad id', 'url-1080-H264': 'https://sylvan.apple.com/Videos/x.mov' },
    { id: 'A5', accessibilityLabel: 'Quote', 'url-1080-H264': 'https://sylvan.apple.com/Videos/a")b.mov' },
  ],
  categories: [],
};
// the newer list's shape: the same ids with only a 240 fps file, new films, the macOS-only ones, and a shot code for a label
const HFR = id => 'https://sylvan.apple.com/itunes-assets/Aerials116/v4/cb/5b/50/' + 'x'.repeat(150) + '/' + id + '_240fps.mov';
const ENTRIES27 = {
  version: 1,
  categories: [
    { id: 'dynamic-aerials', localizedNameKey: 'AerialCategoryDynamic' },
    { id: 'L', localizedNameKey: 'AerialCategoryLandscapes' },
    { id: 'M', localizedNameKey: 'AerialCategoryMac' },
  ],
  assets: [
    {
      id: 'N1',
      accessibilityLabel: 'Golden Gate Night',
      localizedNameKey: 'GG_NIGHT_NAME',
      categories: ['L'],
      'url-4K-SDR-240FPS': HFR('N1'),
    },
    {
      id: 'A1',
      accessibilityLabel: 'Glacier Bay from above',
      localizedNameKey: 'GB_NAME',
      categories: ['L'],
      'url-4K-SDR-240FPS': HFR('A1'),
    },
    {
      id: 'N2',
      accessibilityLabel: 'GG_A_DAY_BLUFFS_C35_V25_HFR_HEVC',
      localizedNameKey: 'GG_DAY_NAME',
      categories: ['L'],
      'url-4K-SDR-240FPS': HFR('N2'),
    },
    {
      id: 'D1',
      accessibilityLabel: 'macOS',
      categories: ['dynamic-aerials'],
      variant: { appearance: 'light' },
      'url-4K-SDR-240FPS': HFR('D1'),
    },
    { id: 'M1', accessibilityLabel: 'Mac Purple', categories: ['M'], 'url-4K-SDR-240FPS': HFR('M1') },
  ],
};

run(async () => {
  // ---- the manifest ----
  const t = tar([
    ['TVIdleScreenStrings.bundle/', ''],
    ['TVIdleScreenStrings.bundle/en.lproj/Localizable.nocache.strings', 'bplist00' + 'x'.repeat(700)],
    ['entries.json', JSON.stringify(ENTRIES)],
  ]);
  const e = F.tarFile(t, 'entries.json');
  ok(e && JSON.parse(String(e)).assets.length === 7, 'entries.json is read from the tar, after a folder and a file over one block');
  ok(F.tarFile(t, 'missing.json') === null && F.tarFile(Buffer.alloc(100), 'entries.json') === null, 'a file that is not there is null');
  const l = F.films(e);
  ok(
    l.length === 3 && l[0].id === 'A1' && l[1].id === 'A2' && l[2].id === 'A4' && l[2].title === '',
    "only films with an id and a file on Apple's host, each once; the place may be missing: " + l.map(f => f.id).join(' ')
  );
  ok(
    l[0].title === 'Glacier Bay' &&
      l[0].h264 === 'http://sylvan.apple.com/Videos/A1_2K_AVC.mov' &&
      l[0].hevc === 'http://sylvan.apple.com/Aerials/2x/Videos/A1_4K_HEVC.mov',
    'the 1080p H.264 and the 4K HEVC SDR file, over plain http: ' + JSON.stringify(l[0])
  );
  ok(l[1].title === 'Red Sea Coral' && l[1].h264 === '' && l[1].hevc, 'the place is one line; a film may have only one of the files');
  ok(F.films('not json').length === 0 && F.films({}).length === 0, 'a broken manifest has no films');
  const n = F.films(ENTRIES27);
  ok(
    n.map(f => f.id).join(' ') === 'N1 A1 N2' && n[0].hfr === HFR('N1').replace('https:', 'http:') && !n[0].h264 && !n[0].hevc,
    'the newer list: the 240 fps file of each film (a long address too), without the films of the Mac and the moving desktops: ' +
      n.map(f => f.id).join(' ')
  );
  ok(n[2].title === '', "a shot's code is no place");
  const m = F.merge([n, l]);
  ok(
    m.map(f => f.id).join(' ') === 'N1 A1 N2 A2 A4',
    "the newest list's order, then the films only the older list has: " + m.map(f => f.id).join(' ')
  );
  ok(
    m[1].title === 'Glacier Bay from above' && m[1].h264 === l[0].h264 && m[1].hevc === l[0].hevc && m[1].hfr === n[1].hfr,
    "the newest list's place, and the older list's files where the newest has none: " + JSON.stringify(m[1])
  );
  ok(F.merge([[], l]).length === 3 && F.merge([n, []]).length === 3, 'either list alone gives its films');

  // ---- the places' names ----
  const big = { s: 'a string longer than fifteen', u: 'Baie des Glaciers à l’aube', j: '夜', n: 7, big: 70000, t: true, f: false, z: null };
  big.list = [1, 'two', [3], { four: 4 }];
  ok(JSON.stringify(BP.parse(bplist(big))) === JSON.stringify(big), 'a binary plist is read: ' + JSON.stringify(BP.parse(bplist(big))));
  const bad = [Buffer.from('not a plist at all, not a plist at all'), bplist({ a: 1 }).slice(0, 30)];
  const loop = bplist([1]);
  loop[10] = 0; // the array's one element (a reference of two bytes) is the array itself
  bad.push(loop);
  const far = bplist([1]);
  far[10] = 9; // a reference to an object that is not there
  bad.push(far);
  ok(
    bad.every(b => {
      try {
        BP.parse(b);
        return false;
      } catch (e) {
        return /^bplist: /.test(e.message);
      }
    }),
    'a broken plist, one that refers to itself and one that refers past its objects are refused'
  );
  const tb = F.names(bplist(LOC));
  ok(
    Object.keys(tb).join(' ') === 'en fr fr_CA pt_BR no ja' && JSON.stringify(F.names(Buffer.from('x'))) === '{}',
    'the names table keeps the languages only: ' + Object.keys(tb).join(' ')
  );
  const nm = F.films(ENTRIES27, tb);
  ok(
    nm[1].title === 'Glacier Bay at dawn' &&
      nm[2].title === 'Golden Gate Day' &&
      nm[0].names.fr === 'Golden Gate de nuit' &&
      !nm[0].names.en,
    'the place in English from the names, also for a film whose label is a code; the other languages beside it: ' + JSON.stringify(nm[0])
  );
  const pl = l => F.place(nm[0], l);
  ok(
    pl('fr-FR') === 'Golden Gate de nuit' &&
      pl('fr-CA') === 'Golden Gate la nuit' &&
      pl('fr') === 'Golden Gate de nuit' &&
      pl('pt') === 'Golden Gate à Noite' &&
      pl('nb-NO') === 'Golden Gate om natten' &&
      pl('ja-JP') === '夜のゴールデンゲート' &&
      pl('en-GB') === 'Golden Gate Night' &&
      pl('de-DE') === 'Golden Gate Night' &&
      pl('') === 'Golden Gate Night' &&
      F.place(nm[1], 'pt-BR') === 'Glacier Bay at dawn',
    'the place in the language and region, the language, the language in any region, else English'
  );

  // ---- the add-on, with a stand-in for Apple's host ----
  const t27 = tar([
    ['entries.json', JSON.stringify(ENTRIES27)],
    ['TVIdleScreenStrings.bundle/Contents/Resources/Localizable.nocache.loctable', bplist(LOC)],
  ]);
  let asked = 0,
    refuse = {};
  const host = await serve((q, r) => {
    asked++;
    const newer = /resources-27/.test(q.url);
    if (refuse[newer ? 27 : 16]) {
      r.writeHead(503);
      return r.end();
    }
    r.writeHead(200, { 'content-type': 'application/x-tar' });
    r.end(newer ? t27 : t);
  });
  process.env.CYTV_AERIALS_MANIFESTS = host.url + '/itunes-assets/resources-27-0-1.tar,' + host.url + '/Aerials/resources-16.tar';
  const S = require(path.join(dir, 'service.js'));
  let settings = {};
  // the add-on's context; dir: its own dataDir, for a TV that has never read the manifests
  const ctx = dir => {
    const dataDir = path.join(tmp, dir || 'aerials-data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
    return {
      id: 'aerials',
      dataDir,
      fetch: req('fetch'),
      log: () => {},
      settings: { get: () => Object.assign({}, settings), set: o => (settings = Object.assign({}, settings, o)) },
    };
  };
  let a = S.create(ctx());
  ok(a.videos.list().length === 0, 'no films before the manifest was read');
  await a.update();
  let v = a.videos.list();
  ok(asked === 2 && v.map(f => f.id).join(' ') === 'N1 A1 N2 A2 A4', "both manifests are read from Apple's host: " + JSON.stringify(v));
  ok(
    v[1].url === 'http://sylvan.apple.com/Videos/A1_2K_AVC.mov' && v[3].url === 'http://sylvan.apple.com/Aerials/2x/Videos/A2_4K_HEVC.mov',
    '1080p H.264 by default, the 4K file where a film has no other'
  );
  ok(
    v[0].url === n[0].hfr && v[0].type === F.HFR_TYPE && v.filter(f => f.type).length === 2,
    'a film with only the 240 fps file plays that one, and says what it needs: ' + JSON.stringify(v[0])
  );
  let r = await call(a, '/status');
  ok(
    r.j.films === 5 && r.j.hfr === 2 && r.j.error === '',
    'the status counts the films with only the 240 fps file: ' + JSON.stringify(r.j)
  );
  r = await call(a, '/quality', 'POST', { quality: '4k' });
  ok(
    r.j.quality === '4k' &&
      a.videos.list()[1].url === 'http://sylvan.apple.com/Aerials/2x/Videos/A1_4K_HEVC.mov' &&
      !a.videos.list()[1].type,
    '4K picks the 30 fps HEVC file'
  );
  r = await call(a, '/quality', 'POST', { quality: '8k' });
  ok(r.code === 400, 'another quality is refused');
  refuse = { 27: true };
  let fresh = S.create(ctx('aerials-old'));
  await fresh.update();
  r = await call(fresh, '/status');
  ok(
    r.j.films === 3 && r.j.hfr === 0 && /resources-27-0-1\.tar: .*503/.test(r.j.error),
    'without the newer list, the older one alone, and the status says which one could not be read: ' + JSON.stringify(r.j)
  );
  refuse = { 16: true };
  fresh = S.create(ctx('aerials-new'));
  await fresh.update();
  ok(
    fresh.videos
      .list()
      .map(f => f.id + (f.type ? '*' : ''))
      .join(' ') === 'N1* A1* N2*',
    'without the older list, the newer one alone (240 fps files only)'
  );
  await a.update();
  ok(
    a.videos
      .list()
      .map(f => f.id + (f.type ? '*' : ''))
      .join(' ') === 'N1* A1 N2* A2 A4',
    'a list that cannot be read this time keeps what the TV knew from it: ' + JSON.stringify(a.videos.list()[1])
  );
  refuse = {};
  await a.update();
  refuse = { 16: true, 27: true };
  a = S.create(ctx());
  ok(
    a.videos.list().length === 5 &&
      a.videos.list()[0].type === F.HFR_TYPE &&
      a.videos.list({ lang: 'fr-FR' })[0].title === 'Golden Gate de nuit',
    'the films are kept on the TV for the next start, with their names'
  );
  ok(a.status().updated > 0, 'a list kept in this format counts as read when it was');
  const oldDir = path.join(tmp, 'aerials-format1');
  fs.mkdirSync(oldDir);
  fs.writeFileSync(
    path.join(oldDir, 'films.json'),
    JSON.stringify({
      at: Date.now(),
      films: [{ id: 'A1', title: 'Glacier Bay', h264: 'http://sylvan.apple.com/Videos/A1_2K_AVC.mov', hevc: '', hfr: '' }],
    })
  );
  const older = S.create(ctx('aerials-format1'));
  ok(
    older.videos.list().length === 1 && older.status().updated === 0,
    'a list kept by an earlier version (without the names) plays meanwhile and is read again at the start'
  );
  await a.update();
  r = await call(a, '/status');
  ok(r.j.films === 5 && /503.*503/.test(r.j.error), 'manifests that cannot be read keep the films and say why: ' + JSON.stringify(r.j));
  host.server.close();

  // ---- the screen saver asks the add-ons that provide videos ----
  let providers = [];
  const ss = req('screensaver').create({
    config: memoryConfig({}),
    luna: async () => ({ returnValue: true }),
    feature: n => (n === 'addons' ? { providers: what => (what === 'videos' ? providers : []) } : null),
  });
  r = await call(ss, '/api/screensaver/videos');
  ok(r.j.videos.length === 0 && r.j.from === '', 'without a video add-on there are no films (the page shows photos)');
  providers = [
    { id: 'broken', mod: { videos: { list: () => Promise.reject(new Error('boom')) } } },
    { id: 'empty', mod: { videos: { list: () => [] } } },
    { id: 'aerials', mod: a },
  ];
  r = await call(ss, '/api/screensaver/videos');
  ok(
    r.j.from === 'aerials' && r.j.videos.length === 5 && r.j.videos[1].title === 'Glacier Bay at dawn' && r.j.videos[0].type === F.HFR_TYPE,
    'the films of the first add-on that has some'
  );
  let asked1 = null;
  const ssFr = req('screensaver').create({
    config: memoryConfig({ lang: 'fr' }),
    luna: async () => ({ returnValue: true }),
    feature: n =>
      n === 'addons'
        ? {
            providers: () => [
              { id: 'spy', mod: { videos: { list: o => ((asked1 = o), []) } } },
              { id: 'aerials', mod: a },
            ],
          }
        : null,
  });
  r = await call(ssFr, '/api/screensaver/videos');
  ok(
    asked1 && asked1.lang === 'fr' && r.j.videos[0].title === 'Golden Gate de nuit' && r.j.videos[1].title === 'Baie des Glaciers à l’aube',
    "the add-ons are told the screen saver's language, and the places come in it: " + JSON.stringify(asked1)
  );
  const C = req('screensaver').cleanVideos;
  const c = C([
    { id: 'ok', url: 'http://sylvan.apple.com/Videos/a.mov', title: 'A\nB' },
    { id: 'js', url: 'javascript:alert(1)' },
    { id: 'q', url: 'http://h/a").mov' },
    { id: 'sp', url: 'http://h/a b.mov' },
    { id: 'ok', url: 'http://h/twice.mov' },
    null,
  ]);
  ok(c.length === 1 && c[0].title === 'A B', 'a film needs an id and a plain http(s) address, each id once: ' + JSON.stringify(c));
  const ty = C([
    { id: 'a', url: 'http://h/a.mov', type: F.HFR_TYPE },
    { id: 'b', url: 'http://h/b.mov', type: 'video/mp4; codecs="x"><img src=x>' },
    { id: 'c', url: 'http://h/c.mov', type: 'text/html' },
  ]);
  ok(
    ty[0].type === F.HFR_TYPE && !('type' in ty[1]) && !('type' in ty[2]),
    'the decoder a film needs passes as a plain MIME type with codecs, nothing else: ' + JSON.stringify(ty)
  );
  const page = fs.readFileSync(path.join(root, 'screensaver', 'app', 'index.html'), 'utf8');
  ok(
    /\.filter\(playable\)/.test(page) && /MediaSource\.isTypeSupported\(f\.type\)/.test(page),
    'the page asks the TV before it plays a film that names the decoder it needs'
  );
});
