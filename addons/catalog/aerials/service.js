// The Aerials add-on: Apple's Aerial films (slow drone films of places, a few minutes each) for CleanYourTV's screen saver. It provides
// "videos" (helper/screensaver.js): the screen saver asks for the films and streams them from Apple's host; nothing is downloaded but
// the manifests (films.js), about 2 MB each, read once a week and kept as the short list in dataDir/films.json, so a TV without network
// still knows the films (and the screen saver falls back to photos when they do not play). The newest manifest gives the list; the
// older one the 1080p and 30 fps 4K files of the films it also has (the newest has only 240 fps files). Either alone is enough.
//   GET  /api/addons/aerials/status     {films, hfr: films with only the 240 fps file, quality, updated, tried, error}
//   POST /api/addons/aerials/quality    {quality: "1080" | "4k"}: 1080p H.264 (the default) or 4K HEVC SDR
'use strict';
const fs = require('fs'),
  path = require('path');
const F = require('./films');

// the newest first (CYTV_AERIALS_MANIFESTS: addresses separated by commas, for the tests)
const MANIFESTS = (
  process.env.CYTV_AERIALS_MANIFESTS ||
  'http://sylvan.apple.com/itunes-assets/Aerials126/v4/82/2e/34/822e344c-f5d2-878c-3d56-508d5b09ed61/resources-27-0-1.tar,' +
    'http://sylvan.apple.com/Aerials/resources-16.tar'
).split(',');
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
    return {
      id: f && f.id,
      accessibilityLabel: f && f.title,
      'url-1080-H264': f && f.h264,
      'url-4K-SDR': f && f.hevc,
      'url-4K-SDR-240FPS': f && f.hfr,
    };
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
    const lists = [],
      errors = [];
    for (const url of MANIFESTS) {
      const name = url.split('/').pop();
      try {
        const r = await ctx.fetch.read(url, { idleMs: 30000, maxBytes: TAR_MAX });
        const e = F.tarFile(r.body, 'entries.json');
        if (!e) throw new Error('no entries.json');
        const l = F.films(e);
        if (!l.length) throw new Error('no films');
        lists.push(l);
      } catch (e) {
        errors.push(name + ': ' + String((e && e.message) || e));
      }
    }
    state.error = errors.join('; ').slice(0, 300);
    if (errors.length) ctx.log('not read: ' + state.error);
    if (lists.length) {
      // a manifest that could not be read this time: what the TV knew from it (the files of its films) stays
      const list = F.merge(errors.length ? lists.concat([kept.films]) : lists);
      kept = { at: Date.now(), films: list };
      try {
        fs.writeFileSync(FILE + '.tmp', JSON.stringify(kept));
        fs.renameSync(FILE + '.tmp', FILE);
      } catch (e) {
        ctx.log('films.json: ' + ((e && e.message) || e));
      }
      ctx.log(list.length + ' films');
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
  // a film has only that one); a film with only the 240 fps file says so with its type, and the page plays it only where the TV can
  function list() {
    if (!kept.films.length && !state.busy && Date.now() - state.tried > 600000) update();
    const q = quality();
    return kept.films.map(f => {
      const url = (q === '4k' ? f.hevc || f.h264 : f.h264 || f.hevc) || f.hfr;
      return url === f.hfr ? { id: f.id, title: f.title, url, type: F.HFR_TYPE } : { id: f.id, title: f.title, url };
    });
  }
  function status() {
    const hfr = kept.films.filter(f => !f.h264 && !f.hevc).length;
    return { films: kept.films.length, hfr, quality: quality(), updated: kept.at, tried: state.tried, error: state.error };
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
