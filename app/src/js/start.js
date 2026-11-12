/* first paint straight from the last known layout, then refresh from the helper */
try {
  var cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
  if (cached && cached.apps && cached.apps.length) {
    apps = cached.apps;
    cfg = cached.cfg || {};
    useLang(cfg.lang);
    WALL.start(); /* before the theme: its wallpaper and scenes do not show first */
    applyTheme(cfg.theme);
    usage = cached.usage || {};
    colors = cached.colors || {};
    rebuild();
    perfMark('launcher cached ' + Math.round(performance.now()));
  }
} catch (e) {}
load();
var pagesLoaded = PAGER.load();
/* a launcher that starts again shows Home: the service is told so before a launch parameter can turn to a page ({live:true}) */
pagesLoaded.then(function () {
  PAGER.report();
});
refreshSoon();
wantInputs(pagesLoaded);
watchOpen();
/* lets the manager know an updated launcher started, and the boot script that this page is ours; at a boot the service may not be up
   yet */
(function started(n) {
  api('/api/frontend-ok', { version: VERSION }).catch(function () {
    if (n < 20) setTimeout(started, 3000, n + 1);
  });
})(0);
