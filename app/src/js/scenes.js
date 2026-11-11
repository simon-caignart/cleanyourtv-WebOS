/* ---------- Scenes and the glass clock (theme: effects.scenes "couch"/"custom", clock.style "glass", cards.style "glass") ----------
   After couch-tv (github.com/Seagey/couch-tv, MIT): five landscapes that take turns behind Home, a large glass clock (Antonio, its fill a
   blurred copy of the scene, a thin rim and a sheen), and in four scenes the scenery cut out of the photo and drawn over the clock, so
   the peaks stand in front of the digits. The files are shipped with the launcher (app/scene-*.jpg, scene-*-fg.webp,
   scene-*-glass.jpg, antonio.woff2). Only the scene on screen and the next one are drawn (.ready); a swap is an opacity cross-fade.
   Glass cards (cards.style) are filled with the same blurred copy, placed where the card is, so no live blur is needed (the GPU is weak).
   Without scenes the glass clock stands alone with a white frosted fill.
   Custom scenes (effects.scenes "custom"): a theme brings its own images; they are served by the helper at /api/theme/scene/<id>/<file>.
   Per-scene clock and date position are set as CSS variables on each scene element; .s-custom in home.css reads them.
   Scenes of an add-on (with the couch scenes): an add-on that provides "scenes" (the Seasons add-on, helper/scenes.js) can bring other
   photos for the couch scenes. The launcher asks POST /api/scenes {cc} (the TV's country) when the theme starts the couch scenes and
   every 30 minutes; a list comes back only when such an add-on runs, and then its photos take the place of the five landscapes, drawn
   as custom scenes (no cut-out, a darker shade at the top) with the photographer in the bottom corner. Without one nothing changes. */
