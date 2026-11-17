// Tile pictures (app/src/js/tiles.js): a picture larger than its tile is ever drawn is replaced, once and while idle, by a copy of the
// size it is shown at (JPEG, or PNG for one with see-through parts); a theme with larger tiles loads the picture at its own size again.
// On a TV that draws Home at half its devicePixelRatio (webOS 25 on an LG C4: 2, on a 1920 x 1080 surface) the copy is halved: each
// 2 x 2 block averaged, as PNG, the picture the browser itself draws there.
const fs = require('fs'),
  path = require('path'),
  vm = require('vm');
const { root, ok, run } = require('./lib');

function setup(win) {
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
  const made = {}; // blob url -> {w, h}
  const canvases = [],
    blobs = [];
  function image() {
    const i = { parentNode: null, remove() {} };
    let src = '';
    Object.defineProperty(i, 'src', {
      set(v) {
        src = v;
        const p = pictures[v.split('?')[0]] || (v.indexOf('blob:') === 0 ? made[v] || { w: 1, h: 1 } : null);
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
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData() {},
    });
    c.toBlob = (cb, type, q) => {
      blobs.push({ type, q, w: c.width, h: c.height });
      cb({ type, w: c.width, h: c.height });
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
    URL: {
      createObjectURL: b => {
        const u = 'blob:' + Object.keys(made).length;
        made[u] = { w: b.w || 1, h: b.h || 1 };
        return u;
      },
      revokeObjectURL() {},
    },
    window: Object.assign(
      {
        devicePixelRatio: 2,
        getComputedStyle: () => ({ getPropertyValue: k => vars[k] || '' }),
        requestIdleCallback: fn => fn(),
      },
      win
    ),
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
  const posts = [];
  context.XMLHttpRequest = function () {
    let to = '';
    this.open = (m, u) => (to = m + ' ' + u);
    this.setRequestHeader = () => {};
    this.send = b => posts.push({ to, type: b && b.type });
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'app/src/js/tiles.js'), 'utf8'), context);
  return { context, pictures, blobs, posts, setVars: v => (vars = Object.assign({}, vars, v)) };
}

run(async () => {
  const { context, pictures, blobs, posts, setVars } = setup();

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

  ok(
    posts.length === 1 && posts[0].to === 'POST http://127.0.0.1:8765/api/icons/small/full?v=3&s=610x366' && posts[0].type === 'image/jpeg',
    "the copy of an app's own picture goes to the service, for this version and tile size: " + JSON.stringify(posts)
  );
  ok(
    context.iconUrl({ id: 'full', iv: 3, is: '610x366' }) === 'http://127.0.0.1:8765/icon/full?v=3&s=610x366' &&
      context.iconUrl({ id: 'full', iv: 3, is: '500x300' }) === 'http://127.0.0.1:8765/icon/full?v=3',
    "the next start asks for the service's copy, when it was made for tiles of this size"
  );
  pictures['http://127.0.0.1:8765/icon/kept'] = { w: 610, h: 366 };
  const kept = context.tile({ id: 'kept', title: 'Kept', iv: 4, it: 1, is: '610x366' });
  ok(kept._i.src === 'http://127.0.0.1:8765/icon/kept?v=4&s=610x366' && blobs.length === 1, 'a copy from the service is shown as it is');

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
  setVars({ '--dock-w': '500px', '--dock-h': '300px' });
  context.regrowIcons();
  ok(
    full._small === '' && full._i.src === 'http://127.0.0.1:8765/icon/full?v=3' && blobs.length === 2,
    'a theme with larger tiles shows the picture from its own file again'
  );

  // the TV draws Home at half its devicePixelRatio: webOS gives the app a 1920 pixel wide screen, the page is 1920 CSS pixels wide
  const tv = setup({ innerWidth: 1920, webOSSystem: { deviceInfo: JSON.stringify({ screenWidth: 1920, screenHeight: 1080 }) } });
  const hn = tv.context.iconNeed();
  ok(
    hn.half && hn.w === 610 && hn.h === 366 && hn.key === '305x183',
    'drawn at 1 screen pixel per CSS pixel: copies made at 610 x 366, kept at 305 x 183 (got ' + JSON.stringify(hn) + ')'
  );
  tv.pictures['http://127.0.0.1:8765/icon/full'] = { w: 1000, h: 600 };
  const tf = tv.context.tile({ id: 'full', title: 'Full', iv: 3, it: 1 });
  ok(
    tv.blobs.length === 2 &&
      tv.blobs[0].type === 'image/jpeg' &&
      tv.blobs[0].w === 610 &&
      tv.blobs[1].type === 'image/png' &&
      tv.blobs[1].w === 305 &&
      tv.blobs[1].h === 183 &&
      tf._i.naturalWidth === 305,
    'the 610 x 366 JPEG copy is halved into a 305 x 183 PNG, which the tile shows: ' + JSON.stringify(tv.blobs)
  );
  ok(
    tv.posts.length === 1 &&
      tv.posts[0].to === 'POST http://127.0.0.1:8765/api/icons/small/full?v=3&s=305x183' &&
      tv.posts[0].type === 'image/png',
    'the half copy goes to the service under its own size: ' + JSON.stringify(tv.posts)
  );
  ok(
    tv.context.iconUrl({ id: 'full', iv: 3, is: '305x183' }) === 'http://127.0.0.1:8765/icon/full?v=3&s=305x183' &&
      tv.context.iconUrl({ id: 'full', iv: 3, is: '610x366' }) === 'http://127.0.0.1:8765/icon/full?v=3',
    'a copy kept from before (610 x 366) is made again as a half copy'
  );
  tv.pictures['http://127.0.0.1:8765/icon/exact'] = { w: 610, h: 366 };
  const te = tv.context.tile({ id: 'exact', title: 'Exact' });
  ok(
    tv.blobs.length === 3 && tv.blobs[2].type === 'image/png' && tv.blobs[2].w === 305 && te._i.naturalWidth === 305,
    'a picture already twice the drawn size is halved as it is, without a JPEG copy'
  );
  tv.pictures['http://127.0.0.1:8765/icon/glass'] = { w: 610, h: 366, alpha: true };
  tv.context.tile({ id: 'glass', title: 'Glass' });
  tv.pictures['http://127.0.0.1:8765/icon/mid'] = { w: 500, h: 300 };
  tv.context.tile({ id: 'mid', title: 'Mid' });
  ok(tv.blobs.length === 3, 'not one with see-through parts, nor one less than twice the drawn size');
  const plain = setup({ innerWidth: 1920, webOSSystem: { deviceInfo: JSON.stringify({ screenWidth: 3840 }) } }).context.iconNeed();
  ok(!plain.half && plain.key === '610x366', 'a TV that draws Home at its devicePixelRatio keeps copies as before');

  // the halving itself
  const src = new Uint8ClampedArray(3 * 3 * 4);
  for (let p = 0; p < 9; p++) src.set([p * 10, 255 - p * 10, 7, 255], p * 4);
  const out = new Uint8ClampedArray(2 * 2 * 4);
  tv.context.halve(src, 3, 3, out);
  ok(
    out[0] === 20 && out[1] === 235 && out[2] === 7 && out[3] === 255 && out[4] === 35 && out[8] === 65 && out[12] === 80,
    'each 2 x 2 block averaged and rounded, the last row and column of an odd size with themselves: ' + Array.from(out).join(',')
  );
});
