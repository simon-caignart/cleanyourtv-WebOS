// The order Wallpapers shows its photos in, shared by Home and the screen saver (wallpapers.js keeps one mix and its state file).
// Two levels:
//   1. the source: uploads (u), each photo source add-on (s/<add-on>) and each live source (l/<add-on>) take turns by weight, with
//      smooth weighted round-robin, so the shares hold over a few photos and no source has a lucky streak. Equal per source (the
//      default): each source's share is its weight; By number of photos: its weight times the photos it has.
//   2. the photo: each source has a shuffle bag. Every photo is shown once before any is shown again; a new round never starts with
//      the photos shown last; photos taken within a few seconds of each other (a burst) are spread over the round; a photo that is new
//      in the source goes to the front of the bag; a removed one drops out. A live source has one entry that is always there.
// The state ({bags, rr}) is plain JSON, so it survives a restart of the service; ids that are gone are dropped from it.
const BURST_MS = 10000,
  WEIGHTS = [0.5, 1, 2, 4],
  RECENT = 3; // a new round does not start with any of the last photos shown

const srcOf = id => {
  const m = /^(u)\/|^([sl]\/[^/]+)/.exec(id);
  return m ? m[1] || m[2] : '';
};
const weightOf = (weights, src) => {
  const w = weights && +weights[src.replace(/^[sl]\//, '')];
  return WEIGHTS.indexOf(w) >= 0 ? w : 1;
};

// a new round of a bag: shuffled, the members of a burst spread evenly over it, and the photos shown last at its end
function arrange(ids, taken, avoid, rnd) {
  const t = taken || {},
    keys = {};
  const dated = ids.filter(id => t[id] > 0).sort((a, b) => t[a] - t[b]);
  const groups = [];
  for (const id of dated) {
    const g = groups[groups.length - 1];
    if (g && t[id] - t[g[g.length - 1]] <= BURST_MS) g.push(id);
    else groups.push([id]);
  }
  for (const id of ids) if (!(t[id] > 0)) groups.push([id]);
  const group = {};
  groups.forEach((g, n) => {
    // member j of k lands in the j-th k-th of the round, at the same random place within it
    const r = rnd();
    g.forEach((id, j) => {
      keys[id] = (r + j) / g.length + rnd() * 1e-6;
      group[id] = n;
    });
  });
  const out = ids.slice().sort((a, b) => keys[a] - keys[b]);
  // two of a burst that still came side by side: the second swaps with the nearest photo, later ones first, where both then fit
  const clash = k => k > 0 && k < out.length && group[out[k]] === group[out[k - 1]];
  const swap = (i, j) => {
    const x = out[i];
    out[i] = out[j];
    out[j] = x;
  };
  for (let i = 1; i < out.length; i++) {
    if (!clash(i)) continue;
    const near = [];
    for (let j = i + 1; j < out.length; j++) near.push(j);
    for (let j = i - 2; j >= 0; j--) near.push(j);
    for (const j of near) {
      swap(i, j);
      if (![i, i + 1, j, j + 1].some(clash)) break;
      swap(i, j);
    }
  }
  const last = (avoid || []).filter(id => out.indexOf(id) >= 0);
  return last.length < out.length ? out.filter(id => last.indexOf(id) < 0).concat(last) : out;
}

// brings the state in line with the library: a bag per source, new photos at the front, removed ones gone
function reconcile(state, ids, taken, rnd) {
  const st = state && typeof state === 'object' ? state : {},
    bags = {},
    by = {};
  for (const id of ids) {
    const s = srcOf(id);
    if (s) (by[s] = by[s] || []).push(id);
  }
  for (const s of Object.keys(by)) {
    const old = (st.bags && st.bags[s]) || {},
      have = {};
    for (const id of by[s]) have[id] = 1;
    const keep = a => (Array.isArray(a) ? a.filter((id, i) => have[id] === 1 && a.indexOf(id) === i) : []);
    let left = keep(old.left);
    const done = keep(old.done).filter(id => left.indexOf(id) < 0);
    const fresh = by[s].filter(id => left.indexOf(id) < 0 && done.indexOf(id) < 0);
    // a source seen for the first time is a new round; a photo new in a known source comes next
    left = arrange(fresh, taken, [], rnd).concat(left);
    bags[s] = { left, done };
  }
  const rr = {};
  for (const s of Object.keys(bags)) rr[s] = st.rr && typeof st.rr[s] === 'number' && isFinite(st.rr[s]) ? st.rr[s] : 0;
  return { bags, rr };
}

// what each source may offer a caller: {source: photos it may show}; ok(id) says which (Home: the landscape ones)
function offer(state, ok) {
  const can = {};
  for (const s of Object.keys(state.bags)) {
    const b = state.bags[s],
      n = b.left.concat(b.done).filter(ok).length;
    if (n) can[s] = n;
  }
  return can;
}
// one turn of the round-robin: every source that can offer gains its weight, the chosen one (the highest, or the one given) pays the
// total; the source chosen, or '' when none can offer
function turn(state, o, can, given) {
  const srcs = Object.keys(can).sort();
  if (!srcs.length || (given && !can[given])) return '';
  let total = 0,
    best = given || '';
  for (const s of srcs) {
    const w = weightOf(o.weights, s) * (o.mode === 'count' ? can[s] : 1);
    state.rr[s] += w;
    total += w;
    if (!given && (!best || state.rr[s] > state.rr[best])) best = s;
  }
  state.rr[best] -= total;
  return best;
}
const okOf = o => o.ok || (() => true);
// the next photo, taken out of the state (o: {ok, mode, weights, taken, rnd}); null: nothing to show
function take(state, o) {
  const ok = okOf(o),
    best = turn(state, o, offer(state, ok));
  if (!best) return null;
  const b = state.bags[best];
  let i = b.left.findIndex(ok);
  if (i < 0) {
    // a new round; what this caller may not show and was not shown yet stays at the front
    b.left = b.left.concat(arrange(b.done, o.taken, b.done.slice(-RECENT), o.rnd || Math.random));
    b.done = [];
    i = b.left.findIndex(ok);
  }
  const id = b.left[i];
  // a live source's entry stays: it has a new photo every time
  if (best.charAt(0) !== 'l') {
    b.left.splice(i, 1);
    b.done.push(id);
  }
  return id;
}

// the next n photos without changing the state (the screen saver's plan)
function peek(state, n, o) {
  const copy = JSON.parse(JSON.stringify(state)),
    out = [];
  for (let k = 0; k < n; k++) {
    const id = take(copy, o);
    if (id === null) break;
    out.push(id);
  }
  return out;
}

// photos that were shown (the slides the screen saver drew): out of their bag's round, the order of the rest kept, and their source's
// turn taken, so Home goes on with the shares where the screen saver left them
function mark(state, ids, o) {
  const ok = okOf(o);
  for (const id of ids) {
    const s = srcOf(id),
      b = state.bags[s];
    if (!b) continue;
    turn(state, o, offer(state, ok), s);
    const i = b.left.indexOf(id);
    if (i < 0 || s.charAt(0) === 'l') continue;
    b.left.splice(i, 1);
    b.done.push(id);
  }
}

module.exports = { arrange, reconcile, take, peek, mark, srcOf, weightOf, WEIGHTS, BURST_MS };