var SCENES = (function () {
  var COUCH = [
    /* tint: the mean colour of the scene's top right (under the top buttons and the clock), for surface.tint: a file of the page may
       not be read back on the TV */
    { id: 'night', fg: true, tint: [87, 97, 114] },
    { id: 'golden', fg: true, tint: [80, 126, 135] },
    { id: 'water', fg: false, water: 0.55, tint: [153, 204, 238] } /* the clock sits on the water: under the line a blurred reflection */,
    { id: 'fog', fg: true, tint: [239, 237, 238] },
    { id: 'dawn', fg: true, tint: [195, 202, 210] },
  ];
  var addonLib = null /* the scenes of an add-on, as custom scenes, or null */,
    addonKey = '',
    addonAt = 0,
    lastTh = null;
  /* the TV's country (its country setting, else the region of its language): an add-on can choose its scenes by it */
  function country() {
    var c = '';
    try {
      var w = window.webOSSystem && window.webOSSystem.country ? window.webOSSystem : window.PalmSystem;
      var j = w && w.country ? (typeof w.country === 'string' ? JSON.parse(w.country) : w.country) : null;
      c = (j && (j.smartServiceCountry || j.country)) || '';
    } catch (e) {}
    if (!c) {
      var m = /[-_]([A-Za-z]{2,3})$/.exec((window.webOSSystem && window.webOSSystem.locale) || navigator.language || '');
      c = m ? m[1] : '';
    }
    return String(c).toUpperCase();
  }
  /* the scenes of an add-on: asked when the couch scenes start and every 30 minutes (sooner while an add-on has none ready yet) */
  function askAddon(force) {
    if (!force && Date.now() - addonAt < (addonKey === 'none' ? 60000 : 1800000)) return;
    addonAt = Date.now();
    api('/api/scenes', { cc: country() }).then(
      function (r) {
        var l =
          r && r.addon && r.scenes && r.scenes.length
            ? r.scenes.map(function (x) {
                return {
                  id: 'x-' + x.id,
                  image: r.addon + '/' + x.id + '/image',
                  glass: r.addon + '/' + x.id + '/glass',
                  credit: x.credit || '',
                  darkSky: !!x.darkSky,
                  addon: true,
                };
              })
            : null;
        var k = l ? JSON.stringify(l) : 'none';
        if (k === addonKey) return;
        addonKey = k;
        addonLib = l;
        if (lastTh) apply(lastTh);
      },
      function () {}
    );
  }
  /* the photographer of a scene of an add-on, in the bottom corner (as Wallpapers does for an Unsplash photo) */
  function credit(s) {
    var c = $('scredit');
    if (!c) {
      c = document.createElement('div');
      c.id = 'scredit';
      $('homepage').appendChild(c);
    }
    c.textContent = on && s && s.credit ? t('Photo: %s').replace('%s', s.credit) : '';
    c.style.display = c.textContent ? 'block' : 'none';
  }
  var lib = COUCH /* active scene list */,
    custom = false /* whether lib comes from the theme */,
    customBase = ''; /* URL prefix for custom scene images */
  var box = null,
    frost = null,
    frostSrc = '',
    wallUrl = '' /* the Wallpapers photo on screen (wall.js), '' when Wallpapers is off or has none */,
    yielded = false /* the theme's scenes stepped aside for that photo (effects.scenesYield) */,
    solo = null,
    els = [],
    cur = 0,
    timer = 0,
    shownHm = '',
    on = false,
    secs = 20,
    fontIn = false;
  function glassOn() {
    return document.body.getAttribute('data-cstyle') === 'glass';
  }
  function cardsGlass() {
    return document.body.getAttribute('data-cards') === 'glass';
  }
  /* the time for the glass clock: as the clock shows it, without AM/PM (the digits are the picture) */
  function hm() {
    return timeText()
      .replace(/\s*[AaPp]\.?\s?[Mm]\.?/, '')
      .trim();
  }
  /* destroy the scenes DOM so build() recreates it with the new lib */
  function reset() {
    if (box) {
      if (box.parentNode) box.parentNode.removeChild(box);
      box = null;
      els = [];
      cur = 0;
    }
  }
  function build() {
    if (box) return;
    box = document.createElement('div');
    box.id = 'scenes';
    els = lib.map(function (s) {
      var el = document.createElement('div');
      el.className = 'scene ' + (custom ? 's-custom' + (s.addon ? ' s-addon' : '') : 's-' + s.id);
      el.innerHTML =
        '<img class="sbg" alt=""><div class="shade"></div><div class="gclock"></div>' +
        (s.water ? '<div class="gclock under"></div>' : '') +
        (s.fg || s.front ? '<img class="fg" alt="">' : '') +
        '<div class="late"></div>';
      box.appendChild(el);
      return el;
    });
    document.body.insertBefore(box, document.body.firstChild);
  }
  /* frosted glass behind the app grid (cards.style glass): the blurred scene, or the Wallpapers photo the scenes yield to, instead of the
     dark layer. It is drawn into small canvases the compositor scales up: a full-screen background image would be decoded only when the
     grid opens and rastered again at the TV's 3840 x 2160 on every opening (frozen frames on an LG C4), while a 960 x 540 canvas texture
     stays resident. Two canvases take turns, so a new picture fades in over the old one. */
  function frostEl() {
    if (frost) return frost;
    frost = document.createElement('div');
    frost.id = 'sglass';
    for (var k = 0; k < 2; k++) {
      var cv = document.createElement('canvas');
      cv.width = 960;
      cv.height = 540;
      frost.appendChild(cv);
    }
    $('view').parentNode.insertBefore(frost, $('view')); /* #view is inside #homepage, not the body */
    return frost;
  }
  function srcOf(s) {
    if (!s) return '';
    return custom ? customBase + s.glass : 'scene-' + s.id + '-glass.jpg';
  }
  function fillOf(s) {
    return s ? 'url("' + srcOf(s) + '")' : '';
  }
  /* the glass behind the grid: a picture and the tint, drawn once per picture once it is decoded; until then the previous one stays. A
     scene brings its own blurred copy; a Wallpapers photo (blur) is blurred here, drawn tiny and scaled back up in steps. */
  var frostFront = 0,
    frostT = 0,
    tiny = null,
    pg = null /* dock.glass: the canvas under the dock panel */,
    pgImg = null,
    pgKey = '';
  function drawFrost(src, blur) {
    var dim = lastTh && typeof lastTh.glassDim === 'number' ? lastTh.glassDim : 0.34,
      key = src && src + '|' + dim + '|' + (blur ? 1 : 0);
    if (key === frostSrc) return;
    frostSrc = key;
    var cvs = frostEl().children;
    if (!src) {
      clearTimeout(frostT);
      cvs[0].classList.remove('on');
      cvs[1].classList.remove('on');
      platter(null);
      return;
    }
    var i = new Image();
    var draw = function () {
      if (frostSrc !== key) return;
      var back = cvs[frostFront ^ 1],
        front = cvs[frostFront],
        x = back.getContext('2d');
      var soft = blur ? blurred(i) : i;
      x.drawImage(soft, 0, 0, back.width, back.height);
      platter(soft);
      var gr = x.createLinearGradient(0, 0, 0, back.height);
      gr.addColorStop(0, 'rgba(16,14,26,' + dim + ')');
      gr.addColorStop(1, 'rgba(16,14,26,' + Math.min(0.95, dim + 0.12) + ')');
      x.fillStyle = gr;
      x.fillRect(0, 0, back.width, back.height);
      /* the new one on top fades in; the old one stays whole under it until then */
      back.style.zIndex = '1';
      front.style.zIndex = '0';
      back.classList.add('on');
      frostFront ^= 1;
      clearTimeout(frostT);
      frostT = setTimeout(function () {
        front.classList.remove('on');
      }, 900);
    };
    i.onload = function () {
      if (i.decode) i.decode().then(draw, draw);
      else draw();
    };
    i.src = src;
  }
  /* dock.glass: the blurred picture behind the dock panel, cut to the panel's rounded shape inside a half-size canvas (no clip or mask
     in CSS), with the bottom shade over it as on the screen around it. It lies in #scroll under the dock, so it moves with it, and it is
     only shown while the grid is closed: over the frosted glass of the open grid the panel is plain glass. Drawn once per picture and
     when the dock changes size; img: a 16:9 picture or canvas of the whole screen, null to hide, undefined to redraw the last one. */
  function platter(img) {
    if (img !== undefined) pgImg = img;
    var d = $('dock'),
      sc = $('scroll'),
      want = !!(lastTh && lastTh.dockGlass && pgImg && d && d.offsetWidth);
    if (!want) {
      if (pg) pg.style.display = 'none';
      pgKey = '';
      return;
    }
    var r = d.getBoundingClientRect(),
      s = sc.getBoundingClientRect(),
      m = /matrix\(([^)]*)\)/.exec(getComputedStyle(sc).transform || ''),
      ty = m ? parseFloat(m[1].split(',')[5]) || 0 : 0,
      /* where the dock is on the screen with the grid closed */
      x0 = r.left,
      y0 = r.top - ty,
      w = r.width,
      h = r.height,
      rad = parseFloat(getComputedStyle(d).borderTopLeftRadius) || 0,
      shade = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bshade-a')) || 0,
      key = [x0, y0, w, h, rad, shade].join('|');
    if (!pg) {
      pg = document.createElement('canvas');
      pg.className = 'pglass';
      sc.insertBefore(pg, sc.firstChild);
    }
    pg.style.display = '';
    if (key === pgKey && img === undefined) return;
    pgKey = key;
    var cw = Math.ceil(w / 2),
      ch = Math.ceil(h / 2),
      k = (pgImg.naturalWidth || pgImg.width) / 1920,
      x = pg.getContext('2d');
    pg.width = cw;
    pg.height = ch;
    pg.style.left = r.left - s.left + 'px';
    pg.style.top = r.top - s.top + 'px';
    pg.style.width = w + 'px';
    pg.style.height = h + 'px';
    x.save();
    roundRect(x, cw, ch, rad / 2);
    x.clip();
    x.drawImage(pgImg, x0 * k, y0 * k, w * k, h * k, 0, 0, cw, ch);
    if (shade) {
      /* the stops of #bshade (home.css): from y 600 to the bottom */
      var g = x.createLinearGradient(0, 0, 0, ch),
        at = function (y) {
          var t = Math.max(0, Math.min(1, (y - 600) / 480)),
            a = t < 0.45 ? (t / 0.45) * 0.35 : t < 0.8 ? 0.35 + ((t - 0.45) / 0.35) * 0.45 : 0.8 + ((t - 0.8) / 0.2) * 0.2;
          return 'rgba(0,0,0,' + (a * shade).toFixed(3) + ')';
        };
      for (var q = 0; q <= 4; q++) g.addColorStop(q / 4, at(y0 + (h * q) / 4));
      x.fillStyle = g;
      x.fillRect(0, 0, cw, ch);
    }
    x.restore();
  }
  function roundRect(x, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    x.beginPath();
    x.moveTo(r, 0);
    x.arcTo(w, 0, w, h, r);
    x.arcTo(w, h, 0, h, r);
    x.arcTo(0, h, 0, 0, r);
    x.arcTo(0, 0, w, 0, r);
    x.closePath();
  }
  /* a photo blurred without filters: drawn at 96 x 54, then scaled up twice with smoothing; the canvas scales the rest */
  function blurred(img) {
    if (!tiny)
      tiny = [96, 192, 384].map(function (w) {
        var c = document.createElement('canvas');
        c.width = w;
        c.height = (w * 9) / 16;
        return c;
      });
    for (var k = 0; k < tiny.length; k++) {
      var x = tiny[k].getContext('2d');
      x.imageSmoothingEnabled = true;
      x.drawImage(k ? tiny[k - 1] : img, 0, 0, tiny[k].width, tiny[k].height);
    }
    return tiny[tiny.length - 1];
  }
  /* the digits, and the fill placed so the blurred scene lines up with the screen behind them */
  function drawClock(el, s, text) {
    var cs = el.querySelectorAll('.gclock');
    for (var k = 0; k < cs.length; k++) {
      var c = cs[k];
      c.innerHTML = '<span class="fill"></span><span class="sheen"></span><span class="rim"></span>';
      for (var j = 0; j < 3; j++) c.childNodes[j].textContent = text;
      var f = c.firstChild;
      if (s) {
        f.style.backgroundImage = fillOf(s);
        f.style.backgroundPosition = -(c.offsetLeft + f.offsetLeft) + 'px ' + -(c.offsetTop + f.offsetTop) + 'px';
      }
    }
    if (s && s.water && cs.length > 1) {
      /* above the waterline sharp, below it the reflection; the clips reach past the box on the open sides */
      var line = 1080 * s.water - cs[0].offsetTop,
        out = '-50%';
      cs[0].style.clipPath = 'inset(' + out + ' ' + out + ' ' + (cs[0].offsetHeight - line) + 'px ' + out + ')';
      cs[1].style.clipPath = 'inset(' + line + 'px ' + out + ' ' + out + ' ' + out + ')';
    }
  }
  function setCssVars(el, s) {
    /* per-scene clock/date position for custom scenes; .s-custom reads these */
    el.style.setProperty('--scene-clock-top', (s.clock && s.clock.top != null ? s.clock.top : 150) + 'px');
    el.style.setProperty('--scene-clock-size', (s.clock && s.clock.size != null ? s.clock.size : 400) + 'px');
    el.style.setProperty('--scene-date-top', (s.date && s.date.top != null ? s.date.top : 96) + 'px');
  }
  function ready(i) {
    var s = lib[i],
      el = els[i];
    if (!el.classList.contains('ready')) {
      if (custom) {
        el.querySelector('.sbg').src = customBase + s.image;
        if (s.front) el.querySelector('.fg').src = customBase + s.front;
        setCssVars(el, s);
      } else {
        el.querySelector('.sbg').src = 'scene-' + s.id + '.jpg';
        if (s.fg) el.querySelector('.fg').src = 'scene-' + s.id + '-fg.webp';
      }
      el.classList.add('ready');
    }
    if (glassOn()) drawClock(el, s, shownHm || hm());
    else {
      var cs = el.querySelectorAll('.gclock');
      for (var k = 0; k < cs.length; k++) cs[k].textContent = '';
    }
  }
  function sceneClass(id) {
    var b = document.body;
    lib.forEach(function (s) {
      b.classList.remove('scene-' + s.id);
    });
    b.classList.remove('scene-custom');
    b.classList.remove('scene-dark-sky');
    if (id) {
      b.classList.add(custom ? 'scene-custom' : 'scene-' + id);
      if (lib[cur] && lib[cur].darkSky) b.classList.add('scene-dark-sky');
    }
  }
  function show(i) {
    var prev = cur;
    cur = i;
    ready(i);
    els[i].classList.add('on');
    if (prev !== i) els[prev].classList.remove('on');
    /* the date moves with the clock and the glass of the cards follows the scene, halfway through the fade */
    setTimeout(function () {
      sceneClass(lib[cur].id);
      credit(lib[cur]);
      if (custom) {
        var s = lib[cur];
        document.body.style.setProperty('--scene-date-top', (s.date && s.date.top != null ? s.date.top : 96) + 'px');
      }
      glassCards();
      inkUpdate();
    }, 700);
    /* after the fade: the old scene is no longer drawn, the next one gets ready */
    setTimeout(function () {
      var next = (cur + 1) % lib.length;
      els.forEach(function (el, k) {
        if (k !== cur && k !== next) el.classList.remove('ready', 'on');
      });
      ready(next);
    }, 2000);
  }
  function arm() {
    clearInterval(timer);
    if (on)
      timer = setInterval(function () {
        show((cur + 1) % lib.length);
      }, secs * 1000);
  }
  /* the theme decides: scenes on or off, how long each stays, the glass clock with or without them */
  function apply(th) {
    lastTh = th;
    var wantCouch = !!(th && th.scenes && th.scenes.set === 'couch');
    var wantCustom = !!(th && th.scenes && th.scenes.set === 'custom' && th.scenes.lib && th.scenes.lib.length);
    yielded = !!(th && th.scenes && th.scenes.yield && wallUrl);
    var want = (wantCouch || wantCustom) && !yielded;
    secs = (th && th.scenes && th.scenes.secs) || 20;

    if (wantCouch) askAddon(false);
    var wantAddon = wantCouch && !!addonLib;
    /* rebuild the scene list when switching mode or theme */
    var newCustom = wantCustom || wantAddon;
    var newLib = wantCustom ? th.scenes.lib : wantAddon ? addonLib : COUCH;
    var libChanged =
      newCustom !== custom ||
      newLib.length !== lib.length ||
      newLib.some(function (s, i) {
        return s.id !== lib[i].id;
      });
    if (libChanged) {
      reset();
      lib = newLib;
      custom = newCustom;
      customBase = wantCustom ? API + '/api/theme/scene/' + th.scenes.id + '/' : wantAddon ? API + '/api/scenes/photo/' : '';
    }

    on = want;
    document.body.classList.toggle('scenes-on', want);
    document.body.classList.toggle('glass-on', cardsGlass() && (want || yielded));
    if (want) {
      build();
      box.style.display = '';
      if (!els[cur].classList.contains('on')) show(cur);
      else ready(cur);
      sceneClass(lib[cur].id);
    } else {
      if (box) box.style.display = 'none';
      sceneClass('');
      credit(null);
    }
    soloClock();
    arm();
    glassCards();
    platter();
    inkUpdate();
  }
  /* surface.ink auto (ink.js): the picture now behind Home. A built-in scene is a file of the page that may not be read back, so its
     brightness is what the scene says (Fog and darkSky have a bright sky); add-on and theme scenes, photos and wallpapers are measured */
  function inkUpdate() {
    var th = lastTh,
      night = th && th.nightRgb ? th.nightRgb.split(',').map(Number) : [7, 8, 11],
      w = th && th.wallpaper;
    if (on) {
      var s = lib[cur];
      INK.set(custom ? customBase + s.image : '', 0, night, !!s.darkSky || (!custom && s.id === 'fog'), custom ? null : s.tint);
    } else if (wallUrl) INK.set(wallUrl, w && w.dim != null ? w.dim : 0.4, night);
    else if (w) INK.set(API + '/api/theme/wallpaper/' + w.id + '/' + w.file, w.dim, night);
    else INK.set('', 0, night);
  }
  /* the glass clock without scenes: one clock with a white frosted fill */
  function soloClock() {
    var want = glassOn() && !on;
    if (want && !solo) {
      solo = document.createElement('div');
      solo.id = 'gsolo';
      solo.innerHTML = '<div class="gclock"></div>';
      $('top').parentNode.insertBefore(solo, $('top'));
    }
    if (solo) {
      solo.style.display = want ? '' : 'none';
      if (want) drawClock(solo, null, shownHm || hm());
    }
  }
  /* the clock tick: the digits only change once a minute */
  function tick() {
    var h = new Date().getHours();
    document.body.classList.toggle('late', h >= 22 || h < 6);
    if (on && lastTh && lastTh.scenes && lastTh.scenes.set === 'couch') askAddon(false);
    if (!glassOn()) return;
    var x = hm();
    if (x === shownHm && fontIn) return;
    shownHm = x;
    if (on)
      els.forEach(function (el, i) {
        if (el.classList.contains('ready')) drawClock(el, lib[i], x);
      });
    if (solo && solo.style.display !== 'none') drawClock(solo, null, x);
  }
  /* glass cards: the blurred scene behind each card, lined up with the screen; without scenes the CSS gives a plain frosted panel */
  function glassCards() {
    var cards = $('cards');
    if (!cards) return;
    var els2 = cards.children,
      g = cardsGlass() && on ? fillOf(lib[cur]) : '';
    drawFrost(g ? srcOf(lib[cur]) : cardsGlass() && yielded ? wallUrl : '', !g);
    for (var i = 0; i < els2.length; i++) {
      var el = els2[i];
      if (!/\bcard-(weather|ha-|frame\b)/.test(el.className)) continue;
      if (!g) {
        el.style.backgroundImage = '';
        el.style.backgroundSize = '';
        el.style.backgroundPosition = '';
        continue;
      }
      var r = el.getBoundingClientRect();
      el.style.backgroundImage = 'linear-gradient(rgba(16,14,26,0.40),rgba(16,14,26,0.30)),' + g;
      el.style.backgroundSize = '100% 100%,1920px 1080px';
      el.style.backgroundPosition = '0 0,' + -Math.round(r.left) + 'px ' + -Math.round(r.top) + 'px';
    }
  }
  /* the clock's typeface must be in before the glass is measured */
  try {
    if (document.fonts && document.fonts.load)
      document.fonts.load('300 100px "CYTV Clock"').then(function () {
        fontIn = true;
        shownHm = '';
        tick();
        if (on) ready(cur);
      });
    else fontIn = true;
  } catch (e) {
    fontIn = true;
  }
  return {
    apply: apply,
    tick: tick,
    /* the dock was rebuilt (layout.js): its glass follows its size */
    platter: function () {
      platter();
    },
    glassCards: glassCards,
    /* the Wallpapers photo now behind Home (wall.js), or '' */
    wall: function (url) {
      if (url === wallUrl) return;
      wallUrl = url;
      if (lastTh && lastTh.scenes && lastTh.scenes.yield) apply(lastTh);
      else inkUpdate();
    },
    shown: function () {
      arm();
      glassCards();
    },
    hidden: function () {
      clearInterval(timer);
    },
  };
})();
