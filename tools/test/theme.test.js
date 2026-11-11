// Themes (theme.js): the repository's themes/ folder is valid, values are checked and clamped, extends works, a theme is downloaded
// from GitHub (a local stand-in here) when chosen and kept, a bad download is refused, and the service ships none.
const fs = require('fs'),
  path = require('path'),
  vm = require('vm');
const { root, tmp, ok, call, serve, req, memoryConfig, run } = require('./lib');
const nc = req('netcompat');

run(async () => {
  const themeMod = req('theme'),
    tdir = path.join(root, 'themes');
  const folders = fs.readdirSync(tdir).filter(n => fs.statSync(path.join(tdir, n)).isDirectory());
  ok(folders.length >= 5 && folders.indexOf('classic') >= 0, 'the themes folder holds one folder per theme');
  const known = new Set(themeMod.SCHEMA.map(r => r[0])),
    unknownKeys = [];
  const walk = (o, pre) => {
    for (const k of Object.keys(o)) {
      const key = pre ? pre + '.' + k : k;
      if (key === 'slots') continue; // a list, checked by themeschema.slots
      if (key === 'scenes') continue; // custom scenes array, checked by themeschema.customScenes
      if (o[k] && typeof o[k] === 'object') walk(o[k], key);
      else if (!known.has(key) && ['name', 'author', 'description', 'extends'].indexOf(key) < 0) unknownKeys.push(key);
    }
  };
  let allOk = true;
  const tbad = [];
  for (const id of folders) {
    const fd = path.join(tdir, id);
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(fd, 'theme.json'), 'utf8'));
    } catch (e) {
      allOk = false;
      tbad.push(id + ': theme.json');
      continue;
    }
    const t = themeMod.normalize(raw, id, null, fd);
    walk(raw, '');
    if (!t || (raw.effects && raw.effects.wallpaper && t.v['effects.wallpaper'] !== raw.effects.wallpaper)) {
      allOk = false;
      tbad.push(id + ': theme or wallpaper');
    }
    const pv = ['jpg', 'png', 'webp'].map(x => path.join(fd, 'preview.' + x)).filter(f => fs.existsSync(f))[0];
    if (!pv || !themeMod.imageOk(fs.readFileSync(pv), pv, 600 * 1024)) {
      allOk = false;
      tbad.push(id + ': screenshot (preview.jpg, an image of at most 600 KB)');
    }
  }
  ok(allOk, 'every theme folder has a valid theme.json, its wallpaper and a screenshot' + (tbad.length ? ': ' + tbad.join('; ') : ''));
  ok(unknownKeys.length === 0, 'theme files use only keys of the schema' + (unknownKeys.length ? ': ' + unknownKeys.join(', ') : ''));
  ok(
    fs.readFileSync(path.join(tdir, 'index.json'), 'utf8') === require(path.join(root, 'tools', 'theme-index.js')).build(),
    'themes/index.json is up to date (run: node tools/theme-index.js)'
  );
  ok(
    themeMod.SCHEMA.every(r => ['name', 'author', 'description', 'extends'].indexOf(r[0].split('.')[0]) < 0),
    "no setting group shares a name with the theme's own fields (name, author, description, extends)"
  );
  const bad = themeMod.normalize(
    {
      name: 'x'.repeat(500),
      colors: { night: 'red; background:url(//evil)', ink: '#12345', accent: 5 },
      grid: { cols: 99, tileH: -5, radius: 1e9, mode: 'sideways', align: 'middle' },
      type: { scale: '2', font: 'comic' },
      clock: { layout: 'sideways', scale: 50 },
      effects: { glow: 7, speed: NaN, wallpaper: '../../etc/passwd', wallpaperDim: 5 },
      css: 'body{display:none}',
    },
    'evil'
  );
  ok(
    bad.name.length === 40 &&
      bad.v['colors.night'] === '#07080b' &&
      bad.v['colors.ink'] === '#f5f6f8' &&
      bad.v['colors.accent'] === '#f5f6f8',
    'colours must be #rrggbb, anything else falls back'
  );
  ok(
    bad.v['grid.cols'] === 14 &&
      bad.v['grid.tileH'] === 80 &&
      bad.v['grid.radius'] === 100 &&
      bad.v['grid.mode'] === 'below' &&
      bad.v['grid.align'] === 'left' &&
      bad.v['type.scale'] === 1 &&
      bad.v['type.font'] === 'default' &&
      bad.v['clock.layout'] === 'inline' &&
      bad.v['clock.scale'] === 2.5,
    'numbers are clamped, enums and types are checked'
  );
  ok(
    bad.v['effects.glow'] === 1 &&
      bad.v['effects.speed'] === 1 &&
      bad.v['effects.wallpaper'] === '' &&
      bad.v['effects.wallpaperDim'] === 0.9 &&
      !('css' in bad.v),
    'effects are clamped, a wallpaper path is refused and unknown keys are dropped'
  );
  ok(themeMod.normalize({}, '../x') === null, 'a bad theme id is refused');
  // clock.greeting and dock.tileAlpha: a stacked greeting over the clock and a see-through dock
  const glass = themeMod.resolve(themeMod.normalize({ clock: { layout: 'stack', greeting: true }, dock: { tileAlpha: 0.3 } }, 'glass'));
  ok(
    glass.vars['--greet-d'] === 'block' && glass.vars['--dock-tile-alpha'] === '0.3' && glass.attrs.clock === 'stack',
    'clock.greeting shows the greeting and dock.tileAlpha makes the dock tiles see-through'
  );
  const plain = themeMod.resolve(themeMod.normalize({}, 'plain'));
  ok(
    plain.vars['--greet-d'] === 'none' && plain.vars['--dock-tile-alpha'] === '1',
    'by default there is no greeting and the dock tiles are opaque'
  );
  const focusArt = themeMod.resolve(themeMod.normalize({ effects: { focusIcon: true } }, 'focus-art'));
  ok(focusArt.focusIcon === true && !plain.focusIcon, 'effects.focusIcon reaches the launcher only when enabled');
  // clock.style, effects.scenes and cards.style (scenes.js): only a theme that uses them carries the keys, so other replies stay the same
  const couch = themeMod.resolve(
    themeMod.normalize({ clock: { style: 'glass' }, effects: { scenes: 'couch', sceneSecs: 5 }, cards: { style: 'glass' } }, 'couch')
  );
  ok(
    couch.attrs.cstyle === 'glass' && couch.attrs.cards === 'glass' && couch.scenes.set === 'couch' && couch.scenes.secs === 10,
    'the glass clock, the scenes (seconds clamped to 10 or more) and glass cards reach the launcher'
  );
  const odd = themeMod.resolve(themeMod.normalize({ clock: { style: 'neon' }, effects: { scenes: 'beach' } }, 'odd'));
  ok(
    !('cstyle' in plain.attrs) && !('cards' in plain.attrs) && !('scenes' in plain) && !('cstyle' in odd.attrs) && !('scenes' in odd),
    'without them (or with an unknown value) the text clock and no scenes, and no new keys in the reply'
  );
  // tile.label: the focused app's name under its tile; only a theme that turns it on carries the keys
  const named = themeMod.resolve(
    themeMod.normalize(
      { tile: { label: 'focus', labelSize: 30, labelDock: true }, type: { scale: 1.1 }, grid: { focusScale: 1.22 } },
      'named'
    )
  );
  ok(
    named.label &&
      named.label.dock === true &&
      named.label.size === 33 &&
      named.label.gridScale === 1.22 &&
      named.label.lift === 10 &&
      named.vars['--tlabel-fs'] === '33px',
    'tile.label reaches the launcher with its size (times type.scale), the dock choice and the focus scales'
  );
  ok(
    !('label' in plain) &&
      !('--tlabel-fs' in plain.vars) &&
      !('label' in themeMod.resolve(themeMod.normalize({ tile: { label: 'always' } }, 'odd2'))),
    'without tile.label (or with an unknown value) no name and no new keys in the reply'
  );
  {
    const lctx = {};
    vm.runInNewContext(fs.readFileSync(path.join(root, 'app', 'src', 'js', 'theme.js'), 'utf8'), lctx);
    const L = { gridScale: 1.22, size: 29 },
      b = lctx.labelBox(90, 0, 250, 150, 1.22, 0);
    ok(
      b.w === 305 && b.x === 63 && b.y === 182,
      'the name is centred under the tile, as wide as the focused tile, 15 px below its scaled bottom'
    );
    ok(lctx.labelBox(0, 0, 250, 150, 1.22, -10).y === b.y - 10, 'a lifted dock tile lifts its name too');
    // surface.ink auto: dark ink above about #8a8a8a under the buttons, white below
    const ictx = { $: () => null };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'app', 'src', 'js', 'ink.js'), 'utf8'), ictx);
    const dark = rgb => ictx.INK.luma(rgb) > ictx.INK_DARK;
    ok(
      dark([255, 255, 255]) && dark([160, 160, 160]) && !dark([128, 128, 128]) && !dark([0, 0, 0]),
      'the ink turns dark over white and light grey, and stays white over mid grey and black'
    );
    // surface.tint: the glass takes the colour of the picture behind it (a built-in scene's own colour, or the page colour without one)
    const fakeBody = attrs => {
      const cls = new Set(),
        style = {};
      return {
        cls,
        style: {
          setProperty: (k, v) => (style[k] = v),
          removeProperty: k => delete style[k],
          get: k => style[k],
        },
        attrs,
        getAttribute: k => (k in attrs ? attrs[k] : null),
        hasAttribute: k => k in attrs,
        classList: {
          add: (...c) => c.forEach(x => cls.add(x)),
          remove: (...c) => c.forEach(x => cls.delete(x)),
          toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)),
        },
      };
    };
    const tb = fakeBody({ 'data-inkmode': 'auto', 'data-tint': 'on' }),
      tctx = { $: () => null, document: { body: tb }, setTimeout: f => f(), clearTimeout: () => {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'app', 'src', 'js', 'ink.js'), 'utf8'), tctx);
    tctx.INK.set('', 0, [7, 8, 11], true, [80, 126, 135]);
    const scene = tb.cls.has('tinted') && tb.cls.has('ink-dark') && tb.style.get('--ink-tint') === '80,126,135';
    tctx.INK.set('', 0, [10, 20, 30]);
    const bare = tb.cls.has('tinted') && !tb.cls.has('ink-dark') && tb.style.get('--ink-tint') === '10,20,30';
    delete tb.attrs['data-tint'];
    tctx.INK.set('', 0, [250, 250, 250]);
    const untinted = !tb.cls.has('tinted') && tb.cls.has('ink-dark') && tb.style.get('--ink-tint') === undefined;
    ok(
      scene && bare && untinted,
      "the glass takes a built-in scene's colour or the page colour, and none once the theme drops the tint (the ink still follows)"
    );
    // grid.scroll row: (ex, row top, row height with its name, row step, safe top, safe bottom)
    ok(
      lctx.rowScroll(0, 411, 217, 260, 150, 1020) === 0 && lctx.rowScroll(0, 671, 217, 260, 150, 1020) === 0,
      'rows that fit in the safe area do not scroll the page'
    );
    ok(
      lctx.rowScroll(0, 931, 217, 260, 150, 1020) === 260 && lctx.rowScroll(260, 1191, 217, 260, 150, 1020) === 520,
      'the next row that would leave the safe area scrolls the page by exactly one row'
    );
    ok(
      lctx.rowScroll(520, 931, 217, 260, 150, 1020) === 520 && lctx.rowScroll(520, 411, 217, 260, 150, 1020) === 260,
      'going back up the page stays until the row would leave at the top, then moves back by whole rows'
    );
    ok(
      lctx.labelRoom(L, 150) === Math.ceil(16.5 + 15 + 29 * 1.2) && lctx.labelRoom(null, 150) === 0,
      'the room a name takes under a row: the grown tile, the gap and one line; none without names'
    );
  }
  // effects.motion, tile.highlight and tile.shadow: the motion and the focus look of a streaming box, only in the themes that use them
  const box = themeMod.resolve(
    themeMod.normalize(
      { effects: { motion: 'smooth' }, tile: { highlight: 'focus', rim: 0.7, shadow: 'soft', shadowStrength: 0.6 } },
      'box'
    )
  );
  ok(
    box.attrs.motion === 'smooth' &&
      box.attrs.hl === 'focus' &&
      box.attrs.tshadow === 'soft' &&
      box.vars['--rim'] === '0.7' &&
      box.vars['--shadow-k'] === '0.6',
    'smooth motion, the highlight on the focused tile and soft shadows reach the launcher'
  );
  ok(
    !('motion' in plain.attrs) &&
      !('hl' in plain.attrs) &&
      !('tshadow' in plain.attrs) &&
      !('--rim' in plain.vars) &&
      !('--shadow-k' in plain.vars),
    'by default the spring motion, the gloss on every tile and the focus shadow, with no new keys in the reply'
  );
  // tile.press and tile.launch: how deep a held tile sinks, and a launch that zooms the tile away
  const pressed = themeMod.resolve(
    themeMod.normalize({ tile: { press: 1.11, launch: 'zoom' }, grid: { focusScale: 1.22 }, dock: { focusScale: 1.2 } }, 'pressed')
  );
  ok(
    pressed.vars['--press-s'] === '1.11' &&
      pressed.attrs.launch === 'zoom' &&
      pressed.vars['--launch-sg'] === '1.59' &&
      pressed.vars['--launch-sd'] === '1.56',
    'tile.press sets the held scale and tile.launch zoom grows the tile to 1.3 times its focused size'
  );
  ok(
    !('--press-s' in plain.vars) && !('launch' in plain.attrs) && !('--launch-sg' in plain.vars),
    'by default a held tile sinks to 0.96 and a launch dims it, with no new keys in the reply'
  );
  const tinted = themeMod.resolve(themeMod.normalize({ surface: { tint: 0.35 } }, 'tinted'));
  ok(
    tinted.attrs.tint === 'on' && tinted.vars['--tint-a'] === '0.35' && !('tint' in plain.attrs) && !('--tint-a' in plain.vars),
    'surface.tint reaches the launcher, and by default the glass is not tinted, with no new keys in the reply'
  );
  const calmTop = themeMod.resolve(
    themeMod.normalize({ dock: { chevron: true }, grid: { hideTop: true }, effects: { lateDim: false, bottomShade: 0.45 } }, 'calmtop')
  );
  ok(
    calmTop.attrs.chev === 'on' &&
      calmTop.attrs.gtop === 'hide' &&
      calmTop.attrs.late === 'off' &&
      calmTop.attrs.bshade === 'on' &&
      calmTop.vars['--bshade-a'] === '0.45' &&
      ['chev', 'gtop', 'late', 'bshade'].every(k => !(k in plain.attrs)) &&
      !('--bshade-a' in plain.vars),
    'the chevron, the status area hidden in the grid, no night dimming and the bottom shade reach the launcher; none by default'
  );
  const glassDock = themeMod.resolve(themeMod.normalize({ dock: { glass: true } }, 'glassdock'));
  ok(
    glassDock.dockGlass === true && glassDock.attrs.dglass === 'on' && !('dockGlass' in plain) && !('dglass' in plain.attrs),
    'dock.glass reaches the launcher, and by default the panel is a plain fill, with no new keys in the reply'
  );
  // grid.peek: in push mode the first row shows at the bottom of the screen at rest, and the grid opens from there
  const peeking = themeMod.resolve(
    themeMod.normalize(
      {
        dock: { anchor: 'bottom', y: 65, h: 150, panel: 0.1, panelPad: 40 },
        grid: { mode: 'push', dockUp: 60, peek: 24, gapY: 110, y: 500 },
      },
      'peek'
    )
  );
  ok(
    peeking.attrs.peek === 'on' && peeking.push.gridTop === 1056 && peeking.push.up === 725 && peeking.gapY === 110,
    'grid.peek places the first row 24 px into the screen, the page moves it up with the dock, and the row gap goes past 60'
  );
  const noPeek = themeMod.resolve(themeMod.normalize({ grid: { mode: 'below', peek: 24 } }, 'nopeek'));
  ok(
    !('peek' in plain.attrs) && !('peek' in noPeek.attrs) && noPeek.gt === plain.gt,
    'without push mode (or by default) there is no peek and the grid stays where it was'
  );
  // clock.style pill, dock.panelRim and grid.glassDim: a clock readable on any scene, a brighter platter rim, a calmer glass
  const calm = themeMod.resolve(
    themeMod.normalize({ clock: { style: 'pill' }, dock: { panel: 0.1, panelRim: 0.35 }, grid: { glassDim: 0.5 } }, 'calm')
  );
  ok(
    calm.attrs.cstyle === 'pill' && calm.vars['--dock-rim'] === '0.35' && calm.glassDim === 0.5,
    'the pill clock, the panel rim and the darkness of the glass reach the launcher'
  );
  const rims = [0.9, -1, '', null, 'x'].map(
    x => themeMod.normalize({ dock: { panelRim: x } }, 'rim', themeMod.DEFAULTS).v['dock.panelRim']
  );
  ok(
    rims[0] === 0.8 && rims[1] === 0 && rims[2] === null && rims[3] === null && rims[4] === null,
    'an optional number is clamped, and empty or invalid leaves it worked out from dock.panel'
  );
  ok(
    !('--dock-rim' in plain.vars) && !('glassDim' in plain) && !('cstyle' in plain.attrs),
    'by default the rim follows the panel, the glass keeps its tint and the clock is text, with no new keys in the reply'
  );
  // type: a weight per kind of text, the spacing of large text, the optical size, and a variable font that covers every weight
  const typed = themeMod.resolve(
    themeMod.normalize(
      {
        type: {
          fontFile: 'inter.woff2',
          variable: true,
          opsz: 'display',
          weightTitle: 600,
          weightText: 450.4,
          weightLabel: 1000,
          weightClock: 500,
          tracking: 0,
        },
        clock: { scale: 0.43 },
      },
      'typed',
      themeMod.DEFAULTS,
      path.join(tdir, 'lounge')
    )
  );
  ok(
    typed.vars['--w-title'] === '600' &&
      typed.vars['--w-text'] === '450' &&
      typed.vars['--w-label'] === '900' &&
      typed.vars['--w-clock'] === '500' &&
      typed.vars['--track'] === '0em' &&
      typed.vars['--fvs'] === '"opsz" 32' &&
      typed.vars['--fvs-s'] === '"opsz" 14' &&
      typed.vars['--clock-s'] === '0.43' &&
      typed.font &&
      typed.font.file === 'inter.woff2' &&
      typed.font.variable === true,
    'the weights (rounded, clamped), the spacing, the optical size, a small clock and a variable font reach the pages'
  );
  const statFont = themeMod.resolve(
    themeMod.normalize({ type: { fontFile: 'inter.woff2' } }, 'stat', themeMod.DEFAULTS, path.join(tdir, 'lounge'))
  );
  ok(
    ['--w-title', '--w-text', '--w-label', '--w-clock', '--track', '--fvs', '--fvs-s'].every(k => !(k in plain.vars)) &&
      statFont.font &&
      !('variable' in statFont.font),
    "by default the pages keep their own weights, spacing and optical size, and a theme's font is not taken as variable"
  );
  const rowed = themeMod.resolve(
    themeMod.normalize({ dock: { anchor: 'bottom' }, grid: { scroll: 'row', clipTop: 120, dockUp: 140 } }, 'rowed')
  );
  ok(
    rowed.attrs.gscroll === 'row' && rowed.rowScroll.top === 120 && rowed.rowScroll.dockUp === 140,
    'grid.scroll row reaches a push grid with its clip line and the place of the dock'
  );
  ok(
    !('gscroll' in plain.attrs) &&
      !('rowScroll' in plain) &&
      !('rowScroll' in themeMod.resolve(themeMod.normalize({ grid: { scroll: 'row' } }, 'below'))),
    'by default, and outside push mode, the grid scrolls as before with no new keys in the reply'
  );
  // effects.scenesYield: the scenes step aside for Wallpapers photos; only a theme that asks for it carries the key
  const yields = themeMod.resolve(themeMod.normalize({ effects: { scenes: 'couch', scenesYield: true } }, 'yields'));
  ok(
    yields.scenes.yield === true &&
      !('yield' in couch.scenes) &&
      !('scenes' in themeMod.resolve(themeMod.normalize({ effects: { scenesYield: true } }, 'noscenes'))),
    'effects.scenesYield reaches the launcher with the scenes, and means nothing without them'
  );
  // bar.style glass, surface.ink and bar.besideClock: the status area of a streaming box, the dock's glass with ink that follows the picture
  const status = themeMod.resolve(
    themeMod.normalize(
      {
        bar: { style: 'glass', besideClock: true, align: 'right', gap: 14 },
        clock: { style: 'pill', align: 'right', x: 51, y: 53 },
        surface: { ink: 'auto' },
      },
      'status'
    )
  );
  ok(
    status.attrs.bar === 'glass' &&
      status.attrs.labels === 'hide' &&
      status.vars['--pill-r'] === '50%' &&
      status.attrs.inkmode === 'auto' &&
      status.barClock.side === 'right' &&
      status.barClock.x === 51 &&
      status.barClock.y === 53 &&
      status.barClock.gap === 14,
    'glass buttons are icon-only circles, their ink can follow the picture, and the bar can stand beside the clock'
  );
  const apart = themeMod.resolve(themeMod.normalize({ bar: { besideClock: true, align: 'right' }, clock: { align: 'left' } }, 'apart'));
  ok(
    !('barClock' in apart) && !('barClock' in plain) && !('inkmode' in plain.attrs),
    'the bar stays where it is when the clock is on the other side, and by default, with no new keys in the reply'
  );
  // dock.tileFrost and dock.tileFrostColor: a tint over the resting tiles, its colour resolved to an rgb triple
  const frost = themeMod.resolve(themeMod.normalize({ dock: { tileFrost: 0.4, tileFrostColor: '#ffffff' } }, 'frost'));
  ok(
    frost.vars['--dock-tile-frost'] === '0.4' && frost.vars['--dock-frost-rgb'] === '255,255,255',
    'dock.tileFrost sets the frost and dock.tileFrostColor becomes its rgb tint'
  );
  ok(plain.vars['--dock-tile-frost'] === '0' && plain.vars['--dock-frost-rgb'] === '255,255,255', 'by default there is no dock-tile frost');
  // tile.iconScale: scales the icon inside the tile
  const scaled = themeMod.resolve(themeMod.normalize({ tile: { iconScale: 1.3 } }, 'scaled'));
  ok(scaled.vars['--icon-s'] === '1.3', 'tile.iconScale sets the icon scale');
  ok(plain.vars['--icon-s'] === '1', 'by default icon scale is 1');
  // dock, grid and picker icon scales: separate variables, only present when changed, clamped
  ok(
    !('--icon-s-dock' in plain.vars) && !('--icon-s-grid' in plain.vars) && !('--icon-s-picker' in plain.vars),
    'by default there are no per-surface icon scale variables'
  );
  const surf = themeMod.resolve(
    themeMod.normalize({ dock: { iconScale: 1.8 }, grid: { iconScale: 0.8 }, picker: { iconScale: 99 } }, 'surf')
  );
  ok(
    surf.vars['--icon-s-dock'] === '1.8' && surf.vars['--icon-s-grid'] === '0.8' && surf.vars['--icon-s-picker'] === '2.5',
    'dock.iconScale, grid.iconScale and picker.iconScale set their own variables and are clamped'
  );
  ok(surf.vars['--icon-s'] === '1', 'per-surface icon scales leave tile.iconScale alone');
  // shelf.dockAlign: the name follows the dock, so the dock's geometry is carried to the page; off by default, so other replies are unchanged
  const nameDock = themeMod.resolve(
    themeMod.normalize(
      { shelf: { dockAlign: true }, dock: { align: 'center', x: 40, w: 150, gap: 24, panel: 0.2, panelPad: 18 } },
      'namedock'
    )
  );
  ok(
    nameDock.shelf &&
      nameDock.shelf.dock === true &&
      nameDock.shelf.align === 'center' &&
      nameDock.shelf.w === 150 &&
      nameDock.shelf.gap === 24 &&
      nameDock.shelf.pad === 18,
    'shelf.dockAlign carries the dock width, gap and panel padding to the page'
  );
  ok(plain.shelf === undefined, 'a theme that does not line the name up with the dock has no shelf key');
  // slots for cards: checked and clamped, placed like the clock, kept by a theme that extends it, and only in replies of themes with slots
  const slotted = themeMod.normalize(
    {
      slots: [
        { id: 'greeting', anchor: 'top', align: 'left', x: 102, y: 70, w: 900, h: 26, card: 'greeting', grid: 'keep' },
        { id: 'side', align: 'right', w: 99999, card: 'Bad Type!' },
        { id: 'side', align: 'center' },
        { id: '../x' },
        { id: 'mid', align: 'center', anchor: 'bottom', x: 300, y: 40 },
      ],
    },
    'slotted'
  );
  const rs = themeMod.resolve(slotted).slots;
  const horizon = JSON.parse(fs.readFileSync(path.join(tdir, 'horizon', 'theme.json'), 'utf8'));
  const rightColumn = themeMod.resolve(themeMod.normalize(horizon, 'horizon')).slots.filter(slot => slot.stack === 'right-column');
  ok(
    rightColumn.map(slot => slot.id).join(',') === 'side,side-middle,side-bottom' &&
      rightColumn.every(slot => slot.name && slot.w === '520px') &&
      rightColumn.map(slot => slot.t).join(',') === '150px,375px,600px',
    'Horizon keeps the existing right slot and adds two named positions in its stack'
  );
  ok(
    rs.length === 3 &&
      rs[0].l === '102px' &&
      rs[0].t === '70px' &&
      rs[0].w === '900px' &&
      rs[0].card === 'greeting' &&
      rs[0].keep === true &&
      rs[1].r === '96px' &&
      rs[1].w === '1920px' &&
      rs[1].card === '' &&
      rs[1].keep === false &&
      rs[2].l === '50%' &&
      rs[2].b === '40px' &&
      rs[2].tx === 'translateX(-50%)',
    'theme slots are checked, clamped and placed (a duplicate or bad id is dropped)'
  );
  ok(
    themeMod.resolve(themeMod.normalize({ name: 'kid' }, 'kid2', slotted.v)).slots.length === 3 &&
      !('slots' in themeMod.resolve(themeMod.normalize({ slots: [] }, 'none2', slotted.v))) &&
      !('slots' in plain),
    'a theme that extends one with slots keeps them, "slots": [] removes them, and a theme without slots has no slots key'
  );
  // custom scenes: a theme brings its own landscape images; files are validated on disk, bad entries are dropped
  const sceneDir = path.join(tmp, 'scene-theme');
  fs.mkdirSync(sceneDir, { recursive: true });
  const appDir = path.join(root, 'app');
  fs.writeFileSync(path.join(sceneDir, 'theme.json'), JSON.stringify({ name: 'S', effects: { scenes: 'custom' } }));
  fs.copyFileSync(path.join(appDir, 'scene-night.jpg'), path.join(sceneDir, 'night.jpg'));
  fs.copyFileSync(path.join(appDir, 'scene-night-glass.jpg'), path.join(sceneDir, 'night-glass.jpg'));
  fs.copyFileSync(path.join(appDir, 'scene-night-fg.webp'), path.join(sceneDir, 'night-fg.webp'));
  const sceneRaw = JSON.parse(fs.readFileSync(path.join(sceneDir, 'theme.json'), 'utf8'));
  sceneRaw.scenes = [
    {
      id: 'night',
      image: 'night.jpg',
      glass: 'night-glass.jpg',
      front: 'night-fg.webp',
      clock: { top: 200, size: 380 },
      date: { top: 120 },
      water: 0,
      darkSky: true,
    },
    { id: '../bad', image: 'evil.jpg', glass: 'night-glass.jpg' }, // bad id
    { id: 'dup', image: '../../etc/passwd', glass: 'night-glass.jpg' }, // bad filename
    { id: 'missing', image: 'missing.jpg', glass: 'night-glass.jpg' }, // file not on disk
    { id: 'night' }, // duplicate id (after the valid one above)
  ];
  const sceneTheme = themeMod.normalize(sceneRaw, 'scene-theme', null, sceneDir);
  const rs2 = themeMod.resolve(sceneTheme);
  ok(
    sceneTheme.v['effects.scenes'] === 'custom' &&
      sceneTheme.v.customScenes &&
      sceneTheme.v.customScenes.length === 1 &&
      sceneTheme.v.customScenes[0].id === 'night' &&
      sceneTheme.v.customScenes[0].image === 'night.jpg' &&
      sceneTheme.v.customScenes[0].glass === 'night-glass.jpg' &&
      sceneTheme.v.customScenes[0].front === 'night-fg.webp' &&
      sceneTheme.v.customScenes[0].clock &&
      sceneTheme.v.customScenes[0].clock.top === 200 &&
      sceneTheme.v.customScenes[0].date &&
      sceneTheme.v.customScenes[0].date.top === 120 &&
      sceneTheme.v.customScenes[0].darkSky === true,
    'custom scenes: valid scene is accepted, bad id/filename/missing file/duplicate are dropped; darkSky is preserved'
  );
  ok(
    rs2.scenes &&
      rs2.scenes.set === 'custom' &&
      rs2.scenes.id === 'scene-theme' &&
      rs2.scenes.lib &&
      rs2.scenes.lib.length === 1 &&
      rs2.scenes.lib[0].id === 'night',
    'custom scenes: resolved output has scenes.lib and scenes.id'
  );
  const noSceneRaw = { name: 'NS', effects: { scenes: 'custom' } }; // custom but no scenes array
  const noSceneTheme = themeMod.normalize(noSceneRaw, 'noscene', null, sceneDir);
  ok(noSceneTheme.v['effects.scenes'] === 'off', 'effects.scenes "custom" without a valid scenes array falls back to off');
  // on the TV the launcher is a file:// page: a path alone does not reach the service, so the scene pictures need API in front,
  // like the theme's font and wallpaper (theme.js)
  ok(
    /customBase = wantCustom \? API \+ '\/api\/theme\/scene\/'/.test(fs.readFileSync(path.join(root, 'app/src/js/scenes.js'), 'utf8')),
    "custom scenes: the launcher asks the service's address for the pictures, not a path of the page"
  );
  const cardsShape = req('cards');
  const cs = cardsShape.sanitize({
    greeting: { type: 'greeting', name: 'Salih', x: { deep: { deeper: 1 } } },
    side: { type: 'ha-entities', entities: ['light.a', { entity: 'sensor.b', name: 'B' }, { nested: { no: 1 } }] },
    'Bad Id': { type: 'greeting' },
    row: { type: 'Not Valid' },
    empty: { type: 'none' },
  });
  ok(
    JSON.stringify(cs) ===
      JSON.stringify({
        greeting: { type: 'greeting', name: 'Salih' },
        side: { type: 'ha-entities', entities: ['light.a', { entity: 'sensor.b', name: 'B' }, {}] },
        empty: { type: 'none' },
      }) && cardsShape.sanitize([]) === undefined,
    'cards from the launcher are checked for shape: slot ids, card types, short option values'
  );
  const tbase = themeMod.normalize({ grid: { cols: 7 }, dock: { count: 6 } }, 'base'),
    tkid = themeMod.normalize({ grid: { cols: 'many' }, bar: { style: 'round' } }, 'kid', tbase.v);
  ok(
    tkid.v['grid.cols'] === 7 && tkid.v['dock.count'] === 6 && tkid.v['bar.style'] === 'round',
    'a theme that extends another keeps its values where its own are missing or invalid'
  );

  // a stand-in for raw.githubusercontent.com: the repository's folder, plus a few themes that are wrong on purpose
  const tWrong = {
    kid: JSON.stringify({ name: 'Kid', extends: 'bloom', bar: { style: 'flat' } }),
    notjson: '{ this is not json',
    huge: JSON.stringify({ name: 'x'.repeat(40000) }),
    badwall: JSON.stringify({ name: 'Bad wallpaper', effects: { wallpaper: 'w.jpg' } }),
    orphan: JSON.stringify({ name: 'Orphan', extends: 'missing-base' }),
    pixkid: JSON.stringify({ name: 'Pixel kid', extends: 'pixel', dock: { count: 4 } }),
    badfont: JSON.stringify({ name: 'Bad typeface', type: { fontFile: 'f.woff2' } }),
  };
  let ghUp = true;
  const ghHits = [];
  const gh = await serve((q, r) => {
    const u = q.url.split('?')[0];
    ghHits.push(u);
    const send = (c, b, t) => {
      r.writeHead(c, { 'content-type': t || 'application/octet-stream' });
      r.end(b);
    };
    if (!ghUp) return q.socket.destroy();
    let m = /^\/themes\/([a-z0-9-]+)\/theme\.json$/.exec(u);
    if (m && tWrong[m[1]]) return send(200, tWrong[m[1]]);
    if (/^\/themes\/badwall\/w\.jpg$/.test(u)) return send(200, Buffer.from('this is not a jpeg at all, just text'));
    if (/^\/themes\/badfont\/f\.woff2$/.test(u)) return send(200, Buffer.from('this is not a font file, only some text'));
    const f = path.join(root, u);
    if (!f.startsWith(tdir + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return send(404, 'no');
    send(200, fs.readFileSync(f));
  });
  const tlocal = path.join(tmp, 'themes-local');
  nc.mkdirp(path.join(tlocal, 'wallpapers'));
  fs.writeFileSync(path.join(tlocal, 'old.json'), '{}');
  fs.writeFileSync(path.join(tlocal, 'wallpapers', 'x.jpg'), 'x');
  process.env.CYTV_THEMES = tlocal;
  process.env.CYTV_THEMES_URL = gh.url + '/themes';
  const th = themeMod.create({ config: memoryConfig(), noStartup: true });
  ok(
    !fs.existsSync(path.join(tlocal, 'old.json')) && !fs.existsSync(path.join(tlocal, 'wallpapers')),
    'the files of the earlier layout (themes shipped with the service) are removed'
  );
  const tcall = (act, body, method) => call(th, '/api/theme/' + act, method || 'POST', body);
  let r = await tcall('list', null, 'GET');
  ok(
    r.j.current.id === 'classic' && r.j.themes.length === folders.length && r.j.themes[0].id === 'classic' && r.j.catalogue.ok === true,
    'the list comes from themes/index.json on GitHub, Classic first'
  );
  const rb = r.j.themes.filter(x => x.id === 'bloom')[0];
  ok(
    rb && rb.installed === false && rb.preview === true && /flower/i.test(rb.description),
    'a theme that is not on the TV is listed with its description and screenshot'
  );
  const rv = th.resolved();
  ok(
    rv.vars['--cols'] === '10' &&
      rv.vars['--tile-h'] === '151px' &&
      rv.vars['--acc'] === '#f5f6f8' &&
      rv.vars['--view-top'] === '300px' &&
      rv.vars['--dock-t'] === '60px' &&
      rv.vars['--grid-t'] === '350px' &&
      rv.cols === 10 &&
      rv.attrs.grid === 'below',
    'Classic is built in and resolves to the original positions'
  );
  const pv = await call(th, '/api/theme/preview/bloom', 'GET');
  ok(pv.code === 200 && Buffer.isBuffer(pv.out) && pv.out.length > 1000, 'the screenshot is fetched from GitHub and served');
  const hitsBefore = ghHits.length;
  await call(th, '/api/theme/preview/bloom', 'GET');
  ok(ghHits.length === hitsBefore, 'a screenshot is kept on the TV and not fetched again');
  r = await tcall('set', { id: 'bloom' });
  ok(
    r.code === 200 && r.j.current.id === 'bloom' && r.j.themes.filter(x => x.id === 'bloom')[0].installed === true,
    'choosing a theme downloads it and applies it'
  );
  ok(
    fs.existsSync(path.join(tlocal, 'bloom', 'theme.json')) && fs.existsSync(path.join(tlocal, 'bloom', 'bloom.jpg')),
    'the theme file and its wallpaper are kept on the TV'
  );
  const bl = th.resolved();
  ok(
    bl.wallpaper &&
      bl.wallpaper.id === 'bloom' &&
      bl.wallpaper.file === 'bloom.jpg' &&
      bl.attrs.grid === 'push' &&
      bl.attrs.galign === 'center' &&
      bl.push &&
      bl.push.up > 0 &&
      bl.dockN === 6 &&
      bl.vars['--dock-t'] !== 'auto' &&
      bl.vars['--dock-b'] === 'auto' &&
      bl.vars['--tile-w'] === '193px' &&
      bl.dockBottom === true,
    'a dock at the bottom with the push layout resolves to a scrolling grid below it, centred; dockBottom is set'
  );
  r = await tcall('wallpaper/bloom/bloom.jpg', null, 'GET');
  ok(r.code === 200, 'a downloaded wallpaper is served');
  r = await tcall('wallpaper/bloom/other.jpg', null, 'GET');
  ok(r.code === 404, 'a file the theme does not name is not served');
  r = await tcall('wallpaper/..%2f..%2fpasswd', null, 'GET');
  ok(r.code === 404, 'a path is not served as a wallpaper');
  // a theme's own typeface: downloaded with the theme, served from its folder, named first in --font
  ok(
    themeMod.fontOk(Buffer.from('wOF2' + 'x'.repeat(40)), 'a.woff2') &&
      !themeMod.fontOk(Buffer.from('wOF2' + 'x'.repeat(40)), 'a.ttf') &&
      !themeMod.fontOk(Buffer.from('<html>' + 'x'.repeat(40)), 'a.woff2'),
    'a typeface file is checked by its first bytes against its name'
  );
  r = await tcall('set', { id: 'pixel' });
  const px = th.resolved();
  ok(
    r.code === 200 &&
      fs.existsSync(path.join(tlocal, 'pixel', 'pixel.woff2')) &&
      px.font &&
      px.font.id === 'pixel' &&
      px.font.file === 'pixel.woff2' &&
      /^"CYTV Theme Font",/.test(px.vars['--font']),
    "a theme's typeface is downloaded with it and named first in the font"
  );
  r = await tcall('font/pixel/pixel.woff2', null, 'GET');
  ok(r.code === 200, 'the typeface is served');
  r = await tcall('font/pixel/other.woff2', null, 'GET');
  ok(r.code === 404, 'a typeface the theme does not name is not served');
  r = await tcall('set', { id: 'pixkid' });
  ok(
    r.code === 200 && th.resolved().font && th.resolved().font.id === 'pixel' && th.resolved().dockN === 4,
    'a theme that extends one with a typeface uses that file from its folder'
  );
  r = await tcall('set', { id: 'badfont' });
  ok(r.code !== 200 && !fs.existsSync(path.join(tlocal, 'badfont')), 'a typeface that is not a font is refused and nothing is kept');
  r = await tcall('set', { id: 'kid' });
  ok(
    r.code === 200 &&
      fs.existsSync(path.join(tlocal, 'kid', 'theme.json')) &&
      th.resolved().attrs.bar === 'flat' &&
      th.resolved().attrs.grid === 'push',
    'a theme that extends another one downloads and uses it'
  );
  r = await tcall('set', { id: 'nope' });
  ok(r.code === 400 && /unknown theme/.test(r.j.error), 'a theme that is not on GitHub is refused');
  r = await tcall('set', { id: 'notjson' });
  ok(r.code === 502 && !fs.existsSync(path.join(tlocal, 'notjson')), 'a theme file that is not JSON is refused and nothing is kept');
  r = await tcall('set', { id: 'huge' });
  ok(r.code === 502 && /too large/.test(r.j.error) && !fs.existsSync(path.join(tlocal, 'huge')), 'a theme file over 32 KB is refused');
  r = await tcall('set', { id: 'badwall' });
  ok(
    r.code === 502 && /not an image/.test(r.j.error) && !fs.existsSync(path.join(tlocal, 'badwall')),
    'a wallpaper that is not an image is refused and nothing is kept'
  );
  r = await tcall('set', { id: 'orphan' });
  ok(r.code === 502 && !fs.existsSync(path.join(tlocal, 'orphan', 'theme.json')), 'a theme whose base theme is missing is refused');
  r = await tcall('set', { id: '../x' });
  ok(r.code === 400, 'a bad theme id is refused');
  r = await tcall('set', { accent: 'blue' });
  ok(r.code === 400, 'an accent must be a hex colour');
  r = await tcall('set', { id: 'bloom', accent: '#FF8A3D' });
  ok(
    th.resolved().vars['--acc'] === '#ff8a3d' &&
      th.resolved().vars['--acc-ink'] === '#0b0c10' &&
      th.resolved().vars['--focus'] === '#ff8a3d',
    "an accent overrides the theme's own, with readable text on it"
  );
  r = await tcall('revert');
  ok(r.j.current.id === 'bloom' || r.j.current.id === 'kid', 'revert goes back to the previous theme');
  ghUp = false;
  await th.refreshCatalogue(true);
  r = await tcall('list', null, 'GET');
  ok(
    r.j.catalogue.ok === false && r.j.catalogue.error && r.j.themes.some(x => x.id === 'bloom' && x.installed),
    'GitHub unreachable: the list shows the themes on the TV and says why'
  );
  r = await tcall('set', { id: 'bloom' });
  ok(r.code === 200 && r.j.current.id === 'bloom', 'GitHub unreachable: a downloaded theme can still be chosen');
  r = await tcall('set', { id: 'midnight' });
  ok(
    r.code === 502 && /could not download/.test(r.j.error),
    'GitHub unreachable: a theme that was never downloaded says it could not be downloaded'
  );
  gh.server.close();

  // the page strip (addons.js in the launcher): a theme sets its look and place; the reply carries `strip` only for a theme that changes it
  {
    const ts = req('themeschema');
    const res = raw => ts.resolve(ts.normalize(raw, 'x', null));
    ok(
      res({ name: 'Plain' }).strip === undefined,
      'a theme without strip settings has no strip in its reply (the replies of the other themes stay as they were)'
    );
    const sd = res({
      name: 'S',
      strip: { style: 'dots', labels: 'current', colors: 'numbers', anchor: 'top', align: 'right', x: 400, y: 60, size: 1.2 },
    }).strip;
    ok(
      sd &&
        sd.style === 'dots' &&
        sd.labels === 'current' &&
        sd.colors === 'numbers' &&
        sd.anchor === 'top' &&
        sd.align === 'right' &&
        sd.x === 400 &&
        sd.y === 60 &&
        sd.size === 1.2,
      'a theme can set the strip style, names, colours, edge, side, distances and size'
    );
    const sc = res({ name: 'S', strip: { style: 'ribbon', labels: 'x', colors: 7, anchor: 'middle', show: 'yes' } }).strip;
    ok(sc === undefined, 'wrong values are ignored, and a theme that only has those is the default one');
    const sc2 = res({ name: 'S', strip: { size: 9, x: -5, y: 5000, show: false } }).strip;
    ok(
      sc2 && sc2.size === 1.6 && sc2.x === 0 && sc2.y === 900 && sc2.show === false,
      'sizes and distances are clamped to their range, and the strip can be hidden'
    );
    ok(res({ name: 'S', extends: 'x', strip: { show: true } }).strip === undefined, 'writing a default down is not a change');
    const bl = ts.resolve(
      ts.normalize(JSON.parse(fs.readFileSync(path.join(tdir, 'bloom', 'theme.json'), 'utf8')), 'bloom', null, path.join(tdir, 'bloom'))
    );
    ok(
      bl.strip && bl.strip.y === 14 && bl.strip.size === 0.92 && bl.strip.style === 'pills',
      'Bloom sets the strip lower and a little smaller, to sit under its glass dock'
    );
    const ls = ts.resolve(
      ts.normalize(
        JSON.parse(fs.readFileSync(path.join(tdir, 'lockscreen', 'theme.json'), 'utf8')),
        'lockscreen',
        null,
        path.join(tdir, 'lockscreen')
      )
    );
    const uc = (ls.slots || []).filter(sl => sl.id === 'under-clock')[0];
    ok(uc && uc.t === '262px' && uc.keep === true, 'Lock Screen has a place for a card under the clock');
    const cl = ts.resolve(ts.normalize(JSON.parse(fs.readFileSync(path.join(tdir, 'classic', 'theme.json'), 'utf8')), 'classic', null));
    ok(cl.strip === undefined, 'Classic writes down the default look, so it adds nothing to its reply');
  }

  // the documentation table is generated from the schema; the service ships no themes
  const gen = require(path.join(root, 'tools', 'theme-docs.js')),
    docs = fs.readFileSync(path.join(root, 'docs', 'themes.md'), 'utf8');
  ok(docs.indexOf(gen.table()) >= 0, 'docs/themes.md holds the table generated from the schema (run: node tools/theme-docs.js)');
  const noComments = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/#.*$/gm, '');
  ok(
    !/themes/.test(noComments('ipk/build.py')) && !/themes/.test(noComments('scripts/bootstrap.sh')),
    'the package build and the setup do not ship or copy themes'
  );
});
