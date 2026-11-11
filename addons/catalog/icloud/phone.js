// The phone page of the iCloud Shared Album add-on: add albums by their public link, remove them, sync, and see and hide the synced
// photos. Plain script for iOS Safari and Android Chrome; the fixed text is translated here (ctx.util.i18n), the script's own texts by t().
// Everything from Apple (an album's name) is set as text, never as HTML.
const PHONE_JS = `var code='',S={},$=function(i){return document.getElementById(i)};
function fm(s){var a=arguments,n=1;return t(s.replace(/%[sd]/g,function(){return a[n++]}))}
function api(p,b){return new Promise(function(ok,no){var x=new XMLHttpRequest();x.open(b===undefined?'GET':'POST','/api/'+p);x.setRequestHeader('x-code',code);
 x.onload=function(){var j={};try{j=JSON.parse(x.responseText)}catch(e){}if(x.status===403){showLogin(t('Wrong code.'));no(j)}else ok(j)};x.onerror=function(){no({error:t('The TV did not answer. Is the phone on the same Wi-Fi?')})};
 x.send(b===undefined?null:JSON.stringify(b))})}
function msg(s,e){$('msg').innerHTML=s?'<p class="m'+(e?' e':'')+'"></p>':'';if(s)$('msg').firstChild.textContent=s}
function showLogin(s){$('login').className='';$('main').className='hide';$('sum').textContent=s||''}
function ago(x){if(!x)return t('never');var m=Math.round((Date.now()-x)/60000);return m<1?t('just now'):m<60?fm('%d min ago',m):m<1440?fm('%d h ago',Math.round(m/60)):fm('%d days ago',Math.round(m/1440))}
function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e}
function albums(list){var box=$('al');box.innerHTML='';list.forEach(function(a){var r=el('div','al'),i=el('div','ai');
 i.appendChild(el('b','',a.name||t('Shared album')));i.appendChild(el('small','',fm('%d photos in the album · %d on the TV',a.count,a.photos)+' · '+a.hint));
 if(a.error)i.appendChild(el('small','er',t(a.error)));r.appendChild(i);var b=el('button','rm',t('Remove'));b.setAttribute('data-id',a.id);r.appendChild(b);box.appendChild(r)});
 $('albox').className=list.length?'':'hide'}
function state(){return api('state').then(function(i){S=i;$('login').className='hide';$('main').className='';
 $('sum').textContent=fm('iCloud: %d photos',i.photos);albums(i.albums||[]);
 $('ist').innerHTML='';if(i.configured){var p=el('p','',(i.state==='syncing'?fm('Syncing… %d new',i.done):fm('Last sync: %s',ago(i.lastSync)))+(i.error?' · '+t(i.error):''));$('ist').appendChild(p)}
 $('isy').className=$('idc').className=i.configured?'':'hide';if(i.state==='syncing')setTimeout(function(){state();loadPhotos()},3000)})}
function thumbs(box){[].forEach.call(box.querySelectorAll('img[data-s]'),function(im){var x=new XMLHttpRequest();x.open('GET','/api/photo/'+im.getAttribute('data-s'));x.setRequestHeader('x-code',code);x.responseType='blob';
 x.onload=function(){if(x.status===200)im.src=URL.createObjectURL(x.response)};x.send()})}
function loadPhotos(){api('photos',{}).then(function(r){var ps=r.photos||[];$('iphb').className=ps.length?'':'hide';var g='';ps.forEach(function(p){if(!/^[A-Za-z0-9-]+$/.test(p.id))return;g+='<div class="ph'+(p.hidden?' off':'')+'" data-h="'+p.id+'"><img loading=lazy src="" data-s="'+p.id+'"></div>'});$('ipg').innerHTML=g;thumbs($('ipg'))})}
$('ipg').onclick=function(e){var x=e.target.closest('[data-h]');if(!x)return;var off=!/off/.test(x.className);api('hide',{id:x.getAttribute('data-h'),hidden:off}).then(function(){x.className='ph'+(off?' off':'');state()})};
$('al').onclick=function(e){var b=e.target.closest('[data-id]');if(!b)return;if(confirm(t('Remove this album? Its photos are removed from the TV.')))api('remove',{id:b.getAttribute('data-id')}).then(function(r){if(r.error)return msg(t(r.error),1);msg(t('Album removed.'));state();loadPhotos()})};
$('ia').onclick=function(){var v=$('il').value;if(!v.trim())return msg(t('Paste the link of a shared album'),1);msg(t('Reading the album…'));api('add',{links:v}).then(function(r){if(r.error)return msg(t(r.error),1);
 var out=(r.added||[]).map(function(a){return fm('Added %s (%d photos).',a.name,a.count)}).concat((r.errors||[]).map(function(x){return (x.album?x.album+': ':'')+t(x.error)}));
 if(r.added&&r.added.length)$('il').value='';msg(out.join(' '),!(r.added&&r.added.length));state();setTimeout(loadPhotos,8000)},function(e){msg(e.error||t('The TV did not answer. Is the phone on the same Wi-Fi?'),1)})};
$('isy').onclick=function(){api('sync',{}).then(function(){msg(t('Syncing…'));setTimeout(state,1500)})};
$('idc').onclick=function(){if(confirm(t('Remove every album? Their photos are removed from the TV.')))api('disconnect',{}).then(function(){$('iphb').className='hide';msg(t('Every album was removed.'));state()})};
$('go').onclick=function(){code=$('code').value.trim();state().then(loadPhotos).catch(function(){})};
code=(location.hash||'').slice(1);if(/^\\d{6}$/.test(code))state().then(loadPhotos).catch(function(){});else showLogin();
`;

