// Home's wallpapers (app/src/js/wall.js): opening Home changes the photo only when the interval has passed since the last change
// (every time with "Each time Home opens"), the interval timer keeps running, a photo that fails to load is skipped, and Home that
// starts again opens on the photo it showed last
const fs = require('fs'),
  path = require('path'),
  vm = require('vm');
const { root, ok, run } = require('./lib');

function classes() {
  const set = new Set();
  return {
    add: (...c) => c.forEach(x => set.add(x)),
    remove: (...c) => c.forEach(x => set.delete(x)),
    contains: c => set.has(c),
  };
}
function layerEl() {
  return { style: {}, id: '', className: '', parentNode: null, classList: classes() };
}

// the service's order (POST /api/wallpapers/next) is the photos in turn; down: it does not answer. o.store: localStorage (kept
// between two makes, as between two starts of Home); o.fail(url): that photo does not load
function make(cfg, photos, down, o) {
  o = o || {};
  let now = 1000000,
    turn = 0;
  const shown = [],
    intervals = [],
    timers = [],
    asked = [],
    walls = [],
    store = o.store || {};
  const holder = { insertBefore() {} };
  const els = {},
    created = [];
  const context = {
    cfg,
    API: 'http://tv',
    Date: { now: () => now },
    Math,
    String,
    Number,
    $: id => (id === 'gA' ? { parentNode: holder } : id === 'homepage' ? { appendChild() {} } : els[id] || null),
    api: u => ({
      then: (f, no) =>
        asked.push(u) &&
        (u !== '/api/wallpapers/next' ? f({ photos }) : down ? no && no(new Error('down')) : f({ id: photos[turn++ % photos.length] })),
    }),
    setInterval: fn => intervals.push(fn) && intervals.length,
    clearInterval() {},
    setTimeout: (fn, ms) => timers.push({ fn, ms }) && timers.length,
    clearTimeout: n => n && timers[n - 1] && (timers[n - 1].fn = null),
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => (store[k] = String(v)),
      removeItem: k => delete store[k],
    },
    window: { getComputedStyle: () => ({ opacity: '1' }) },
    SCENES: { wall: u => walls.push(u) },
    Image: function () {
      const im = this;
      Object.defineProperty(im, 'src', {
        set(v) {
          shown.push(v);
          if (o.fail && o.fail(v)) {
            if (im.onerror) im.onerror();
          } else if (im.onload) im.onload();
        },
      });
    },
    document: {
      createElement: () => {
        const e = layerEl();
        created.push(e);
        return e;
      },
      body: { classList: classes() },
    },
  };
  /* the timers set so far, in order (those they set run on the next call) */
  const runTimers = () => {
    for (let i = 0, n = timers.length; i < n; i++) {
      const fn = timers[i].fn;
      timers[i].fn = null;
      if (fn) fn();
    }
  };
  context.cfg.wallpapers = { stamp: '1:1' };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'app', 'src', 'js', 'wall.js'), 'utf8'), context);
  return {
    WALL: vm.runInContext('WALL', context),
    shown,
    intervals,
    created,
    asked,
    walls,
    store,
    body: context.document.body,
    runTimers,
    tick: ms => (now += ms),
  };
}

