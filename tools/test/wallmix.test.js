// Wallpapers' order (wallmix.js): the sources in turn by weight, a shuffle bag per source, bursts spread out, new photos first, the
// state kept across a restart; and the service's API around it (wallpapers.js: next, the Mix settings, the screen saver's plan)
const { ok, call, memoryConfig, req, run } = require('./lib');

// a seeded random, so a failure can be run again
function seeded(n) {
  let x = n >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}
const up = n => Array.from({ length: n }, (_, i) => 'u/' + ('000000000000000' + i).slice(-16));
const album = (n, src) => Array.from({ length: n }, (_, i) => 's/' + (src || 'icloud') + '/p' + i);
const count = ids =>
  ids.reduce((o, id) => {
    const s = id
      .split('/')
      .slice(0, id[0] === 'u' ? 1 : 2)
      .join('/');
    o[s] = (o[s] || 0) + 1;
    return o;
  }, {});

run(async () => {
  const M = req('wallmix');
  const rnd = seeded(7);
  const lib = album(300).concat(up(20));

  // ---- shares ----
  let st = M.reconcile({}, lib, {}, rnd);
  let seq = [];
  for (let i = 0; i < 100; i++) seq.push(M.take(st, { rnd }));
  let c = count(seq);
  ok(
    c.u === 50 && c['s/icloud'] === 50,
    'Equal per source: 20 uploads and a 300-photo album take turns, half each (' + JSON.stringify(c) + ')'
  );
  ok(
    seq.every((id, i) => i === 0 || M.srcOf(id) !== M.srcOf(seq[i - 1])),
    'with two sources of the same weight they alternate: no streaks'
  );

  st = M.reconcile({}, lib, {}, rnd);
  seq = [];
  for (let i = 0; i < 320; i++) seq.push(M.take(st, { rnd, mode: 'count' }));
  c = count(seq);
  ok(c.u === 20 && c['s/icloud'] === 300, 'By number of photos: each photo once in 320, so the album has 300 of them');

  st = M.reconcile({}, lib, {}, rnd);
  seq = [];
  for (let i = 0; i < 100; i++) seq.push(M.take(st, { rnd, weights: { u: 4 } }));
  c = count(seq);
  ok(c.u === 80 && c['s/icloud'] === 20, 'a weight of 4 on the uploads gives them four turns for each of the album');
  ok(M.weightOf({ icloud: 3 }, 's/icloud') === 1 && M.weightOf({ icloud: 0.5 }, 's/icloud') === 0.5, 'only the offered weights count');

  // ---- no repeats ----
  st = M.reconcile({}, lib, {}, rnd);
  seq = [];
  for (let i = 0; i < 600; i++) seq.push(M.take(st, { rnd }));
  const albumSeen = seq.filter(id => id[0] === 's');
  ok(new Set(albumSeen).size === 300, 'every photo of the album is shown once before any of them again');
  const ups = seq.filter(id => id[0] === 'u');
  let rounds = true;
  for (let i = 0; i + 20 <= ups.length; i += 20) rounds = rounds && new Set(ups.slice(i, i + 20)).size === 20;
  ok(rounds, 'the uploads go round in full rounds, each upload once per round');
  let edge = true;
  for (let i = 20; i < ups.length; i += 20) edge = edge && ups.slice(i - 3, i).indexOf(ups[i]) < 0;
  ok(edge, 'a new round does not start with the photos shown last');

  // ---- a restart: the state is JSON ----
  st = M.reconcile({}, lib, {}, rnd);
  const first = [];
  for (let i = 0; i < 150; i++) first.push(M.take(st, { rnd }));
  const again = M.reconcile(JSON.parse(JSON.stringify(st)), lib, {}, rnd);
  const after = [];
  for (let i = 0; i < 150; i++) after.push(M.take(again, { rnd }));
  ok(
    after.filter(id => id[0] === 's').every(id => first.indexOf(id) < 0),
    'after a restart the album goes on where it was: none of the first 75 again'
  );

  // ---- the library changes ----
  st = M.reconcile({}, album(10), {}, rnd);
  const before = st.bags['s/icloud'].left.slice();
  st = M.reconcile(
    st,
    album(10)
      .filter(id => id !== before[3])
      .concat(['s/icloud/new1']),
    {},
    rnd
  );
  const left = st.bags['s/icloud'].left;
  ok(
    left[0] === 's/icloud/new1' && left.slice(1).join() === before.filter(id => id !== before[3]).join(),
    'a new photo comes next, a removed one drops out, the order of the rest is kept'
  );

  // ---- bursts ----
  const ids = album(40),
    taken = {};
  ids.forEach((id, i) => (taken[id] = i < 8 ? 1700000000000 + i * 1000 : 1600000000000 + i * 3600000));
  let spread = true;
  for (let k = 0; k < 200; k++) {
    const order = M.arrange(ids, taken, [], seeded(k + 1));
    const at = ids
      .slice(0, 8)
      .map(id => order.indexOf(id))
      .sort((a, b) => a - b);
    for (let i = 1; i < at.length; i++) spread = spread && at[i] - at[i - 1] >= 2;
  }
  ok(spread, 'eight shots taken a second apart are spread over the round, never side by side');

  // ---- Home: only landscape photos; live sources ----
  st = M.reconcile({}, ['u/a1', 'u/a2', 'u/p1', 'l/unsplash'], {}, rnd);
  seq = [];
  for (let i = 0; i < 8; i++) seq.push(M.take(st, { rnd, ok: id => id !== 'u/p1' }));
  ok(seq.indexOf('u/p1') < 0 && count(seq)['l/unsplash'] === 4, 'Home skips what it does not show; a live source has its turn every time');
  ok(st.bags.u.left.indexOf('u/p1') >= 0, 'a photo Home skips stays in the round for the screen saver');

  // ---- the screen saver: peek does not change the state, mark does ----
  st = M.reconcile({}, lib, {}, rnd);
  const plan = M.peek(st, 6, { rnd });
  ok(plan.length === 6 && st.bags.u.done.length === 0, 'the plan of the next photos leaves the order as it is');
  M.mark(st, plan.slice(0, 2), {});
  const nextOne = M.take(st, { rnd });
  ok(nextOne === plan[2], 'once the screen saver drew two of them, Home goes on with the third');
  ok(M.take({ bags: {}, rr: {} }, {}) === null, 'nothing to show: null');

  // ---- the service ----
  const W = req('wallpapers');
  const photosOf = n => album(n, 'test').map(id => id.split('/')[2]);
  const fake = {
    id: 'test',
    name: 'Test',
    mod: { wallpapers: { label: 'Test', list: () => photosOf(30), file: () => '', taken: () => ({ p0: 1700000000000 }) } },
  };
  // a cold boot: the screen saver asks for its plan before anything else has read or built the order (it threw and the page stayed
  // black)
  const cold = W.create({ config: memoryConfig({}), feature: n => (n === 'addons' ? { providers: () => [fake] } : null) });
  let cold1 = null;
  try {
    cold1 = cold.plan(5);
  } catch (e) {
    cold1 = e;
  }
  ok(Array.isArray(cold1) && cold1.length === 5, 'the plan right after a start builds the order first: no error');
  ok(M.take(null, {}) === null && M.peek(undefined, 3, {}).length === 0, 'no state at all: nothing to show, no error');
  const config = memoryConfig({});
  const wp = W.create({ config, feature: n => (n === 'addons' ? { providers: () => [fake] } : null) });
  wp.addUpload(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]));
  let r = await call(wp, '/api/wallpapers/status');
  ok(r.j.mix === 'equal' && r.j.weight === 1 && r.j.sources[0].weight === 1, 'the status says Equal per source, every weight Normal');
  const got = [];
  for (let i = 0; i < 6; i++) got.push((await call(wp, '/api/wallpapers/next', 'POST', {})).j.id);
  c = count(got);
  ok(c.u === 3 && c['s/test'] === 3, "Home's next photos: the one upload and the source's 30 take turns");
  r = await call(wp, '/api/wallpapers/set', 'POST', { mix: 'count', weight: { source: 'test', value: 2 } });
  ok(
    r.j.mix === 'count' && r.j.sources[0].weight === 2 && config.get().wallpapers.mix.weights.test === 2,
    'Mix and a weight are saved in config.json'
  );
  r = await call(wp, '/api/wallpapers/set', 'POST', { mix: 'equal', weight: { source: 'test', value: 1 } });
  ok(!config.get().wallpapers.mix.mode && !('test' in config.get().wallpapers.mix.weights), 'the defaults are not written');
  r = await call(wp, '/api/wallpapers/set', 'POST', { weight: { source: '../x', value: 4 } });
  r = await call(wp, '/api/wallpapers/set', 'POST', { weight: { source: 'test', value: 3 } });
  ok(Object.keys(config.get().wallpapers.mix.weights).length === 0, 'a source name or a weight that is not offered is refused');
  const p = wp.plan(4);
  wp.shown(p.slice(0, 1).concat(['s/nope/x']));
  ok(
    (await call(wp, '/api/wallpapers/next', 'POST', {})).j.id === p[1],
    'what the screen saver drew counts for Home; an unknown id is ignored'
  );
  wp.flush();
});