function page(i18n, esc, lang) {
  const T = s => esc(i18n.tr(lang, s));
  return (
    `<!doctype html><html lang=${lang}><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>iCloud Shared Album</title>
<style>*{box-sizing:border-box}body{font:17px -apple-system,system-ui,sans-serif;background:#0d0e12;color:#eee;margin:0;padding:20px 16px 60px;max-width:640px;margin:0 auto}
h1{font-size:26px;margin:4px 0 4px}h2{font-size:20px;margin:28px 0 10px}p{color:#aaa;margin:6px 0}.m{padding:12px 14px;border-radius:12px;background:#1d2a1f;margin:12px 0}.m.e{background:#3a1717}
button,textarea,input{font:inherit;display:block;width:100%;padding:14px;border-radius:12px;border:1px solid #333;background:#1a1b21;color:#eee;margin:8px 0;text-align:center}
button.p{background:#f5f6f8;color:#111;font-weight:600;border:0}textarea,input{text-align:left}textarea{min-height:96px;resize:vertical}.hide{display:none}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.ph{position:relative;aspect-ratio:16/9;border-radius:10px;overflow:hidden;background:#222}
.ph img{width:100%;height:100%;object-fit:cover;display:block}.ph.off img{opacity:.3}
.al{display:flex;align-items:center;gap:12px;padding:12px;border-radius:12px;background:#1a1b21;margin:6px 0}.ai{flex:1;min-width:0}.ai b,.ai small{display:block;overflow-wrap:anywhere}
.al button.rm{width:auto;margin:0;padding:8px 12px}small{color:#888}small.er{color:#f08a8a}</style>
<h1>iCloud Shared Album</h1><p id=sum>${T('Connecting to the TV…')}</p>
<div id=login class=hide><p>${T('Enter the code shown on the TV.')}</p><input id=code inputmode=numeric autocomplete=one-time-code><button class=p id=go>${T('Continue')}</button></div>
<div id=main class=hide>
<div id=msg></div>
<p>${T('In Photos on your iPhone or Mac, open the shared album, then its people settings, and turn on Public Website. Share the link and paste it here (one per line for several albums).')}</p>
<textarea id=il placeholder="https://www.icloud.com/sharedalbum/#..." autocomplete=off autocapitalize=off spellcheck=false></textarea>
<button class=p id=ia>${T('Test and save')}</button>
<div id=albox class=hide><h2>${T('Albums')}</h2><div id=al></div></div>
<div id=ist></div>
<div id=iphb class=hide><h2>${T('Synced photos')} <small>${T('tap to hide or show one')}</small></h2><div class=grid id=ipg></div></div>
<button id=isy>${T('Sync now')}</button><button id=idc>${T('Remove every album')}</button></div>
` +
    i18n.script(lang, PHONE_JS) +
    '<script>' +
    PHONE_JS +
    '</script></html>'
  );
}

module.exports = { page };
