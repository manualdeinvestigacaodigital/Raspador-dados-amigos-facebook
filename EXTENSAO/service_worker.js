/*
Raspador de dados de relações do Facebook V36 V35-Core Observed-Surface Real-Time - service worker
Ativação robusta e extension-only preservada; recuperação adaptativa da relação, foto baixa validada, informações gerais limpas e HTML ficam no content.js: injeta o content.js em páginas de relação já abertas, após instalação, reload, navegação ou clique no ícone; nenhum BAT é requisito de produção.
Descoberta opcional de operation IDs em bundles carregados; comportamento de injeção preservado da V3. Meta streaming durante scroll, enriquecimento do alvo e gates finais ficam no content.js e não alteram a lane relação/foto.
*/
const REL_RE = /^https:\/\/(?:www|web)\.facebook\.com\/[^/?#]+\/(?:friends_all|friends|followers|following)(?:[/?#]|$)/i;
const PROFILE_PHP_RE = /^https:\/\/(?:www|web)\.facebook\.com\/profile\.php\?(?=[^#]*\bsk=(?:friends_all|friends|followers|following)(?:&|#|$))[^#]*/i;
const FALLBACK_OPS = Object.freeze({
  ProfileCometHeaderQuery: '26916983467972978',
  ProfileCometAboutAppSectionQuery: '26885786877765593',
  ProfileCometTopAppSectionQuery: '27618050364552818'
});

function relationUrl(url=''){ return REL_RE.test(url) || PROFILE_PHP_RE.test(url); }
const FB_PAGE_RE = /^https:\/\/(?:www|web)\.facebook\.com\/(?!$)(?!home(?:[/?#]|$))(?!watch(?:[/?#]|$))(?!marketplace(?:[/?#]|$))(?!messages(?:[/?#]|$))(?!notifications(?:[/?#]|$))(?!groups(?:[/?#]|$))(?!events(?:[/?#]|$))(?!pages(?:[/?#]|$))(?!reel(?:s)?(?:[/?#]|$))(?!stories(?:[/?#]|$))(?!search(?:[/?#]|$))(?!settings(?:[/?#]|$))(?!help(?:[/?#]|$))[^?#]+/i;
function eligibleFacebookPage(url=''){ return relationUrl(url) || FB_PAGE_RE.test(String(url||'')); }

async function inject(tabId,url=''){
  if(!tabId || !eligibleFacebookPage(url)) return {ok:false,reason:'not_facebook_profile_or_relation_page'};
  try{
    // MAIN world first, but V35 remains inert until CAPTURE_CONTROL active=true; no fetch/XHR interception at idle.
    await chrome.scripting.executeScript({target:{tabId},world:'MAIN',files:['main_world_hook.js']});
    // Isolated world second: UI, strict binding, enrichment, export and integrity reports.
    await chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',files:['content.js']});
    return {ok:true};
  }catch(e){ return {ok:false,reason:String(e&&e.message||e)}; }
}
async function injectAllOpen(){
  const tabs=await chrome.tabs.query({url:['https://www.facebook.com/*','https://web.facebook.com/*']});
  for(const t of tabs){ if(t.id && eligibleFacebookPage(t.url||'')) await inject(t.id,t.url||''); }
}
chrome.action.onClicked.addListener(async tab=>{ const r=await inject(tab.id,tab.url||''); try{await chrome.action.setBadgeText({tabId:tab.id,text:r.ok?'ON':'!'});await chrome.action.setBadgeBackgroundColor({tabId:tab.id,color:r.ok?'#137333':'#b3261e'});}catch(e){} });
chrome.runtime.onInstalled.addListener(()=>{ injectAllOpen().catch(()=>{}); });
chrome.runtime.onStartup.addListener(()=>{ injectAllOpen().catch(()=>{}); });
chrome.tabs.onUpdated.addListener((tabId,info,tab)=>{
  const url=String(info.url||tab.url||'');
  if((info.status==='complete'||!!info.url) && eligibleFacebookPage(url)) inject(tabId,url);
});

function validBundleUrl(u=''){
  try{const x=new URL(u); return x.protocol==='https:' && (/(^|\.)fbcdn\.net$/i.test(x.hostname)||/(^|\.)facebook\.com$/i.test(x.hostname)) && /(?:\.js(?:\?|$)|\/rsrc\.php\/)/i.test(x.pathname+x.search);}catch(e){return false;}
}
function extractOps(text=''){
  const out={};
  for(const name of Object.keys(FALLBACK_OPS)){
    const re=new RegExp(name+'_facebookRelayOperation[\\s\\S]{0,1200}?exports\\s*=\\s*["\\\']?(\\d+)["\\\']?','i');
    const m=String(text).match(re); if(m) out[name]=m[1];
  }
  return out;
}
async function discoverOps(resources=[]){
  const cache=await chrome.storage.local.get(['b35a1_ops_v2']);
  const cached=cache.b35a1_ops_v2||{};
  // Cache is fallback only. Current page resources are always scanned so a complete but stale cache cannot freeze old operation IDs.
  const found={};
  const urls=Array.from(new Set((resources||[]).filter(validBundleUrl))).slice(0,120);
  let next=0;
  async function worker(){
    while(next<urls.length && (!found.ProfileCometHeaderQuery || !found.ProfileCometAboutAppSectionQuery || !found.ProfileCometTopAppSectionQuery)){
      const u=urls[next++];
      try{
        const r=await fetch(u,{credentials:'omit',cache:'force-cache'}); if(!r.ok) continue;
        const t=await r.text(); Object.assign(found,extractOps(t));
      }catch(e){}
    }
  }
  await Promise.all(Array.from({length:6},()=>worker()));
  const result={...FALLBACK_OPS,...cached,...found};
  await chrome.storage.local.set({b35a1_ops_v2:result,b35a1_ops_v2_updated_at:Date.now()});
  return {ops:result,freshOps:{...found}};
}
chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{
  if(msg&&msg.type==='B35A1_DISCOVER_OPS_V2'){
    discoverOps(msg.resources||[]).then(bundle=>sendResponse({ok:true,ops:bundle.ops,freshOps:bundle.freshOps})).catch(e=>sendResponse({ok:false,error:String(e)}));
    return true;
  }
  if(msg&&msg.type==='B35A1_FORCE_INJECT_V2'){
    inject(sender.tab&&sender.tab.id,sender.tab&&sender.tab.url||'').then(sendResponse); return true;
  }
});
