/* ---------- Top Shelf (theme: effects.topShelf; Customise > Look > Top Shelf overrides it, cfg.topShelf): while an app in the dock is
   focused, its backdrop (a 16:9 picture chosen on the phone, kept by the App icons add-on) is behind Home, cross-faded between two layers
   (opacity only) once the focus settles. An app without one fades back to the usual background (scenes, Wallpapers or the theme's
   wallpaper). With the focus in the app grid the backdrop of the last dock app stays, covered by its blurred copy (made on the phone: the
   TV does not blur). The top row of buttons and the cards leave it as it is.
   A full-screen CSS background costs a 3840 x 2160 texture on a 4K TV and froze the screen for 60 to 100 ms when a second one faded in,
   so each layer is a small canvas stretched over the screen: the picture drawn at 960 x 540 with the shade drawn in, the blurred copy
   at 240 x 135, which the compositor scales up for nothing. The layers stay on the page (at an opacity that cannot be seen) while Top
   Shelf is on, and a picture is decoded before it is drawn. ---------- */
var TOPSHELF = (function () {
  var W = 960,
    H = 540,
    GW = 240,
    GH = 135;
  var list = {} /* app id -> {v: version, g: 1 when it has a blurred copy} */,
    els = null,
    side = 0,
    cur = '' /* the app (and version) whose backdrop is on screen */,
    want = '' /* the app whose backdrop is wanted once the focus settles */,
    timer = 0,
    asked = '';
  function enabled() {
    if (!iconsOn) return false;
    if (typeof cfg.topShelf === 'boolean') return cfg.topShelf;
    return themeDefault();
  }
  function themeDefault() {
    return !!(cfg.theme && cfg.theme.topShelf);
  }
  /* two picture layers and the blurred copy, inside #homepage (they turn with Home when the book turns to a page) and under the glow,
     the dock and the grid */
  function layers() {
    if (els) return els;
    var g = $('gA');
    els = ['tsA', 'tsB', 'tsG'].map(function (id) {
      var d = document.createElement('canvas');
      d.id = id;
      d.className = id === 'tsG' ? 'tsg' : 'tsb';
      d.width = id === 'tsG' ? GW : W;
      d.height = id === 'tsG' ? GH : H;
      g.parentNode.insertBefore(d, g);
      return d;
    });
    return els;
  }
  function drop() {
    if (!els) return;
    els.forEach(function (d) {
      if (d.parentNode) d.parentNode.removeChild(d);
    });
    els = null;
  }
  function src(id, glass) {
    return API + '/api/icons/backdrop/' + encodeURIComponent(id) + (glass ? '/glass' : '') + '?v=' + list[id].v;
  }
  function none() {
    clearTimeout(timer);
    want = '';
    cur = '';
    document.body.classList.remove('ts-on');
    if (els) {
      els[0].classList.remove('on');
      els[1].classList.remove('on');
      els[2].classList.remove('has');
    }
  }
  /* a picture, loaded and decoded (where the browser can say when) before anything is drawn */
  function picture(url) {
    return new Promise(function (ok, no) {
      var im = new Image();
      im.onload = function () {
        if (im.decode)
          im.decode().then(
            function () {
              ok(im);
            },
            function () {
              ok(im);
            }
          );
        else ok(im);
      };
      im.onerror = no;
      im.src = url;
    });
  }
  /* the picture over the whole canvas, its middle kept, then the shade: a little darker at the top and the bottom, so the clock, the
     buttons and the dock stay readable on a bright picture */
  function draw(cv, im) {
    var x = cv.getContext('2d'),
      iw = im.naturalWidth,
      ih = im.naturalHeight,
      k = Math.max(W / iw, H / ih),
      dw = iw * k,
      dh = ih * k;
    x.drawImage(im, (W - dw) / 2, (H - dh) / 2, dw, dh);
    var gr = x.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, 'rgba(0,0,0,0.36)');
    gr.addColorStop(0.26, 'rgba(0,0,0,0)');
    gr.addColorStop(0.6, 'rgba(0,0,0,0)');
    gr.addColorStop(1, 'rgba(0,0,0,0.32)');
    x.fillStyle = gr;
    x.fillRect(0, 0, W, H);
  }
  /* the blurred copy, darkened a little with the theme's night colour, as the scenes' frosted glass is */
  function drawGlass(cv, im) {
    var x = cv.getContext('2d'),
      night = (getComputedStyle(document.documentElement).getPropertyValue('--night-rgb') || '7, 8, 11').trim();
    x.drawImage(im, 0, 0, GW, GH);
    x.fillStyle = 'rgba(' + night + ',0.33)';
    x.fillRect(0, 0, GW, GH);
  }
  /* a newer focus wins: nothing is drawn for an app that is no longer wanted */
  function show(id) {
    if (!id) return none();
    var key = id + '?' + list[id].v;
    if (key === cur) return;
    Promise.all([picture(src(id)), list[id].g ? picture(src(id, true)).catch(function () {}) : null]).then(
      function (p) {
        if (want !== id || !enabled() || !list[id]) return;
        var l = layers(),
          on = l[side],
          off = l[side ^ 1];
        side ^= 1;
        draw(on, p[0]);
        on.classList.add('on');
        off.classList.remove('on');
        if (p[1]) {
          drawGlass(l[2], p[1]);
          l[2].classList.add('has');
        } else l[2].classList.remove('has');
        document.body.classList.add('ts-on');
        cur = key;
      },
      function () {
        if (want === id) none();
      }
    );
  }
  /* the focus moved (setFocus): e the element, row its row (0 the buttons, 1 the dock, 2 and on the grid) */
  function focus(e, row) {
    if (!enabled()) return;
    document.body.classList.toggle('ts-grid', row >= 2);
    if (!e || e.parentNode !== $('dock')) return;
    var a = e._a,
      id = a && !a.input && list[a.id] ? a.id : '';
    want = id;
    clearTimeout(timer);
    /* after the focus settles, as the ambient glow does (tiles.js glowSoon) */
    timer = setTimeout(function () {
      show(want);
    }, 110);
  }
  /* the focused tile now, when it is in the dock */
  function focused() {
    var e = rows[r] && rows[r][c];
    return e && e.parentNode === $('dock') ? e : null;
  }
  /* after the settings were read (load, saveCfg): switched on or off, and which apps have a backdrop (asked each time Home opens, so a
     picture sent from the phone shows when Home comes back) */
  function sync() {
    if (!enabled()) {
      document.body.classList.remove('ts-grid');
      none();
      return drop();
    }
    layers();
    api('/api/icons/backdrops').then(
      function (x) {
        list = (x && x.backdrops) || {};
        var k = JSON.stringify(list);
        if (k === asked && cur) return;
        asked = k;
        var e = focused();
        if (e) focus(e, 1);
        else if (cur && !list[cur.split('?')[0]]) none();
      },
      function () {
        list = {};
        none();
      }
    );
  }
  return {
    sync: sync,
    focus: focus,
    enabled: enabled,
    themeDefault: themeDefault,
    has: function (id) {
      return !!list[id];
    },
    /* Customise > Look > Top Shelf: the other way round; the same as the theme is not saved, so another theme brings its own again */
    toggle: function () {
      var on = !enabled();
      if (on === themeDefault()) delete cfg.topShelf;
      else cfg.topShelf = on;
    },
    /* the tile menu's Reset backdrop */
    reset: function (id) {
      return api('/api/icons/backdrop/reset', { id: id }).then(function () {
        delete list[id];
        if (cur.split('?')[0] === id) none();
      });
    },
  };
})();
