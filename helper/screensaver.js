// The screen saver: our page in place of LG's screen saver app (scripts/20-cleanyourtv-screensaver, docs/screensaver.md). This module
// serves that page, closes it again, and opens it over an idle launcher when tvpowerd did not:
//   GET  /api/screensaver          {replaced, running, photos, every, style, show, films}
//   GET  /api/screensaver/photos?cc=<country>   {photos, credits, from, every, slides, style, show}   what Home has behind it
//        (background() below): photos are library ids ('u/<id>', 's/<add-on>/<id>', 'l/<add-on>') or paths on this service; from:
//        scenes, wallpapers, theme; slides: the photos in order, a portrait photo paired with the next one (slides()); mixed: the
//        order is Wallpapers' own (shared with Home): the next photos only, reported with POST /api/screensaver/shown {ids} as they
//        are drawn, asked for again at the end; else a shuffled order of all;
//        style: kenburns or classic; show: what to show, aerials, photos or both (resolved: photos when no add-on has films)
//   POST /api/screensaver/set {style, show}   the screen saver's settings (config.json screensaver: written only when not the default)
//   GET  /api/screensaver/scene/<night|golden|water|fog|dawn>   a couch scene of the launcher (app/scene-<id>.jpg)
//   GET  /api/screensaver/live/<add-on>   {url, credit}: the photo a live source (Unsplash) gave Home last, so the saver shows the same
//   GET  /api/screensaver/videos   {videos: [{id, url, title}], from}: the films of the first add-on that provides "videos" and has
//        some (the Aerials add-on); the page plays them and falls back to the photos above when there are none or they do not play
//        and lang, clock: the language and the clock format Home uses (the Language setting, else the TV's menu language; auto,
//        12 or 24)
//   POST /api/screensaver/active   {returnValue}   the launcher reports a key: the TV is in use, do not open the page over it
//   POST /api/screensaver/dismiss  {returnValue}   close the page: the app that was on screen comes back
// The page keeps LG's own screen-saver window type, and a page that stayed up would keep the remote. The page closes itself on the
// first key; this module closes it as well when the TV is back to Active for a minute while the page is still listed (the system ended
// the screen saver by itself, which stops the program sam started but not necessarily the page in webapp-mgr).
const fs = require('fs');
const P = require('./paths'),
  web = require('./web'),
  i18n = require('./i18n'),
  { isLandscape } = require('./wallpapers');

const SA = 'com.webos.app.screensaver',
  WEBMGR = 'luna://com.palm.webappmanager/',
  AM = 'luna://com.webos.applicationManager/',
  CHECK_MS = 10000,
  GRACE_MS = 60000,
  EVERY_S = { classic: 25, kenburns: 16 }; // the seconds each photo stays on the page, by style

// is LG's screen saver replaced now (the page's folder mounted over its app)?
function replaced() {
  try {
    return fs.readFileSync(P.PROC + '/mounts', 'utf8').indexOf(' ' + P.SCREENSAVER_APP + ' ') >= 0;
  } catch (_) {
    return false;
  }
}
// Can this TV have our screen saver? Where LG's screen saver is not a native program (saverTakeover 'mount') and the Home takeover is
// the folder mount, whose app manager restart also reads the screen saver's folder (scripts/20-cleanyourtv-screensaver). The Home
// stand-in (LG's native Home) does no such restart, so a TV with it keeps LG's screen saver in this version.
function supported(profile, homeMethod) {
  const p = profile || {};
  return p.saverTakeover === 'mount' && (p.homeTakeover === 'mount' || homeMethod === 'mount');
}

