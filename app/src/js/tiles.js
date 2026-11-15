/* ---------- tiles (built once per app, reused across rebuilds) ---------- */
function tile(a) {
  /* a new custom icon (iv, the App icons add-on) or a new way to show it (it: Full tile): build the tile again, with the colour of the new picture */
  if (tiles[a.id] && ((tiles[a.id]._iv || 0) !== (a.iv || 0) || (tiles[a.id]._it || 0) !== (a.it ? 1 : 0))) {
    delete tiles[a.id];
    delete colors[a.id];
    storeSoon();
  }
  if (tiles[a.id]) {
    tiles[a.id]._a = a;
    return a.input ? inputTile(tiles[a.id], a) : tiles[a.id];
  }
  var d = document.createElement('div');
  d.className = 'tile' + (a.sys ? ' sys' : '');
  d._a = a;
  d._iv = a.iv || 0;
  d._it = a.it ? 1 : 0;
  tiles[a.id] = d;
  hit(d);
  if (a.sys) {
    d.innerHTML = svg(a.icon) + '<div class="slab">' + 'LG Home' + '</div>';
    return shade(d);
  }
  if (a.input) {
    d.innerHTML = svg('hdmi') + '<div class="slab"></div><div class="slab sub"></div>';
    var f = hsl2rgb(hashHue(a.id), 0.3, 0.3);
    paint(d, { c: f, b: hsl2rgb(hashHue(a.id), 0.3, 0.16) });
    return inputTile(shade(d), a);
  }
  var known = colors[a.id];
  if (known) {
    paint(d, known);
    d._col = known;
  }
  var i = new Image();
  i.alt = '';
  i.decoding = 'async';
  d._i = i;
  if (!known) i.crossOrigin = 'anonymous';
  i.onload = function () {
    d._iconFailed = false;
    if (d._iconFallback) {
      d._iconFallback.remove();
      d._iconFallback = null;
    }
    if (!i.parentNode) d.appendChild(i);
    if (!colors[a.id]) {
      var col = iconColor(i, a.id);
      d._col = col;
      paint(d, col);
      fit(d, !!(d.parentNode && d.parentNode.id === 'dock'));
      if (!col.t) {
        colors[a.id] = col;
        storeSoon();
      }
      if (rows[r] && rows[r][c] === d) glowNow(d);
    }
    shrinkIcon(d, i);
  };
  i.onerror = function () {
    d._iconFailed = true;
    i.remove();
    if (!d._iconFallback) {
      var t = document.createElement('div');
      t.className = 't';
      t.textContent = a.title;
      d._iconFallback = t;
      d.appendChild(t);
    }
    if (!colors[a.id]) {
      var f = hsl2rgb(hashHue(a.id), 0.42, 0.42);
      paint(d, { c: f, b: hsl2rgb(hashHue(a.id), 0.4, 0.2) });
    }
  }; /* not remembered: a failed load must not pin a made-up colour */
  /* Live TV shows its own picture once one was chosen for it (App icons) */
  i.src = a.id === '__live' && !a.iv ? LIVE_ICON : iconUrl(a);
  d.appendChild(i);
  if (i.decode) i.decode().catch(function () {});
  return shade(d);
}
/* An app's picture from the service; a picture of its own (iv) from the copy the service keeps of it at the size the tiles draw it
   (is, sent by shrinkIcon), when that copy was made for tiles of this size */
function iconUrl(a) {
  var u = API + '/icon/' + encodeURIComponent(a.id) + (a.iv ? '?v=' + a.iv : '');
  if (a.iv && a.is) {
    var n = iconNeed();
    if (a.is === n.w + 'x' + n.h) u += '&s=' + a.is;
  }
  return u;
}
/* The largest a tile's picture is drawn, in screen pixels: a dock or a grid tile grown by its focus scale. */
function iconNeed() {
  var cs = window.getComputedStyle(document.documentElement),
    n = function (k, d) {
      return parseFloat(cs.getPropertyValue(k)) || d;
    },
    dpr = window.devicePixelRatio || 1;
  return {
    w: Math.ceil(Math.max(n('--dock-w', 408) * n('--dock-fs', 1.05), n('--tile-w', 151) * n('--grid-fs', 1.12)) * dpr),
    h: Math.ceil(Math.max(n('--dock-h', 230) * n('--dock-fs', 1.05), n('--tile-h', 151) * n('--grid-fs', 1.12)) * dpr),
  };
}
/* the scale that makes a picture of w x h just cover that size, or 1 when that would not save a third of its pixels */
function shrinkScale(w, h, need) {
  var k = Math.max(need.w / w, need.h / h);
  return w > 0 && h > 0 && k * k < 0.66 ? k : 1;
}
/* A picture larger than the tile is ever drawn (a Full tile picture of 1000 x 600) is drawn once, while the page is idle, into a copy
   of the size it is shown at, which the tile shows from then on. The TV drops the decoded pictures of a page it sends to the
   background, and decodes every one again when Home comes back: a picture of the right size decodes several times faster, and at
   one scale for the tile at rest and grown. JPEG for a picture without see-through parts. A copy of an app's own picture (iv) goes
   to the service, which keeps it beside the picture (POST /api/icons/small) and sends it from then on (iconUrl), so the page makes
   it once. A copy made for smaller tiles than a new theme's is dropped again (regrowIcons). */
