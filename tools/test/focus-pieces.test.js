// The focused tile's deeper shadow and its light (focusPieces in app/src/js/tiles.js, tile.shadow soft and tile.highlight focus): three
// sets per row of tiles, drawn at rest at the grown size, that take turns and only move by transform, so a move of the focus draws
// nothing again (each tile had a shadow and a light of its own, drawn the first time it was focused: a missed frame per move on the TV)
const fs = require('fs'),
  path = require('path'),
  vm = require('vm');
const { root, ok, run } = require('./lib');

function classes(el) {
  const set = new Set();
  return {
    add: c => set.add(c),
    remove: c => set.delete(c),
    contains: c => set.has(c),
    toggle: (c, on) => (on ? set.add(c) : set.delete(c)),
    get value() {
      return [...set].join(' ');
    },
  };
}
function element(tag) {
  const el = { tagName: tag, children: [], parentNode: null, style: {}, offsetLeft: 0, offsetTop: 0, offsetWidth: 0, offsetHeight: 0 };
  el.classList = classes(el);
  Object.defineProperty(el, 'className', {
    set: v => v.split(' ').forEach(c => el.classList.add(c)),
    get: () => el.classList.value,
  });
  el.appendChild = c => {
    if (c.parentNode) c.parentNode.children.splice(c.parentNode.children.indexOf(c), 1);
    el.children.push(c);
    c.parentNode = el;
  };
  el.querySelector = sel => el.children.find(c => sel === '.tile' && c.classList.contains('tile')) || null;
  return el;
}

run(async () => {
  const body = element('body'),
    attrs = { 'data-tshadow': 'soft', 'data-hl': 'focus' },
    vars = { '--dock-fs': '1.22', '--grid-fs': '1.22', '--dock-lift': '0px', '--press-s': '0.96' },
    boxes = { dock: element('div'), grid: element('div') };
  body.getAttribute = k => attrs[k] || null;
  boxes.dock.id = 'dock';
  boxes.grid.id = 'grid';
  boxes.grid.offsetTop = 1100;
  const tile = (box, i) => {
    const t = element('div');
    t.className = 'tile';
    t.offsetLeft = 40 + i * 298;
    t.offsetTop = 40;
    t.offsetWidth = 250;
    t.offsetHeight = 150;
    boxes[box].appendChild(t);
    return t;
  };
  const dock = [0, 1, 2, 3].map(i => tile('dock', i)),
    grid = [0, 1].map(i => tile('grid', i));
  const context = {
    document: { body, createElement: element, documentElement: {} },
    $: id => boxes[id] || null,
    // input.js: puts back the pieces left out of the page while Home was hidden
    putBack() {},
    window: {
      getComputedStyle: el => ({
        getPropertyValue: k => vars[k] || '',
        opacity: el.classList && el.classList.contains('on') ? '1' : '0.004',
        transform: '',
      }),
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'app/src/js/tiles.js'), 'utf8'), context);
  const sets = box => {
    const p = boxes[box].children.filter(c => c.classList.contains('fpc'));
    return [0, 2, 4].map(k => [p[k], p[k + 1]]);
  };
  const onSet = box => sets(box).filter(s => s[0].classList.contains('on'));

  context.focusPieces(dock[0]);
  ok(sets('dock').length === 3 && sets('grid').length === 3, 'the dock and the grid get three sets each, a shadow and a light');
  ok(
    sets('dock').every(s => s[0].style.width === '250px' && s[0].style.height === '150px'),
    'every set has its size from the start, so it is drawn at rest'
  );
  ok(
    sets('grid').every(s => /^translate\(40px,-800px\) scale\(1\.22\)$/.test(s[0].style.transform) && !s[0].classList.contains('on')),
    "the grid's sets wait grown and invisible on the screen, where they are drawn ahead of the first Down: " +
      sets('grid')[0][0].style.transform
  );
  let on = onSet('dock');
  ok(
    on.length === 1 && on[0][0].style.transform === 'translate(40px,40px) translateY(0px) scale(1.22)' && on[0][1].classList.contains('on'),
    'the focused tile gets a set, grown with it: ' + (on[0] && on[0][0].style.transform)
  );
  const first = on[0];
  context.focusPieces(dock[1]);
  on = onSet('dock');
  ok(
    on.length === 1 && on[0] !== first && on[0][0].style.transform === 'translate(338px,40px) translateY(0px) scale(1.22)',
    'a move gives the new tile another set'
  );
  ok(
    !first[0].classList.contains('on') && first[0].style.transform === 'translate(40px,40px)',
    'and the set of the tile it leaves shrinks and fades out with that tile, where it is'
  );
  // the one reused is the one that left longest ago: the set still fading out under the tile before is left alone
  const second = on[0];
  context.focusPieces(dock[2]);
  on = onSet('dock');
  ok(on[0] !== first && on[0] !== second, 'quick presses do not take the set that is still fading out');
  dock[2].classList.add('press');
  context.focusPieces(dock[2]);
  ok(
    on[0][0].style.transform === 'translate(636px,40px) scale(0.96)' && on[0][0].classList.contains('press'),
    'OK held: the set sinks with the tile'
  );
  dock[2].classList.remove('press');
  // back on a tile it just left (quick Left and Right): the set still over it turns round with the tile, from where it is, with no jump
  // to rest; a set grown from rest there would be smaller than the tile, a frame inside it, with the one still leaving
  const jumps = [];
  second.forEach(p => {
    let v = p.style.transition;
    Object.defineProperty(p.style, 'transition', { get: () => v, set: x => (jumps.push(x), (v = x)) });
  });
  context.focusPieces(dock[1]);
  on = onSet('dock');
  ok(
    on.length === 1 &&
      on[0][0] === second[0] &&
      !jumps.length &&
      second[0].style.transform === 'translate(338px,40px) translateY(0px) scale(1.22)',
    'focus back on the tile before: its own set grows again from where it is: ' + jumps.join()
  );
  context.focusPieces(dock[2]);

  // a move reads the tiles' places once (they are kept until the tiles or the theme change)
  let reads = 0;
  Object.defineProperty(dock[3], 'offsetLeft', { get: () => (reads++, 40 + 3 * 298) });
  context.focusPieces(dock[3]);
  context.focusPieces(dock[2]);
  context.focusPieces(dock[3]);
  ok(reads === 1, 'a tile focused again reads no layout: ' + reads + ' reads');
  context.fpGen++;
  context.focusPieces(dock[2]);
  context.focusPieces(dock[3]);
  ok(reads === 2, 'after a rebuild or a new theme its place is read again');

  context.focusPieces(grid[1]);
  ok(onSet('dock').length === 0 && onSet('grid').length === 1, 'the focus going down to the grid takes its set there along');
  context.focusPieces(null);
  ok(onSet('dock').length === 0 && onSet('grid').length === 0, 'no focused tile fades them all out');

  // a theme without them: no pieces are made
  attrs['data-tshadow'] = attrs['data-hl'] = null;
  boxes.dock._fp = boxes.grid._fp = null;
  boxes.dock.children = boxes.dock.children.filter(c => !c.classList.contains('fpc'));
  context.focusPieces(dock[0]);
  ok(!boxes.dock.children.some(c => c.classList.contains('fpc')), 'a theme without the soft shadow and the focus light gets no pieces');
});