// May this module open the page itself? Only when the launcher has been in front for IDLE_MS since the last key it reported: "Home is
// in front" alone is not "idle" — a TV that is browsed with the remote is Home in front all evening, and LG's own screen saver only
// starts when no key arrives. A launcher that never reported anything (LG's Home in front, a launcher from before this endpoint) is
// no reason to open the page: then tvpowerd's own timer is the way in.
const IDLE_MS = 120000;
// the couch scenes that ship with the launcher (app/scene-<id>.jpg, the list in app/src/js/scenes.js): the page is another app and
// cannot load the launcher's files by their relative names, so this module hands them out (only these names)
const COUCH = ['night', 'golden', 'water', 'fog', 'dawn'];
// The order of the photos: a landscape photo is a slide of its own; a portrait photo waits for the next portrait one and the two
// share a slide, side by side, where the second one came; a portrait photo left over at the end is a slide alone (shown over a blurred
// copy of itself). A size that is not known counts as landscape (a live source, a scene, the theme's wallpaper).
//   [{a}, {a, b, portrait: true}, {a, portrait: true}]
function slides(ids, sizes) {
  const z = sizes || {},
    out = [];
  let held = null;
  for (const id of ids) {
    if (isLandscape(z[id])) out.push({ a: id });
    else if (held === null) held = id;
    else {
      out.push({ a: held, b: id, portrait: true });
      held = null;
    }
  }
  if (held !== null) out.push({ a: held, portrait: true });
  return out;
}
function shuffle(a, rnd) {
  const r = rnd || Math.random;
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1)),
      t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}
const PLAN = 60;
const STYLES = ['kenburns', 'classic'],
  SHOWS = ['aerials', 'photos', 'both'];
function mayOpen(now, homeSince, activeAt) {
  return !!activeAt && now - Math.max(homeSince, activeAt) >= IDLE_MS;
}
// a film an add-on hands over, checked: an id, a plain http(s) address the page can put in a <video> (no quotes, spaces or brackets),
// the place as one short line, and the decoder a film needs where it is not one every TV has (type: a MIME type with codecs, and at
// most four numbers such as framerate=240; the page asks the TV with MediaSource.isTypeSupported and passes over a film it cannot
// decode); at most 300
const VIDEO_ID = /^[\w.-]{1,64}$/,
  VIDEO_URL = /^https?:\/\/[\w.-]+(?::\d{1,5})?\/[\w\/.%~+-]{1,300}$/,
  VIDEO_TYPE = /^video\/(?:mp4|webm); codecs="[\w.]{1,60}"(?:; [a-z]{1,16}=\d{1,6}){0,4}$/,
  VIDEO_MAX = 300;
function cleanVideos(l) {
  const seen = {};
  return (Array.isArray(l) ? l : [])
    .filter(
      v => v && typeof v === 'object' && VIDEO_ID.test(String(v.id)) && VIDEO_URL.test(String(v.url)) && !seen[v.id] && (seen[v.id] = 1)
    )
    .slice(0, VIDEO_MAX)
    .map(v => {
      const o = {
        id: String(v.id),
        url: String(v.url),
        title: String(v.title || '')
          .replace(/[\u0000-\u001f\u007f]/g, ' ')
          .slice(0, 80),
      };
      if (VIDEO_TYPE.test(String(v.type || ''))) o.type = String(v.type);
      return o;
    });
}

