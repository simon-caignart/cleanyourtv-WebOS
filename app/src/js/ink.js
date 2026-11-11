/* ---------- surface.ink auto: dark or white ink for the glass top buttons and the pill clock. The glass stays clear, like the dock's;
   what changes is its content, from how bright the picture is under the buttons and the clock. Measured once per picture on a 32 x 18
   copy (no work per frame); the change happens while the buttons and the clock are faded out. ---------- */
var INK = (function () {
  var cv = null,
    seen = null,
    dark = false,
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
  /* the mean light of that part of the picture (linear, 0 to 1); throws when the picture may not be read */
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
      sum = 0;
    for (var k = 0; k < d.length; k += 4) sum += luma([d[k], d[k + 1], d[k + 2]]);
    return sum / (d.length / 4);
  }
  function show(d) {
    if (d === dark) return;
    dark = d;
    var b = document.body;
    b.classList.add('ink-swap');
    clearTimeout(swapT);
    swapT = setTimeout(function () {
      b.classList.toggle('ink-dark', dark);
      b.classList.remove('ink-swap');
    }, 200);
  }
  /* src: the picture behind Home ('' for none); dim: how far it is darkened with the page colour night ([r, g, b]); bright: what is known
     about a picture that cannot be read (a scene marked as having a bright sky) */
  function set(src, dim, night, bright) {
    var b = document.body;
    if (b.getAttribute('data-inkmode') !== 'auto') {
      clearTimeout(swapT);
      dark = false;
      seen = null;
      b.classList.remove('ink-dark', 'ink-swap');
      return;
    }
    var key = src + '|' + dim + '|' + (bright ? 1 : 0);
    if (key === seen) return;
    seen = key;
    if (!src) return show(!!bright || luma(night) > INK_DARK);
    var i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = function () {
      if (seen !== key) return;
      try {
        show(measure(i) * (1 - dim) + luma(night) * dim > INK_DARK);
      } catch (e) {
        show(!!bright);
      }
    };
    i.onerror = function () {
      if (seen === key) show(!!bright);
    };
    i.src = src;
  }
  return { set: set, luma: luma };
})();
/* above this mean light under the buttons (about #8a8a8a) dark ink reads better than white on the clear glass */
var INK_DARK = 0.25;
