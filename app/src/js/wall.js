/* ---------- Wallpapers: the service's photos (uploads and the photo sources of add-ons, GET /api/wallpapers/list: its "home" list, the
   landscape photos unless Photos on Home is All) behind Home instead of the theme's
   background. The next photo of Wallpapers' order (POST /api/wallpapers/next: each photo once before any repeats, the sources in turn,
   shared with the screen saver; helper/wallmix.js) every cfg.wall.secs seconds while Home is on screen; when Home opens again, a new one only if that many
   seconds have passed since the last change (0: a new photo each time Home opens), cross-faded between two layers (opacity only). Darkened like a theme's wallpaper. Off, or no photos: the theme as it is.
   The photo on screen is kept in localStorage: when Home starts again (a boot, a reload) it opens on that photo, before the service
   answers and before the theme's own wallpaper or scenes could show; Home stays hidden until it is decoded (2 s at most). ---------- */
/* seconds between photos; settings saved before 1.6.10 hold minutes in "every" */
function wallSecs() {
  var w = cfg.wall || {};
  return typeof w.secs === 'number' ? w.secs : typeof w.every === 'number' ? w.every * 60 : 900;
}
var WALL = (function () {
  var list = [],
    stamp = '',
    cur = '',
    curCredit = '',
    side = 0,
    last = 0 /* when the photo on screen was put there (ms) */,
    timer = 0,
    pollT = 0,
    els = null,
    booting = null /* the kept photo Home started on, until it is on screen */,
    bootT = 0,
    revealT = 0;
  var KEPT = 'cytv.wall.shown';
  function keep(id, url, text) {
    try {
      localStorage.setItem(KEPT, JSON.stringify({ id: id, url: url, credit: text }));
    } catch (e) {}
  }
  function kept() {
    try {
      var k = JSON.parse(localStorage.getItem(KEPT) || 'null');
      return k && typeof k.id === 'string' && typeof k.url === 'string' ? k : null;
    } catch (e) {
      return null;
    }
  }
  function forget() {
    try {
      localStorage.removeItem(KEPT);
    } catch (e) {}
  }
  /* Home was held back for the kept photo (body.wpwait) */
  function reveal() {
    clearTimeout(revealT);
    document.body.classList.remove('wpwait');
  }
  /* a "live" entry (l/<add-on>): a photo source that is not kept on the TV and asks its server now and then */
  var isLive = function (id) {
    return id.slice(0, 2) === 'l/';
  };
  function want() {
    return !!(cfg.wall && cfg.wall.on);
  }
  function layers() {
    if (els) return els;
    var g = $('gA');
    els = ['wpA', 'wpB', 'wpD'].map(function (id) {
      var d = document.createElement('div');
      d.id = id;
      d.className = id === 'wpD' ? 'wpd' : 'wp';
      g.parentNode.insertBefore(d, g); /* inside #homepage, so the photo turns with Home when the book turns to a page */
      return d;
    });
    return els;
  }
  /* the line a photo source asks for in a corner (the photographer of an Unsplash photo); inside #homepage, so it turns with Home */
  function credit(text) {
    var c = $('wpc');
    if (!c) {
      c = document.createElement('div');
      c.id = 'wpc';
      $('homepage').appendChild(c);
    }
    c.textContent = want() ? text || '' : '';
    c.style.display = c.textContent ? 'block' : 'none';
  }
  /* effects.wallpaperDim: sent with the theme's own wallpaper, or on its own (wallDim) by a theme without one */
  function dim() {
    var th = cfg.theme || {},
      d = th.wallpaper && th.wallpaper.dim != null ? th.wallpaper.dim : th.wallDim != null ? th.wallDim : 0.4;
    layers()[2].style.background = 'rgba(' + (th.nightRgb || '7, 8, 11') + ',' + d + ')';
  }
  /* a live entry is asked of the service (/api/wallpapers/live/<add-on>): it hands over an address on the source's own server and a
     credit line. Nothing to show (no photo yet, no network): skip() makes next() pick another photo, and with only a live source the
     one on screen stays */
  function show(id, skip) {
    if (isLive(id))
      return api('/api/wallpapers/live/' + id.slice(2)).then(
        function (r) {
          if (r && r.url) load(id, r.url, skip, r.credit);
          else if (skip) skip();
        },
        function () {}
      );
    load(id, API + '/api/wallpapers/photo/' + id, skip, '');
  }
  /* boot: the kept photo of start(); a later photo has taken its place by the time it loads, then it is not shown */
  function load(id, url, skip, text, boot) {
    var im = new Image();
    im.onerror = function () {
      if (skip && (boot || !isLive(id))) skip();
    };
    /* decoded before it is shown, so the swap does not wait for a 4K decode; the scenes and the grid glass learn of the photo */
    im.onload = function () {
      if (im.decode) im.decode().then(put, put);
      else put();
    };
    var put = function () {
      if (!want() || (boot && booting !== boot)) return;
      var l = layers(),
        on = l[side],
        off = l[side ^ 1],
        held = document.body.classList.contains('wpwait');
      side ^= 1;
      on.style.backgroundImage = 'url("' + url + '")';
      /* while Home is held back the photo is there at once: Home shows with it, without a fade from the page colour */
      if (held) on.style.transition = 'none';
      on.classList.add('on');
      off.classList.remove('on');
      if (held) {
        window.getComputedStyle(on).opacity;
        on.style.transition = '';
        reveal();
      }
      booting = null;
      clearTimeout(bootT);
      keep(id, url, text);
      dim();
      document.body.classList.add('wpon');
      cur = id;
      last = Date.now();
      curCredit = text || '';
      credit(curCredit);
      if (typeof SCENES !== 'undefined') SCENES.wall(url);
    };
    im.src = url;
  }
  /* a random one when the service does not answer */
  function anyPhoto() {
    var pick = list[Math.floor(Math.random() * list.length)];
    for (var n = 0; pick === cur && !isLive(pick) && list.length > 1 && n < 8; n++) pick = list[Math.floor(Math.random() * list.length)];
    return pick;
  }
  function next(tries) {
    if (!list.length) return;
    var again = function () {
      if ((tries || 0) < 5 && list.length > 1) next((tries || 0) + 1);
    };
    api('/api/wallpapers/next', {}).then(
      function (r) {
        var id = r && typeof r.id === 'string' ? r.id : '';
        if (id && list.indexOf(id) < 0) {
          /* the library changed since the list was read: read it again */
          stamp = '';
          return sync();
        }
        if (id && !(id === cur && !isLive(id))) show(id, again);
      },
      function () {
        show(anyPhoto(), again);
      }
    );
  }
  function hasLive() {
    return list.some(isLive);
  }
  function arm() {
    clearInterval(timer);
    clearInterval(pollT);
    if (hasLive()) {
      poll();
      pollT = setInterval(poll, 4000);
    }
    var sec = wallSecs();
    if (sec > 0 && (list.length > 1 || (list.length && isLive(list[0]))))
      timer = setInterval(function () {
        next();
      }, sec * 1000);
  }
  /* a live source can have a photo for Home at once (Unsplash: the one the phone page's Test key and save fetched): while Home is on
     screen with a live entry in the list it asks every few seconds, and the service hands the photo out once */
  function poll() {
    if (!want() || !hasLive()) return;
    api('/api/wallpapers/push').then(
      function (r) {
        if (r && r.url && r.id) load(r.id, r.url, null, r.credit);
      },
      function () {}
    );
  }
  function off() {
    clearInterval(timer);
    clearInterval(pollT);
    clearTimeout(bootT);
    booting = null;
    reveal();
    forget();
    document.body.classList.remove('wpon');
    credit('');
    if (els) {
      els[0].classList.remove('on');
      els[1].classList.remove('on');
    }
    cur = '';
    curCredit = '';
    if (typeof SCENES !== 'undefined') SCENES.wall('');
  }
  /* after the settings were read: switched on or off, a new interval, or a different set of photos */
  function sync() {
    if (!want()) return off();
    var st = (cfg.wallpapers && cfg.wallpapers.stamp) || '';
    if (st === stamp && list.length) {
      dim();
      credit(curCredit);
      return arm();
    }
    stamp = st;
    api('/api/wallpapers/list').then(
      function (x) {
        list = x.home || x.photos || [];
        if (!list.length) return off();
        /* the kept photo Home started on is still loading: it stays, and the next one comes at the interval */
        if (!(booting && list.indexOf(booting.id) >= 0) && (!cur || list.indexOf(cur) < 0)) {
          booting = null;
          next();
        }
        arm();
      },
      function () {}
    );
  }
  /* the kept photo, when it cannot be loaded (the service is still starting): tried again for about half a minute, then Home goes on
     without it (the theme's background, or the next photo once the list is known) */
  function bootLoad(k, n) {
    load(
      k.id,
      k.url,
      function () {
        if (booting !== k) return;
        if (n < 20)
          bootT = setTimeout(function () {
            if (booting === k) bootLoad(k, n + 1);
          }, 1500);
        else {
          booting = null;
          reveal();
          if (cur) return;
          document.body.classList.remove('wpon');
          if (typeof SCENES !== 'undefined') SCENES.wall('');
          if (list.length) next();
        }
      },
      k.credit,
      k
    );
  }
  return {
    /* Home starts with the settings it kept (start.js), before the theme is applied: the kept photo takes the theme's place at once */
    start: function () {
      var k = kept();
      if (!want() || !k) return;
      booting = k;
      cur = '';
      last = Date.now();
      document.body.classList.add('wpon', 'wpwait');
      dim();
      if (typeof SCENES !== 'undefined') SCENES.wall(k.url);
      revealT = setTimeout(reveal, 2000);
      bootLoad(k, 0);
    },
    sync: sync,
    /* Home is on screen again: a new photo when it is time for one (every time with 0 seconds; else once the interval has passed since the
       last change, so opening Home does not change the photo or decode a new one before then), and the timer runs again */
    shown: function () {
      if (want() && list.length) {
        var gone = Date.now() - last,
          sec = wallSecs();
        if (!sec || !last || gone < 0 || gone >= sec * 1000) next();
        arm();
      }
    },
    hidden: function () {
      clearInterval(timer);
      clearInterval(pollT);
    },
  };
})();