run(async () => {
  const photos = ['a', 'b', 'c'];

  // the darkening of the photos: the theme's effects.wallpaperDim also when the theme has no wallpaper of its own (it was always 0.4)
  const dimOf = theme => {
    const d = make({ wall: { on: true, secs: 900 }, theme }, photos);
    d.WALL.sync();
    const layer = d.created.filter(e => e.className === 'wpd')[0];
    return layer && layer.style.background;
  };
  ok(
    dimOf({ nightRgb: '0, 0, 0', wallDim: 0 }) === 'rgba(0, 0, 0,0)' &&
      dimOf({ nightRgb: '0, 0, 0' }) === 'rgba(0, 0, 0,0.4)' &&
      dimOf({ nightRgb: '0, 0, 0', wallDim: 0.2, wallpaper: { dim: 0.6 } }) === 'rgba(0, 0, 0,0.6)',
    "a theme without a wallpaper darkens the photos by its own wallpaperDim, 0.4 by default, and a theme's wallpaper keeps its own"
  );

  // an interval of 15 minutes: Home opening again within that time keeps the photo on screen
  let w = make({ wall: { on: true, secs: 900 } }, photos);
  w.WALL.sync();
  ok(w.shown.length === 1, 'the first photo is shown when the wallpapers load');
  w.tick(60000);
  w.WALL.shown();
  ok(w.shown.length === 1, 'opening Home after 1 minute with a 15 minute interval keeps the photo');
  w.tick(900000);
  w.WALL.shown();
  ok(w.shown.length === 2, 'opening Home after the interval has passed shows a new photo');
  ok(w.intervals.length >= 2, 'the interval timer is armed again each time Home opens');

  // "Each time Home opens" (0 seconds): a new photo every time
  w = make({ wall: { on: true, secs: 0 } }, photos);
  w.WALL.sync();
  w.tick(1000);
  w.WALL.shown();
  w.tick(1000);
  w.WALL.shown();
  ok(w.shown.length === 3, 'with "Each time Home opens" every opening shows a new photo');

  // the clock set back: do not wait for a time that will not come
  w = make({ wall: { on: true, secs: 900 } }, photos);
  w.WALL.sync();
  w.tick(-3600000);
  w.WALL.shown();
  ok(w.shown.length === 2, 'a clock set back does not hold the photo for good');

  // the order is the service's (shared with the screen saver), not a random pick of the page's own
  w = make({ wall: { on: true, secs: 0 } }, photos);
  w.WALL.sync();
  for (let i = 0; i < 5; i++) w.WALL.shown();
  ok(
    w.shown.map(u => u.split('/').pop()).join('') === 'abcabc',
    "Home shows the photos in Wallpapers' order, from POST /api/wallpapers/next"
  );
  w = make({ wall: { on: true, secs: 0 } }, photos, true);
  w.WALL.sync();
  w.WALL.shown();
  ok(w.shown.length === 2, 'when the service does not answer, Home picks a photo itself');

  // Home starts again (a boot, a reload): it opens on the photo it showed last, before the theme and before the service answers, held back
  // until that photo is decoded; the service's list keeps it, and the next photo comes at the interval
  const store = {};
  w = make({ wall: { on: true, secs: 900 } }, photos, false, { store });
  w.WALL.sync();
  const first = w.shown[0];
  ok(/\/api\/wallpapers\/photo\/a$/.test(first) && /"id":"a"/.test(store['cytv.wall.shown']), 'the photo on screen is kept');
  let held = false;
  w = make({ wall: { on: true, secs: 900 } }, photos, false, { store });
  const realAdd = w.body.classList.add;
  w.body.classList.add = (...c) => {
    if (c.indexOf('wpwait') >= 0) held = true;
    realAdd(...c);
  };
  w.WALL.start();
  ok(
    w.walls[0] === first && w.shown[0] === first && w.asked.length === 0,
    'Home that starts again shows the kept photo at once, before it asks the service anything'
  );
  ok(
    held && !w.body.classList.contains('wpwait') && w.body.classList.contains('wpon'),
    'Home is held back until the kept photo is decoded, then shows with it'
  );
  w.WALL.sync();
  ok(
    w.asked.indexOf('/api/wallpapers/next') < 0 && w.shown.length === 1 && w.intervals.length >= 1,
    'the list from the service keeps the kept photo on screen; the next one comes at the interval'
  );
  // (this stand-in's order starts again at a, the photo on screen, which Home skips)
  w.intervals[w.intervals.length - 1]();
  w.intervals[w.intervals.length - 1]();
  ok(w.shown.length === 2 && /photo\/b$/.test(w.shown[1]), "at the interval Home goes on with Wallpapers' order");

  // the kept photo is no longer in the library: the next one of the order, no wait
  w = make({ wall: { on: true, secs: 900 } }, ['b', 'c'], false, {
    store: { 'cytv.wall.shown': JSON.stringify({ id: 'z', url: 'http://tv/z' }) },
    fail: u => /z$/.test(u),
  });
  w.WALL.start();
  w.WALL.sync();
  ok(
    w.asked.indexOf('/api/wallpapers/next') >= 0 && /photo\/b$/.test(w.shown[w.shown.length - 1]),
    'a kept photo that was removed is replaced by the next one'
  );

  // the service is not up yet: the kept photo is tried again; Home shows after at most 2 s without it, never with the theme's wallpaper
  let up = false;
  w = make({ wall: { on: true, secs: 900 } }, photos, false, {
    store: { 'cytv.wall.shown': JSON.stringify({ id: 'a', url: 'http://tv/a' }) },
    fail: () => !up,
  });
  w.WALL.start();
  w.runTimers();
  ok(
    !w.body.classList.contains('wpwait') && w.body.classList.contains('wpon') && w.walls.indexOf('') < 0 && w.shown.length === 2,
    'while the service starts, Home shows after the wait without the theme wallpaper and the kept photo is tried again'
  );
  up = true;
  w.runTimers();
  ok(w.created.filter(e => e.classList.contains('on')).length === 1, 'the kept photo shows once the service answers');
  // it never answers: Home goes on with the theme
  w = make({ wall: { on: true, secs: 900 } }, photos, false, {
    store: { 'cytv.wall.shown': JSON.stringify({ id: 'a', url: 'http://tv/a' }) },
    fail: () => true,
  });
  w.WALL.start();
  for (let i = 0; i < 25; i++) w.runTimers();
  ok(
    w.shown.length === 21 && !w.body.classList.contains('wpon') && w.walls[w.walls.length - 1] === '',
    'a kept photo that never loads is given up after about 30 s'
  );

  // Wallpapers switched off: nothing is kept, and the next start shows the theme
  const s2 = {};
  w = make({ wall: { on: true, secs: 900 } }, photos, false, { store: s2 });
  w.WALL.sync();
  w = make({ wall: { on: false, secs: 900 } }, photos, false, { store: s2 });
  w.WALL.start();
  ok(w.shown.length === 0 && !w.body.classList.contains('wpon'), 'with Wallpapers off Home does not start on a photo');
  w.WALL.sync();
  ok(!('cytv.wall.shown' in s2), 'switched off, the kept photo is forgotten');

  // off: nothing is shown
  w = make({ wall: { on: false, secs: 900 } }, photos);
  w.WALL.sync();
  w.WALL.shown();
  ok(w.shown.length === 0, 'with Wallpapers off no photo is asked for');
});
