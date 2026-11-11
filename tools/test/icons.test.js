// Custom app icons (the bundled add-on icons): a picture kept per app (picture types, the size limit, app ids, a new picture replacing the old one),
// the phone page (the code, the apps without the inputs, upload, reset, the app chosen on Home in the QR code), the launcher's Reset
// icon, and apps.js: GET /icon/<app id> sends the custom picture first and /api/apps marks the app with iv. Backdrops (Top Shelf): a 16:9
// picture and its blurred copy per app, their limits, the phone page's upload and reset, and what Home asks (/api/icons/backdrops).
const fs = require('fs'),
  http = require('http'),
  path = require('path');
const { ok, call, serve, req, memoryConfig, run, sleep, tmp } = require('./lib');
const addonPath = path.join(__dirname, '..', '..', 'helper', 'addons-bundled', 'icons');

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(50, 1)]);

// a request to the phone page on 127.0.0.1:8794
function phone(method, p, body, code, type, language) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        host: '127.0.0.1',
        port: 8794,
        path: p,
        method,
        headers: Object.assign(
          { 'x-code': code || '' },
          type ? { 'content-type': type } : {},
          language ? { 'accept-language': language } : {}
        ),
      },
      res => {
        const b = [];
        res.on('data', c => b.push(c));
        res.on('end', () => {
          const t = Buffer.concat(b).toString();
          let j = null;
          try {
            j = JSON.parse(t);
          } catch (_) {}
          resolve({ code: res.statusCode, j, text: t });
        });
      }
    );
    r.on('error', reject);
    r.end(body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body));
  });
}
// a GET with the raw reply
function get(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, res => {
        const b = [];
        res.on('data', c => b.push(c));
        res.on('end', () => resolve({ code: res.statusCode, type: res.headers['content-type'], body: Buffer.concat(b) }));
      })
      .on('error', reject);
  });
}

