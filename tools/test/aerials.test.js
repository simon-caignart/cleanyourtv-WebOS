// Films for the screen saver (helper/screensaver.js GET /api/screensaver/videos) and the Aerials add-on (addons/catalog/aerials): the
// manifest's tar and entries.json are read without dependencies (an invented fixture here, not Apple's), only films on Apple's host are
// kept and turned into plain http, the list survives a restart, the quality picks the file, and the screen saver hands the page the
// films of the first add-on that has some, checked.
const fs = require('fs'),
  path = require('path');
const { root, tmp, ok, call, serve, req, memoryConfig, run } = require('./lib');

const dir = path.join(root, 'addons', 'catalog', 'aerials');
const F = require(path.join(dir, 'films.js'));

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
    l.length === 2 && l[0].id === 'A1' && l[1].id === 'A2',
    "only films with a place, an id and a file on Apple's host, each once: " + l.map(f => f.id).join(' ')
  );
  ok(
    l[0].title === 'Glacier Bay' &&
      l[0].h264 === 'http://sylvan.apple.com/Videos/A1_2K_AVC.mov' &&
      l[0].hevc === 'http://sylvan.apple.com/Aerials/2x/Videos/A1_4K_HEVC.mov',
    'the 1080p H.264 and the 4K HEVC SDR file, over plain http: ' + JSON.stringify(l[0])
  );
  ok(l[1].title === 'Red Sea Coral' && l[1].h264 === '' && l[1].hevc, 'the place is one line; a film may have only one of the files');
  ok(F.films('not json').length === 0 && F.films({}).length === 0, 'a broken manifest has no films');

  // ---- the add-on, with a stand-in for Apple's host ----
  let asked = 0,
    refuse = false;
  const host = await serve((q, r) => {
    asked++;
    if (refuse) {
      r.writeHead(503);
      return r.end();
    }
    r.writeHead(200, { 'content-type': 'application/x-tar' });
    r.end(t);
  });
  process.env.CYTV_AERIALS_MANIFEST = host.url + '/Aerials/resources-16.tar';
  const S = require(path.join(dir, 'service.js'));
  const dataDir = path.join(tmp, 'aerials-data');
  fs.mkdirSync(dataDir);
  let settings = {};
  const ctx = () => ({
    id: 'aerials',
    dataDir,
    fetch: req('fetch'),
    log: () => {},
    settings: { get: () => Object.assign({}, settings), set: o => (settings = Object.assign({}, settings, o)) },
  });
  let a = S.create(ctx());
  ok(a.videos.list().length === 0, 'no films before the manifest was read');
  await a.update();
  let v = a.videos.list();
  ok(asked >= 1 && v.length === 2, "the manifest is read from Apple's host: " + JSON.stringify(v));
  ok(
    v[0].url === 'http://sylvan.apple.com/Videos/A1_2K_AVC.mov' && v[1].url === 'http://sylvan.apple.com/Aerials/2x/Videos/A2_4K_HEVC.mov',
    '1080p H.264 by default, the 4K file where a film has no other'
  );
  let r = await call(a, '/quality', 'POST', { quality: '4k' });
  ok(
    r.j.quality === '4k' && a.videos.list()[0].url === 'http://sylvan.apple.com/Aerials/2x/Videos/A1_4K_HEVC.mov',
    '4K picks the HEVC file'
  );
  r = await call(a, '/quality', 'POST', { quality: '8k' });
  ok(r.code === 400, 'another quality is refused');
  refuse = true;
  a = S.create(ctx());
  ok(a.videos.list().length === 2, 'the films are kept on the TV for the next start');
  await a.update();
  r = await call(a, '/status');
  ok(r.j.films === 2 && /503/.test(r.j.error), 'a manifest that cannot be read keeps the films and says why: ' + JSON.stringify(r.j));
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
    r.j.from === 'aerials' && r.j.videos.length === 2 && r.j.videos[0].title === 'Glacier Bay',
    'the films of the first add-on that has some'
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
});
