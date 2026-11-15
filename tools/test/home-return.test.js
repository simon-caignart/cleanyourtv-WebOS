// Home back from an app (load() in app/src/js/layout.js): the usage counts change with every app opened, and they matter only where
// they change the order of the grid. Then Home keeps its tiles and its theme as they are (no rebuild, no theme applied again), so
// the TV has nothing to lay out and paint again but what it dropped while Home was in the background.
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
});
