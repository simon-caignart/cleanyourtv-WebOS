// The iCloud Shared Album add-on (addons/catalog/icloud): reading a public link, the partition host from the token and the 330 that
// moves it, the photos and derivatives of a webstream answer, which derivative is downloaded at 4K and at Full HD, the sync (only new or
// changed photos, photos that left the album deleted, at most so many photos and bytes, the photos kept when Apple cannot be reached),
// the hosts it trusts (a 330 or a redirect to any other server is refused), the token kept out of every reply and log line, the phone
// page, and the photos through Home's wallpapers. Apple is a stand-in: fetch answers from the invented answers in fixtures/icloud/
// (the shape Apple's shared-streams API answers in; no real album, token or name), so no request leaves this machine.
const fs = require('fs'),
  http = require('http'),
  path = require('path'),
  { URL } = require('url');
const { root, ok, call, req, memoryConfig, run, sleep } = require('./lib');

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(600, 7)]);
const FIX = path.join(__dirname, 'fixtures', 'icloud');
const fixture = n => JSON.parse(fs.readFileSync(path.join(FIX, n), 'utf8'));
const TOKEN = 'B1zTestT0kenAbC', // invented; partition B62("1z") = 1 * 62 + 61 = 123
  TOKEN2 = 'A7SecondT0kenXy', // partition B62("7") = 7
  HOME = 'p42-sharedstreams.icloud.com';
const G = n => '0A000000-0000-4000-8000-00000000000' + n;

// a request to the add-on's phone page on 127.0.0.1:8804
function phone(method, p, body, code) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: 8804, path: p, method, headers: { 'x-code': code || '' } }, res => {
      const b = [];
      res.on('data', c => b.push(c));
      res.on('end', () => {
        const t = Buffer.concat(b).toString();
        let j = null;
        try {
          j = JSON.parse(t);
        } catch (_) {}
        resolve({ code: res.statusCode, j, text: t, type: res.headers['content-type'] });
      });
    });
    r.on('error', reject);
    r.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

// the stand-in for Apple: ctx.fetch.read, answering by address. Every request is recorded.
function fakeApple() {
  const A = {
    calls: [],
    albums: { [TOKEN]: { home: HOME, stream: fixture('webstream.json'), urls: fixture('webasseturls.json') } },
    down: false, // nothing answers (no network)
    moveViaBody: false, // the 330 names the host only in its body
    moveTo: '', // the 330 names this host instead of the album's
    picture: () => JPEG, // what a picture address gives
    redirect: null, // {from: path part, to: address}: a picture answers 302
  };
  const answer = (status, obj, headers) => ({
    status,
    headers: headers || {},
    body: Buffer.isBuffer(obj) ? obj : Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)),
  });
  A.read = (url, o) => {
    A.calls.push({ url, o });
    if (o.redirects !== 0) return Promise.reject(new Error('the add-on must follow redirects itself (redirects: 0)'));
    if (A.down) return Promise.reject(Object.assign(new Error('could not connect'), { code: 'connect' }));
    const u = new URL(url);
    if (u.protocol !== 'https:') return Promise.reject(new Error('not https: ' + url));
    const m = /^\/([^/]+)\/sharedstreams\/(webstream|webasseturls)$/.exec(u.pathname);
    if (/-sharedstreams\.icloud\.com$/.test(u.hostname) && m) {
      if (o.method !== 'POST') return Promise.resolve(answer(405, {}));
      const al = A.albums[m[1]];
      if (!al) return Promise.resolve(answer(404, {}));
      if (u.hostname !== al.home) {
        const to = A.moveTo || al.home;
        return Promise.resolve(A.moveViaBody ? answer(330, { 'X-Apple-MMe-Host': to }) : answer(330, {}, { 'x-apple-mme-host': to }));
      }
      const b = JSON.parse(o.body);
      if (m[2] === 'webstream') return Promise.resolve(b.streamCtag === null ? answer(200, al.stream) : answer(400, {}));
      // webasseturls: the items of the asked photos' derivatives only
      const sums = {};
      al.stream.photos
        .filter(p => b.photoGuids.indexOf(p.photoGuid) >= 0)
        .forEach(p => Object.keys(p.derivatives).forEach(k => (sums[p.derivatives[k].checksum] = 1)));
      const items = {};
      Object.keys(al.urls.items).forEach(s => sums[s] && (items[s] = al.urls.items[s]));
      return Promise.resolve(answer(200, { locations: al.urls.locations, items }));
    }
    if (/icloud-content\.com$/.test(u.hostname) && (o.method || 'GET') === 'GET') {
      if (A.redirect && url.indexOf(A.redirect.from) >= 0) return Promise.resolve(answer(302, '', { location: A.redirect.to }));
      return Promise.resolve(answer(200, A.picture(url)));
    }
    return Promise.reject(new Error('the stand-in got a request for ' + u.hostname));
  };
  A.hosts = () => A.calls.map(c => new URL(c.url).hostname);
  return A;
}

