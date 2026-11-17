// Home back from an app (load() in app/src/js/layout.js): the usage counts change with every app opened, and they matter only where
// they change the order of the grid. Then Home keeps its tiles and its theme as they are (no rebuild, no theme applied again), so
// the TV has nothing to lay out and paint again but what it dropped while Home was in the background. A tile launched (tile.launch zoom
// or dim) is at rest before Home shows again, not shrinking back from its launch size on the first frames. What shows only after a move
// (the frosted glass of the grid, the focus pieces that wait) is out of the page while Home is hidden and back before any fade of theirs.
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

  // body.away: set while Home is hidden, taken off with the style read at once, so a fade that follows starts from where they rest
  const order = [];
  const body = { cls: ['glass-on', 'away'] };
  body.classList = {
    contains: c => body.cls.indexOf(c) >= 0,
    remove: c => {
      order.push('remove ' + c);
      body.cls = body.cls.filter(x => x !== c);
    },
  };
  const glass = {};
  const back = {
    document: { body },
    $: id => (id === 'sglass' ? glass : null),
    window: {
      getComputedStyle: e => ({
        get opacity() {
          order.push('style of ' + (e === glass ? 'the glass' : 'the page') + ' read with ' + body.cls.join(' '));
          return '0';
        },
      }),
    },
  };
  vm.createContext(back);
  vm.runInContext(fn('input.js', 'putBack'), back);
  back.putBack();
  back.putBack();
  ok(
    order.join() === 'remove away,style of the glass read with glass-on',
    'the layers left out while Home was hidden are back, their style taken in at once, and only once: ' + order.join()
  );
  const hide = fs.readFileSync(path.join(root, 'app/src/js/input.js'), 'utf8');
  const tilesJs = fs.readFileSync(path.join(root, 'app/src/js/tiles.js'), 'utf8');
  ok(
    /if \(document\.hidden\) \{[\s\S]*?classList\.add\('away'\)[\s\S]*?\} else/.test(hide) &&
      /putBack\(\);\s*document\.body\.classList\.add\('ahead'\)/.test(hide) &&
      /function focusPieces\(e\) \{\s*putBack\(\);/.test(tilesJs),
    'body.away is set when Home hides, and taken off by the drawing ahead and by any move of the focus pieces'
  );
});
