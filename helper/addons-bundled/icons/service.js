// Custom app icons, a bundled add-on (addons-bundled/icons): a picture chosen on a phone shows instead of an app's own icon, on Home and
// in the Inputs list. The app's own files
// are never touched, so an app update keeps the picture. One file per app, in one of two folders by how it is shown:
//   D/icons/<app id>.<png|jpg|webp>        Icon: inside the tile, like the app's own icon (a logo)
//   D/icons/tile/<app id>.<png|jpg|webp>   Full tile: the picture covers the tile, the middle kept (a photo)
// GET /icon/<app id> (apps.js) sends it first, and /api/apps marks such an app with iv (the picture's version, so the pages load the
// new picture and work out its colour again) and it: 1 for a Full tile picture. apps.js asks the loader for this add-on
// (addons.module('icons')) and does nothing of this while it is switched off: the apps then show their own icons.
// It also keeps a backdrop per app for Home's Top Shelf (setBackdrop below): a 16:9 picture shown behind the dock while the app is
// focused there, with a blurred copy for behind the app grid.
// API (loopback, our apps): GET /api/icons/status, POST /api/icons/pair {app, scale, stop}, POST /api/icons/reset {id},
// GET /api/icons/backdrops {backdrops: {<app id>: {v, g}}}, GET /api/icons/backdrop/<app id>[/glass], POST /api/icons/backdrop/reset {id}.
// The phone page (POST pair) is a short-lived server on the LAN, port 8794, that needs the code shown on the TV; its API is under /api/
// on that port.
// It and the manager show the picture sizes that fit the tiles of the theme in use (sizes()): scale is the screen's pixels per CSS
// pixel, measured by the manager (2 on a 4K TV, where Home is drawn at 3840 x 2160).
const fs = require('fs'),
  http = require('http'),
  path = require('path');
const P = require('../../paths'),
  web = require('../../web'),
  i18n = require('../../i18n'),
  nc = require('../../netcompat'),
  { imageType } = require('../../wallpapers');

const DIR = P.D + '/icons',
  TILE = DIR + '/tile',
  BACK = DIR + '/backdrop',
  GLASS = BACK + '/glass';
const LIMITS = { file: 1024 * 1024, icons: 300, backdrop: 1536 * 1024, glass: 256 * 1024, backdrops: 300 };
const PAIR_PORT = 8794, // after the Android box page (8793)
  PAIR_MS = 15 * 60 * 1000;
const LIVE = '__live';
const ID = /^[\w-][\w.-]{0,127}$/; // an app id, as apps.js checks it: never starting with a dot
const TYPES = ['png', 'jpg', 'webp'];
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

// the custom picture of an app, or ''
function find(id) {
  if (!ID.test(String(id || ''))) return '';
  for (const d of [TILE, DIR])
    for (const x of TYPES) {
      const f = d + '/' + id + '.' + x;
      if (fs.existsSync(f)) return f;
    }
  return '';
}
const isTile = f => f.indexOf(TILE + '/') === 0;
const mime = f => MIME[f.split('.').pop()] || 'image/png';
// {app id: {v, tile}} of every custom picture; the version is the file's time, so a new picture gets a new one
function versions() {
  const out = {};
  [DIR, TILE].forEach(d => {
    let names = [];
    try {
      names = fs.readdirSync(d);
    } catch (_) {}
    names.forEach(n => {
      const m = /^(.+)\.(png|jpg|webp)$/.exec(n);
      if (!m || !ID.test(m[1])) return;
      try {
        out[m[1]] = { v: Math.round(fs.statSync(d + '/' + n).mtimeMs), tile: d === TILE };
      } catch (_) {}
    });
  });
  return out;
}
// the app's own icon again; true when there was a picture
function remove(id) {
  if (!ID.test(String(id || ''))) return false;
  let gone = false;
  [DIR, TILE].forEach(d =>
    TYPES.forEach(x => {
      try {
        fs.unlinkSync(d + '/' + id + '.' + x);
        gone = true;
      } catch (_) {}
    })
  );
  return gone;
}
// keep a picture for an app, as Full tile (tile) or as Icon: '' when it worked, else why not
function set(id, b, tile) {
  if (!ID.test(String(id || ''))) return 'not an app';
  if (!b || !b.length) return 'no picture';
  if (b.length > LIMITS.file) return 'the picture is larger than 1 MB';
  const x = imageType(b);
  if (!x) return 'only JPEG, PNG or WebP pictures';
  if (!find(id) && Object.keys(versions()).length >= LIMITS.icons) return 'at most ' + LIMITS.icons + ' icons';
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR);
  if (tile && !fs.existsSync(TILE)) fs.mkdirSync(TILE);
  remove(id);
  const f = (tile ? TILE : DIR) + '/' + id + '.' + x;
  fs.writeFileSync(f + '.part', b);
  fs.renameSync(f + '.part', f);
  return '';
}