run(async () => {
  const I = require(path.join(addonPath, 'service.js'));
  const dir = path.join(process.env.CYTV_DIR, 'icons');
  ok(I.set('com.example.app', PNG) === '' && /\.png$/.test(I.find('com.example.app')), 'a PNG is kept for an app');
  ok(/JPEG, PNG or WebP/.test(I.set('com.example.app', Buffer.from('<svg/>'))), 'a file that is not a picture is refused');
  ok(I.set('../config', PNG) === 'not an app' && I.set('.hidden', PNG) === 'not an app', 'a name that is not an app id is refused');
  ok(/1 MB/.test(I.set('com.example.app', Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]))), 'a picture over 1 MB is refused');
  ok(
    I.set('com.example.app', JPEG) === '' && /\.jpg$/.test(I.find('com.example.app')) && fs.readdirSync(dir).length === 1,
    'a new picture replaces the old one, also of another type: ' + fs.readdirSync(dir).join(' ')
  );
  const v = I.versions();
  ok(
    typeof v['com.example.app'].v === 'number' && v['com.example.app'].tile === false && Object.keys(v).length === 1,
    'the versions list every custom picture, with how it is shown'
  );
  ok(
    I.set('com.example.app', PNG, true) === '' &&
      /[\\/]tile[\\/]com\.example\.app\.png$/.test(I.find('com.example.app')) &&
      I.versions()['com.example.app'].tile === true &&
      !fs.existsSync(path.join(dir, 'com.example.app.jpg')),
    'a Full tile picture is kept apart and replaces the Icon picture'
  );
  ok(
    I.set('com.example.app', JPEG) === '' &&
      I.find('com.example.app') === path.join(dir, 'com.example.app.jpg').split(path.sep).join('/') &&
      !fs.existsSync(path.join(dir, 'tile', 'com.example.app.png')),
    'back to Icon replaces the Full tile picture'
  );
  ok(
    I.remove('com.example.app') === true && I.find('com.example.app') === '' && I.remove('com.example.app') === false,
    'reset removes the picture, once'
  );

  // ---- backdrops: the picture, then its blurred copy (the glass) ----
  const bdir = path.join(dir, 'backdrop');
  ok(/no backdrop/.test(I.setGlass('com.example.app', JPEG)), 'a blurred copy without a backdrop is refused');
  ok(
    I.setBackdrop('com.example.app', PNG) === '' && /backdrop[\\/]com\.example\.app\.png$/.test(I.findBackdrop('com.example.app')),
    'a backdrop is kept for an app'
  );
  ok(I.find('com.example.app') === '', 'a backdrop is not an icon');
  ok(
    /1\.5 MB/.test(I.setBackdrop('com.example.app', Buffer.concat([JPEG, Buffer.alloc(1536 * 1024)]))),
    'a backdrop over 1.5 MB is refused'
  );
  ok(I.setBackdrop('../x', JPEG) === 'not an app', 'a name that is not an app id is refused');
  ok(/JPEG, PNG or WebP/.test(I.setBackdrop('com.example.app', Buffer.from('<svg/>'))), 'a file that is not a picture is refused');
  ok(/JPEG/.test(I.setGlass('com.example.app', PNG)), 'the blurred copy must be a JPEG');
  ok(
    /256 KB/.test(I.setGlass('com.example.app', Buffer.concat([JPEG, Buffer.alloc(256 * 1024)]))),
    'a blurred copy over 256 KB is refused'
  );
  ok(I.setGlass('com.example.app', JPEG) === '' && I.findGlass('com.example.app') !== '', 'the blurred copy is kept beside it');
  let bd = I.backdrops();
  ok(
    Object.keys(bd).length === 1 && typeof bd['com.example.app'].v === 'number' && bd['com.example.app'].g === 1,
    'the backdrops list the app, with the version and the glass copy: ' + JSON.stringify(bd)
  );
  ok(
    I.setBackdrop('com.example.app', JPEG) === '' &&
      /\.jpg$/.test(I.findBackdrop('com.example.app')) &&
      I.findGlass('com.example.app') === '' &&
      fs.readdirSync(bdir).filter(n => n !== 'glass').length === 1,
    'a new backdrop replaces the old one, also of another type, and drops the old blurred copy: ' + fs.readdirSync(bdir).join(' ')
  );
  ok(I.backdrops()['com.example.app'].g === undefined, 'without the blurred copy the list says so');
  ok(
    I.removeBackdrop('com.example.app') === true &&
      I.findBackdrop('com.example.app') === '' &&
      I.removeBackdrop('com.example.app') === false,
    'a backdrop is reset, once'
  );

  // ---- the phone page, with a stand-in for apps.js ----
  const own = path.join(tmp, 'app-own');
  fs.mkdirSync(own);
  fs.writeFileSync(path.join(own, 'i.png'), JPEG);
  const list = [
    { id: 'com.example.app', title: 'Example', folder: own, icon: 'i.png' },
    { id: 'com.webos.app.hdmi1', title: 'HDMI 1', input: 1 },
  ];
  // the tiles of a theme: dock 236 x 150, grid 165 x 150 (CSS pixels)
  const theme = { resolved: () => ({ vars: { '--dock-w': '236px', '--dock-h': '150px', '--tile-w': '165px', '--tile-h': '150px' } }) };
  const ic = I.create({
    config: memoryConfig({}),
    feature: n => (n === 'apps' ? { apps: async () => list } : n === 'theme' ? theme : null),
  });
  // the tool (wave 2): which apps have a picture of their own (reset is not a tool: it deletes the picture)
  ok(
    ic.tools.list().length === 1 && ic.tools.list()[0].inputSchema.properties.action.enum.join() === 'list_custom',
    'one tool, icons, with list_custom only'
  );
  ok(/no app/.test((await ic.tools.call('icons', { action: 'list_custom' })).content[0].text), 'list_custom with no picture says so');
  I.set('com.example.app', PNG, true);
  const tl = await ic.tools.call('icons', { action: 'list_custom' });
  const tj = JSON.parse(tl.content[0].text);
  ok(
    !tl.isError && tj.length === 1 && tj[0].id === 'com.example.app' && tj[0].name === 'Example' && tj[0].tile === true,
    'list_custom: the app, by name, and how it is shown'
  );
  ok((await ic.tools.call('icons', { action: 'reset' })).isError, 'reset is refused');
  I.remove('com.example.app');
  let r = await call(ic, '/api/icons/pair', 'POST', { app: 'com.example.app', scale: 2 });
  const code = r.j.code;
  ok(
    /^\d{6}$/.test(code) && /:8794\/#\d{6}\/com\.example\.app$/.test(r.j.qr),
    'the phone page opens with a 6-digit code; the QR code carries the app chosen on Home'
  );
  ok(
    JSON.stringify(r.j.sizes) ===
      JSON.stringify({ tile: { w: 472, h: 300 }, grid: { w: 330, h: 300 }, icon: 512, backdrop: { w: 3840, h: 2160 } }),
    "the sizes that fit the theme's tiles, in the screen's pixels (scale 2 on a 4K TV): " + JSON.stringify(r.j.sizes)
  );
  await sleep(100);
  let p = await phone('GET', '/');
  ok(p.code === 200 && /App icons/.test(p.text), 'the page is served');
  p = await phone('GET', '/api/state', undefined, '000000');
  ok(p.code === 403, 'the API needs the code');
  p = await phone('GET', '/api/state', undefined, code);
  ok(
    p.j.apps.length === 2 && p.j.apps[0].id === 'com.example.app' && p.j.apps[0].custom === false && p.j.apps[1].id === '__live',
    "the page lists the apps, not the inputs, and Home's Live TV tile: " + JSON.stringify(p.j.apps.map(x => x.id))
  );
  ok(p.j.sizes && p.j.sizes.tile.w === 472, 'the page gets the sizes too');
  p = await phone('GET', '/api/state', undefined, code, null, 'fr-FR,fr;q=0.9');
  ok(
    p.j.apps.filter(x => x.id === '__live')[0].title === 'TV en direct',
    "the Live TV tile's name is in the phone's language: " + JSON.stringify(p.j.apps.map(x => x.title))
  );
  p = await phone('POST', '/api/upload/__live', PNG, code, 'image/png');
  ok(p.code === 200 && /__live\.png$/.test(I.find('__live')) && I.versions().__live, 'the Live TV tile can get a picture of its own');
  I.remove('__live');
  p = await phone('GET', '/api/icon/com.example.app', undefined, code);
  ok(p.code === 200, "without a picture the page shows the app's own icon");
  p = await phone('POST', '/api/upload/com.other.app', PNG, code, 'image/png');
  ok(p.code === 400, 'a picture for an app that is not installed is refused');
  p = await phone('POST', '/api/upload/com.example.app', PNG, code, 'image/png');
  ok(p.code === 200 && /\.png$/.test(I.find('com.example.app')), 'a picture is uploaded for an app');
  p = await phone('GET', '/api/state', undefined, code);
  ok(p.j.apps[0].custom === true && p.j.apps[0].tile === false, 'the page marks the app as having its own picture');
  p = await phone('POST', '/api/upload/com.example.app?tile=1', JPEG, code, 'image/jpeg');
  ok(p.code === 200 && /[\\/]tile[\\/]com\.example\.app\.jpg$/.test(I.find('com.example.app')), 'a picture is uploaded as Full tile');
  p = await phone('GET', '/api/state', undefined, code);
  ok(p.j.apps[0].tile === true, 'the page marks it as Full tile');
  p = await phone('POST', '/api/reset', { id: 'com.example.app' }, code);
  ok(p.j.ok === true && I.find('com.example.app') === '', 'Reset on the phone gives the app its own icon again');
  // a backdrop from the phone: the picture, then its blurred copy; Home asks which apps have one and loads them over loopback
  p = await phone('GET', '/api/state', undefined, code);
  ok(
    p.j.apps[0].backdrop === false && p.j.sizes.backdrop.w === 3840 && p.j.sizes.backdrop.h === 2160,
    'the page offers a backdrop at 3840 x 2160 (4K)'
  );
  p = await phone('POST', '/api/backdrop/com.example.app/glass', JPEG, code, 'image/jpeg');
  ok(p.code === 400, 'the blurred copy comes after the picture');
  p = await phone('POST', '/api/backdrop/com.other.app', JPEG, code, 'image/jpeg');
  ok(p.code === 400, 'a backdrop for an app that is not installed is refused');
  // the service stops reading at the limit and drops the connection, so the client sees an error or a reset
  p = await phone('POST', '/api/backdrop/com.example.app', Buffer.concat([JPEG, Buffer.alloc(1600 * 1024)]), code, 'image/jpeg').catch(
    e => ({ code: e.code })
  );
  ok(
    (p.code === 400 || p.code === 'ECONNRESET' || p.code === 'EPIPE') && !I.findBackdrop('com.example.app'),
    'a backdrop over 1.5 MB is refused while it arrives: ' + p.code
  );
  p = await phone('POST', '/api/backdrop/com.example.app', JPEG, code, 'image/jpeg');
  ok(p.code === 200 && I.findBackdrop('com.example.app'), 'a backdrop is uploaded');
  p = await phone('POST', '/api/backdrop/com.example.app/glass', JPEG, code, 'image/jpeg');
  ok(p.code === 200 && I.findGlass('com.example.app'), 'and its blurred copy');
  p = await phone('GET', '/api/state', undefined, code);
  ok(p.j.apps[0].backdrop === true && p.j.apps[0].custom === false, 'the page marks the app as having a backdrop, not an icon');
  p = await phone('GET', '/api/backdrop/com.example.app', undefined, code);
  ok(p.code === 200, 'the page shows the backdrop');
  r = await call(ic, '/api/icons/backdrops');
  ok(r.j.backdrops['com.example.app'] && r.j.backdrops['com.example.app'].g === 1, 'Home learns which apps have a backdrop: ' + r.out);
  const ls = await serve((q, res) => ic.handle(q, res, q.url.split('?')[0], async () => ({})));
  let lg = await get(ls.url + '/api/icons/backdrop/com.example.app?v=1');
  ok(lg.code === 200 && lg.type === 'image/jpeg' && lg.body.equals(JPEG), 'Home loads the backdrop');
  lg = await get(ls.url + '/api/icons/backdrop/com.example.app/glass');
  ok(lg.code === 200 && lg.body.equals(JPEG), 'and its blurred copy');
  lg = await get(ls.url + '/api/icons/backdrop/com.none.app');
  ok(lg.code === 404, 'an app without a backdrop has none');
  ls.server.close();
  p = await phone('POST', '/api/backdrop-reset', { id: 'com.example.app' }, code);
  ok(
    p.j.removed === true && !I.findBackdrop('com.example.app') && !I.findGlass('com.example.app'),
    'Reset on the phone removes the backdrop and its copy'
  );
  I.setBackdrop('com.example.app', JPEG);
  r = await call(ic, '/api/icons/backdrop/reset', 'POST', { id: 'com.example.app' });
  ok(r.j.removed === true && !I.findBackdrop('com.example.app'), "the launcher's Reset backdrop removes it too");
  r = await call(ic, '/api/icons/backdrop/reset', 'POST', { id: '../x' });
  ok(r.code === 400, 'a backdrop reset for a name that is not an app id is refused');

  // ---- the launcher's Reset icon, and the status ----
  I.set('com.example.app', PNG);
  r = await call(ic, '/api/icons/reset', 'POST', { id: 'com.example.app' });
  ok(r.j.ok === true && r.j.removed === true && I.find('com.example.app') === '', "the launcher's Reset icon removes the picture");
  r = await call(ic, '/api/icons/reset', 'POST', { id: 'com.example.app' });
  ok(
    r.j.ok === true && r.j.removed === false,
    'Reset for an app that already shows its own icon (reset on the phone first) is fine, so the launcher shows it again'
  );
  r = await call(ic, '/api/icons/reset', 'POST', { id: '../x' });
  ok(r.code === 400, 'a reset for a name that is not an app id is refused');
  r = await call(ic, '/api/icons/status');
  ok(r.j.icons === 0 && r.j.pair && r.j.pair.code === code, 'the status says how many pictures there are and whether the page is open');
  await call(ic, '/api/icons/pair', 'POST', { stop: true });
  r = await call(ic, '/api/icons/status');
  ok(r.j.pair === null, 'the phone page closes');

  // ---- apps.js: the custom picture first, and iv in the app list ----
  const luna = async uri =>
    /listApps/.test(uri)
      ? { returnValue: true, apps: [{ id: 'com.example.app', title: 'Example', folderPath: own, icon: 'i.png' }] }
      : { returnValue: true };
  // apps.js reaches the add-on through the loader (addons.module), and only while it runs
  let running = null;
  const apps = req('apps').create({
    config: memoryConfig({}),
    luna,
    version: '1.6.0',
    feature: n => (n === 'addons' ? { module: id => (id === 'icons' ? running : null) } : null),
  });
  I.set('com.example.app', PNG);
  r = await call(apps, '/api/apps');
  ok(
    r.j.apps.length === 1 && r.j.apps[0].iv === undefined && r.j.icons === undefined,
    'with the add-on off, a picture is not used and the launcher is not told to offer Change icon'
  );
  I.remove('com.example.app');
  running = ic;
  r = await call(apps, '/api/apps');
  ok(r.j.icons === true, 'with the add-on on, the launcher is told (icons: true)');
  ok(r.j.apps.length === 1 && r.j.apps[0].iv === undefined, 'an app without a picture of its own has no iv');
  const s = await serve((q, res) => apps.handle(q, res, q.url.split('?')[0], async () => ({})));
  let g = await get(s.url + '/icon/com.example.app');
  ok(g.code === 200 && g.body.equals(JPEG), "the app's own icon is sent while it has no picture");
  I.set('com.example.app', PNG);
  r = await call(apps, '/api/apps');
  ok(
    typeof r.j.apps[0].iv === 'number' && r.j.apps[0].iv > 0 && r.j.apps[0].it === undefined,
    'an app with a picture of its own is marked with iv'
  );
  g = await get(s.url + '/icon/com.example.app?v=' + r.j.apps[0].iv);
  ok(g.code === 200 && g.type === 'image/png' && g.body.equals(PNG), 'the custom picture is sent first, as a PNG');
  I.set('com.example.app', JPEG, true);
  r = await call(apps, '/api/apps');
  ok(r.j.apps[0].it === 1, 'a Full tile picture is marked with it: 1');
  g = await get(s.url + '/icon/com.example.app');
  ok(g.code === 200 && g.type === 'image/jpeg' && g.body.equals(JPEG), 'the Full tile picture is sent as well');
  I.remove('com.example.app');
  g = await get(s.url + '/icon/com.example.app');
  ok(g.code === 200 && g.body.equals(JPEG), "after a reset the app's own icon is sent again");
  s.server.close();
});
