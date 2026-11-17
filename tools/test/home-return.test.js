// Home back from an app (load() in app/src/js/layout.js): the usage counts change with every app opened, and they matter only where
// they change the order of the grid. Then Home keeps its tiles and its theme as they are (no rebuild, no theme applied again), so
// the TV has nothing to lay out and paint again but what it dropped while Home was in the background. A tile launched (tile.launch zoom
// or dim) is at rest before Home shows again, not shrinking back from its launch size on the first frames.
const fs = require('fs'),
  path = require('path'),
  vm = require('vm');
const { root, ok, run } = require('./lib');

// one function of a page script, by its name
function fn(file, name) {
  const s = fs.readFileSync(path.join(root, 'app/src/js', file), 'utf8'),
    a = s.indexOf('\nfunction ' + name + '(') + 1;
  let depth = 0,
    i = s.indexOf('{', a);
  for (; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}' && --depth === 0) break;
  }
  return s.slice(a, i + 1);
}

run(async () => {
  const calls = [];
  let reply = null;
  const context = {
    apps: [],
    cfg: {},
    usage: {},
    lastSig: '',
    lastOrder: '',
    themeSig: '',
    perfReady: true,
    warned: false,
    TH: { dockN: 6 },
    DEFAULTS: { dock: [] },
    JSON,
    Object,
    Math,
    readRunning() {},
    oldSvc: () => false,
    retryTileIcons() {},
    setCardsIdleMinutes() {},
    useLang() {},
    liveOn: () => false,
    store() {},
    toast() {},
    setTimeout() {},
    t: s => s,
    WALL: { sync() {} },
    TOPSHELF: { sync() {} },
  };
  context.api = () => ({
    then(f) {
      f(reply);
      return { catch() {} };
    },
  });
  context.rebuild = () => calls.push('rebuild');
  vm.createContext(context);
  vm.runInContext(
    fn('config.js', 'isHidden') +
      fn('config.js', 'dockIds') +
      fn('config.js', 'gridApps') +
      fn('config.js', 'gridAppIds') +
      fn('config.js', 'byOrder') +
      fn('layout.js', 'load') +
      // applyTheme as the page has it records what it applied; here only that
      'function applyTheme(t) { themeSig = JSON.stringify([t || null, (cfg && cfg.lang) || ""]); calls.push("theme"); }',
    Object.assign(context, { calls })
  );
  const list = (usage, config) => ({
    apps: ['a', 'b', 'c', 'd'].map(id => ({ id, title: id.toUpperCase() })),
    config: Object.assign({ dock: ['a'], theme: { id: 'lounge', vars: { '--x': '1' } } }, config || {}),
    usage,
  });

  reply = list({ b: 5, c: 3, d: 1 });
  context.load();
  ok(calls.join() === 'theme,rebuild', 'the first list from the service applies the theme and builds the tiles: ' + calls.join());

  calls.length = 0;
  reply = list({ b: 6, c: 3, d: 1 });
  context.load();
  ok(calls.length === 0, 'Home back from an app whose use keeps the order of the grid builds nothing again: ' + calls.join());

  reply = list({ b: 6, c: 3, d: 9 });
  context.load();
  ok(calls.join() === 'rebuild', 'an app that moves up in the grid rebuilds it, without applying the theme again: ' + calls.join());

  calls.length = 0;
  reply = list({ b: 6, c: 3, d: 9 }, { theme: { id: 'moon', vars: { '--x': '2' } } });
  context.load();
  ok(calls.join() === 'theme,rebuild', 'another theme is applied: ' + calls.join());

  calls.length = 0;
  reply = list({ b: 6, c: 3, d: 9 }, { theme: { id: 'moon', vars: { '--x': '2' } }, lang: 'fr' });
  context.load();
  ok(calls.join() === 'theme,rebuild', 'and the theme again in another language: ' + calls.join());

  // a launched tile put back in its place: what the style is when its launch class goes, and whether the browser takes it in then
  const seen = [];
  const tile = { cls: ['tile', 'f', 'launching'] };
  tile.classList = {
    contains: c => tile.cls.indexOf(c) >= 0,
    add: c => tile.cls.push(c),
    remove: c => {
      if (c === 'launching') seen.push('removed with ' + tile.cls.join(' '));
      tile.cls = tile.cls.filter(x => x !== c);
    },
  };
  const page = {
    document: { hidden: true },
    window: {
      getComputedStyle: e => ({
        get transform() {
          seen.push('style read with ' + e.cls.join(' '));
          return 'none';
        },
      }),
    },
  };
  vm.createContext(page);
  vm.runInContext(fn('config.js', 'unlaunch'), page);
  page.unlaunch(tile);
  ok(
    seen.join() === 'removed with tile f launching still,style read with tile f still' && tile.cls.join(' ') === 'tile f',
    'while Home is hidden, a launched tile is put back with its transitions off and the style taken in at once: ' + seen.join()
  );
  seen.length = 0;
  tile.cls = ['tile', 'f', 'launching'];
  page.document.hidden = false;
  page.unlaunch(tile);
  ok(
    seen.join() === 'removed with tile f launching' && tile.cls.join(' ') === 'tile f',
    'on screen (the app did not open in 4 s) it goes back with its transitions: ' + seen.join()
  );
});
