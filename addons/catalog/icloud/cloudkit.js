// Shared albums of the newer kind, with links https://photos.icloud.com/shared/album/<id>. The album's page on photos.icloud.com reads
// them from CloudKit, Apple's database service, without a sign-in; this does the same (undocumented, read from what that page sends):
//   1. POST https://ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/public/records/resolve
//        ?remapEnums=true&getCurrentSyncToken=true&sharing_url_key=<id>   {"shortGUIDs":[{"value":"<id>"}]}
//      -> {results: [{databaseScope: "SHARED", zoneID, share: {fields: {"cloudkit.title"}}, anonymousPublicAccess: {token, tokenTTL,
//          databasePartition: "https://p<NN>-ckdatabasews.icloud.com:443"}}]}, or a result with serverErrorCode "NOT_FOUND"
//   2. POST <databasePartition>/database/1/com.apple.photos.cloud/production/shared/records/query
//        ?remapEnums=true&getCurrentSyncToken=true&sharing_url_key=<id>&publicAccessAuthToken=<token>
//        {query: {recordType: "CPLAssetAndMasterByAssetDateWithoutHiddenOrDeleted", filterBy: direction DESCENDING}, zoneID, resultsLimit}
//      -> {records: [CPLMaster, CPLAsset, ...], continuationMarker?}: newest first, a master (the original and Apple's JPEGs of it) and an
//         asset (the date, a reference to its master, and the edited JPEGs when the photo was edited) per photo; resultsLimit counts both
// A picture's fields (resJPEGFullRes, resJPEGMedRes, resOriginalRes) carry a downloadURL on an icloud-content.com host that ends in
// "${f}" (a file name of the client's choosing) and works for about half an hour. The access token lasts 20 minutes (tokenTTL).
// The resolve answer also names the album's owner (name and e-mail address): only the title, the zone and the access are read from it.
const CONTAINER = 'com.apple.photos.cloud',
  RESOLVE_BASE = 'https://ckdatabasews.icloud.com',
  QUERY = 'CPLAssetAndMasterByAssetDateWithoutHiddenOrDeleted',
  PAGE = 200, // records per page: 100 photos
  MAX_PAGES = 20;
const SHORT = /^[A-Za-z0-9_-]{15,64}$/,
  PARTITION = /^https:\/\/(p\d{1,4}-ckdatabasews\.icloud\.com)(?::443)?\/?$/,
  ZONE = /^[A-Za-z0-9_.:-]{1,120}$/,
  ASSET = /^[A-Za-z0-9-]{8,64}$/,
  SUM = /^[A-Za-z0-9+/=_-]{8,128}$/,
  VIDEO = /movie|video|mpeg|avi/i;

const HEADERS = {
  'content-type': 'text/plain',
  Accept: 'application/json',
  Origin: 'https://photos.icloud.com',
  Referer: 'https://photos.icloud.com/',
};
const qs = o =>
  Object.keys(o)
    .map(k => k + '=' + encodeURIComponent(o[k]))
    .join('&');
const dbUrl = (base, scope, endpoint, params) =>
  base +
  '/database/1/' +
  CONTAINER +
  '/production/' +
  scope +
  '/' +
  endpoint +
  '?' +
  qs(Object.assign({ remapEnums: 'true', getCurrentSyncToken: 'true' }, params));

// the parts of a resolve answer that are needed; throws a message for the person when the album cannot be read without a sign-in
function parseResolve(j) {
  const r = j && Array.isArray(j.results) && j.results[0];
  if (!r || typeof r !== 'object') throw new Error('Apple sent an answer the TV does not understand');
  if (r.serverErrorCode === 'NOT_FOUND' || r.serverErrorCode === 'ZONE_NOT_FOUND')
    throw new Error('Apple does not find this album: it was deleted or its link was turned off');
  if (r.serverErrorCode) throw new Error('Apple answered ' + String(r.serverErrorCode).slice(0, 40));
  const a = r.anonymousPublicAccess;
  if (r.requireAppleLogin || !a || typeof a.token !== 'string' || !a.token)
    throw new Error('this album needs an Apple sign-in: in Photos, let anyone with the link view it');
  const m = PARTITION.exec(String(a.databasePartition || ''));
  if (!m) throw new Error('Apple named a server the TV does not trust');
  const z = r.zoneID || {};
  if (String(r.databaseScope || '') !== 'SHARED' || !ZONE.test(String(z.zoneName || '')) || !ZONE.test(String(z.ownerRecordName || '')))
    throw new Error('Apple sent an answer the TV does not understand');
  const title = r.share && r.share.fields && r.share.fields['cloudkit.title'];
  return {
    partition: 'https://' + m[1],
    token: a.token,
    zoneID: { zoneName: z.zoneName, ownerRecordName: z.ownerRecordName, zoneType: String(z.zoneType || 'REGULAR_CUSTOM_ZONE') },
    name:
      String((title && title.value) || '')
        .trim()
        .slice(0, 80) || 'Shared album',
  };
}