function create(ctx) {
  const { luna, config } = ctx;
  const wp = () => ctx.feature('wallpapers');
  // The clock and the date as Home has them (app/src/js/clock.js): the language and the Clock setting. The language is resolved here,
  // never '': the Language setting, else the TV's menu language (settingsservice localeInfo, locales.UI: a TV can have its menus in
  // French while its TV locale, which the page's own webOSSystem.locale gives, is en-GB), else the language Home reported, else English.
  let uiLocale = '',
    uiAt = 0;
  async function lang() {
    const set = String((config.get() || {}).lang || '');
    if (set) return set;
    if (!uiLocale || Date.now() - uiAt > 600000) {
      try {
        const r = await luna('luna://com.webos.settingsservice/getSystemSettings', { keys: ['localeInfo'] });
        const ui = r && r.settings && r.settings.localeInfo && r.settings.localeInfo.locales && r.settings.localeInfo.locales.UI;
        if (typeof ui === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(ui)) {
          uiLocale = ui;
          uiAt = Date.now();
        }
      } catch (_) {}
    }
    return uiLocale || i18n.screen() || 'en';
  }
  const clock = () => (['12', '24'].indexOf((config.get() || {}).clock) >= 0 ? config.get().clock : 'auto');
  // the settings: style (kenburns, the default, or classic) and show (aerials, photos or both; '' the default: aerials when an add-on
  // has films, else photos)
  const settings = () => {
    const c = (config.get() || {}).screensaver || {};
    return { style: STYLES.indexOf(c.style) >= 0 ? c.style : 'kenburns', show: SHOWS.indexOf(c.show) >= 0 ? c.show : '' };
  };
  function set(b) {
    config.update('screensaver', c => {
      const s = Object.assign({}, c.screensaver || {});
      if (STYLES.indexOf(b.style) >= 0) {
        if (b.style === 'kenburns') delete s.style;
        else s.style = b.style;
      }
      if (b.show === '' || SHOWS.indexOf(b.show) >= 0) {
        if (!b.show) delete s.show;
        else s.show = b.show;
      }
      if (Object.keys(s).length) c.screensaver = s;
      else delete c.screensaver;
    });
  }
  // what the page shows: photos when no add-on has films, else the setting (Aerials by default)
  const showNow = films => (!films ? 'photos' : settings().show || 'aerials');
  // the sizes of the library's photos, for the pairing of portrait ones
  const sizesOf = ids => {
    const w = wp();
    try {
      return w && w.sizes ? w.sizes(ids.filter(id => /^[us]\//.test(id))) : {};
    } catch (_) {
      return {};
    }
  };
  // the library as Home shows it: uploads (u/<id>) and the photos of source add-ons (s/<add-on>/<id>), which the page loads from
  // /api/wallpapers/photo/, and live sources (l/<add-on>, Unsplash), whose current photo the page asks /api/wallpapers/live/<add-on>
  // for, as Home's wall.js does. An id of another kind is left out: the page would not know how to show it.
  const photos = () => {
    const w = wp();
    try {
      return w ? w.list().filter(id => /^[usl]\//.test(id)) : [];
    } catch (_) {
      return [];
    }
  };
  // What Home has behind it now, in Home's own order (app/src/js/scenes.js, wall.js, theme.js), so the saver shows the same:
  //   1. the theme's scenes: an add-on's scenes where one provides them (Seasons), else the five landscapes of the launcher (couch),
  //      or the theme's own scenes (custom); they take the place of the wallpaper and of Wallpapers, as on Home, unless the theme
  //      lets them yield (effects.scenesYield: scenes.yield) and Wallpapers is on with photos
  //   2. Wallpapers switched on and something in the library: the library (uploads, source add-ons, live sources)
  //   3. the theme's wallpaper
  //   4. nothing: the clock on black
  // An entry is a library id, or a path on this service that the page loads as it is; credits holds the line a photo comes with.
  async function background(cc) {
    const c = config.get() || {};
    const th = ctx.feature('theme');
    let t = null;
    try {
      t = th ? th.resolved() : null;
    } catch (_) {}
    // with effects.scenesYield the scenes step aside for Wallpapers when it is on with photos, as on Home (app/src/js/scenes.js)
    const lib = c.wall && c.wall.on ? photos() : [];
    if (t && t.scenes && !(t.scenes.yield && lib.length)) {
      if (t.scenes.set === 'custom' && Array.isArray(t.scenes.lib) && t.scenes.lib.length)
        return {
          photos: t.scenes.lib.map(s => '/api/theme/scene/' + t.scenes.id + '/' + s.image),
          credits: {},
          from: 'scenes',
        };
      const sc = ctx.feature('scenes');
      try {
        const r = sc ? await sc.list(cc) : null;
        if (r && r.addon && r.scenes && r.scenes.length) {
          const credits = {};
          const list = r.scenes.map(s => {
            const p = '/api/scenes/photo/' + r.addon + '/' + s.id + '/image';
            if (s.credit) credits[p] = String(s.credit);
            return p;
          });
          return { photos: list, credits, from: 'scenes' };
        }
      } catch (_) {}
      return { photos: COUCH.map(id => '/api/screensaver/scene/' + id), credits: {}, from: 'scenes' };
    }
    // Wallpapers on with an empty library: Home's wall.js switches its layer off (sync() -> off()) and the theme's wallpaper shows
    if (lib.length) return { photos: lib, credits: {}, from: 'wallpapers' };
    if (t && t.wallpaper)
      return { photos: ['/api/theme/wallpaper/' + t.wallpaper.id + '/' + t.wallpaper.file], credits: {}, from: 'theme' };
    return { photos: [], credits: {}, from: '' };
  }
  // the photos in the order they come: the library in Wallpapers' order (wallmix.js), shared with Home: the next PLAN photos, which the
  // page reports as it draws them and asks for again when it reaches the end; scenes and the theme's wallpaper shuffled
  const mixed = b => b.from === 'wallpapers' && !!(wp() && wp().plan);
  const order = b => (mixed(b) ? wp().plan(PLAN) : shuffle(b.photos.slice()));
  // the films of the first running, switched-on add-on that provides "videos" and has some
  async function videos() {
    const a = ctx.feature && ctx.feature('addons');
    const list = a && a.providers ? a.providers('videos').filter(p => p.mod.videos && typeof p.mod.videos.list === 'function') : [];
    for (const p of list) {
      try {
        const v = cleanVideos(await p.mod.videos.list());
        if (v.length) return { videos: v, from: p.id };
      } catch (e) {
        console.error('screensaver: add-on ' + p.id + ': ' + ((e && e.message) || e));
      }
    }
    return { videos: [], from: '' };
  }
  async function running() {
    const r = await luna(WEBMGR + 'listRunningApps', {});
    return JSON.stringify(r).indexOf('"' + SA + '"') >= 0;
  }
  async function close() {
    // killApp is what closes a page webapp-mgr opened for us; closeByAppId is the app manager's own way (webOS 6 needed it for Home).
    // Each is tried on its own: one that fails must not keep the other from running.
    try {
      await luna(WEBMGR + 'killApp', { appId: SA });
    } catch (_) {}
    try {
      await luna(AM + 'closeByAppId', { id: SA });
    } catch (_) {}
    return true;
  }

  // The way out of a page the system left behind, and a fallback way back in. With LG's own window type (`screenSaver`) tvpowerd
  // arms and relaunches the saver by itself (61 s in the measured cycles), but it did not fire in one cycle out of three, so the
  // service also opens the page — over an idle launcher only (mayOpen), which the launcher page keeps it informed about.
  const HOME = 'com.webos.app.home';
  let since = 0,
    homeSince = 0,
    tickN = 0,
    activeAt = 0,
    saidQuiet = false;
  // a key on the launcher (or the key that dismissed the page): the TV is in use now
  function active() {
    activeAt = Date.now();
    saidQuiet = false;
  }
  // One check at a time: a check whose luna calls are slow (the app manager restarting) must not be joined by the next tick.
  let busy = false,
    wasUp = false,
    ownPage = false, // the page that is up was opened by this service (the idle fallback), not by tvpowerd
    strikes = 0; // readings in a row that say the TV is on an app again (the safety close)
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      await step();
    } finally {
      busy = false;
    }
  }
  async function step() {
    // nothing to watch when LG's screen saver is not replaced: no luna call every ten seconds on those TVs
    if (!replaced()) {
      since = 0;
      homeSince = 0;
      return;
    }
    // While the page is down the running list is read every third tick (30 s): the idle timer and a page that just came up do not
    // need it every ten seconds, all day. While the page is up it is read at every tick (the safety close counts on it).
    if (!wasUp) {
      tickN++;
      if ((tickN - 1) % 3 !== 0) return;
    }
    let up = false;
    try {
      up = await running();
    } catch (_) {
      return;
    }
    if (wasUp && !up) ownPage = false;
    wasUp = up;
    if (!up) {
      since = 0;
      strikes = 0;
      try {
        const fg = await luna(AM + 'getForegroundAppInfo', {});
        if (fg.appId !== HOME) {
          homeSince = 0;
          return;
        }
        if (!homeSince) {
          homeSince = Date.now();
          return;
        }
        if (!mayOpen(Date.now(), homeSince, activeAt)) {
          if (!activeAt && !saidQuiet) {
            saidQuiet = true;
            console.log('screensaver: the launcher has not reported a key yet; leaving the page to tvpowerd');
          }
          return;
        }
        homeSince = 0;
        console.log('screensaver: the launcher has been idle for two minutes; opening the page');
        ownPage = true;
        await luna(AM + 'launch', { id: SA });
      } catch (_) {}
      return;
    }
    homeSince = 0;
    tickN = 0;
    if (!since) {
      since = Date.now();
      return;
    }
    if (Date.now() - since < GRACE_MS) return;
    try {
      if (ownPage) {
        // A page this service opened is not in tvpowerd's saver slot, so the power state never says "Screen Saver" for it (an LG
        // C4 on webOS 25 reads Active with no processing, all along). The app in front stays Home while it is up; another app in
        // front means it was left behind.
        const fg = await luna(AM + 'getForegroundAppInfo', {});
        if (fg.appId === HOME || fg.appId === SA) {
          strikes = 0;
          return;
        }
      } else {
        const pw = await luna('luna://com.webos.service.tvpower/power/getPowerState', {});
        // "Screen Saver Ready" (or "Screen Saver") in processing: tvpowerd holds the saver slot, so this page is the screen saver
        // itself, not one the system left behind (on the tested TV the state stays Active while our page is up). That rests on
        // one string of LG's (docs/screensaver.md > Limits): a single reading without it decides nothing, two in a row close.
        if (pw.state !== 'Active' || /screen saver/i.test(String(pw.processing || ''))) {
          strikes = 0;
          return;
        }
      }
      strikes++;
      if (strikes < 2) return;
      console.log('screensaver: the TV is on an app again; closing the page');
      strikes = 0;
      await close();
      since = 0;
    } catch (_) {}
  }
  function start() {
    const t = setInterval(tick, CHECK_MS);
    if (t.unref) t.unref();
  }

  async function handle(req, res, u, body) {
    const json = (o, c) => web.json(res, o, c);
    if (u === '/api/screensaver/photos') {
      // ?cc=<country>: the page passes the TV's country, as the launcher does for the scenes of an add-on (Seasons picks by it)
      const m = /[?&]cc=([A-Za-z]{2,3})(?:&|$)/.exec(req.url || '');
      const b = await background(m ? m[1].toUpperCase() : '');
      const st = settings(),
        films = (await videos()).videos.length;
      const out = {
        photos: b.photos,
        credits: b.credits,
        from: b.from,
        every: EVERY_S[st.style],
        lang: await lang(),
        clock: clock(),
        slides: slides(order(b), sizesOf(b.photos)),
        style: st.style,
        show: showNow(films),
      };
      // only with Wallpapers' order, so the reply is the same without it
      if (mixed(b)) out.mixed = true;
      return json(out);
    }
    if (u === '/api/screensaver/videos') return json(await videos());
    // the library photos of the slides the page drew, so Home and the next plan go on from there
    if (u === '/api/screensaver/shown' && req.method === 'POST') {
      const w = wp(),
        b = await body(req);
      if (w && w.shown) w.shown(b.ids);
      return json({});
    }
    // a live source's photo: the one Home has now (wallpapers.js liveCurrent), not the next one the source would hand out
    const lm = /^\/api\/screensaver\/live\/([a-z][a-z0-9-]{1,31})$/.exec(u);
    if (lm) {
      const w = wp();
      return json(w && w.liveCurrent ? await w.liveCurrent(lm[1]) : { error: 'no wallpapers' });
    }
    const sm = /^\/api\/screensaver\/scene\/([a-z]+)$/.exec(u);
    if (sm && COUCH.indexOf(sm[1]) >= 0) {
      let b = null;
      try {
        b = fs.readFileSync(P.APP + '/scene-' + sm[1] + '.jpg');
      } catch (_) {}
      if (!b) return web.notFound(res);
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=600' });
      return res.end(b);
    }
    if (u === '/api/screensaver/active' && req.method === 'POST') {
      active();
      return json({ returnValue: true });
    }
    if (u === '/api/screensaver/dismiss' && req.method === 'POST') {
      active(); // the key that closed the page is the last thing the user did
      await close();
      return json({ returnValue: true });
    }
    if (u === '/api/screensaver/set' && req.method === 'POST') {
      set((await body(req)) || {});
      const st = settings();
      return json({ style: st.style, show: st.show, films: (await videos()).videos.length });
    }
    if (u === '/api/screensaver') {
      const st = settings();
      return json({
        replaced: replaced(),
        running: await running(),
        photos: photos().length,
        every: EVERY_S[st.style],
        style: st.style,
        show: st.show,
        films: (await videos()).videos.length,
      });
    }
    web.notFound(res);
  }

  // tick and lastActive are for the tests (tools/test/screensaver.test.js): the timer's step, and when the launcher last reported a key
  return {
    name: 'screensaver',
    prefix: '/api/screensaver',
    handle,
    start,
    photos,
    videos,
    close,
    active,
    tick,
    lastActive: () => activeAt,
  };
}

module.exports = { create, replaced, supported, mayOpen, cleanVideos, slides, shuffle };
