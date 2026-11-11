// The Aerials add-on: Apple's Aerial films (slow drone films of places, a few minutes each) for CleanYourTV's screen saver. It provides
// "videos" (helper/screensaver.js): the screen saver asks for the films and streams them from Apple's host; nothing is downloaded but
// the manifest (films.js), about 2 MB, read once a week and kept as the short list in dataDir/films.json, so a TV without network
// still knows the films (and the screen saver falls back to photos when they do not play).
//   GET  /api/addons/aerials/status     {films, quality, updated, tried, error}
//   POST /api/addons/aerials/quality    {quality: "1080" | "4k"}: 1080p H.264 (the default) or 4K HEVC SDR
'use strict';
const fs = require('fs'),
  path = require('path');
const F = require('./films');

const MANIFEST = process.env.CYTV_AERIALS_MANIFEST || 'http://sylvan.apple.com/Aerials/resources-16.tar';
const WEEK = 7 * 24 * 3600 * 1000,
  RETRY = 3600 * 1000,
  TAR_MAX = 16 * 1024 * 1024;

function create(ctx) {
  const FILE = path.join(ctx.dataDir, 'films.json');
  const quality = () => ((ctx.settings.get() || {}).quality === '4k' ? '4k' : '1080');
  const state = { busy: false, tried: 0, error: '' };
  let kept = { at: 0, films: [] };
  try {
    const k = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (k && Array.isArray(k.films)) kept = { at: +k.at || 0, films: F.films({ assets: k.films.map(raw) }) };
  } catch (_) {}
  // a kept film back in the manifest's shape, so it goes through the same checks when it is read again
  function raw(f) {
    return { id: f && f.id, accessibilityLabel: f && f.title, 'url-1080-H264': f && f.h264, 'url-4K-SDR': f && f.hevc };
  }

  // one read at a time: a call during one waits for it
  let running = null;
  function update() {
    if (!running)
      running = read().then(() => {
        running = null;
      });
    return running;
  }
  async function read() {
    state.busy = true;
    state.tried = Date.now();
    try {
      const r = await ctx.fetch.read(MANIFEST, { idleMs: 30000, maxBytes: TAR_MAX });
      const e = F.tarFile(r.body, 'entries.json');
      if (!e) throw new Error('the manifest has no entries.json');
      const list = F.films(e);
      if (!list.length) throw new Error('the manifest lists no films');
      kept = { at: Date.now(), films: list };
      fs.writeFileSync(FILE + '.tmp', JSON.stringify(kept));
      fs.renameSync(FILE + '.tmp', FILE);
      state.error = '';
      ctx.log(list.length + ' films');
    } catch (e) {
      state.error = String((e && e.message) || e).slice(0, 200);
      ctx.log('the manifest could not be read: ' + state.error);
    }
    state.busy = false;
  }
  let timer = null;
  function later(ms) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const due = !kept.films.length || Date.now() - kept.at >= WEEK;
      (due ? update() : Promise.resolve()).then(() => later(kept.films.length && !state.error ? WEEK : RETRY));
    }, ms);
    if (timer.unref) timer.unref();
  }

  // what the screen saver asks (helper/screensaver.js): every film, in the manifest's order, at the chosen quality (the other file when
  // a film has only that one)
  function list() {
    if (!kept.films.length && !state.busy && Date.now() - state.tried > 600000) update();
    const q = quality();
    return kept.films.map(f => ({ id: f.id, title: f.title, url: q === '4k' ? f.hevc || f.h264 : f.h264 || f.hevc }));
  }
  function status() {
    return { films: kept.films.length, quality: quality(), updated: kept.at, tried: state.tried, error: state.error };
  }

  async function handle(req, res, p, body) {
    const json = (o, c) => {
      res.writeHead(c || 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(o));
    };
    if (p === '/status') return json(status());
    if (p === '/quality' && req.method === 'POST') {
      const b = (await body(req)) || {};
      if (b.quality !== '1080' && b.quality !== '4k') return json({ error: 'quality is "1080" or "4k"' }, 400);
      ctx.settings.set({ quality: b.quality });
      return json(status());
    }
    return json({ error: 'not found' }, 404);
  }

  return { videos: { list }, start: () => later(15000), update, status, handle };
}

module.exports = { create };