function shrinkIcon(d, i) {
  var src = i.src,
    need = iconNeed();
  if (d._small || src.indexOf(API + '/icon/') !== 0 || !window.URL || !URL.createObjectURL) return;
  var k = shrinkScale(i.naturalWidth, i.naturalHeight, need);
  if (k >= 1) return;
  var run = function () {
    var j = new Image();
    j.crossOrigin = 'anonymous';
    j.onerror = function () {
      tileLog('tile copy: ' + d._a.id + ' did not load for a copy');
    };
    j.onload = function () {
      if (d._i !== i || i.src !== src) return;
      try {
        var c = document.createElement('canvas'),
          a = document.createElement('canvas');
        c.width = Math.max(1, Math.round(j.naturalWidth * k));
        c.height = Math.max(1, Math.round(j.naturalHeight * k));
        var g = c.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.drawImage(j, 0, 0, c.width, c.height);
        a.width = 32;
        a.height = 20;
        var ga = a.getContext('2d');
        ga.drawImage(j, 0, 0, 32, 20);
        var px = ga.getImageData(0, 0, 32, 20).data,
          clear = false;
        for (var p = 3; p < px.length && !clear; p += 4) clear = px[p] < 250;
        c.toBlob(
          function (b) {
            if (!b || d._i !== i || i.src !== src) return;
            d._small = src;
            d._need = need;
            i.src = URL.createObjectURL(b);
            var a = d._a;
            if (a && a.iv) {
              var x = new XMLHttpRequest();
              x.open('POST', API + '/api/icons/small/' + encodeURIComponent(a.id) + '?v=' + a.iv + '&s=' + need.w + 'x' + need.h);
              x.setRequestHeader('content-type', b.type || 'image/jpeg');
              x.send(b);
            }
          },
          clear ? 'image/png' : 'image/jpeg',
          0.92
        );
      } catch (e) {
        tileLog('tile copy: ' + d._a.id + ': ' + e.message);
      }
    };
    j.src = src;
  };
  if (window.requestIdleCallback) window.requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 1500);
}
function tileLog(m) {
  if (typeof logLine !== 'undefined') logLine(m);
}
/* a theme with larger tiles: the pictures made for the smaller ones load again at their own size (and are made smaller again) */
function regrowIcons() {
  var need = iconNeed();
  Object.keys(tiles).forEach(function (id) {
    var d = tiles[id];
    if (!d._small || !d._i || (d._need.w >= need.w && d._need.h >= need.h)) return;
    var blob = d._i.src;
    d._i.src = d._small;
    d._small = '';
    if (blob.indexOf('blob:') === 0) URL.revokeObjectURL(blob);
  });
}
/* the focused tile's soft shadow (tile.shadow soft): its own layer, so it fades in with the focus and grows with the tile instead of
   switching on at once. Last child, so the tile's other children keep their places (inputTile counts them). */
function shade(d) {
  var s = document.createElement('i');
  s.className = 'tsh';
  d.appendChild(s);
  return d;
}

// Cached first paint can beat the helper. Retry failed helper icons only after
// an app-list request succeeds; keep fallback text until an image really loads.
function retryTileIcons() {
  Object.keys(tiles).forEach(function (id) {
    var d = tiles[id];
    if (id === '__live' || !d._iconFailed || !d._i || (d._iconRetries || 0) >= 2) return;
    d._iconFailed = false;
    d._iconRetries = (d._iconRetries || 0) + 1;
    d._i.src = API + '/icon/' + encodeURIComponent(id) + '?retry=' + d._iconRetries;
  });
}

/* Cinema: use the selected app's existing icon as a quiet, full-screen backdrop. */
function updateFocusArt(e) {
  var art = $('focus-art'),
    a = e && e._a,
    o = e && e._o,
    id = a && !a.sys && !a.input ? a.id : o && o.app ? o.app : '',
    src = '';
  if (!art) return;
  if (TH && TH.focusIcon && id) {
    src =
      (e && e._i && e._i.src) || (id === '__live' ? LIVE_ICON : API + '/icon/' + encodeURIComponent(id) + (a && a.iv ? '?v=' + a.iv : ''));
  }
  if (src) {
    if (art._src !== src) {
      art._src = src;
      art.src = src;
    }
    art.classList.add('on');
  } else {
    art.classList.remove('on');
  }
}

/* ---------- ambient glow: two layers cross-fade, updated only once focus settles ---------- */
function glowNow(e) {
  var col = TH.glow || e.style.getPropertyValue('--c') || '74,84,112';
  if (col === gColor) return;
  gColor = col;
  var on = gSide ? $('gB') : $('gA'),
    off = gSide ? $('gA') : $('gB');
  gSide ^= 1;
  on.style.setProperty('--c', col);
  on.classList.add('on');
  off.classList.remove('on');
}
function glowSoon(e) {
  clearTimeout(gT);
  gT = setTimeout(function () {
    glowNow(e);
  }, 110);
}

/* a pinned input: its name (or the port), the port under a name, dimmed while nothing is connected. Its name and state can change
   while the tile is kept, so they are written each time it is drawn. */
function inputTile(d, a) {
  var port = 'HDMI ' + a.input,
    named = a.title && a.title !== port;
  d._a = a;
  d.className = d.className.replace(/ ?\binp\b| ?\boff\b/g, '') + ' inp' + (a.off ? ' off' : '');
  d.children[1].textContent = named ? a.title : port;
  d.children[2].textContent = named ? port : '';
  return d;
}