// ---- backdrops (Top Shelf): a 16:9 picture per app that Home shows behind the dock while the app is focused there, and a heavily
// blurred copy of it made on the phone (the glass), shown behind the app grid. One file each:
//   D/icons/backdrop/<app id>.<jpg|png|webp>   the picture, scaled on the phone to 3840 or 1920 wide (Wallpapers' Picture size)
//   D/icons/backdrop/glass/<app id>.jpg         the blurred copy, small (the TV scales it up, which keeps it soft)
function findBackdrop(id) {
  if (!ID.test(String(id || ''))) return '';
  for (const x of TYPES) {
    const f = BACK + '/' + id + '.' + x;
    if (fs.existsSync(f)) return f;
  }
  return '';
}
function findGlass(id) {
  const f = GLASS + '/' + id + '.jpg';
  return ID.test(String(id || '')) && fs.existsSync(f) ? f : '';
}
// {app id: {v, g}} of every backdrop: v the picture's version (its file time), g 1 when it has its glass copy
function backdrops() {
  const out = {};
  let names = [];
  try {
    names = fs.readdirSync(BACK);
  } catch (_) {}
  names.forEach(n => {
    const m = /^(.+)\.(png|jpg|webp)$/.exec(n);
    if (!m || !ID.test(m[1])) return;
    try {
      out[m[1]] = Object.assign({ v: Math.round(fs.statSync(BACK + '/' + n).mtimeMs) }, findGlass(m[1]) ? { g: 1 } : {});
    } catch (_) {}
  });
  return out;
}
// the app's backdrop and its glass copy gone; true when there was one
function removeBackdrop(id) {
  if (!ID.test(String(id || ''))) return false;
  let gone = false;
  TYPES.forEach(x => {
    try {
      fs.unlinkSync(BACK + '/' + id + '.' + x);
      gone = true;
    } catch (_) {}
  });
  try {
    fs.unlinkSync(GLASS + '/' + id + '.jpg');
  } catch (_) {}
  return gone;
}
function keep(f, b) {
  fs.writeFileSync(f + '.part', b);
  fs.renameSync(f + '.part', f);
}
// keep a backdrop for an app: '' when it worked, else why not. A new picture drops the old glass copy, which belongs to the old one.
function setBackdrop(id, b) {
  if (!ID.test(String(id || ''))) return 'not an app';
  if (!b || !b.length) return 'no picture';
  if (b.length > LIMITS.backdrop) return 'the picture is larger than 1.5 MB';
  const x = imageType(b);
  if (!x) return 'only JPEG, PNG or WebP pictures';
  if (!findBackdrop(id) && Object.keys(backdrops()).length >= LIMITS.backdrops) return 'at most ' + LIMITS.backdrops + ' backdrops';
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR);
  if (!fs.existsSync(BACK)) fs.mkdirSync(BACK);
  removeBackdrop(id);
  keep(BACK + '/' + id + '.' + x, b);
  return '';
}
// the blurred copy of an app's backdrop, sent right after the picture: a JPEG, only for an app that has a backdrop
function setGlass(id, b) {
  if (!ID.test(String(id || ''))) return 'not an app';
  if (!findBackdrop(id)) return 'no backdrop for this app';
  if (!b || !b.length) return 'no picture';
  if (b.length > LIMITS.glass) return 'the blurred copy is larger than 256 KB';
  if (imageType(b) !== 'jpg') return 'the blurred copy must be a JPEG';
  if (!fs.existsSync(GLASS)) fs.mkdirSync(GLASS);
  keep(GLASS + '/' + id + '.jpg', b);
  return '';
}