run(async () => {
  const nc = req('netcompat');
  const addonDir = path.join(root, 'addons', 'catalog', 'icloud');
  const M = require(path.join(addonDir, 'service.js'));

  // ---- the link, the partition, the hosts ----
  const stream = l => JSON.stringify(M.parseLink(l)) === JSON.stringify({ kind: 'stream', token: TOKEN });
  ok(
    stream('https://www.icloud.com/sharedalbum/#' + TOKEN) &&
      stream('  https://www.icloud.com/sharedalbum/fr-fr/#' + TOKEN + '\n') &&
      stream('https://icloud.com/sharedalbum/#' + TOKEN + ';0A000000-0000-4000-8000-000000000001') &&
      stream(TOKEN),
    'a public link gives its token, with a language, a photo after ";" or none, and a bare token works too'
  );
  ok(
    [
      'http://www.icloud.com/sharedalbum/#' + TOKEN,
      'https://www.icloud.com.evil.example/sharedalbum/#' + TOKEN,
      'https://evil.example/sharedalbum/#' + TOKEN,
      'https://www.icloud.com/photos/#' + TOKEN,
      'https://www.icloud.com/sharedalbum/#short',
      'https://www.icloud.com/sharedalbum/#' + TOKEN + '/../x',
      '',
      'B1z/../../etc',
    ].every(l => M.parseLink(l) === null),
    'anything that is not such a link is refused (plain http, another host, another path, a bad token)'
  );
  ok(
    M.firstHost(TOKEN) === 'p123-sharedstreams.icloud.com' &&
      M.firstHost(TOKEN2) === 'p07-sharedstreams.icloud.com' &&
      M.firstHost('AzzTestT0kenAbC') === 'p61-sharedstreams.icloud.com' &&
      M.firstHost('B00TestT0kenAbC') === 'p01-sharedstreams.icloud.com',
    'the first partition is read from the token in base 62 (one character after an "A", else two), p01 when it makes no sense'
  );
  ok(
    ['cvws.icloud-content.com', 'p42-content.icloud.com', 'a-b.c.icloud-content.com'].every(M.assetHost) &&
      ![
        'icloud-content.com',
        'icloud.com',
        'cvws.icloud-content.com.evil.example',
        'evilicloud-content.com',
        'x.evil.example',
        '17.0.0.1',
        'a..icloud.com',
        '-x.icloud.com',
        'x_y.icloud.com',
        '',
      ].some(M.assetHost),
    'a picture may come only from a host under icloud-content.com or icloud.com'
  );
  ok(
    M.assetUrl('https://cvws.icloud-content.com/S/x.JPG?e=1') !== '' &&
      [
        'http://cvws.icloud-content.com/S/x.JPG',
        'https://cvws.icloud-content.com:8443/S/x',
        'https://u:p@cvws.icloud-content.com/S/x',
        'https://cvws.icloud-content.com.evil.example/S/x',
        'ftp://cvws.icloud-content.com/x',
      ].every(u => M.assetUrl(u) === ''),
    'a picture address must be https, on such a host, without a port or a user'
  );

  // ---- a webstream answer and the derivatives ----
  const s = M.parseStream(fixture('webstream.json'));
  ok(s.name === 'Test album', 'the album name is read');
  ok(
    s.photos.map(p => p.guid).join() === [G(1), G(2), G(4), G(5)].join() && s.photos.every(p => p.derivs.every(d => d.w > 0 && d.h > 0)),
    'the photos come newest first, without the video, with the sizes Apple sends as text read as numbers'
  );
  let threw = '';
  try {
    M.parseStream({ streamName: 'x' });
  } catch (e) {
    threw = e.message;
  }
  ok(/does not understand/.test(threw), 'an answer without photos is an error, not an empty album');
  const sumOf = (guid, size) => (M.pick(s.photos.filter(p => p.guid === guid)[0].derivs, size)[0] || {}).sum;
  ok(
    sumOf(G(1), '4k') === '01aa000000000000000000000000000000000001b1' &&
      sumOf(G(1), 'hd') === '01aa000000000000000000000000000000000001b1',
    'the largest derivative when none covers 4K, and the one that covers Full HD (2048 pixels)'
  );
  ok(
    sumOf(G(4), '4k') === '01aa000000000000000000000000000000000004c1' &&
      sumOf(G(4), 'hd') === '01aa000000000000000000000000000000000004b1',
    'with a larger one, 4K takes the 4032 pixels and Full HD the smallest that still covers 1920 (2732)'
  );
  ok(M.pick(s.photos.filter(p => p.guid === G(5))[0].derivs, '4k').length === 0, 'a thumbnail (342 pixels) is never a wallpaper');
  ok(
    M.pick(
      [
        { sum: 'aaaaaaaaaa', w: 4000, h: 3000, bytes: 20 << 20 },
        { sum: 'bbbbbbbbbb', w: 2048, h: 1536, bytes: 1 << 20 },
      ],
      '4k'
    )[0].sum === 'bbbbbbbbbb',
    'a derivative larger than a file may be is skipped'
  );

  // ---- the add-on with the ctx the loader gives ----
  const apple = fakeApple();
  const config = memoryConfig({});
  const dataDir = path.join(process.env.CYTV_DIR, 'addon-data', 'icloud');
  nc.mkdirp(dataDir);
  let size = '4k';
  const logs = [];
  const ctx = {
    id: 'icloud',
    dir: addonDir,
    dataDir,
    log: l => logs.push(String(l)),
    fetch: { read: apple.read },
    util: { lanIp: () => '127.0.0.1', randomInt: nc.randomInt, mkdirp: nc.mkdirp, i18n: req('i18n') },
    env: { lang: () => '', wallpaperSize: () => size },
    settings: {
      get: () => Object.assign({}, ((config.get().addons || {}).icloud || {}).settings),
      set: o =>
        config.update('addon:icloud', c => {
          c.addons = c.addons || {};
          c.addons.icloud = Object.assign({}, c.addons.icloud, { settings: Object.assign({}, (c.addons.icloud || {}).settings, o) });
        }),
    },
  };
  const ic = M.create(ctx);
  const W = ic.wallpapers;
  ok(
    W.label === 'iCloud Shared Album' && !W.live && typeof W.settings === 'function',
    'it is a photo source with files and a settings page'
  );
  ok(/no album yet/.test(W.status().summary) && W.list().length === 0, 'no album at first');

  let r = await W.settings({});
  const code = r.code;
  ok(/^\d{6}$/.test(code) && /:8804\/#\d{6}$/.test(r.qr) && r.seconds === 900, 'the settings page opens with a 6-digit code');
  await sleep(100);
  let p = await phone('GET', '/');
  ok(
    p.code === 200 && /text\/html/.test(p.type) && /Test and save/.test(p.text) && /Public Website/.test(p.text),
    'the page explains the public link'
  );
  p = await phone('POST', '/api/add', { links: 'https://www.icloud.com/sharedalbum/#' + TOKEN }, '000000');
  ok(p.code === 403 && apple.calls.length === 0, 'the API needs the code, and nothing is asked of Apple without it');

  p = await phone('POST', '/api/add', { links: 'https://evil.example/sharedalbum/#' + TOKEN }, code);
  ok(
    p.j.ok === false && /not the link/.test(p.j.errors[0].error) && apple.calls.length === 0,
    'a link that is not iCloud is refused before any request'
  );
  p = await phone('POST', '/api/add', { links: 'https://www.icloud.com/sharedalbum/#' + TOKEN2 }, code);
  ok(
    p.j.ok === false && /Public Website is off/.test(p.j.errors[0].error) && p.j.errors[0].album === '…' + TOKEN2.slice(-4),
    'an album Apple does not know is reported, named by the last four characters of its token: ' + JSON.stringify(p.j.errors)
  );
  apple.calls.length = 0;
  p = await phone('POST', '/api/add', { links: 'https://www.icloud.com/sharedalbum/#' + TOKEN }, code);
  ok(
    p.j.ok === true && p.j.added[0].name === 'Test album' && p.j.added[0].count === 4,
    'Test and save reads the album: its name and how many photos'
  );
  ok(
    apple.calls[0].url === 'https://p123-sharedstreams.icloud.com/' + TOKEN + '/sharedstreams/webstream' &&
      apple.calls[1].url === 'https://' + HOME + '/' + TOKEN + '/sharedstreams/webstream' &&
      JSON.parse(apple.calls[0].o.body).streamCtag === null &&
      apple.calls[0].o.method === 'POST',
    'the first request goes to the partition of the token, the 330 moves it to the one Apple names'
  );
  ok(
    apple.calls.every(c => c.o.redirects === 0),
    'no request lets fetch follow a redirect'
  );
  await ic.sync(); // the sync Test and save started
  let d = ic.details();
  ok(
    d.photos === 3 && !d.error && d.lastSync > 0,
    'the sync downloads the photos (not the video, not the thumbnail-only one): ' + JSON.stringify(d)
  );
  ok(
    apple.calls.filter(c => /webasseturls$/.test(c.url)).every(c => new URL(c.url).hostname === HOME) &&
      apple.calls
        .filter(c => /webstream$/.test(c.url))
        .slice(-1)[0]
        .url.indexOf(HOME) > 0,
    'the next requests go straight to the partition the 330 named'
  );
  const got = apple.calls.filter(c => /icloud-content/.test(c.url)).map(c => c.url);
  ok(
    got.length === 3 &&
      got.some(u => /AaTestPath01b1/.test(u)) &&
      got.some(u => /AaTestPath04c1/.test(u)) &&
      !got.some(u => /a1\//.test(u)),
    'at 4K each photo comes in its largest derivative, never the thumbnail'
  );
  ok(W.list().length === 3 && W.list().every(id => /^0A000000-/.test(id)), 'the source lists them by their photo id');
  const f1 = W.file(G(1));
  ok(
    path.isAbsolute(f1) && fs.existsSync(f1) && /\.jpg$/.test(f1) && f1.indexOf(dataDir) === 0,
    'and gives the file of each in its own folder'
  );
  ok(W.file('../../etc/passwd') === '' && W.file(G(9)) === '', 'an id that is not a synced photo gives no file');
  ok(/3 photos · synced/.test(W.status().summary), 'the status line says how many and when');

  // the token stays a secret
  const st0 = (await phone('GET', '/api/state', undefined, code)).j;
  const everything = JSON.stringify([st0, W.status(), ic.details(), logs, fs.readFileSync(path.join(dataDir, 'index.json'), 'utf8')]);
  ok(
    st0.albums[0].hint === '…' + TOKEN.slice(-4) &&
      st0.albums[0].name === 'Test album' &&
      st0.albums[0].count === 4 &&
      st0.albums[0].photos === 3,
    'the page shows each album with its name, its photos and the last four characters of its token'
  );
  ok(
    everything.indexOf(TOKEN) < 0 && everything.indexOf(TOKEN.slice(0, 8)) < 0,
    'the token is in no reply, no status, no log line and not in the index'
  );

  let n0 = apple.calls.length;
  await ic.sync();
  ok(
    apple.calls.slice(n0).every(c => /webstream$/.test(c.url)),
    'a second sync asks for the album only and downloads nothing'
  );

  // Full HD: photos with a better-fitting derivative are downloaded again in it
  size = 'hd';
  n0 = apple.calls.length;
  await ic.sync();
  const hd = apple.calls.slice(n0).filter(c => /icloud-content/.test(c.url));
  ok(
    hd.length === 3 && hd.some(c => /AaTestPath04b1/.test(c.url)),
    'after a change of Picture size the photos come again, at Full HD the 2732-pixel one'
  );
  size = '4k';
  await ic.sync();

  // a photo that changed, one that left the album, a new one
  const al = apple.albums[TOKEN];
  al.stream.photos[1].derivatives['1536'].checksum = '01aa00000000000000000000000000000000002bb2';
  al.urls.items['01aa00000000000000000000000000000000002bb2'] = {
    url_location: 'cvws.icloud-content.com',
    url_path: '/S/AaTestPath02bb/IMG_0002.JPG?e=1',
  };
  n0 = apple.calls.length;
  await ic.sync();
  ok(
    apple.calls.slice(n0).filter(c => /AaTestPath02bb/.test(c.url)).length === 1 && ic.details().photos === 3,
    'a changed photo is downloaded again'
  );
  al.stream.photos = al.stream.photos.filter(x => x.photoGuid !== G(1));
  await ic.sync();
  ok(
    ic.details().photos === 2 && !fs.existsSync(f1) && fs.readdirSync(path.join(dataDir, 'photos')).length === 2,
    'a photo that left the album is deleted from the TV'
  );

  // hiding
  p = await phone('POST', '/api/hide', { id: G(2), hidden: true }, code);
  ok(W.list().length === 1 && W.file(G(2)) === '', 'a hidden photo is not shown');
  p = await phone('GET', '/api/photo/' + G(2), undefined, code);
  ok(p.code === 200 && /image\/jpeg/.test(p.type), 'the phone page still shows it, so it can be shown again');
  p = await phone('POST', '/api/photos', {}, code);
  ok(p.j.photos.length === 2 && p.j.photos.some(x => x.id === G(2) && x.hidden), 'and lists it as hidden');
  await phone('POST', '/api/hide', { id: G(2), hidden: false }, code);
  ok(W.list().length === 2, 'and shown again');

  // Apple cannot be reached: everything stays
  apple.down = true;
  await ic.sync();
  d = ic.details();
  ok(
    d.error === 'could not connect' && d.photos === 2 && W.list().length === 2 && fs.readdirSync(path.join(dataDir, 'photos')).length === 2,
    'when Apple cannot be reached the photos stay and the error is shown: ' + d.error
  );
  ok(W.status().error === 'could not connect', 'the manager gets the error too');
  apple.down = false;

  // the hosts it trusts
  const pics = () => fs.readdirSync(path.join(dataDir, 'photos')).length;
  al.home = 'p77-sharedstreams.icloud.com'; // the album moved: the remembered host answers 330
  apple.moveViaBody = true;
  await ic.sync();
  ok(!ic.details().error && ic.details().albums[0].error === '', 'a 330 that names the host only in its body is followed too');
  al.home = 'p78-sharedstreams.icloud.com';
  apple.moveTo = 'evil.example';
  n0 = apple.calls.length;
  await ic.sync();
  ok(
    /does not trust/.test(ic.details().error) &&
      apple.calls.slice(n0).every(c => /\.icloud\.com$/.test(new URL(c.url).hostname)) &&
      pics() === 2,
    'a 330 to a server that is not a shared-streams host is refused, and the photos stay'
  );
  apple.moveTo = 'p78-sharedstreams.icloud.com.evil.example';
  await ic.sync();
  ok(/does not trust/.test(ic.details().error), 'also one that only starts like one');
  apple.moveTo = '';
  apple.moveViaBody = false;
  // a new photo whose address is on a strange host, and one whose picture redirects
  const extra = (n, sum, w, h) => ({
    photoGuid: G(n),
    dateCreated: '2026-03-0' + n + 'T12:00:00Z',
    derivatives: { 2048: { fileSize: '400000', checksum: sum, width: String(w), height: String(h) } },
  });
  al.stream.photos.push(
    extra(6, '01aa000000000000000000000000000000000006b1', 2048, 1536),
    extra(7, '01aa000000000000000000000000000000000007b1', 2048, 1536)
  );
  al.urls.items['01aa000000000000000000000000000000000006b1'] = {
    url_location: 'cvws.icloud-content.com.evil.example',
    url_path: '/S/x.JPG',
  };
  al.urls.items['01aa000000000000000000000000000000000007b1'] = {
    url_location: 'cvws.icloud-content.com',
    url_path: '/S/AaRedirect07/IMG.JPG',
  };
  apple.redirect = { from: 'AaRedirect07', to: 'https://evil.example/S/x.JPG' };
  n0 = apple.calls.length;
  await ic.sync();
  ok(
    apple.calls.slice(n0).every(c => /\.icloud(-content)?\.com$/.test(new URL(c.url).hostname)) && !W.file(G(6)) && !W.file(G(7)),
    'an address on a strange host is not asked, and a redirect to one is not followed'
  );
  ok(
    /2 photos could not be downloaded/.test(ic.details().error),
    'and the status says photos could not be downloaded: ' + ic.details().error
  );
  apple.redirect = { from: 'AaRedirect07', to: '/S/AaMoved07/IMG.JPG' };
  await ic.sync();
  ok(W.file(G(7)) !== '' && apple.calls.some(c => /AaMoved07/.test(c.url)), 'a redirect to another Apple address is followed');
  apple.picture = () => Buffer.from('<html>not a picture</html>');
  al.stream.photos.push(extra(8, '01aa000000000000000000000000000000000008b1', 2048, 1536));
  al.urls.items['01aa000000000000000000000000000000000008b1'] = {
    url_location: 'cvws.icloud-content.com',
    url_path: '/S/AaHeic08/IMG.JPG',
  };
  await ic.sync();
  ok(!W.file(G(8)) && !fs.existsSync(path.join(dataDir, 'photos', G(8) + '.tmp')), 'what is not a JPEG is not kept');
  apple.picture = () => JPEG;
  delete al.urls.items['01aa000000000000000000000000000000000006b1'];
  al.stream.photos = al.stream.photos.filter(x => x.photoGuid !== G(6));

  // the limits: photos and bytes (lowered for the test)
  await ic.sync();
  const all = ic.details().photos;
  ok(all === 4, 'four photos now: ' + all);
  M.LIMITS.photos = 2;
  await ic.sync();
  ok(
    ic.details().photos === 2 && W.file(G(8)) && W.file(G(7)) && !W.file(G(2)),
    'past the photo limit the newest stay and the oldest are deleted'
  );
  M.LIMITS.photos = 300;
  M.LIMITS.bytes = 2 * 1024 * 1024 + JPEG.length * 2 + 10;
  await ic.sync();
  ok(
    ic.details().photos === 3 && /at most 2 MB/.test(ic.details().error),
    'past the size limit nothing more is downloaded, and it says so: ' + ic.details().error
  );
  M.LIMITS.bytes = 100 * 1024 * 1024;
  await ic.sync();

  // a second album; one that fails keeps its photos
  apple.albums[TOKEN2] = {
    home: 'p07-sharedstreams.icloud.com',
    stream: { streamName: 'Second', photos: [extra(9, '01aa000000000000000000000000000000000009b1', 1536, 2048)] },
    urls: {
      locations: {},
      items: {
        '01aa000000000000000000000000000000000009b1': { url_location: 'cvws.icloud-content.com', url_path: '/S/AaSecond09/IMG.JPG' },
      },
    },
  };
  p = await phone(
    'POST',
    '/api/add',
    { links: 'https://www.icloud.com/sharedalbum/#' + TOKEN + '\nhttps://www.icloud.com/sharedalbum/#' + TOKEN2 },
    code
  );
  ok(
    p.j.added.length === 1 && p.j.added[0].name === 'Second' && /already/.test(p.j.errors[0].error),
    'several links at once; one already there is said so'
  );
  await ic.sync();
  const before = ic.details().photos;
  ok(before === 5 && W.file(G(9)), 'the second album syncs too: ' + before);
  delete apple.albums[TOKEN]; // the first album's Public Website was switched off
  await ic.sync();
  d = ic.details();
  ok(
    d.photos === before &&
      /1 album could not be read/.test(d.error) &&
      /Public Website/.test(d.albums[0].error) &&
      d.albums[1].error === '',
    'an album Apple no longer answers for keeps its photos, and its row says why'
  );
  p = await phone('POST', '/api/remove', { id: d.albums[0].id }, code);
  d = ic.details();
  ok(p.j.ok && d.albums.length === 1 && d.photos === 1 && W.list().join() === G(9), 'removing an album deletes its photos');

  // through Home's wallpapers (core)
  const core = req('wallpapers').create({
    config: memoryConfig({}),
    feature: n =>
      n === 'addons' ? { providers: w => (w === 'wallpapers' ? [{ id: 'icloud', name: 'iCloud Shared Album', mod: ic }] : []) } : null,
  });
  r = await call(core, '/api/wallpapers/list');
  ok(r.j.photos.join() === 's/icloud/' + G(9), 'Home gets s/icloud/<photo id> entries: ' + r.j.photos.join());
  r = await call(core, '/api/wallpapers/status');
  ok(
    r.j.sources && r.j.sources[0].id === 'icloud' && r.j.sources[0].settings === true && r.j.sources[0].photos === 1,
    'the manager gets a row for it'
  );

  p = await phone('POST', '/api/disconnect', {}, code);
  d = ic.details();
  ok(!d.configured && d.photos === 0 && fs.readdirSync(path.join(dataDir, 'photos')).length === 0, 'Remove every album deletes the photos');
  ok(((config.get().addons || {}).icloud || {}).settings.albums.length === 0, 'and the tokens are gone from the settings');
  ok(
    JSON.stringify(logs).indexOf(TOKEN2) < 0 && JSON.stringify(logs).indexOf(TOKEN) < 0,
    'no log line ever had a token: ' + logs.slice(-3).join(' | ')
  );
  ic.stop();
  await sleep(50);
  p = await phone('GET', '/').catch(() => ({ code: 0 }));
  ok(p.code === 0, 'stop() closes the settings page');
  // ---- the newer kind: https://photos.icloud.com/shared/album/<id>, read from CloudKit ----
  const CK = require(path.join(addonDir, 'cloudkit.js'));
  const CKID = '0Ab_TestCloudKitAlbum9xYz', // the invented id of the fixtures
    CKTOKEN = 'TestAccessTokenForTheAnonymousReader000000000000',
    ckLink = 'https://photos.icloud.com/shared/album/' + CKID;
  const kindOf = l => JSON.stringify(M.parseLink(l));
  ok(
    kindOf(ckLink) === JSON.stringify({ kind: 'cloudkit', token: CKID }) &&
      kindOf(ckLink + '/') === kindOf(ckLink) &&
      kindOf(ckLink + '?lang=fr') === kindOf(ckLink) &&
      kindOf(' ' + ckLink + '#x\n') === kindOf(ckLink),
    'a photos.icloud.com shared album link is told apart from the older kind by the link'
  );
  ok(
    [
      'http://photos.icloud.com/shared/album/' + CKID,
      'https://photos.icloud.com.evil.example/shared/album/' + CKID,
      'https://evil.example/shared/album/' + CKID,
      'https://photos.icloud.com/shared/gallery/' + CKID,
      'https://photos.icloud.com/shared/album/short',
      'https://photos.icloud.com/shared/album/' + CKID + '/../x',
      'https://photos.icloud.com/shared/album/' + CKID + ' x',
    ].every(l => M.parseLink(l) === null),
    'and anything else is refused (plain http, another host or path, a bad id)'
  );
  const resolved = fixture('ck-resolve.json');
  const sh = CK.parseResolve(resolved);
  ok(
    sh.partition === 'https://p42-ckdatabasews.icloud.com' &&
      sh.token === CKTOKEN &&
      sh.name === 'Test CloudKit album' &&
      sh.zoneID.zoneName,
    'the resolve answer gives the partition, the access token, the zone and the title'
  );
  ok(!/Testfirst|Testlast|owner@example/.test(JSON.stringify(sh)), "and nothing of the owner's name or e-mail address is kept");
  const resolveErr = mut => {
    const j = JSON.parse(JSON.stringify(resolved));
    mut(j.results[0]);
    try {
      CK.parseResolve(j);
      return '';
    } catch (e) {
      return e.message;
    }
  };
  ok(/does not find this album/.test(resolveErr(r => (r.serverErrorCode = 'NOT_FOUND'))), 'an id Apple does not know is reported');
  ok(
    /needs an Apple sign-in/.test(resolveErr(r => delete r.anonymousPublicAccess)) &&
      /needs an Apple sign-in/.test(resolveErr(r => (r.requireAppleLogin = true))),
    'an album that is not open to anyone with the link says it needs a sign-in'
  );
  ok(
    [
      'https://evil.example',
      'http://p42-ckdatabasews.icloud.com',
      'https://p42-ckdatabasews.icloud.com.evil.example',
      'https://p42-ckdatabasews.icloud.com:8443',
    ].every(h => /does not trust/.test(resolveErr(r => (r.anonymousPublicAccess.databasePartition = h)))),
    'a database partition that is not https://p<NN>-ckdatabasews.icloud.com is refused'
  );
  ok(/does not understand/.test(resolveErr(r => (r.databaseScope = 'PRIVATE'))), 'and so is any database but the shared one');
  const ckPhotos = CK.photosOf(fixture('ck-query-1.json').records.concat(fixture('ck-query-2.json').records), M.assetUrl);
  const ckId = n => '0B000000-0000-4000-8000-00000000000' + n;
  ok(
    ckPhotos.map(x => x.guid).join() === [1, 2, 3, 5].map(ckId).join(),
    'the photos come newest first by their date, without the video, the hidden one, and one whose pictures are on a strange host'
  );
  const ckPick = (n, size) => (M.pick(ckPhotos.filter(x => x.guid === ckId(n))[0].derivs, size)[0] || {}).sum;
  ok(
    ckPick(1, '4k') === 'AckSumM1m0000' && ckPick(1, 'hd') === 'AckSumM1m0000',
    "a HEIC original is never taken: Apple's 2048-pixel JPEG is"
  );
  ok(
    ckPick(2, '4k') === 'AckSumM2o0000' && ckPick(2, 'hd') === 'AckSumM2m0000',
    'a JPEG original is taken at 4K, the 2048-pixel JPEG at Full HD'
  );
  ok(
    ckPick(3, '4k') === 'AckSumM3m0000' && ckPhotos.filter(x => x.guid === ckId(3))[0].derivs.length === 1,
    'an original that needs turning is never used (old Chromium ignores the EXIF orientation)'
  );
  ok(ckPick(5, '4k') === 'AckSumA5f0000' && ckPick(5, 'hd') === 'AckSumA5m0000', 'an edited photo is shown as edited');
  ok(
    ckPhotos.every(x => x.derivs.every(d => /^https:\/\/cvws\.icloud-content\.com\/B\/Test\w+\/photo\.jpg\?o=/.test(d.url))),
    'the file name in the download address is filled in'
  );

  // the sync against a stand-in for CloudKit
  const ckCalls = [];
  let ckDown = false,
    ckPages = [fixture('ck-query-1.json'), fixture('ck-query-2.json')];
  const ckRead = (url, o) => {
    ckCalls.push({ url, o });
    if (o.redirects !== 0) return Promise.reject(new Error('the add-on must follow redirects itself (redirects: 0)'));
    if (ckDown) return Promise.reject(new Error('could not connect'));
    const u = new URL(url),
      q = {};
    u.searchParams.forEach((v, k) => (q[k] = v));
    const send = (st, obj) =>
      Promise.resolve({ status: st, headers: {}, body: Buffer.isBuffer(obj) ? obj : Buffer.from(JSON.stringify(obj)) });
    if (u.hostname === 'ckdatabasews.icloud.com' && u.pathname === '/database/1/com.apple.photos.cloud/production/public/records/resolve') {
      const b = JSON.parse(o.body);
      return b.shortGUIDs[0].value === CKID && q.sharing_url_key === CKID
        ? send(200, resolved)
        : send(200, { results: [{ shortGUID: b.shortGUIDs[0], serverErrorCode: 'NOT_FOUND', reason: 'Cannot resolve shortGUID' }] });
    }
    if (
      u.hostname === 'p42-ckdatabasews.icloud.com' &&
      u.pathname === '/database/1/com.apple.photos.cloud/production/shared/records/query'
    ) {
      if (q.publicAccessAuthToken !== CKTOKEN || q.sharing_url_key !== CKID) return send(401, { serverErrorCode: 'AUTHENTICATION_FAILED' });
      const b = JSON.parse(o.body);
      if (b.query.recordType !== 'CPLAssetAndMasterByAssetDateWithoutHiddenOrDeleted' || b.zoneID.zoneName !== sh.zoneID.zoneName)
        return send(400, {});
      return send(200, b.continuationMarker === 'TestContinuationMarker1' ? ckPages[1] : ckPages[0]);
    }
    if (u.hostname === 'cvws.icloud-content.com' && /\/photo\.jpg$/.test(u.pathname)) return send(200, JPEG);
    return Promise.reject(new Error('the stand-in got a request for ' + u.hostname));
  };
  const ckConfig = memoryConfig({}),
    ckLogs = [];
  const ckData = path.join(process.env.CYTV_DIR, 'addon-data', 'icloud-ck');
  nc.mkdirp(ckData);
  const ck = M.create(
    Object.assign({}, ctx, {
      dataDir: ckData,
      log: l => ckLogs.push(String(l)),
      fetch: { read: ckRead },
      settings: {
        get: () => Object.assign({}, ((ckConfig.get().addons || {}).icloud || {}).settings),
        set: o =>
          ckConfig.update('addon:icloud', c => {
            c.addons = c.addons || {};
            c.addons.icloud = { settings: Object.assign({}, (c.addons.icloud || {}).settings, o) };
          }),
      },
    })
  );
  size = '4k';
  r = await ck.wallpapers.settings({});
  await sleep(50);
  p = await phone('POST', '/api/add', { links: 'https://photos.icloud.com/shared/album/0Ab_UnknownCloudKitAlb00' }, r.code);
  ok(
    /does not find this album/.test(p.j.errors[0].error) && p.j.errors[0].album === '…lb00',
    'an unknown album is reported by its last four characters'
  );
  p = await phone('POST', '/api/add', { links: ckLink }, r.code);
  ok(
    p.j.ok && p.j.added[0].name === 'Test CloudKit album' && p.j.added[0].count === 4,
    'Test and save reads the album over both pages: ' + JSON.stringify(p.j)
  );
  await ck.sync();
  d = ck.details();
  ok(
    d.photos === 4 && !d.error && d.albums[0].kind === 'cloudkit' && d.albums[0].hint === '…9xYz',
    'the sync downloads its four photos: ' + JSON.stringify(d)
  );
  const ckGot = ckCalls.filter(c => /icloud-content/.test(c.url)).map(c => c.url);
  ok(
    ckGot.length === 4 && ckGot.some(u => /TestM2o\//.test(u)) && ckGot.some(u => /TestA5f\//.test(u)),
    'at 4K: the JPEG original and the edited full-size JPEG'
  );
  ok(
    ckCalls.every(c => /^https:\/\/(ckdatabasews|p42-ckdatabasews)\.icloud\.com\/|^https:\/\/cvws\.icloud-content\.com\//.test(c.url)) &&
      ckCalls.filter(c => /ckdatabasews/.test(c.url)).every(c => c.o.method === 'POST' && c.o.headers['content-type'] === 'text/plain'),
    'every request goes to CloudKit or the picture host named in its answer'
  );
  const ckAll = JSON.stringify([d, ck.wallpapers.status(), ckLogs, fs.readFileSync(path.join(ckData, 'index.json'), 'utf8')]);
  ok(
    ckAll.indexOf(CKID) < 0 && ckAll.indexOf(CKTOKEN) < 0,
    'neither the album id nor the access token is in a reply, a log line or the index'
  );
  ok(!/Testfirst|Testlast|owner@example/.test(ckAll + JSON.stringify(ckConfig.get())), "nor the owner's name or e-mail address, anywhere");
  let n1 = ckCalls.length;
  await ck.sync();
  ok(
    ckCalls.slice(n1).every(c => /ckdatabasews/.test(c.url)) && ckCalls.length - n1 === 3,
    'a second sync reads the album (resolve and two pages) and downloads nothing'
  );
  // a long sync: the download addresses are read again once the listing is old
  size = 'hd';
  M.LIMITS.freshMs = -1;
  n1 = ckCalls.length;
  await ck.sync();
  ok(
    ckCalls.slice(n1).filter(c => /records\/resolve/.test(c.url)).length === 2 &&
      ckCalls.slice(n1).filter(c => /TestM2m\//.test(c.url)).length === 1,
    'when the listing is older than its addresses last, the album is read again before downloading (Full HD: the 2048 JPEG)'
  );
  M.LIMITS.freshMs = 10 * 60 * 1000;
  // a photo that left the album; then CloudKit cannot be reached
  ckPages = [fixture('ck-query-1.json'), fixture('ck-query-2.json')];
  ckPages[1].records = ckPages[1].records.filter(x => !/5/.test(x.recordName.slice(-1)) && !/AckMaster5/.test(x.recordName));
  await ck.sync();
  ok(ck.details().photos === 3 && !ck.wallpapers.file(ckId(5)), 'a photo that left the album is deleted');
  ckDown = true;
  await ck.sync();
  ok(ck.details().photos === 3 && ck.details().error === 'could not connect', 'when Apple cannot be reached the photos stay');
  ckDown = false;
  ck.stop();
});
