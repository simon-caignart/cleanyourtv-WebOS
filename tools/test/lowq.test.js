// Pictures drawn at low quality (app/src/js/tiles.js, lowq): Chromium 120 on webOS 25 decodes a picture drawn at the default quality
// twice each time Home comes back from an app. A picture drawn at half its size or more has the same pixels at low quality, so only
// those are marked: a tile picture by the size it is laid out at (cover for Full tile pictures, contain for the others), the photo by
// the scale it covers the screen at (wall.test.js).
const fs = require('fs'),
  path = require('path'),
  vm = require('vm');
const { root, ok, run } = require('./lib');

function classes(init) {
  const set = new Set(init || []);
  return {
    add: c => set.add(c),
    remove: c => set.delete(c),
    contains: c => set.has(c),
    toggle: (c, on) => (on ? set.add(c) : set.delete(c), on),
  };
}

run(async () => {
  const context = { window: { devicePixelRatio: 2 } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'app/src/js/tiles.js'), 'utf8'), context);

  const el = { classList: classes() };
  context.lowq(el, 1);
  const at1 = el.classList.contains('lowq');
  context.lowq(el, 0.5);
  const at05 = el.classList.contains('lowq');
  context.lowq(el, 0.55);
  ok(at1 && !at05 && el.classList.contains('lowq'), 'low quality from 0.55 of the picture size up (0.5 and a margin for the press)');

  // a tile with its picture laid out at w x h CSS pixels, the picture n x m pixels, on a 4K TV (2 screen pixels per CSS pixel)
  const tile = (fill, w, h, n, m) => {
    const i = { offsetWidth: w, offsetHeight: h, naturalWidth: n, naturalHeight: m, classList: classes() };
    context.tileLowq({ _i: i, classList: classes(fill ? ['fill'] : []) });
    return i.classList.contains('lowq');
  };
  ok(tile(true, 250, 150, 610, 366), "a Full tile picture's copy (610 x 366) in a 250 x 150 Lounge tile at rest (0.82)");
  ok(!tile(true, 250, 150, 2000, 1200), 'a large picture before its copy is made (0.25) keeps the default quality');
  ok(tile(true, 250, 150, 1000, 400), 'a Full tile picture covers the tile: its larger scale counts (0.5 x 1.25 -> 0.75)');
  ok(tile(false, 84, 84, 128, 128) && !tile(false, 168, 168, 1024, 1024), 'an icon inside the tile: grown (1.3) yes, drawn at a third no');
  ok(
    tile(false, 120, 60, 400, 50) && !tile(false, 120, 60, 500, 50),
    'an icon fits inside its box: its smaller scale counts (0.6 yes, 0.48 no, though its height is drawn at 2.4)'
  );
  const none = { offsetWidth: 100, offsetHeight: 100, naturalWidth: 0, naturalHeight: 0, classList: classes(['lowq']) };
  context.tileLowq({ _i: none, classList: classes() });
  ok(none.classList.contains('lowq'), 'a picture not loaded yet is left as it is');
});