const val = (f, k) => (f[k] && typeof f[k] === 'object' ? f[k].value : undefined);
// one picture of a record: a JPEG with its size, checksum and address (the "${f}" filled in and checked by assetUrl)
function picture(f, prefix, assetUrl) {
  const v = val(f, prefix + 'Res');
  if (!v || typeof v !== 'object' || typeof v.downloadURL !== 'string') return null;
  if (val(f, prefix + 'FileType') !== 'public.jpeg') return null;
  const sum = String(v.fileChecksum || ''),
    w = +val(f, prefix + 'Width') || 0,
    h = +val(f, prefix + 'Height') || 0,
    url = assetUrl(v.downloadURL.split('${f}').join('photo.jpg'));
  return SUM.test(sum) && w > 0 && h > 0 && url ? { sum, w, h, bytes: +v.size || +val(f, prefix + 'FileSize') || 0, url } : null;
}
// the photos of the records read so far, newest first. An edited photo is shown as edited (the asset's JPEGs); one that was not is
// shown from its master: Apple's JPEG of it, and the original when that is a JPEG. Videos are skipped.
function photosOf(records, assetUrl) {
  const masters = {},
    out = [];
  for (const r of records)
    if (r && r.recordType === 'CPLMaster' && r.fields && typeof r.recordName === 'string') masters[r.recordName] = r.fields;
  for (const r of records) {
    if (!r || r.recordType !== 'CPLAsset' || !r.fields || !ASSET.test(String(r.recordName || '')) || r.deleted) continue;
    const f = r.fields,
      ref = val(f, 'masterRef'),
      m = ref && masters[ref.recordName];
    if (!m || val(f, 'isHidden') === 1 || val(f, 'isDeleted') === 1 || +val(f, 'trashReason') > 0) continue;
    if (VIDEO.test(String(val(m, 'itemType') || '')) || VIDEO.test(String(val(m, 'resOriginalFileType') || ''))) continue;
    const edited = [picture(f, 'resJPEGFull', assetUrl), picture(f, 'resJPEGMed', assetUrl)].filter(Boolean);
    // Apple's JPEGs of a photo come turned the right way; an original is used only when it needs no turning (old Chromium on the TV
    // ignores the EXIF orientation)
    const upright = (+val(m, 'originalOrientation') || 1) === 1 && (+val(f, 'orientation') || 1) === 1;
    const derivs = edited.length
      ? edited
      : [picture(m, 'resJPEGMed', assetUrl), upright ? picture(m, 'resOriginal', assetUrl) : null].filter(Boolean);
    if (derivs.length) out.push({ guid: r.recordName, at: +val(f, 'assetDate') || +val(f, 'addedDate') || 0, derivs });
  }
  return out.sort((a, b) => b.at - a.at);
}

// one request; CloudKit never redirects, so none is followed
async function post(read, url, payload) {
  const r = await read(url, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(payload),
    redirects: 0,
    anyStatus: true,
    idleMs: 30000,
    totalMs: 120000,
    maxBytes: 24 << 20,
  });
  if (r.status === 401 || r.status === 403) throw new Error('Apple refused to show the album: its link may have been turned off');
  if (r.status === 404) throw new Error('Apple does not find this album: it was deleted or its link was turned off');
  if (r.status === 429 || r.status === 503) throw new Error('Apple is busy: the TV tries again later');
  if (r.status !== 200) throw new Error('Apple answered ' + r.status);
  try {
    return JSON.parse(r.body.toString('utf8'));
  } catch (_) {
    throw new Error('Apple sent an answer the TV does not understand');
  }
}

// the album: its name and its photos, newest first; reading stops once `enough` photos are known (more: true then)
async function readAlbum(read, id, assetUrl, enough) {
  const share = parseResolve(
    await post(read, dbUrl(RESOLVE_BASE, 'public', 'records/resolve', { sharing_url_key: id }), { shortGUIDs: [{ value: id }] })
  );
  const url = dbUrl(share.partition, 'shared', 'records/query', { sharing_url_key: id, publicAccessAuthToken: share.token });
  let records = [],
    marker = null,
    photos = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = {
      query: {
        recordType: QUERY,
        filterBy: [{ fieldName: 'direction', comparator: 'EQUALS', fieldValue: { value: 'DESCENDING', type: 'STRING' } }],
      },
      zoneID: share.zoneID,
      resultsLimit: PAGE,
    };
    if (marker) body.continuationMarker = marker;
    const j = await post(read, url, body);
    if (!j || !Array.isArray(j.records)) throw new Error('Apple sent an answer the TV does not understand');
    records = records.concat(j.records);
    photos = photosOf(records, assetUrl);
    marker = typeof j.continuationMarker === 'string' && j.continuationMarker ? j.continuationMarker : null;
    if (!marker) return { name: share.name, photos, more: false };
    if (photos.length >= enough) break;
  }
  return { name: share.name, photos, more: !!marker };
}

module.exports = { readAlbum, parseResolve, photosOf, SHORT, PARTITION };
