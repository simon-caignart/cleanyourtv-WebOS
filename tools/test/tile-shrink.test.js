// Tile pictures (app/src/js/tiles.js): a picture larger than its tile is ever drawn is replaced, once and while idle, by a copy of the
// size it is shown at (JPEG, or PNG for one with see-through parts); a theme with larger tiles loads the picture at its own size again
const fs = require('fs'),
  path = require('path'),
  vm = require('vm');
const { root, ok, run } = require('./lib');

run(async () => {
  // Lounge on a 4K TV: dock and grid tiles 250 x 150, focus 1.22, drawn at 2 screen pixels per CSS pixel
  let vars = {
    '--dock-w': '250px',
    '--dock-h': '150px',
    '--dock-fs': '1.22',
    '--tile-w': '250px',
    '--tile-h': '150px',
    '--grid-fs': '1.22',
  };
  const pictures = {}; // url -> {w, h, alpha}
  const canvases = [],
    blobs = [];
  function image() {
    const i = { parentNode: null, remove() {} };
    let src = '';
    Object.defineProperty(i, 'src', {
      set(v) {
        src = v;
        const p = pictures[v.split('?')[0]] || (v.indexOf('blob:') === 0 ? { w: 1, h: 1 } : null);
        if (p) {
          i.naturalWidth = p.w;
          i.naturalHeight = p.h;
          i._alpha = p.alpha;
          if (i.onload) i.onload();
        }
      },
      get: () => src,
    });
    return i;
  }
  function canvas() {
    const c = { width: 0, height: 0, drawn: null };
    c.getContext = () => ({
      drawImage(im) {
        c.drawn = im;
      },
      getImageData: () => {
        const d = new Uint8ClampedArray(c.width * c.height * 4).fill(255);
        if (c.drawn && c.drawn._alpha) d[3] = 0;
        return { data: d };
      },
    });
    c.toBlob = (cb, type, q) => {
      blobs.push({ type, q, w: c.width, h: c.height });
      cb({ type });
    };
    canvases.push(c);
    return c;
  }
  const context = {
    tiles: {},
    colors: {},
    API: 'http://127.0.0.1:8765',
    LIVE_ICON: 'data:image/svg+xml;base64,PHN2Zy8+',
    Image: image,
    document: { createElement: n => (n === 'canvas' ? canvas() : { appendChild() {}, remove() {}, classList: { add() {} } }) },
    URL: { createObjectURL: () => 'blob:' + blobs.length, revokeObjectURL() {} },
    window: {
      devicePixelRatio: 2,
      getComputedStyle: () => ({ getPropertyValue: k => vars[k] || '' }),
      requestIdleCallback: fn => fn(),
    },
    encodeURIComponent,
    rows: [],
    r: 0,
    c: 0,
    glowNow() {},
    hit() {},
    paint() {},
    fit() {},
    iconColor: () => ({ c: [0, 0, 0], b: [0, 0, 0] }),
    storeSoon() {},
  };
  context.window.URL = context.URL;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'app/src/js/tiles.js'), 'utf8'), context);

  const need = context.iconNeed();
  ok(
    need.w === 610 && need.h === 366,
    'the largest a Lounge tile is drawn on a 4K TV: 610 x 366 screen pixels (got ' + JSON.stringify(need) + ')'
  );

  pictures['http://127.0.0.1:8765/icon/full'] = { w: 1000, h: 600 };
  const full = context.tile({ id: 'full', title: 'Full', iv: 3, it: 1 });
  ok(
    /^blob:/.test(full._i.src) && blobs.length === 1 && blobs[0].type === 'image/jpeg' && blobs[0].w === 610 && blobs[0].h === 366,
    'a 1000 x 600 Full tile picture is shown from a 610 x 366 JPEG copy: ' + JSON.stringify(blobs)
  );

  pictures['http://127.0.0.1:8765/icon/clear'] = { w: 1200, h: 720, alpha: true };
  const clear = context.tile({ id: 'clear', title: 'Clear', iv: 1 });
  ok(/^blob:/.test(clear._i.src) && blobs[1].type === 'image/png', 'a picture with see-through parts stays PNG');

  pictures['http://127.0.0.1:8765/icon/logo'] = { w: 512, h: 512 };
  const logo = context.tile({ id: 'logo', title: 'Logo' });
  ok(
    logo._i.src === 'http://127.0.0.1:8765/icon/logo' && blobs.length === 2,
    'a picture not larger than the tile is drawn is left as it is'
  );

  pictures['http://127.0.0.1:8765/icon/near'] = { w: 700, h: 420 };
  context.tile({ id: 'near', title: 'Near' });
  ok(blobs.length === 2, 'nor one that would save less than a third of its pixels');

  // a theme with tiles twice as large: the copies made for the smaller ones are dropped and the pictures made again for the new size
  vars = Object.assign({}, vars, { '--dock-w': '500px', '--dock-h': '300px' });
  context.regrowIcons();
  ok(
    full._small === '' && full._i.src === 'http://127.0.0.1:8765/icon/full?v=3' && blobs.length === 2,
    'a theme with larger tiles shows the picture from its own file again'
  );
});