function create(ctx) {
  const config = ctx.config;
  // the apps a picture can be chosen for: the installed apps (not the inputs on Home), by name; lang: the phone's language, for the
  // name of the Live TV tile (the apps have their own names)
  async function apps(lang) {
    const a = ctx.feature && ctx.feature('apps');
    const list = a ? await a.apps() : [];
    const out = list.filter(x => !x.input);
    // Home's Live TV tile (the id __live) can have a picture of its own too, while Live TV is on
    if (!(config.options && config.options().liveTv === false)) out.push({ id: LIVE, title: i18n.tr(lang || 'en', 'Live TV') });
    return out.sort((p, q) => String(p.title).localeCompare(String(q.title)));
  }
  // the picture an app shows now: its custom one, else its own
  function sendIcon(res, a) {
    let f = find(a.id);
    if (!f && a.icon && a.folder) {
      const own = path.join(a.folder, a.icon);
      if (path.resolve(own).startsWith(path.resolve(a.folder)) && fs.existsSync(own)) f = own;
    }
    if (!f) return web.notFound(res);
    res.writeHead(200, { 'content-type': mime(f), 'cache-control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  }
  // the picture sizes that fit the tiles of the theme in use, in the screen's pixels: Full tile at the size of a dock tile (the grid's
  // tiles show its middle), Icon square
  function sizes(scale) {
    const th = ctx.feature && ctx.feature('theme');
    const v = (th && th.resolved && th.resolved().vars) || {};
    const n = (k, d) => Math.round((parseFloat(v[k]) || d) * scale);
    // a backdrop fills the screen: as wide as Wallpapers' Picture size (Home is drawn at 3840 x 2160 on a 4K TV)
    const bw = (config.get().wallpapers || {}).size === 'hd' ? 1920 : 3840;
    return {
      tile: { w: n('--dock-w', 408), h: n('--dock-h', 230) },
      grid: { w: n('--tile-w', 151), h: n('--tile-h', 151) },
      icon: 512,
      backdrop: { w: bw, h: (bw * 9) / 16 },
    };
  }

  // ---- the phone page: LAN, short-lived, the code shown on the TV in every request (header x-code) ----
  let pair = null;
  function startPair(app, scale) {
    stopPair();
    const code = String(nc.randomInt(100000, 1000000));
    let bad = 0;
    const srv = http.createServer((req, res) => phone(req, res, code, () => ++bad));
    pair = {
      code,
      srv,
      scale: Math.min(3, Math.max(1, +scale || 1)),
      url: 'http://' + web.lanIp() + ':' + PAIR_PORT,
      until: Date.now() + PAIR_MS,
      timer: setTimeout(stopPair, PAIR_MS),
    };
    // the app chosen on Home comes first on the page
    const out = {
      url: pair.url,
      code,
      qr: pair.url + '/#' + code + (ID.test(app) ? '/' + app : ''),
      seconds: PAIR_MS / 1000,
      sizes: sizes(pair.scale),
    };
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
  function rawBody(req, max, tooLarge) {
    return new Promise((resolve, reject) => {
      const b = [];
      let n = 0;
      req.on('data', c => {
        n += c.length;
        if (n > max) {
          reject(new Error(tooLarge || 'the picture is larger than 1 MB'));
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
      const list = await apps(i18n.lang(req, config.get().lang));
      if (u === '/api/state')
        return json({
          apps: list.map(a => {
            const f = find(a.id);
            return { id: a.id, title: a.title, custom: !!f, tile: !!f && isTile(f), backdrop: !!findBackdrop(a.id) };
          }),
          sizes: sizes(pair ? pair.scale : 1),
        });
      let m = /^\/api\/icon\/([\w.-]+)$/.exec(u);
      if (m && req.method === 'GET') {
        const a = list.find(x => x.id === m[1]);
        return a ? sendIcon(res, a) : web.notFound(res);
      }
      m = /^\/api\/backdrop\/([\w.-]+)$/.exec(u);
      if (m && req.method === 'GET') return sendFile(res, findBackdrop(m[1]));
      if (req.method !== 'POST') return json({ error: 'not found' }, 404);
      // a backdrop, then its blurred copy (/glass), each in its own request
      m = /^\/api\/backdrop\/([\w.-]+?)(\/glass)?$/.exec(u);
      if (m) {
        if (!list.some(x => x.id === m[1])) return json({ error: 'not an app' }, 400);
        const err = m[2]
          ? setGlass(m[1], await rawBody(req, LIMITS.glass, 'the blurred copy is larger than 256 KB'))
          : setBackdrop(m[1], await rawBody(req, LIMITS.backdrop, 'the picture is larger than 1.5 MB'));
        return json(err ? { error: err } : { ok: true }, err ? 400 : 200);
      }
      if (u === '/api/backdrop-reset') {
        const b = await web.body(req, 4096);
        return json({ ok: true, removed: removeBackdrop(String(b.id || '')) });
      }
      m = /^\/api\/upload\/([\w.-]+)$/.exec(u);
      if (m) {
        if (!list.some(x => x.id === m[1])) return json({ error: 'not an app' }, 400);
        const err = set(m[1], await rawBody(req, LIMITS.file), /[?&]tile=1(&|$)/.test(req.url));
        return json(err ? { error: err } : { ok: true }, err ? 400 : 200);
      }
      if (u === '/api/reset') {
        const b = await web.body(req, 4096);
        return json({ ok: true, removed: remove(String(b.id || '')) });
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String(e.message || e) }, 400);
    }
  }

  // a picture as it is, or not found
  function sendFile(res, f) {
    if (!f) return web.notFound(res);
    res.writeHead(200, { 'content-type': mime(f), 'cache-control': 'max-age=86400' });
    fs.createReadStream(f).pipe(res);
  }

  // ---- the service's API ----
  async function handle(req, res, u, body) {
    const json = (o, c) => web.json(res, o, c);
    if (u === '/api/icons/status')
      return json({
        icons: Object.keys(versions()).length,
        backdrops: Object.keys(backdrops()).length,
        limits: LIMITS,
        pair: pair ? { url: pair.url, code: pair.code, until: pair.until } : null,
      });
    // Home's Top Shelf: which apps have a backdrop (and a glass copy), and the pictures; ?v=<version> in the address keeps the cache honest
    if (u === '/api/icons/backdrops') return json({ backdrops: backdrops() });
    const bm = /^\/api\/icons\/backdrop\/([\w.-]+?)(\/glass)?$/.exec(u);
    if (bm && req.method === 'GET') return sendFile(res, bm[2] ? findGlass(bm[1]) : findBackdrop(bm[1]));
    if (req.method !== 'POST') return web.notFound(res);
    const b = await body(req);
    if (u === '/api/icons/pair') return json(b.stop ? (stopPair(), {}) : await startPair(String(b.app || ''), b.scale));
    if (u === '/api/icons/reset') {
      const id = String(b.id || '');
      if (!ID.test(id)) return json({ error: 'not an app' }, 400);
      // an app that already shows its own icon (reset on the phone first) is fine too: the launcher then shows it again
      return json({ ok: true, removed: remove(id) });
    }
    if (u === '/api/icons/backdrop/reset') {
      const id = String(b.id || '');
      if (!ID.test(id)) return json({ error: 'not an app' }, 400);
      return json({ ok: true, removed: removeBackdrop(id) });
    }
    return web.notFound(res);
  }

  // /api/icons/... is answered through the manifest's "routes" (addon.json); apps.js asks for find(), versions() and mime()
  // ---- the tool for the voice assistant and MCP clients ("provides": ["tools"]): which apps have a picture of their own ----
  // (reset deletes the picture, which must then be uploaded again: it is not a tool)
  const TOOL = {
    name: 'icons',
    description: 'App icons chosen on a phone. action list_custom: the apps that show a picture of their own instead of their icon.',
    inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['list_custom'] } }, required: ['action'] },

    group: 'App icons', // the manager's Tools screen
    labels: { list_custom: 'Apps with their own picture' },
  };
  async function callTool(name, args) {
    const bad = m => ({ content: [{ type: 'text', text: String(m) }], isError: true });
    if (name !== 'icons') return bad('unknown tool: ' + name);
    if (!args || args.action !== 'list_custom') return bad('action is list_custom');
    const v = versions(),
      names = {};
    (await apps('en')).forEach(a => (names[a.id] = a.title));
    const list = Object.keys(v).map(id => ({ id, name: names[id] || id, tile: v[id].tile }));
    return { content: [{ type: 'text', text: JSON.stringify(list.length ? list : 'no app has a picture of its own') }], isError: false };
  }
  return { handle, phone, find, versions, mime, backdrops, tools: { list: () => [TOOL], call: callTool } };
}

// the phone page: the apps with their icons, Change and Reset. Change shows a preview of the picture in a dock tile and a grid tile
// of the theme in use, as Full tile (the default: it covers the tile, its middle kept) or as Icon (inside the tile, like the app's own
// icon), and the picture sizes that fit those tiles. Plain script for iOS Safari and Android Chrome; the picture is scaled in the
// browser before it is sent (Full tile: 1024 pixels on the long side, Icon: 512), as JPEG for a photo and as PNG for a picture with
// see-through parts, so a transparent logo stays transparent; such a picture starts as Icon. This also turns an iPhone's HEIC into JPEG
// or PNG. Under each app a backdrop (Top Shelf): previewed as the TV's screen, cut to 16:9 around the middle at Wallpapers' Picture
// size and sent as JPEG under 1.5 MB, followed by its blurred copy (glass()). It is in the phone's language: the fixed text is
// translated here, the script's own texts by t() (i18n.js).
const PHONE_JS = `var code='',want='',cur='',kind='',file=null,alpha=false,mode='tile',S={},$=function(i){return document.getElementById(i)};
/* a text with its %s / %d filled in, in order, then in the page's language */
function fm(s){var a=arguments,n=1;return t(s.replace(/%[sd]/g,function(){return a[n++]}))}
function api(p,b){return new Promise(function(ok,no){var x=new XMLHttpRequest();x.open(b===undefined?'GET':'POST','/api/'+p);x.setRequestHeader('x-code',code);
 x.onload=function(){var j={};try{j=JSON.parse(x.responseText)}catch(e){}if(x.status===403){showLogin(t('Wrong code.'));no(j)}else ok(j)};x.onerror=function(){no({error:t('The TV did not answer. Is the phone on the same Wi-Fi?')})};
 x.send(b===undefined?null:JSON.stringify(b))})}
function msg(t,e){$('msg').innerHTML=t?'<p class="m'+(e?' e':'')+'"></p>':'';if(t)$('msg').firstChild.textContent=t}
function showLogin(t){$('login').className='';$('main').className='hide';$('sum').textContent=t||''}
function px(z){return z.w+' × '+z.h}
function state(){return api('state').then(function(s){S=s;$('login').className='hide';$('main').className='';$('sum').textContent=t('Choose an app, then a picture.');
 var z=s.sizes;if(z){$('sz').textContent=fm('Best size for Full tile: %s pixels. Edges that don’t fit are trimmed, keeping the middle.',px(z.tile));$('sz2').textContent=fm('Best size for Icon: %s pixels. Ideally with a transparent background.',z.icon+' × '+z.icon);
  if(z.backdrop)$('sz3').textContent=fm('Backdrop: %s pixels (16:9), shown behind the dock while the app is focused there. Edges that don’t fit are trimmed, keeping the middle.',px(z.backdrop))}
 var list=(s.apps||[]).slice();list.sort(function(a,b){return (b.id===want)-(a.id===want)});
 var h='';list.forEach(function(a){h+='<div class="ap'+(a.id===want?' on':'')+'"><div class=r1><img alt="" data-i="'+a.id+'"><span></span><button class=p data-c="'+a.id+'"></button>'+(a.custom?'<button data-r="'+a.id+'"></button>':'')+'</div>'+
  '<div class=r2><div class=bt>'+(a.backdrop?'<img alt="" data-b="'+a.id+'">':'')+'</div><small></small><button data-bc="'+a.id+'"></button>'+(a.backdrop?'<button data-br="'+a.id+'"></button>':'')+'</div></div>'});
 $('list').innerHTML=h;var rows=$('list').children;
 list.forEach(function(a,i){rows[i].querySelector('span').textContent=a.title;rows[i].querySelector('[data-c]').textContent=t('Change');var r=rows[i].querySelector('[data-r]');if(r)r.textContent=t('Reset');
  rows[i].querySelector('small').textContent=t('Backdrop');rows[i].querySelector('[data-bc]').textContent=a.backdrop?t('Change'):t('Add');r=rows[i].querySelector('[data-br]');if(r)r.textContent=t('Reset')});
 thumbs()})}
function thumbs(){[].forEach.call($('list').querySelectorAll('img[data-i],img[data-b]'),function(im){var b=im.getAttribute('data-b'),x=new XMLHttpRequest();x.open('GET',b?'/api/backdrop/'+b:'/api/icon/'+im.getAttribute('data-i'));x.setRequestHeader('x-code',code);x.responseType='blob';
 x.onload=function(){if(x.status===200)im.src=URL.createObjectURL(x.response)};x.send()})}
/* the preview: the picture in a dock tile and a grid tile of the theme's shape, as the TV will show it */
function preview(){var z=S.sizes||{tile:{w:16,h:10},grid:{w:1,h:1}};$('td').style.paddingTop=(z.tile.h/z.tile.w*100)+'%';$('tg').style.paddingTop=(z.grid.h/z.grid.w*100)+'%';
 $('td').className=$('tg').className='t '+mode;$('mt').className=mode==='tile'?'on':'';$('mi').className=mode==='icon'?'on':'';
 $('mh').textContent=mode==='tile'?t('Full tile: the picture fills the tile; its middle is kept. Any photo works.'):t('Icon: inside the tile, like the app’s own icon. Best for a logo on a transparent background.')}
/* does the picture have see-through parts? Then it is a logo: it starts as Icon, and it is sent as PNG so it stays see-through */
function hasAlpha(im){try{var c=document.createElement('canvas');c.width=c.height=64;var g=c.getContext('2d');g.drawImage(im,0,0,64,64);
 var d=g.getImageData(0,0,64,64).data;for(var i=3;i<d.length;i+=4)if(d[i]<250)return true}catch(e){}return false}
function pick(f){file=f;alpha=false;mode='tile';var u=URL.createObjectURL(f);$('td').firstChild.src=$('tg').firstChild.src=u;
 var a=(S.apps||[]).filter(function(x){return x.id===cur})[0];$('pvt').textContent=a?a.title:'';$('list').className='hide';$('pv').className='';msg('');preview();window.scrollTo(0,0);
 var im=new Image();im.onload=function(){if(file===f&&hasAlpha(im)){alpha=true;mode='icon';preview()}};im.src=u}
function closePv(){$('pv').className=$('bp').className='hide';$('list').className='';file=null}
/* a backdrop: the preview is the TV's screen, 16:9, the picture's middle kept, with the dock over it */
function pickBackdrop(f){file=f;$('bv').firstChild.src=URL.createObjectURL(f);var a=(S.apps||[]).filter(function(x){return x.id===cur})[0];
 $('bpt').textContent=a?a.title:'';$('list').className='hide';$('bp').className='';msg('');window.scrollTo(0,0)}
function canvas(w,h){var c=document.createElement('canvas');c.width=Math.max(1,Math.round(w));c.height=Math.max(1,Math.round(h));return c}
function jpeg(c,q){return new Promise(function(ok){c.toBlob(function(b){ok(b)},'image/jpeg',q)})}
/* cut to 16:9 around the middle, at most W wide (never wider than the picture), as JPEG under 1.5 MB: lower quality first, then smaller */
function backdrop(im,W){var w=im.naturalWidth,h=im.naturalHeight,sw=w,sh=w*9/16;if(sh>h){sh=h;sw=h*16/9}
 var c=canvas(Math.min(W,sw),Math.min(W,sw)*9/16);c.getContext('2d').drawImage(im,(w-sw)/2,(h-sh)/2,sw,sh,0,0,c.width,c.height);return c}
function under(c,q){return jpeg(c,q).then(function(b){if(b&&b.size<=1500000)return b;if(q>0.65)return under(c,q-0.1);
 var d=canvas(c.width*0.75,c.height*0.75);d.getContext('2d').drawImage(c,0,0,d.width,d.height);return under(d,0.85)})}
/* one box blur of radius R along every row (rowsFirst) or every column of the picture, its edges held */
function pass(d,W,H,R,rowsFirst){var n=rowsFirst?W:H,m=rowsFirst?H:W,b=new Float32Array(n*3),k=2*R+1,i,j,o,ch,sum;
 for(var a=0;a<m;a++){for(i=0;i<n;i++){o=4*(rowsFirst?a*W+i:i*W+a);b[i*3]=d[o];b[i*3+1]=d[o+1];b[i*3+2]=d[o+2]}
  for(ch=0;ch<3;ch++){sum=0;for(j=-R;j<=R;j++)sum+=b[Math.min(n-1,Math.max(0,j))*3+ch];
   for(i=0;i<n;i++){d[4*(rowsFirst?a*W+i:i*W+a)+ch]=sum/k;sum+=b[Math.min(n-1,i+R+1)*3+ch]-b[Math.max(0,i-R)*3+ch]}}}}
/* the glass: the picture shrunk in halves to 160 × 90 and blurred very heavily (three box blurs make a Gaussian), sent at 480 × 270;
   the TV scales it up to the screen, which keeps it soft. Made here because the TV must not blur */
function glass(c){var s=c;while(s.width>320){var hv=canvas(s.width/2,s.height/2);hv.getContext('2d').drawImage(s,0,0,hv.width,hv.height);s=hv}
 var W=160,H=90,g=canvas(W,H),x=g.getContext('2d');x.drawImage(s,0,0,W,H);var id=x.getImageData(0,0,W,H);
 for(var p=0;p<3;p++){pass(id.data,W,H,6,true);pass(id.data,W,H,6,false)}x.putImageData(id,0,0);
 var o=canvas(480,270);o.getContext('2d').drawImage(g,0,0,480,270);return jpeg(o,0.85)}
function post(p,b){return new Promise(function(ok){var x=new XMLHttpRequest();x.open('POST',p);x.setRequestHeader('x-code',code);x.setRequestHeader('content-type','image/jpeg');
 x.onload=function(){var j={};try{j=JSON.parse(x.responseText)}catch(e){}ok(x.status===200?{}:{error:j.error||'refused'})};x.onerror=function(){ok({error:'The TV did not answer.'})};x.send(b)})}
function sendBackdrop(){var id=cur,f=file;if(!f||!id)return;msg(t('Sending…'));var u=URL.createObjectURL(f),im=new Image();
 im.onerror=function(){msg(t('This picture cannot be read here. Try a JPEG or PNG.'),1)};
 im.onload=function(){URL.revokeObjectURL(u);var c=backdrop(im,(S.sizes&&S.sizes.backdrop&&S.sizes.backdrop.w)||3840);
  under(c,0.88).then(function(b){return post('/api/backdrop/'+id,b)}).then(function(r){if(r.error)throw r;return glass(c)}).then(function(g){return post('/api/backdrop/'+id+'/glass',g)})
  .then(function(r){if(r.error)throw r;closePv();msg(t('Backdrop changed. Go back to Home on the TV to see it.'));state()},function(r){msg(t((r&&r.error)||'refused'),1)})};im.src=u}
/* scale in the browser: Full tile to 1024 pixels on the long side, Icon to 512. A photo goes as JPEG; a picture with see-through parts as
   PNG, made smaller until it fits in 1 MB; an Icon without them as PNG, or JPEG when the PNG would be too large. A file the browser cannot
   draw is sent as it is */
function scaled(f,m,al){return new Promise(function(ok){var u=URL.createObjectURL(f),im=new Image();im.onload=function(){var w=im.naturalWidth,h=im.naturalHeight,s=Math.min(1,(m==='tile'?1024:512)/Math.max(w,h));URL.revokeObjectURL(u);
 (function at(k){var c=document.createElement('canvas');c.width=Math.max(1,Math.round(w*k));c.height=Math.max(1,Math.round(h*k));c.getContext('2d').drawImage(im,0,0,c.width,c.height);
  if(!al&&m==='tile')return c.toBlob(function(j){ok(j||f)},'image/jpeg',0.9);
  c.toBlob(function(b){if(b&&b.size<=1000000)ok(b);else if(al&&Math.max(c.width,c.height)>256)at(k*0.75);else c.toBlob(function(j){ok(j||f)},'image/jpeg',0.9)},'image/png')})(s)};
 im.onerror=function(){URL.revokeObjectURL(u);ok(f)};im.src=u})}
$('f').onchange=function(){var f=this.files[0];this.value='';if(f&&cur){if(kind==='b')pickBackdrop(f);else pick(f)}};
$('bs').onclick=sendBackdrop;
$('bc').onclick=closePv;
$('mt').onclick=function(){mode='tile';preview()};
$('mi').onclick=function(){mode='icon';preview()};
$('pc').onclick=closePv;
$('ps').onclick=function(){var id=cur,m=mode;if(!file||!id)return;msg(t('Sending…'));
 scaled(file,m,alpha).then(function(b){var x=new XMLHttpRequest();x.open('POST','/api/upload/'+id+(m==='tile'?'?tile=1':''));x.setRequestHeader('x-code',code);x.setRequestHeader('content-type',b.type||'application/octet-stream');
  x.onload=function(){var j={};try{j=JSON.parse(x.responseText)}catch(e){}if(x.status===200){closePv();msg(t('Icon changed. Go back to Home on the TV to see it.'));state()}else msg(t(j.error||'refused'),1)};
  x.onerror=function(){msg(t('The TV did not answer.'),1)};x.send(b)})};
$('list').onclick=function(e){var c=e.target.getAttribute('data-c'),r=e.target.getAttribute('data-r'),bc=e.target.getAttribute('data-bc'),br=e.target.getAttribute('data-br');
 if(c||bc){cur=c||bc;kind=bc?'b':'';$('f').click()}
 if(r)api('reset',{id:r}).then(function(){msg(t('Icon reset.'));state()});
 if(br)api('backdrop-reset',{id:br}).then(function(){msg(t('Backdrop reset.'));state()})};
$('go').onclick=function(){code=$('code').value.trim();state().catch(function(){})};
var hh=(location.hash||'').slice(1).split('/');code=hh[0]||'';want=hh[1]||'';if(/^\\d{6}$/.test(code))state().catch(function(){});else showLogin();
`;
function phonePage(lang) {
  const T = s => web.esc(i18n.tr(lang, s));
  return (
    `<!doctype html><html lang=${lang}><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${T('App icons')}</title>
<style>*{box-sizing:border-box}body{font:17px -apple-system,system-ui,sans-serif;background:#0d0e12;color:#eee;margin:0;padding:20px 16px 60px;max-width:640px;margin:0 auto}
h1{font-size:26px;margin:4px 0 4px}h2{font-size:20px;margin:18px 0 8px}p{color:#aaa;margin:6px 0}.m{padding:12px 14px;border-radius:12px;background:#1d2a1f;margin:12px 0}.m.e{background:#3a1717}
button,input{font:inherit;display:block;width:100%;padding:14px;border-radius:12px;border:1px solid #333;background:#1a1b21;color:#eee;margin:8px 0;text-align:center}
button.p{background:#f5f6f8;color:#111;font-weight:600;border:0}input{text-align:left}.hide{display:none}small{color:#888}
.ap{padding:10px;border-radius:14px;background:#15161b;margin:8px 0}.ap.on{outline:2px solid #f5f6f8}.r1,.r2{display:flex;align-items:center;gap:12px}
.r2{margin-top:8px}.r2 small{flex:1}.bt{width:64px;height:36px;border-radius:6px;overflow:hidden;background:#22232a;flex:none}.bt img{width:100%;height:100%;object-fit:cover;display:block}
.bv{position:relative;padding-top:56.25%;overflow:hidden;border-radius:10px;background:#000;margin:12px 0}.bv img{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover}
.bv i{position:absolute;left:4%;right:4%;bottom:6%;height:20%;border-radius:12px;background:rgba(255,255,255,.14);box-shadow:inset 0 0 0 1px rgba(255,255,255,.35)}
.r1 img{width:64px;height:64px;object-fit:contain;border-radius:12px;background:#22232a;flex:none}.r1 span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ap button{width:auto;margin:0;padding:10px 14px;flex:none}
.modes{display:flex;gap:8px}.modes button{margin:0}.modes .on{background:#f5f6f8;color:#111;font-weight:600}
.tiles{display:flex;gap:12px;align-items:flex-end;margin:12px 0}.tiles>div{text-align:center}.tiles small{display:block;margin-top:4px}
.t{position:relative;overflow:hidden;border-radius:18px;background:#3a3b42}.t img{position:absolute;max-width:none}
.t.tile img{left:0;top:0;width:100%;height:100%;object-fit:cover}
.t.icon img{left:50%;top:50%;transform:translate(-50%,-50%);height:56%;width:65%;object-fit:contain}#tg.icon img{height:64%;width:75%}</style>
<h1>${T('App icons')}</h1><p id=sum>${T('Connecting to the TV…')}</p><p><small id=sz></small><br><small id=sz2></small><br><small id=sz3></small></p>
<div id=login class=hide><p>${T('Enter the code shown on the TV.')}</p><input id=code inputmode=numeric autocomplete=one-time-code><button class=p id=go>${T('Continue')}</button></div>
<div id=main class=hide><div id=msg></div><input id=f type=file accept="image/*" class=hide>
<div id=pv class=hide><h2 id=pvt></h2><div class=modes><button id=mt>${T('Full tile')}</button><button id=mi>${T('Icon')}</button></div><p id=mh></p>
<div class=tiles><div style="width:62%"><div class=t id=td><img alt=""></div><small>${T('Dock')}</small></div><div style="width:34%"><div class=t id=tg><img alt=""></div><small>${T('App grid')}</small></div></div>
<button class=p id=ps>${T('Send')}</button><button id=pc>${T('Cancel')}</button></div>
<div id=bp class=hide><h2 id=bpt></h2><p>${T('Backdrop: shown behind the dock on Home while this app is focused there (Top Shelf).')}</p><div class=bv id=bv><img alt=""><i></i></div>
<button class=p id=bs>${T('Send')}</button><button id=bc>${T('Cancel')}</button></div>
<div id=list></div></div>
` +
    i18n.script(lang, PHONE_JS) +
    '<script>' +
    PHONE_JS +
    '</script></html>'
  );
}

module.exports = {
  create,
  find,
  versions,
  set,
  remove,
  mime,
  findBackdrop,
  findGlass,
  backdrops,
  setBackdrop,
  setGlass,
  removeBackdrop,
  LIMITS,
  PAIR_PORT,
};
