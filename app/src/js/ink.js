/* ---------- surface.ink auto and surface.tint: the glass top buttons and the pill clock follow the picture under them. The glass stays
   clear, like the dock's; with ink auto its content turns dark over a bright picture, and with a tint the glass takes some of the
   picture's colour. Measured once per picture on a 32 x 18 copy (no work per frame); the change happens while the buttons and the clock
   are faded out. ---------- */
var INK = (function () {
  var cv = null,
    seen = null,
    dark = false,
    tint = '',
    swapT = 0;
  var lin = function (c) {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  function luma(rgb) {
    return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  }
  /* the part of the 1920 x 1080 screen under the buttons and the clock, in cells of 60 px (the 32 x 18 copy) */
  function cells() {
    var box = null;
    ['bar', 'clock'].forEach(function (id) {
      var el = $(id),
        r = el && el.offsetWidth ? el.getBoundingClientRect() : null;
      if (!r) return;
      box = box
        ? { l: Math.min(box.l, r.left), t: Math.min(box.t, r.top), r: Math.max(box.r, r.right), b: Math.max(box.b, r.bottom) }
        : { l: r.left, t: r.top, r: r.right, b: r.bottom };
    });
    if (!box) box = { l: 1200, t: 40, r: 1880, b: 130 };
    var x0 = Math.max(0, Math.min(31, Math.floor(box.l / 60))),
      y0 = Math.max(0, Math.min(17, Math.floor(box.t / 60)));
    return {
      x: x0,
      y: y0,
      w: Math.max(1, Math.min(32, Math.ceil(box.r / 60)) - x0),
      h: Math.max(1, Math.min(18, Math.ceil(box.b / 60)) - y0),
    };
  }
  /* the mean light of that part of the picture (l: linear, 0 to 1) and its mean colour (c: [r, g, b]); throws when the picture may not
     be read */
  function measure(img) {
    if (!cv) {
      cv = document.createElement('canvas');
      cv.width = 32;
      cv.height = 18;
    }
    var x = cv.getContext('2d'),
      c = cells();
    x.drawImage(img, 0, 0, 32, 18);
    var d = x.getImageData(c.x, c.y, c.w, c.h).data,
      sum = 0,
      rgb = [0, 0, 0],
      n = d.length / 4;
    for (var k = 0; k < d.length; k += 4) {
      sum += luma([d[k], d[k + 1], d[k + 2]]);
      rgb[0] += d[k];
      rgb[1] += d[k + 1];
      rgb[2] += d[k + 2];
    }
    return {
      l: sum / n,
      c: rgb.map(function (v) {
        return v / n;
      }),
    };
  }
  /* d: dark ink; col: the colour of the picture ([r, g, b]), or null when it is not known (the glass is then not tinted) */
  function show(d, col) {
    var b = document.body,
      t = col && b.hasAttribute('data-tint') ? col.map(Math.round).join(',') : '';
    if (b.getAttribute('data-inkmode') !== 'auto') d = false;
    if (d === dark && t === tint) return;
    dark = d;
    tint = t;
    b.classList.add('ink-swap');
    clearTimeout(swapT);
    swapT = setTimeout(function () {
      b.classList.toggle('ink-dark', dark);
      b.classList.toggle('tinted', !!tint);
      if (tint) b.style.setProperty('--ink-tint', tint);
      else b.style.removeProperty('--ink-tint');
      b.classList.remove('ink-swap');
    }, 200);
  }
  /* src: the picture behind Home ('' for none); dim: how far it is darkened with the page colour night ([r, g, b]); bright and col: what
     is known about a picture that cannot be read (a scene marked as having a bright sky, a built-in scene's colour) */
  function set(src, dim, night, bright, col) {
    var b = document.body;
    if (b.getAttribute('data-inkmode') !== 'auto' && !b.hasAttribute('data-tint')) {
      clearTimeout(swapT);
      dark = false;
      tint = '';
      seen = null;
      b.classList.remove('ink-dark', 'ink-swap', 'tinted');
      b.style.removeProperty('--ink-tint');
      return;
    }
    var key = [src, dim, bright ? 1 : 0, col, night, b.getAttribute('data-inkmode'), b.hasAttribute('data-tint')].join('|');
    if (key === seen) return;
    seen = key;
    if (!src) return col ? show(!!bright, col) : show(!!bright || luma(night) > INK_DARK, night);
    var i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = function () {
      if (seen !== key) return;
      try {
        var m = measure(i);
        show(
          m.l * (1 - dim) + luma(night) * dim > INK_DARK,
          m.c.map(function (v, k) {
            return v * (1 - dim) + night[k] * dim;
          })
        );
      } catch (e) {
        show(!!bright, col || null);
      }
    };
    i.onerror = function () {
      if (seen === key) show(!!bright, col || null);
    };
    i.src = src;
  }
  return { set: set, luma: luma };
})();
/* above this mean light under the buttons (about #8a8a8a) dark ink reads better than white on the clear glass */
var INK_DARK = 0.25;
