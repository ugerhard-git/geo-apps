(() => {
"use strict";

/* ============================================================
   1. Card colours
   ============================================================ */
const PRESETS = {
  light: { bg:'#FBF9F3', text:'#16232E' },
  dark:  { bg:'#1D303E', text:'#F5F2E9' }
};

function hex2rgb(h){
  let s = String(h || '').replace('#','');
  if (s.length === 3) s = s.split('').map(c => c + c).join('');
  return [parseInt(s.slice(0,2),16) || 0, parseInt(s.slice(2,4),16) || 0, parseInt(s.slice(4,6),16) || 0];
}
function rgba(h, a){ const [r,g,b] = hex2rgb(h); return `rgba(${r},${g},${b},${a})`; }
function mix(a, b, t){
  const A = hex2rgb(a), B = hex2rgb(b);
  return '#' + A.map((v,i) => Math.round(v + (B[i]-v)*t).toString(16).padStart(2,'0')).join('');
}

/* Everything on a card is the chosen text colour at a different strength,
   so the two pickers can never produce an unreadable combination. */
function palette(bg, text, clearCard){
  return {
    surface: clearCard ? null : bg,
    sheet:   mix(bg, text, 0.06),
    value:   text,
    unit:    rgba(text, 0.80),
    label:   rgba(text, 0.70),
    note:    rgba(text, 0.70),
    border:  rgba(text, 0.20)
  };
}
function currentPalette(){
  return palette(state.cardBg, state.cardText, state.cardTransparent);
}

/* ============================================================
   2. Number + text formatting
   ============================================================ */
const nf = (n, d=0) => Number(n).toLocaleString('en-US',{minimumFractionDigits:d, maximumFractionDigits:d});

function sig(v){
  const a = Math.abs(v);
  if (a >= 100) return nf(v,0);
  if (a >= 10)  return nf(v,1);
  return nf(v,2);
}
function scaleWord(n){
  const a = Math.abs(n);
  if (a >= 1e12) return {v:n/1e12, w:'trillion'};
  if (a >= 1e9)  return {v:n/1e9,  w:'billion'};
  if (a >= 1e6)  return {v:n/1e6,  w:'million'};
  if (a >= 1e4)  return {v:n/1e3,  w:'thousand'};
  return {v:n, w:''};
}
const fmtPeople  = v => { const s = scaleWord(v); return s.w ? {big:sig(s.v), unit:s.w+' people'} : {big:nf(v,0), unit:'people'}; };
const fmtCount   = (v,u) => { const s = scaleWord(v); return s.w ? {big:sig(s.v), unit:s.w+' '+u} : {big:nf(v,0), unit:u}; };
const fmtMoney   = v => { const s = scaleWord(v); return {big:'$'+sig(s.v), unit:(s.w?s.w+' ':'')+'US$, current prices'}; };
const fmtPerHead = v => ({big:'$'+nf(v,0), unit:'per person, current US$'});
const fmtPct     = (v,u) => ({big:nf(v,1)+'%', unit:u});
const fmtNum     = (v,u,d=1) => ({big:nf(v,d), unit:u});
const fmtArea    = v => ({big:nf(v,0), unit:'square kilometres'});

function ordinal(n){
  const s=['th','st','nd','rd'], v=n%100;
  return n + (s[(v-20)%10] || s[v] || s[0]);
}

/* ============================================================
   3. Ranking
   ============================================================ */
function rankAmong(values, v){
  if (!values || values.length < 2 || v == null || !isFinite(v)) return null;
  const sorted = [...values].sort((a,b)=>b-a);
  let i = sorted.findIndex(x => x <= v);
  const rank = i < 0 ? sorted.length : i + 1;
  const total = sorted.length;
  return { rank, total, pct: total > 1 ? (total - rank) / (total - 1) : .5 };
}

/* ============================================================
   4. Data layer
   ============================================================ */
const WB = 'https://api.worldbank.org/v2';

/* Source A: the open ISO 3166 set. No key, no account, CORS wide open. */
const ATLAS_MIRRORS = [
  'https://cdn.jsdelivr.net/gh/mledoze/countries@master/countries.json',
  'https://raw.githubusercontent.com/mledoze/countries/master/countries.json'
];

/* Source B: REST Countries v5. Needs the key the person supplies. */
const RC = 'https://api.restcountries.com/countries/v5';
const RC_OMIT = 'leaders,links,postal_code.regex,flag.colors.palette';
const RC_PAGE = 100;   // free-plan ceiling

const cache = { atlas:null, index:null, builtFor:null, wbCountries:null,
                ind:new Map(), fb:new Map(), fbPaths:null };

/* Text that came off the network is never trusted as a message: it is
   stripped of control characters and clipped before it can reach the UI. */
function safeMessage(v){
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, 200).trim();
}

const REQUEST_TIMEOUT = 30000;

async function getJSON(url, init, timeout){
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout || REQUEST_TIMEOUT) : null;
  let r;
  try {
    r = await fetch(url, ctrl ? { ...(init || {}), signal: ctrl.signal } : init);
  } catch(e){
    if (timer) clearTimeout(timer);
    const err = new Error(e && e.name === 'AbortError'
      ? 'The request took too long and was given up on.'
      : 'The request could not be made.');
    err.aborted = e && e.name === 'AbortError';
    throw err;                       // deliberately carries no URL
  }
  if (timer) clearTimeout(timer);
  if (!r.ok){
    let msg = 'HTTP ' + r.status;
    try {
      const b = await r.json();
      if (b && b.errors && b.errors[0] && b.errors[0].message) msg = safeMessage(b.errors[0].message);
    } catch(e){}
    const err = new Error(msg); err.status = r.status; throw err;
  }
  return r.json();
}

/* --- REST Countries v5 ------------------------------------------------ */
function rcInit(key){
  return { headers:{ 'Authorization': 'Bearer ' + key, 'Accept': 'application/json' } };
}

async function rcRequest(pathAndQuery, key){
  try {
    return await getJSON(RC + pathAndQuery, rcInit(key));
  } catch(err){
    if (err.status === 401) err.hint = 'That key was not accepted. Check it for stray spaces, or generate a new one.';
    else if (err.status === 403) err.hint = 'The key is valid but the account is blocked — usually the monthly request limit.';
    else if (err.status === 429) err.hint = 'Too many requests in a short window. Wait a few seconds and try again.';
    else if (err.aborted) err.hint = 'REST Countries did not answer in time. Try again, or switch back to the open data set.';
    else if (err.status === undefined) err.hint = 'The browser blocked the request. Add this page\u2019s hostname to the key\u2019s allowed origins, and serve the page over http rather than opening the file directly.';
    throw err;
  }
}

async function rcCheckKey(key){
  const body = await rcRequest('?limit=1&response_fields=codes.alpha_2', key);
  const n = body && body.data && body.data.meta && body.data.meta.total;
  return typeof n === 'number' ? n : 0;
}

async function rcAll(key, onProgress){
  const out = [];
  let offset = 0, total = Infinity, page = 0;
  while (offset < total && page < 12){
    const body = await rcRequest(`?limit=${RC_PAGE}&offset=${offset}&response_fields_omit=${RC_OMIT}`, key);
    const d = body && body.data;
    const objs = (d && d.objects) || [];
    out.push(...objs);
    total = (d && d.meta && d.meta.total) || out.length;
    offset += RC_PAGE; page++;
    if (onProgress) onProgress(out.length, total);
    if (!objs.length || !(d && d.meta && d.meta.more)) break;
  }
  return out;
}

/* --- normalising both sources into one shape -------------------------- */
const str = v => (typeof v === 'string' ? v : '');
const arr = v => (Array.isArray(v) ? v : []);

function fromOpen(r){
  const names = r.name || {};
  const keys = [names.common, names.official, r.cca2, r.cca3, r.ccn3, r.cioc];
  const soft = [...arr(r.altSpellings)];
  Object.values(names.native || {}).forEach(n => soft.push(n.common, n.official));
  Object.values(r.translations || {}).forEach(t => soft.push(t.common, t.official));
  return {
    iso2:r.cca2, iso3:r.cca3, keys, soft,
    region:str(r.region), subregion:str(r.subregion), continents:arr(r.continents),
    landlocked:!!r.landlocked, borders:arr(r.borders),
    area:typeof r.area === 'number' ? r.area : null,
    lat:(r.latlng || [])[0], lng:(r.latlng || [])[1],
    languages:Object.values(r.languages || {}),
    currencies:Object.entries(r.currencies || {}).map(([code, i]) =>
      ({ code, symbol:(i && i.symbol) || '', name:(i && i.name) || '' })),
    capitals:arr(r.capital),
    tlds:arr(r.tld),
    callingCode:(r.idd && r.idd.root) ? r.idd.root + ((r.idd.suffixes || [])[0] || '') : null,
    demonym:(r.demonyms && r.demonyms.eng && r.demonyms.eng.m) || null,
    population:null,
    sovereign:!!r.independent, unMember:!!r.unMember, unObserver:null,
    unGroup:str(r.unRegionalGroup) || null,
    disputed:null, dependency:null, dependencyType:null,
    timezones:null, drivingSide:null, carSigns:null, startOfWeek:null,
    measurement:null, temperature:null, numberFormat:null, governmentType:null,
    memberships:null, postalFormat:null, flagColor:null,
    academicYear:null, fiscalYear:null
  };
}

function fromRest(r){
  const names = r.names || {}, codes = r.codes || {};
  const keys = [names.common, names.official, codes.alpha_2, codes.alpha_3, codes.ccn3, codes.cioc, codes.fifa];
  const soft = [...arr(names.alternates)];
  Object.values(names.native || {}).forEach(n => soft.push(n.common, n.official));
  Object.values(names.translations || {}).forEach(t => soft.push(t.common, t.official));

  const langs = arr(r.languages).map(l =>
    typeof l === 'string' ? l : str(l.name) || str(l.english) || str(l.native) || str(l.iso639_3)
  ).filter(Boolean);

  const rawCur = r.currencies;
  const currencies = Array.isArray(rawCur)
    ? rawCur.map(c => ({ code:str(c.code) || str(c.iso4217), symbol:str(c.symbol), name:str(c.name) }))
    : Object.entries(rawCur || {}).map(([code, i]) =>
        ({ code, symbol:(i && i.symbol) || '', name:(i && i.name) || '' }));

  const caps = arr(r.capitals).map(c => typeof c === 'string' ? c : str(c.name)).filter(Boolean);
  const call = arr(r.calling_codes)[0];
  const cls = r.classification || {}, mem = r.memberships || {};
  const date = r.date || {}, nfmt = r.number_format || {}, units = r.units || {};

  return {
    iso2:codes.alpha_2, iso3:codes.alpha_3, keys, soft,
    region:str(r.region), subregion:str(r.subregion), continents:arr(r.continents),
    landlocked:!!r.landlocked, borders:arr(r.borders),
    area:(r.area && typeof r.area.kilometers === 'number') ? r.area.kilometers : null,
    lat:r.coordinates && r.coordinates.lat, lng:r.coordinates && r.coordinates.lng,
    languages:langs, currencies, capitals:caps,
    tlds:arr(r.tlds),
    callingCode:call ? ('+' + String(call).replace(/^\+/, '')) : null,
    demonym:(r.demonyms && r.demonyms.eng && r.demonyms.eng.m) || null,
    population:typeof r.population === 'number' ? r.population : null,
    sovereign:!!cls.sovereign, unMember:!!(cls.un_member || mem.un),
    unObserver:typeof cls.un_observer === 'boolean' ? cls.un_observer : null,
    unGroup:null,
    disputed:typeof cls.disputed === 'boolean' ? cls.disputed : null,
    dependency:typeof cls.dependency === 'boolean' ? cls.dependency : null,
    dependencyType:str(cls.dependency_type) || null,
    timezones:arr(r.timezones).length ? arr(r.timezones) : null,
    drivingSide:(r.cars && str(r.cars.driving_side)) || null,
    carSigns:(r.cars && arr(r.cars.signs).length) ? arr(r.cars.signs) : null,
    startOfWeek:str(date.start_of_week) || null,
    measurement:str(units.measurement_system) || null,
    temperature:str(units.temperature_scale) || null,
    numberFormat:(nfmt.decimal_separator != null)
      ? { decimal:str(nfmt.decimal_separator), thousands:str(nfmt.thousands_separator) } : null,
    governmentType:str(r.government_type) || null,
    memberships:Object.keys(mem).length ? mem : null,
    postalFormat:(r.postal_code && str(r.postal_code.format)) || null,
    flagColor:(r.flag && r.flag.colors && (str(r.flag.colors.prominent) || str(r.flag.colors.dominant))) || null,
    academicYear:(date.academic_year_start && date.academic_year_start.month)
      ? { month:date.academic_year_start.month, day:date.academic_year_start.day } : null,
    fiscalYear:(date.fiscal_year_start && date.fiscal_year_start.government && date.fiscal_year_start.government.month)
      ? { month:date.fiscal_year_start.government.month, day:date.fiscal_year_start.government.day } : null
  };
}

/* --- the working set -------------------------------------------------- */
async function openAtlas(){
  let last = null;
  for (const url of ATLAS_MIRRORS){
    try {
      const data = await getJSON(url, {headers:{'Accept':'application/json'}});
      if (!Array.isArray(data) || !data.length) throw new Error('empty data set');
      return data.map(fromOpen);
    } catch(e){ last = e; }
  }
  throw last || new Error('no mirror reachable');
}

async function atlas(onProgress){
  const want = state.source === 'rest' ? 'rest:' + state.keyToken : 'open';
  if (cache.atlas && cache.builtFor === want) return cache.atlas;
  const list = state.source === 'rest'
    ? (await rcAll(state.apiKey, onProgress)).map(fromRest)
    : await openAtlas();
  cache.atlas = list;
  cache.index = buildIndex(list);
  cache.builtFor = want;
  return list;
}

function invalidateAtlas(){ cache.atlas = null; cache.index = null; cache.builtFor = null; }

/* --- name matching ---------------------------------------------------- */
function norm(s){
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function buildIndex(list){
  const idx = new Map();
  const add = (key, c) => { const k = norm(key); if (k && !idx.has(k)) idx.set(k, c); };
  list.forEach(c => c.keys.forEach(k => add(k, c)));   // real names and codes win
  list.forEach(c => c.soft.forEach(k => add(k, c)));   // then spellings and translations
  return idx;
}

function editDistance(a, b){
  if (Math.abs(a.length - b.length) > 3) return 99;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++){
    let carry = prev[0]; prev[0] = i;
    for (let j = 1; j <= b.length; j++){
      const t = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j-1] + 1, carry + (a[i-1] === b[j-1] ? 0 : 1));
      carry = t;
    }
  }
  return prev[b.length];
}

async function resolveCountry(raw, onProgress){
  const list = await atlas(onProgress);
  const q = norm(raw);
  if (!q) return null;

  const hit = cache.index.get(q);
  if (hit) return hit;

  const starts = [];
  for (const [key, c] of cache.index) if (key.startsWith(q)) starts.push([key, c]);
  if (starts.length){
    starts.sort((a,b) => a[0].length - b[0].length);
    return starts[0][1];
  }
  for (const [key, c] of cache.index) if (key.includes(q)) return c;

  let best = null, bestD = 3;
  list.forEach(c => {
    const d = editDistance(q, norm(c.keys[0]));
    if (d < bestD){ bestD = d; best = c; }
  });
  return best;
}


/* --- CIA World Factbook -----------------------------------------------
   The CIA shut the Factbook down in February 2026 and the public-domain
   mirror stopped updating with it, so this is a frozen final edition.
   Mountains do not move; land-use percentages will slowly go stale.
   Files are named by old GEC codes in region folders, not ISO codes, so
   the tree listing gives the folder and the table below gives the code. */
const FB_TREE = 'https://api.github.com/repos/factbook/factbook.json/git/trees/master?recursive=1';
const FB_BASES = [
  'https://cdn.jsdelivr.net/gh/factbook/factbook.json@master/',
  'https://raw.githubusercontent.com/factbook/factbook.json/master/'
];
const FB_FOLDERS = ['europe','africa','east-n-southeast-asia','south-asia','central-asia',
  'middle-east','north-america','central-america-n-caribbean','south-america',
  'australia-oceania','antarctica'];
const FB_EDITION = 'CIA World Factbook, final edition';

const FB_GEC = (() => {
  const m = new Map();
  'ABWaa,AFGaf,AGOao,AIAav,ALBal,ANDan,AREae,ARGar,ARMam,ASMaq,ATAay,ATFfs,ATGac,AUSas,AUTau,AZEaj,BDIby,BELbe,BENbn,BFAuv,BGDbg,BGRbu,BHRba,BHSbf,BIHbk,BLMtb,BLRbo,BLZbh,BMUbd,BOLbl,BRAbr,BRBbb,BRNbx,BTNbt,BVTbv,BWAbc,CAFct,CANca,CCKck,CHEsz,CHLci,CHNch,CIViv,CMRcm,CODcg,COGcf,COKcw,COLco,COMcn,CPVcv,CRIcs,CUBcu,CUWuc,CXRkt,CYMcj,CYPcy,CZEez,DEUgm,DJIdj,DMAdo,DNKda,DOMdr,DZAag,ECUec,EGYeg,ERIer,ESPsp,ESTen,ETHet,FINfi,FJIfj,FLKfk,FRAfr,FROfo,FSMfm,GABgb,GBRuk,GEOgg,GGYgk,GHAgh,GIBgi,GINgv,GMBga,GNBpu,GNQek,GRCgr,GRDgj,GRLgl,GTMgt,GUMgq,GUYgy,HKGhk,HMDhm,HNDho,HRVhr,HTIha,HUNhu,IDNid,IMNim,INDin,IOTio,IRLei,IRNir,IRQiz,ISLic,ISRis,ITAit,JAMjm,JEYje,JORjo,JPNja,KAZkz,KENke,KGZkg,KHMcb,KIRkr,KNAsc,KORks,KWTku,LAOla,LBNle,LBRli,LBYly,LCAst,LIEls,LKAce,LSOlt,LTUlh,LUXlu,LVAlg,MACmc,MAFrn,MARmo,MCOmn,MDAmd,MDGma,MDVmv,MEXmx,MHLrm,MKDmk,MLIml,MLTmt,MMRbm,MNEmj,MNGmg,MNPcq,MOZmz,MRTmr,MSRmh,MUSmp,MWImi,MYSmy,NAMwa,NCLnc,NERng,NFKnf,NGAni,NICnu,NIUne,NLDnl,NORno,NPLnp,NRUnr,NZLnz,OMNmu,PAKpk,PANpm,PCNpc,PERpe,PHLrp,PLWps,PNGpp,POLpl,PRIrq,PRKkn,PRTpo,PRYpa,PSEwe,PYFfp,QATqa,ROUro,RUSrs,RWArw,SAUsa,SDNsu,SENsg,SGPsn,SGSsx,SHNsh,SJMsv,SLBbp,SLEsl,SLVes,SMRsm,SOMso,SPMsb,SRBri,SSDod,STPtp,SURns,SVKlo,SVNsi,SWEsw,SWZwz,SXMnn,SYCse,SYRsy,TCAtk,TCDcd,TGOto,THAth,TJKti,TKLtl,TKMtx,TLStt,TONtn,TTOtd,TUNts,TURtu,TUVtv,TWNtw,TZAtz,UGAug,UKRup,UMIum,UNKkv,URYuy,USAus,UZBuz,VATvt,VCTvc,VENve,VGBvi,VIRvq,VNMvm,VUTnh,WLFwf,WSMws,XKXkv,YEMym,ZAFsf,ZMBza,ZWEzi'.split(',').forEach(p => m.set(p.slice(0,3), p.slice(3)));
  return m;
})();

async function fbPaths(){
  if (cache.fbPaths) return cache.fbPaths;
  const m = new Map();
  try {
    const tree = await getJSON(FB_TREE);
    (tree.tree || []).forEach(n => {
      const hit = /^([a-z-]+)\/([a-z]{2})\.json$/.exec(n.path || '');
      if (hit) m.set(hit[2], n.path);
    });
  } catch(e){ /* fall back to probing the folders below */ }
  cache.fbPaths = m;
  return m;
}

async function factbook(iso3){
  if (cache.fb.has(iso3)) return cache.fb.get(iso3);
  const job = (async () => {
    const gec = FB_GEC.get(iso3);
    if (!gec) return null;
    const known = (await fbPaths()).get(gec);
    const tries = known ? [known] : FB_FOLDERS.map(f => `${f}/${gec}.json`);
    for (const t of tries){
      for (const base of FB_BASES){
        try { return await getJSON(base + t); } catch(e){}
      }
      if (!known) break;   // probing every folder on both mirrors is not worth it
    }
    if (!known){
      for (const t of tries){
        try { return await getJSON(FB_BASES[0] + t); } catch(e){}
      }
    }
    return null;
  })();
  cache.fb.set(iso3, job);
  return job;
}

/* --- reading the Factbook's free text --------------------------------- */
const fbText = (o, ...keys) => {
  let v = o;
  for (const k of keys){ if (!v || typeof v !== 'object') return null; v = v[k]; }
  if (v && typeof v.text === 'string') return v.text;
  return typeof v === 'string' ? v : null;
};

/* "Grossglockner 3,798 m" and "Laguna del Carbon -105 m" */
function fbPoint(text){
  const t = fbClip(text);
  if (!t) return null;
  const hit = /^(.{0,200}?)(-?[\d,]+(?:\.\d+)?)\s*m\b/.exec(t.trim());
  if (!hit) return null;
  const metres = Number(hit[2].replace(/,/g, ''));
  const name = hit[1].replace(/[,;:]\s*$/, '').trim();
  return { name: name || null, metres: isFinite(metres) ? metres : null };
}

/* "1,448 km", "0 km (landlocked)", "83,871 sq km", "NA" */
function fbAmount(text, unit){
  const t = fbClip(text);
  if (!t || /^\s*NA\b/i.test(t)) return null;
  const hit = new RegExp('(-?[\\d,]+(?:\\.\\d+)?)\\s*' + unit + '\\b').exec(t);
  if (!hit) return null;
  const n = Number(hit[1].replace(/,/g, ''));
  return isFinite(n) ? n : null;
}

/* Every field below is parsed from text fetched off the network, so each one
   is clipped first. The regexes backtrack, and an unbounded string from a
   compromised mirror would otherwise be able to hang the tab. */
const FB_MAX_TEXT = 4000;
const fbClip = t => (typeof t === 'string' ? t.slice(0, FB_MAX_TEXT) : null);

/* prose fields carry trailing notes and estimate years that add nothing here.
   The bracket pattern matches a whole bracketed run in one go: two adjacent
   open-ended classes inside it would backtrack badly on an unclosed bracket. */
function fbProse(text){
  const t = fbClip(text);
  if (!t) return null;
  const clean = t.replace(/\s*\([^)]{0,300}?(?:\d{4}|est\.)[^)]{0,300}\)\s*/gi, ' ')
                 .replace(/\s*note\s*[-:][\s\S]*$/i, '')
                 .replace(/\s+/g, ' ')
                 .trim();
  return clean || null;
}


/* The Religions field is free text and its shape varies a lot:
   "Roman Catholic 24.8%, Protestant 22.6%, none 47.4% (2022 est.)"
   "Muslim 90-95%, other 5-10%"
   "Christian 70.6% (includes Protestant 25.4%, Roman Catholic 20.8%)"
   "Muslim (official), Christian, Hindu"          <- no figures at all
   Bracketed matter is dropped so nested breakdowns cannot be mistaken for
   top-level groups, and a range is read as its lower bound. */
const FB_NONE  = /^(none|unaffiliated|atheist|agnostic|no religion|non-?religious|irreligious|secular)\b/i;
const FB_OTHER = /^(other|unspecified|unknown|no answer|various|several)\b/i;

function fbReligions(text){
  const clipped = fbClip(text);
  if (!clipped) return null;
  const cleaned = clipped
    .replace(/\s*note\s*[-:][\s\S]*$/i, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ');
  const out = [];
  cleaned.split(/[,;]/).forEach(part => {
    const hit = /^\s*(.+?)\s+([\d.]+)(?:\s*[-–]\s*[\d.]+)?\s*%\s*$/.exec(part);
    if (!hit) return;
    const pct = Number(hit[2]);
    if (!isFinite(pct)) return;
    const name = hit[1].trim().replace(/^and\s+/i, '').replace(/^[^A-Za-z]+/, '');
    if (name) out.push({ name, pct, none:FB_NONE.test(name), other:FB_OTHER.test(name) });
  });
  return out.length ? out : null;
}

function fbReligionText(fb){
  return fbText(fb, 'People and Society', 'Religions')
      || fbText(fb, 'People and Society', 'Religion');
}

/* "Austria 801 km; Belgium 133 km; Czechia 704 km" and the comma-separated
   variant. Splitting on the separator would be wrong: a thousands comma sits
   inside the figures ("Russia 2,511 km"), so instead every "name figure km"
   run is matched in place. Names may carry accents and apostrophes. */
function fbBorderList(text){
  const clipped = fbClip(text);
  if (!clipped) return null;
  const cleaned = clipped
    .replace(/\s*note\s*[-:][\s\S]*$/i, '')
    .replace(/\([^)]*\)/g, ' ');
  const out = [];
  const re = /([^\d;,()]{2,}?)\s+(\d[\d,]*(?:\.\d+)?)\s*km/g;
  let hit;
  while ((hit = re.exec(cleaned)) !== null){
    const km = Number(hit[2].replace(/,/g, ''));
    if (!isFinite(km)) continue;
    const name = hit[1].replace(/^[^A-Za-zÀ-ÿ]+/, '').trim();
    if (name) out.push({ name, km });
  }
  return out.length ? out : null;
}

function fbBorders(fb){
  return fbBorderList(fbText(fb, 'Geography', 'Land boundaries', 'border countries'));
}

/* --- World Bank ------------------------------------------------------- */
async function wbCountrySet(){
  if (cache.wbCountries) return cache.wbCountries;
  const [, rows] = await getJSON(`${WB}/country?format=json&per_page=400`);
  cache.wbCountries = new Set(
    (rows || []).filter(r => r.region && r.region.value !== 'Aggregates').map(r => r.id)
  );
  return cache.wbCountries;
}

async function indicator(code){
  if (cache.ind.has(code)) return cache.ind.get(code);
  const p = (async () => {
    const keep = await wbCountrySet();
    const [, rows] = await getJSON(`${WB}/country/all/indicator/${code}?format=json&mrnev=1&per_page=500`);
    const byIso = new Map(), values = [];
    (rows || []).forEach(r => {
      const iso = r.countryiso3code;
      if (!iso || !keep.has(iso) || r.value == null) return;
      byIso.set(iso, { value:Number(r.value), year:r.date });
      values.push(Number(r.value));
    });
    return { byIso, values };
  })();
  cache.ind.set(code, p);
  return p;
}

/* ============================================================
   5. Card catalogue
   ============================================================ */
const ISO = 'ISO 3166 reference data';
const RCS = 'REST Countries';
const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
const MEMBER_LABELS = {
  un:'UN', eu:'EU', eurozone:'Eurozone', schengen:'Schengen', nato:'NATO',
  commonwealth:'Commonwealth', oecd:'OECD', g7:'G7', g20:'G20', brics:'BRICS',
  opec:'OPEC', african_union:'African Union', asean:'ASEAN', arab_league:'Arab League'
};
const title = s => String(s || '').replace(/[_-]+/g, ' ').replace(/^./, m => m.toUpperCase());

function wbCard(ctx, code, c, fmt){
  const set = ctx.wb.get(code);
  const row = set && set.byIso.get(c.iso3);
  if (!row) return null;
  return { ...fmt(row.value), rank:rankAmong(set.values, row.value), source:'World Bank, ' + row.year };
}

/* population: the reference set carries it under a key, otherwise the bank does */
function populationOf(c, ctx){
  if (c.population != null){
    const all = ctx.atlas.map(y => y.population).filter(v => typeof v === 'number');
    return { value:c.population, rank:rankAmong(all, c.population), source:ctx.refSource };
  }
  const set = ctx.wb.get('SP.POP.TOTL');
  const row = set && set.byIso.get(c.iso3);
  if (!row) return null;
  return { value:row.value, rank:rankAmong(set.values, row.value), source:'World Bank, ' + row.year };
}

const CARDS = [
  /* --- People --- */
  { id:'population', label:'Population', group:'People', wb:'SP.POP.TOTL', kind:'stat',
    build:(c,x)=>{ const p = populationOf(c,x); return p ? { ...fmtPeople(p.value), rank:p.rank, source:p.source } : null; } },
  { id:'density', label:'Population density', group:'People', wb:'SP.POP.TOTL', kind:'stat',
    build:(c,x)=>{
      const p = populationOf(c,x);
      if (!p || !c.area) return null;
      const v = p.value / c.area;
      const all = [];
      x.atlas.forEach(y => {
        if (!y.area) return;
        const pop = y.population != null ? y.population
                  : (x.wb.get('SP.POP.TOTL') && (x.wb.get('SP.POP.TOTL').byIso.get(y.iso3) || {}).value);
        if (pop) all.push(pop / y.area);
      });
      return { ...fmtNum(v, 'people per square kilometre', v < 10 ? 1 : 0),
               rank:rankAmong(all, v), source:p.source };
    } },
  { id:'languages', label:'Official languages', group:'People', kind:'text',
    build:(c,x)=>{ const L = c.languages; if (!L.length) return null;
      if (L.length <= 2) return { big:L.join(' and '),
        unit:L.length === 1 ? 'the one official language' : 'the two official languages', detail:'', source:x.refSource };
      return { big:String(L.length), unit:'official languages', detail:L.join(', '), source:x.refSource }; } },
  { id:'lifeexp', label:'Life expectancy at birth', group:'People', wb:'SP.DYN.LE00.IN',
    kind:'stat', build:(c,x)=>wbCard(x,'SP.DYN.LE00.IN',c,v=>fmtNum(v,'years')) },
  { id:'urban', label:'Living in urban areas', group:'People', wb:'SP.URB.TOTL.IN.ZS',
    kind:'stat', build:(c,x)=>wbCard(x,'SP.URB.TOTL.IN.ZS',c,v=>fmtPct(v,'of the population')) },
  { id:'fertility', label:'Births per woman', group:'People', wb:'SP.DYN.TFRT.IN',
    kind:'stat', build:(c,x)=>wbCard(x,'SP.DYN.TFRT.IN',c,v=>fmtNum(v,'children, lifetime average',2)) },
  { id:'popgrowth', label:'Annual population growth', group:'People', wb:'SP.POP.GROW',
    kind:'stat', build:(c,x)=>wbCard(x,'SP.POP.GROW',c,v=>fmtPct(v,'change per year')) },
  { id:'infant', label:'Infant mortality', group:'People', wb:'SP.DYN.IMRT.IN',
    kind:'stat', build:(c,x)=>wbCard(x,'SP.DYN.IMRT.IN',c,v=>fmtNum(v,'deaths per 1,000 live births')) },

  /* --- Economy --- */
  { id:'gdp', label:'Gross domestic product', group:'Economy', wb:'NY.GDP.MKTP.CD',
    kind:'stat', build:(c,x)=>wbCard(x,'NY.GDP.MKTP.CD',c,fmtMoney) },
  { id:'gdppc', label:'GDP per person', group:'Economy', wb:'NY.GDP.PCAP.CD',
    kind:'stat', build:(c,x)=>wbCard(x,'NY.GDP.PCAP.CD',c,fmtPerHead) },
  { id:'gdpgrowth', label:'Annual GDP growth', group:'Economy', wb:'NY.GDP.MKTP.KD.ZG',
    kind:'stat', build:(c,x)=>wbCard(x,'NY.GDP.MKTP.KD.ZG',c,v=>fmtPct(v,'change per year')) },
  { id:'unemp', label:'Unemployment', group:'Economy', wb:'SL.UEM.TOTL.ZS',
    kind:'stat', build:(c,x)=>wbCard(x,'SL.UEM.TOTL.ZS',c,v=>fmtPct(v,'of the labour force')) },
  { id:'gini', label:'Income inequality', group:'Economy', wb:'SI.POV.GINI',
    kind:'stat', build:(c,x)=>wbCard(x,'SI.POV.GINI',c,v=>fmtNum(v,'Gini index, 0 is perfect equality')) },
  { id:'health', label:'Spending on health', group:'Economy', wb:'SH.XPD.CHEX.GD.ZS',
    kind:'stat', build:(c,x)=>wbCard(x,'SH.XPD.CHEX.GD.ZS',c,v=>fmtPct(v,'of GDP')) },
  { id:'education', label:'Spending on education', group:'Economy', wb:'SE.XPD.TOTL.GD.ZS',
    kind:'stat', build:(c,x)=>wbCard(x,'SE.XPD.TOTL.GD.ZS',c,v=>fmtPct(v,'of GDP')) },
  { id:'military', label:'Spending on defence', group:'Economy', wb:'MS.MIL.XPND.GD.ZS',
    kind:'stat', build:(c,x)=>wbCard(x,'MS.MIL.XPND.GD.ZS',c,v=>fmtPct(v,'of GDP')) },
  { id:'tourism', label:'International visitors', group:'Economy', wb:'ST.INT.ARVL',
    kind:'stat', build:(c,x)=>wbCard(x,'ST.INT.ARVL',c,v=>fmtCount(v,'arrivals per year')) },
  { id:'currency', label:'Currency', group:'Economy', kind:'text',
    build:(c,x)=>{ const e = c.currencies; if (!e.length) return null;
      const f = e[0];
      return { big:(f.symbol ? f.symbol + ' ' : '') + f.code,
               unit:e.length > 1 ? 'one of ' + e.length + ' currencies in use' : 'the one currency in use',
               detail:'', source:x.refSource }; } },

  /* --- Land --- */
  { id:'area', label:'Land area', group:'Land', kind:'stat',
    build:(c,x)=> c.area == null ? null
      : ({ ...fmtArea(c.area), rank:rankAmong(x.area, c.area), source:x.refSource }) },
  { id:'borders', label:'Countries it borders', group:'Land', kind:'stat',
    build:(c,x)=>{ const v = c.borders.length;
      return { ...fmtNum(v, v === 1 ? 'land neighbour' : 'land neighbours', 0),
               rank:rankAmong(x.bord, v), source:x.refSource }; } },
  { id:'longestborder', label:'Longest single land border', group:'Land', fb:true, kind:'stat',
    build:(c,x)=>{ const B = fbBorders(x.fb); if (!B) return null;
      const km = Math.max(...B.map(b => b.km));
      return { ...fmtNum(km, B.length === 1 ? 'kilometres, its only border' : 'kilometres, with one neighbour', 0),
               source:FB_EDITION }; } },
  { id:'shortestborder', label:'Shortest single land border', group:'Land', fb:true, kind:'stat',
    build:(c,x)=>{ const B = fbBorders(x.fb); if (!B) return null;
      const km = Math.min(...B.map(b => b.km));
      return { ...fmtNum(km, B.length === 1 ? 'kilometres, its only border' : 'kilometres, with one neighbour', 0),
               source:FB_EDITION }; } },
  { id:'region', label:'Continental region', group:'Land', kind:'category',
    build:(c,x)=> !c.region ? null
      : ({ big:c.region, unit:'', share:shareOf(x.atlas, y => y.region === c.region), source:x.refSource }) },
  { id:'subregion', label:'Sub-region', group:'Land', kind:'category',
    build:(c,x)=> !c.subregion ? null
      : ({ big:c.subregion, unit:'', share:shareOf(x.atlas, y => y.subregion === c.subregion), source:x.refSource }) },
  { id:'landlocked', label:'Access to the sea', group:'Land', kind:'category',
    build:(c,x)=>({ big:c.landlocked ? 'Landlocked' : 'Has a coast', unit:'',
      share:shareOf(x.atlas, y => !!y.landlocked === !!c.landlocked), source:x.refSource }) },
  { id:'timezones', label:'Time zones', group:'Land', kind:'text', needs:'rc',
    build:(c,x)=>{ const z = c.timezones; if (!z) return null;
      if (z.length === 1) return { big:z[0], unit:'the one time zone', detail:'', source:x.refSource };
      return { big:String(z.length), unit:'time zones',
               detail:z.slice(0,6).join(', ') + (z.length > 6 ? ', and ' + (z.length-6) + ' more' : ''),
               source:x.refSource }; } },

  /* --- Environment --- */
  { id:'forest', label:'Forest cover', group:'Environment', wb:'AG.LND.FRST.ZS',
    kind:'stat', build:(c,x)=>wbCard(x,'AG.LND.FRST.ZS',c,v=>fmtPct(v,'of the land area')) },
  { id:'co2', label:'Carbon dioxide per person', group:'Environment', wb:'EN.GHG.CO2.PC.CE.AR5',
    kind:'stat', build:(c,x)=>wbCard(x,'EN.GHG.CO2.PC.CE.AR5',c,v=>fmtNum(v,'tonnes per person, per year',2)) },
  { id:'internet', label:'People using the internet', group:'Environment', wb:'IT.NET.USER.ZS',
    kind:'stat', build:(c,x)=>wbCard(x,'IT.NET.USER.ZS',c,v=>fmtPct(v,'of the population')) },
  { id:'electricity', label:'Access to electricity', group:'Environment', wb:'EG.ELC.ACCS.ZS',
    kind:'stat', build:(c,x)=>wbCard(x,'EG.ELC.ACCS.ZS',c,v=>fmtPct(v,'of the population')) },

  /* --- Everyday life --- */
  { id:'driving', label:'Traffic drives on the', group:'Everyday life', kind:'category', needs:'rc',
    build:(c,x)=>{ const s = c.drivingSide; if (!s) return null;
      return { big:title(s), unit:'', share:shareOf(x.atlas, y => y.drivingSide === s), source:x.refSource }; } },
  { id:'startofweek', label:'The week starts on', group:'Everyday life', kind:'category', needs:'rc',
    build:(c,x)=>{ const d = c.startOfWeek; if (!d) return null;
      return { big:title(d), unit:'', share:shareOf(x.atlas, y => y.startOfWeek === d), source:x.refSource }; } },
  { id:'measurement', label:'System of measurement', group:'Everyday life', kind:'category', needs:'rc',
    build:(c,x)=>{ const m = c.measurement; if (!m) return null;
      return { big:title(m), unit:'', share:shareOf(x.atlas, y => y.measurement === m), source:x.refSource }; } },
  { id:'temperature', label:'Temperature is measured in', group:'Everyday life', kind:'category', needs:'rc',
    build:(c,x)=>{ const t = c.temperature; if (!t) return null;
      return { big:title(t), unit:'', share:shareOf(x.atlas, y => y.temperature === t), source:x.refSource }; } },
  { id:'numberformat', label:'A million and a half is written', group:'Everyday life', kind:'text', needs:'rc',
    build:(c,x)=>{ const f = c.numberFormat; if (!f) return null;
      const grouped = '1' + f.thousands + '500' + f.thousands + '000' + f.decimal + '50';
      return { big:grouped, unit:'local number formatting', detail:'', source:x.refSource }; } },
  { id:'postal', label:'Postal codes look like', group:'Everyday life', kind:'text', needs:'rc',
    build:(c,x)=>{ const p = c.postalFormat; if (!p) return null;
      return { big:p, unit:'# stands for a digit', detail:'', source:x.refSource }; } },
  { id:'academic', label:'The school year begins', group:'Everyday life', kind:'text', needs:'rc',
    build:(c,x)=>{ const a = c.academicYear; if (!a) return null;
      return { big:(a.day ? a.day + ' ' : '') + MONTHS[a.month-1], unit:'start of the academic year', detail:'', source:x.refSource }; } },
  { id:'fiscal', label:'The fiscal year begins', group:'Everyday life', kind:'text', needs:'rc',
    build:(c,x)=>{ const f = c.fiscalYear; if (!f) return null;
      return { big:(f.day ? f.day + ' ' : '') + MONTHS[f.month-1], unit:'government fiscal year', detail:'', source:x.refSource }; } },

  /* --- Standing --- */
  { id:'unmember', label:'United Nations seat', group:'Standing', kind:'category',
    build:(c,x)=>({ big:c.unMember ? 'A member state' : 'Not a member', unit:'',
      share:shareOf(x.atlas, y => !!y.unMember === !!c.unMember), source:x.refSource }) },
  { id:'ungroup', label:'UN regional group', group:'Standing', kind:'category',
    build:(c,x)=> !c.unGroup ? null
      : ({ big:c.unGroup, unit:'', share:shareOf(x.atlas, y => y.unGroup === c.unGroup), source:x.refSource }) },
  { id:'independent', label:'Sovereignty', group:'Standing', kind:'category',
    build:(c,x)=>({ big:c.sovereign ? 'A sovereign state' : 'A dependent territory', unit:'',
      share:shareOf(x.atlas, y => !!y.sovereign === !!c.sovereign), source:x.refSource }) },
  { id:'memberships', label:'International memberships', group:'Standing', kind:'text', needs:'rc',
    build:(c,x)=>{ const m = c.memberships; if (!m) return null;
      const on = Object.keys(MEMBER_LABELS).filter(k => m[k]).map(k => MEMBER_LABELS[k]);
      if (!on.length) return { big:'None', unit:'of the blocs tracked here', detail:'', source:x.refSource };
      if (on.length <= 2) return { big:on.join(' and '), unit:on.length === 1 ? 'the one bloc it belongs to' : 'the blocs it belongs to', detail:'', source:x.refSource };
      return { big:String(on.length), unit:'blocs and treaty organisations', detail:on.join(', '), source:x.refSource }; } },
  { id:'government', label:'Form of government', group:'Standing', kind:'text', needs:'rc',
    build:(c,x)=>{ const g = c.governmentType; if (!g) return null;
      return { big:title(g), unit:'', detail:'', source:x.refSource }; } },


  /* --- Elevation and terrain (Factbook) --- */
  { id:'meanelev', label:'Mean elevation', group:'Elevation and terrain', fb:true, kind:'stat',
    build:(c,x)=>{ const v = fbAmount(fbText(x.fb,'Geography','Elevation','mean elevation'), 'm');
      return v == null ? null : { ...fmtNum(v,'metres above sea level',0), source:FB_EDITION }; } },
  { id:'highelev', label:'Highest point', group:'Elevation and terrain', fb:true, kind:'stat',
    build:(c,x)=>{ const p = fbPoint(fbText(x.fb,'Geography','Elevation','highest point'));
      return (!p || p.metres == null) ? null
        : { ...fmtNum(p.metres,'metres above sea level',0), source:FB_EDITION }; } },
  { id:'lowelev', label:'Lowest point', group:'Elevation and terrain', fb:true, kind:'stat',
    build:(c,x)=>{ const p = fbPoint(fbText(x.fb,'Geography','Elevation','lowest point'));
      return (!p || p.metres == null) ? null
        : { ...fmtNum(p.metres, p.metres === 0 ? 'metres, at sea level' : 'metres above sea level', 0),
            source:FB_EDITION }; } },
  { id:'relief', label:'Height from lowest to highest', group:'Elevation and terrain', fb:true, kind:'stat',
    build:(c,x)=>{ const hi = fbPoint(fbText(x.fb,'Geography','Elevation','highest point'));
      const lo = fbPoint(fbText(x.fb,'Geography','Elevation','lowest point'));
      if (!hi || !lo || hi.metres == null || lo.metres == null) return null;
      return { ...fmtNum(hi.metres - lo.metres,'metres of vertical range',0), source:FB_EDITION }; } },
  { id:'coastline', label:'Length of coastline', group:'Elevation and terrain', fb:true, kind:'stat',
    build:(c,x)=>{ const v = fbAmount(fbText(x.fb,'Geography','Coastline'), 'km');
      return v == null ? null
        : { ...fmtNum(v, v === 0 ? 'kilometres, it is landlocked' : 'kilometres', 0), source:FB_EDITION }; } },
  { id:'boundaries', label:'Length of land borders', group:'Elevation and terrain', fb:true, kind:'stat',
    build:(c,x)=>{ const v = fbAmount(fbText(x.fb,'Geography','Land boundaries','total'), 'km');
      return v == null ? null : { ...fmtNum(v,'kilometres',0), source:FB_EDITION }; } },
  { id:'watershare', label:'Share of the territory that is water', group:'Elevation and terrain', fb:true, kind:'stat',
    build:(c,x)=>{ const tot = fbAmount(fbText(x.fb,'Geography','Area','total'), 'sq km');
      const wat = fbAmount(fbText(x.fb,'Geography','Area','water'), 'sq km');
      if (!tot || wat == null) return null;
      return { ...fmtPct(wat/tot*100,'of the total area'), source:FB_EDITION }; } },
  { id:'terrain', label:'The lie of the land', group:'Elevation and terrain', fb:true, kind:'prose',
    build:(c,x)=>{ const t = fbProse(fbText(x.fb,'Geography','Terrain'));
      return t ? { big:t, unit:'', source:FB_EDITION } : null; } },
  { id:'climate', label:'Climate', group:'Elevation and terrain', fb:true, kind:'prose',
    build:(c,x)=>{ const t = fbProse(fbText(x.fb,'Geography','Climate'));
      return t ? { big:t, unit:'', source:FB_EDITION } : null; } },
  { id:'resources', label:'Natural resources', group:'Elevation and terrain', fb:true, kind:'prose',
    build:(c,x)=>{ const t = fbProse(fbText(x.fb,'Geography','Natural resources'));
      return t ? { big:t, unit:'', source:FB_EDITION } : null; } },
  { id:'hazards', label:'Natural hazards', group:'Elevation and terrain', fb:true, kind:'prose',
    build:(c,x)=>{ const t = fbProse(fbText(x.fb,'Geography','Natural hazards'));
      return t ? { big:t, unit:'', source:FB_EDITION } : null; } },

  /* --- more land and water, from the bank --- */
  { id:'rainfall', label:'Average yearly rainfall', group:'Environment', wb:'AG.LND.PRCP.MM',
    kind:'stat', build:(c,x)=>wbCard(x,'AG.LND.PRCP.MM',c,v=>fmtNum(v,'millimetres of depth',0)) },
  { id:'lowland', label:'Land lying below five metres', group:'Environment', wb:'AG.LND.EL5M.ZS',
    kind:'stat', build:(c,x)=>wbCard(x,'AG.LND.EL5M.ZS',c,v=>fmtPct(v,'of the land area')) },
  { id:'lowpop', label:'People living below five metres', group:'Environment', wb:'EN.POP.EL5M.ZS',
    kind:'stat', build:(c,x)=>wbCard(x,'EN.POP.EL5M.ZS',c,v=>fmtPct(v,'of the population')) },
  { id:'protected', label:'Protected land', group:'Environment', wb:'ER.LND.PTLD.ZS',
    kind:'stat', build:(c,x)=>wbCard(x,'ER.LND.PTLD.ZS',c,v=>fmtPct(v,'of the land area')) },
  { id:'arable', label:'Arable land', group:'Environment', wb:'AG.LND.ARBL.ZS',
    kind:'stat', build:(c,x)=>wbCard(x,'AG.LND.ARBL.ZS',c,v=>fmtPct(v,'of the land area')) },
  { id:'agriland', label:'Agricultural land', group:'Environment', wb:'AG.LND.AGRI.ZS',
    kind:'stat', build:(c,x)=>wbCard(x,'AG.LND.AGRI.ZS',c,v=>fmtPct(v,'of the land area')) },
  { id:'freshwater', label:'Renewable fresh water', group:'Environment', wb:'ER.H2O.INTR.PC',
    kind:'stat', build:(c,x)=>wbCard(x,'ER.H2O.INTR.PC',c,v=>fmtCount(v,'cubic metres per person, per year')) },
  { id:'irrigated', label:'Irrigated farmland', group:'Environment', wb:'AG.LND.IRIG.AG.ZS',
    kind:'stat', build:(c,x)=>wbCard(x,'AG.LND.IRIG.AG.ZS',c,v=>fmtPct(v,'of agricultural land')) },


  /* --- Belief (Factbook) --- */
  { id:'religion', label:'Largest religious group', group:'Belief', fb:true, kind:'text',
    build:(c,x)=>{ const R = fbReligions(fbReligionText(x.fb)); if (!R) return null;
      const faiths = R.filter(r => !r.none && !r.other);
      if (!faiths.length) return null;
      const top = faiths.reduce((a,b) => b.pct > a.pct ? b : a);
      return { big:top.name, unit:nf(top.pct,1) + '% of the population', detail:'', source:FB_EDITION }; } },
  { id:'religionshare', label:'Share in the largest religious group', group:'Belief', fb:true, kind:'stat',
    build:(c,x)=>{ const R = fbReligions(fbReligionText(x.fb)); if (!R) return null;
      const faiths = R.filter(r => !r.none && !r.other);
      if (!faiths.length) return null;
      const top = faiths.reduce((a,b) => b.pct > a.pct ? b : a);
      return { ...fmtPct(top.pct,'belong to the single largest group'), source:FB_EDITION }; } },
  { id:'noreligion', label:'People reporting no religion', group:'Belief', fb:true, kind:'stat',
    build:(c,x)=>{ const R = fbReligions(fbReligionText(x.fb)); if (!R) return null;
      const none = R.filter(r => r.none);
      if (!none.length) return null;
      const sum = none.reduce((a,r) => a + r.pct, 0);
      return { ...fmtPct(sum,'of the population'), source:FB_EDITION }; } },
  { id:'faithcount', label:'Religious groups recorded', group:'Belief', fb:true, kind:'stat',
    build:(c,x)=>{ const R = fbReligions(fbReligionText(x.fb)); if (!R) return null;
      const n = R.filter(r => !r.none && !r.other).length;
      return n ? { ...fmtNum(n, n === 1 ? 'group counted separately' : 'groups counted separately', 0),
                   source:FB_EDITION } : null; } },
  { id:'religions', label:'Religious make-up', group:'Belief', fb:true, kind:'prose',
    build:(c,x)=>{ const raw = fbReligionText(x.fb); if (!raw) return null;
      const R = fbReligions(raw);
      const body = R
        ? R.map(r => `${r.name} ${nf(r.pct,1)}%`).join(', ')
        : fbProse(raw);
      return body ? { big:body, unit:'', source:FB_EDITION } : null; } },

  /* --- Gives it away --- */
  { id:'peakname', label:'Its highest point is called', group:'Gives it away', fb:true, kind:'text', reveals:true,
    build:(c,x)=>{ const p = fbPoint(fbText(x.fb,'Geography','Elevation','highest point'));
      return (p && p.name) ? { big:p.name,
        unit:p.metres != null ? nf(p.metres,0) + ' metres above sea level' : '',
        detail:'', source:FB_EDITION } : null; } },
  { id:'lowname', label:'Its lowest point is called', group:'Gives it away', fb:true, kind:'text', reveals:true,
    build:(c,x)=>{ const p = fbPoint(fbText(x.fb,'Geography','Elevation','lowest point'));
      return (p && p.name) ? { big:p.name,
        unit:p.metres != null ? nf(p.metres,0) + ' metres above sea level' : '',
        detail:'', source:FB_EDITION } : null; } },
  /* --- Gives it away --- */
  { id:'capital', label:'Capital city', group:'Gives it away', kind:'text', reveals:true,
    build:(c,x)=>{ const cap = c.capitals[0];
      return cap ? { big:cap, unit:'seat of government', detail:'', source:x.refSource } : null; } },
  { id:'demonym', label:'People from here are called', group:'Gives it away', kind:'text', reveals:true,
    build:(c,x)=> c.demonym ? { big:c.demonym, unit:'in English', detail:'', source:x.refSource } : null },
  { id:'calling', label:'Telephone code', group:'Gives it away', kind:'text', reveals:true,
    build:(c,x)=> c.callingCode ? { big:c.callingCode, unit:'international dialling code', detail:'', source:x.refSource } : null },
  { id:'tld', label:'Internet domain', group:'Gives it away', kind:'text', reveals:true,
    build:(c,x)=> c.tlds[0] ? { big:c.tlds[0], unit:'top-level domain', detail:'', source:x.refSource } : null },
  { id:'carsign', label:'Vehicle registration code', group:'Gives it away', kind:'text', reveals:true, needs:'rc',
    build:(c,x)=> (c.carSigns && c.carSigns[0])
      ? { big:c.carSigns[0], unit:'the oval sticker on a car', detail:'', source:x.refSource } : null },
  { id:'flagcolour', label:'The flag is mostly', group:'Gives it away', kind:'swatch', reveals:true, needs:'rc',
    build:(c,x)=> c.flagColor
      ? { big:c.flagColor.toUpperCase(), unit:'the colour covering most of the flag', swatch:c.flagColor, source:x.refSource } : null },
  { id:'coords', label:'Position on the globe', group:'Gives it away', kind:'text', reveals:true,
    build:(c,x)=>{ if (typeof c.lat !== 'number' || typeof c.lng !== 'number') return null;
      return { big:`${Math.abs(c.lat).toFixed(1)}° ${c.lat >= 0 ? 'N' : 'S'}`,
               unit:`${Math.abs(c.lng).toFixed(1)}° ${c.lng >= 0 ? 'E' : 'W'}`, detail:'', source:x.refSource }; } }
];

const DEFAULTS = ['population','area','density','gdp','gdppc','lifeexp','urban','internet','forest','languages','region','landlocked'];
const GROUP_ORDER = ['People','Belief','Economy','Land','Elevation and terrain','Environment','Everyday life','Standing','Gives it away'];

function shareOf(all, pred){
  return { n: all.filter(pred).length, total: all.length };
}

/* ============================================================
   6. Assembling card data
   ============================================================ */
async function buildCards(country, ids, onProgress){
  const list = await atlas(onProgress);
  const defs = ids.map(id => CARDS.find(c => c.id === id)).filter(Boolean);

  const codes = [...new Set(defs.filter(d => d.wb).map(d => d.wb))];
  const wb = new Map();
  let fb = null;
  await Promise.all([
    ...codes.map(async code => {
      try { wb.set(code, await indicator(code)); } catch(e){ /* card degrades to Not reported */ }
    }),
    (async () => {
      if (!defs.some(d => d.fb)) return;
      try { fb = await factbook(country.iso3); } catch(e){ fb = null; }
    })()
  ]);

  const ctx = {
    atlas: list,
    wb, fb,
    refSource: state.source === 'rest' ? RCS : ISO,
    area: list.map(c => c.area).filter(v => typeof v === 'number' && v > 0),
    bord: list.map(c => c.borders.length)
  };

  return defs.map(def => {
    const base = { id:def.id, label:def.label, kind:def.kind };
    try {
      const f = def.build(country, ctx);
      return f ? { ...base, ...f }
               : { ...base, kind:'empty',
                   source:def.wb ? 'World Bank' : def.fb ? FB_EDITION : ctx.refSource };
    } catch(e){
      return { ...base, kind:'empty', source:'' };
    }
  });
}

/* ============================================================
   7. Canvas drawing
   ============================================================ */
const SANS  = 'Archivo, system-ui, -apple-system, sans-serif';
const SERIF = 'Fraunces, Georgia, "Times New Roman", serif';

function roundRect(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}

function fitFont(ctx, text, maxW, start, min, weight, family){
  let size = start;
  while (size > min){
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= maxW) break;
    size -= 1;
  }
  ctx.font = `${weight} ${size}px ${family}`;
  return size;
}

function wrap(ctx, text, maxW, max){
  const words = String(text).split(/\s+/), lines = [];
  let line = '';
  for (const w of words){
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && line){ lines.push(line); line = w; }
    else line = t;
  }
  if (line) lines.push(line);
  if (lines.length > max){
    const cut = lines.slice(0, max);
    cut[max-1] = cut[max-1].replace(/[,\s]+$/,'') + '…';
    return cut;
  }
  return lines;
}

function drawCard(ctx, x, y, w, h, card, t){
  const s = Math.min(w/540, h/460);

  /* Small text stops shrinking with the card. Past that point the card
     sheds detail instead of becoming unreadable. */
  const labelSize = Math.max(17, 25*s);
  const uSize     = Math.max(15, 21*s);
  const noteSize  = Math.max(14, 16*s);
  const dense     = s < 0.72;

  const pad = Math.max(18, 36*s);
  const innerW = w - pad*2;

  /* surface */
  ctx.save();
  roundRect(ctx, x+1, y+1, w-2, h-2, 20*s);
  if (t.surface){ ctx.fillStyle = t.surface; ctx.fill(); }
  ctx.lineWidth = Math.max(1, 1.5*s);
  ctx.strokeStyle = t.border;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  /* Measure every piece first, then centre the whole stack. Cards can be any
     shape once the sheet is filled edge to edge, and a label pinned to the top
     of a tall card drifts a long way from the number it belongs to. */
  ctx.font = `500 ${labelSize}px ${SANS}`;
  const labelLines = wrap(ctx, card.label, innerW, 2);

  const isEmpty = card.kind === 'empty';
  const isProse = card.kind === 'prose' && !isEmpty;
  ctx.font = `400 ${uSize}px ${SANS}`;
  const unitLines = (!isEmpty && !isProse && card.unit) ? wrap(ctx, card.unit, innerW, 2) : [];

  ctx.font = `400 ${noteSize}px ${SANS}`;
  const showDetail = !isEmpty && card.kind === 'text' && card.detail && !dense;
  const detailLines = showDetail ? wrap(ctx, card.detail, innerW, 2) : [];

  const ruleGap = 14*s, ruleH = Math.max(2, 2.5*s), afterRule = 34*s;
  const labelH  = labelLines.length * labelSize*1.22;
  const unitH   = unitLines.length ? 12*s + unitLines.length*uSize*1.25 : 0;
  const detailH = detailLines.length ? 22*s + detailLines.length*noteSize*1.3 : 0;

  const fixed = labelH + ruleGap + ruleH + afterRule + unitH + detailH;
  const avail = h - pad*2 - fixed;

  /* A prose card carries a paragraph instead of a headline figure, set at a
     size you read rather than one you look at. */
  let proseLines = [], proseSize = 0, proseStep = 0;
  if (isProse){
    proseSize = Math.max(15, 25*s);
    proseStep = proseSize*1.42;
    const room = Math.max(2, Math.floor(avail / proseStep));
    ctx.font = `400 ${proseSize}px ${SANS}`;
    proseLines = wrap(ctx, card.big, innerW, Math.min(8, room));
  }

  const big = isEmpty ? 'Not reported' : card.big;
  const vCap = isEmpty ? Math.max(20, 34*s) : Math.min(112*s, Math.max(24*s, avail*0.86));
  const vSize = isProse ? 0
    : fitFont(ctx, big, card.kind === 'swatch' ? innerW*0.62 : innerW,
              vCap, Math.min(22*s, vCap), 600, SERIF);

  const total = fixed + (isProse ? proseLines.length*proseStep : vSize*0.78);
  let cy = y + Math.max(pad, (h - total)/2);

  /* label */
  ctx.font = `500 ${labelSize}px ${SANS}`;
  ctx.fillStyle = t.label;
  labelLines.forEach(l => { ctx.fillText(l, x+pad, cy + labelSize*0.86); cy += labelSize*1.22; });

  /* hairline rule */
  cy += ruleGap;
  ctx.fillStyle = t.border;
  ctx.fillRect(x+pad, cy, 46*s, ruleH);
  cy += ruleH + afterRule;

  if (isProse){
    ctx.font = `400 ${proseSize}px ${SANS}`;
    ctx.fillStyle = t.value;
    proseLines.forEach(l => { ctx.fillText(l, x+pad, cy + proseSize*0.88); cy += proseStep; });
    ctx.restore();
    return;
  }

  /* value, with an optional colour chip in front of it */
  const vBase = cy + vSize*0.78;
  let vx = x + pad;
  if (!isEmpty && card.kind === 'swatch' && card.swatch){
    const side = vSize*0.78;
    ctx.save();
    roundRect(ctx, vx, vBase - side, side, side, side*0.22);
    ctx.fillStyle = card.swatch;
    ctx.fill();
    ctx.lineWidth = Math.max(1, 1.5*s);
    ctx.strokeStyle = t.border;
    ctx.stroke();
    ctx.restore();
    vx += side + 18*s;
  }
  ctx.font = `600 ${vSize}px ${SERIF}`;
  ctx.fillStyle = isEmpty ? t.label : t.value;
  ctx.fillText(big, vx, vBase);
  cy += vSize*0.78;

  /* unit */
  if (unitLines.length){
    cy += 12*s;
    ctx.font = `400 ${uSize}px ${SANS}`;
    ctx.fillStyle = t.unit;
    unitLines.forEach(l => { ctx.fillText(l, x+pad, cy + uSize*0.86); cy += uSize*1.25; });
  }

  /* a list too long to serve as the value */
  if (detailLines.length){
    cy += 22*s;
    ctx.font = `400 ${noteSize}px ${SANS}`;
    ctx.fillStyle = t.note;
    detailLines.forEach(l => { ctx.fillText(l, x+pad, cy + noteSize*0.86); cy += noteSize*1.3; });
  }

  ctx.restore();
}

/* ============================================================
   8. Sheet + single-card rendering
   ============================================================ */
const SHEET_W = 2400, SHEET_H = 1600, PAD = 60, GAP = 40;
const CARD_RATIO = 540/460;

/* Every row spans the full width and the rows together span the full height,
   so no sheet space is left over. When the count will not divide evenly the
   remainder is spread across the top rows, which end up holding one extra
   card each and therefore slightly narrower cards. The arrangement chosen is
   the one whose worst-shaped card is closest to the natural card proportion,
   with a nudge towards rows that all hold the same number. */
function layoutFor(n){
  let best = null;
  for (let rows = 1; rows <= n; rows++){
    const ch = (SHEET_H - PAD*2 - GAP*(rows-1))/rows;
    if (ch < 70) continue;

    const base = Math.floor(n/rows), extra = n % rows;
    const counts = [];
    for (let r = 0; r < rows; r++) counts.push(base + (r < extra ? 1 : 0));
    if (counts[counts.length-1] < 1) continue;

    const widths = counts.map(k => (SHEET_W - PAD*2 - GAP*(k-1))/k);
    if (widths.some(w => w < 80)) continue;

    let worst = 0;
    widths.forEach(cw => {
      worst = Math.max(worst, Math.abs(Math.log((cw/ch) / CARD_RATIO)));
    });
    const uneven = new Set(counts).size - 1;
    const score = worst + uneven*0.12;
    if (!best || score < best.score) best = { rows, counts, widths, ch, score };
  }
  if (!best){
    const cw = (SHEET_W - PAD*2 - GAP*(n-1))/n;
    best = { rows:1, counts:[n], widths:[cw], ch:SHEET_H - PAD*2 };
  }
  return best;
}

/* the smallest card any layout produces, used to warn about dense sheets */
function smallestScale(n){
  const L = layoutFor(n);
  return Math.min(...L.widths.map(w => Math.min(w/540, L.ch/460)));
}

function renderSheet(cards, pal, transparent){
  const cv = document.createElement('canvas');
  cv.width = SHEET_W; cv.height = SHEET_H;
  const ctx = cv.getContext('2d');
  if (!transparent){ ctx.fillStyle = pal.sheet; ctx.fillRect(0,0,SHEET_W,SHEET_H); }

  const L = layoutFor(cards.length);
  let i = 0;
  L.counts.forEach((k, r) => {
    const cw = L.widths[r];
    const y = PAD + r*(L.ch + GAP);
    for (let c = 0; c < k; c++){
      drawCard(ctx, PAD + c*(cw + GAP), y, cw, L.ch, cards[i++], pal);
    }
  });
  return cv;
}

const SINGLE_W = 1176, SINGLE_H = 1016, SINGLE_M = 48;

function renderSingle(card, pal, transparent){
  const cv = document.createElement('canvas');
  cv.width = SINGLE_W; cv.height = SINGLE_H;
  const ctx = cv.getContext('2d');
  if (!transparent){ ctx.fillStyle = pal.sheet; ctx.fillRect(0,0,SINGLE_W,SINGLE_H); }
  drawCard(ctx, SINGLE_M, SINGLE_M, SINGLE_W-SINGLE_M*2, SINGLE_H-SINGLE_M*2, card, pal);
  return cv;
}

/* ============================================================
   9. Fonts
   ============================================================ */
let fontsDone = false;
async function ensureFonts(){
  if (fontsDone) return;
  try{
    await Promise.all([
      document.fonts.load('500 21px Archivo'),
      document.fonts.load('400 16px Archivo'),
      document.fonts.load('600 96px Fraunces'),
      document.fonts.load('500 34px Fraunces')
    ]);
    await document.fonts.ready;
  }catch(e){}
  fontsDone = true;
}

/* ============================================================
   10. UI
   ============================================================ */
const $ = id => document.getElementById(id);
const state = {
  cardBg:PRESETS.light.bg, cardText:PRESETS.light.text,
  cardTransparent:false, transparent:false, selected:[...DEFAULTS],
  cards:[], country:null, busy:false,
  source:'open', apiKey:'', keyOk:false, keyToken:0
};

const KEY_STORE = 'geocards.key';

/* Browser storage is optional and must never break the app if it is absent. */
const store = {
  get(k){ try { return window.localStorage.getItem(k); } catch(e){ return null; } },
  set(k,v){ try { window.localStorage.setItem(k,v); return true; } catch(e){ return false; } },
  del(k){ try { window.localStorage.removeItem(k); } catch(e){} },
  works(){ try { window.localStorage.setItem('__t','1'); window.localStorage.removeItem('__t'); return true; } catch(e){ return false; } }
};

/* -- picker -- */
const available = def => def.needs !== 'rc' || state.source === 'rest';

function buildPicker(){
  const host = $('groups');
  host.innerHTML = '';
  GROUP_ORDER.forEach(g => {
    const items = CARDS.filter(c => c.group === g);
    if (!items.length) return;

    const sec = document.createElement('div');
    sec.className = 'group';

    const head = document.createElement('header');
    const h = document.createElement('h3');
    h.textContent = g;
    const all = document.createElement('button');
    all.type = 'button'; all.textContent = 'select all';
    const none = document.createElement('button');
    none.type = 'button'; none.textContent = 'clear';
    head.append(h, all, none);
    sec.appendChild(head);

    const row = document.createElement('div');
    row.className = 'chips';
    items.forEach(c => {
      const usable = available(c);
      const lab = document.createElement('label');
      lab.className = 'chip';
      const notes = [];
      if (!usable) notes.push('Needs a REST Countries API key');
      if (c.reveals) notes.push('Gives the country away');
      if (c.fb) notes.push('From the final Factbook edition, frozen in 2026');
      if (notes.length) lab.title = notes.join('. ');

      const inp = document.createElement('input');
      inp.type = 'checkbox'; inp.value = c.id;
      inp.checked = state.selected.includes(c.id);
      inp.disabled = !usable;
      inp.addEventListener('change', onPick);

      const sp = document.createElement('span');
      sp.appendChild(document.createTextNode(c.label));
      const mark = (cls, text) => {
        const i = document.createElement('i');
        i.className = 'mark ' + cls;
        if (text) i.textContent = text;
        sp.appendChild(i);
      };
      if (c.reveals) mark('dot', '');
      if (c.fb) mark('frozen', '2026');
      if (!usable) mark('key', 'key');

      lab.append(inp, sp);
      row.appendChild(lab);
    });
    sec.appendChild(row);

    const setGroup = on => {
      items.forEach(c => {
        if (!available(c)) return;
        const box = row.querySelector(`input[value="${c.id}"]`);
        if (box) box.checked = on;
      });
      onPick();
    };
    all.addEventListener('click', () => setGroup(true));
    none.addEventListener('click', () => setGroup(false));

    host.appendChild(sec);
  });
  updateTally();
}

/* Selection order decides sheet order: keep what is already chosen in the
   order it was chosen, then append anything newly ticked. */
function currentPicks(){
  const checked = new Set(
    [...$('groups').querySelectorAll('input[type=checkbox]')]
      .filter(b => b.checked).map(b => b.value)
  );
  const kept = state.selected.filter(id => checked.has(id));
  const added = CARDS.map(c => c.id).filter(id => checked.has(id) && !kept.includes(id));
  return [...kept, ...added];
}

function updateTally(){
  const n = state.selected.length;
  $('tally').textContent = n + (n === 1 ? ' selected' : ' selected');
  const small = n ? smallestScale(n) < 0.72 : false;
  $('denseNote').hidden = !small;
  if (small) $('denseNote').textContent =
    `At ${n} cards each one is drawn small, so source credits and list details are dropped to keep the text legible.`;
}

async function onPick(){
  const picks = currentPicks();
  if (!picks.length){ say('Pick at least one statistic.', true); state.selected = []; updateTally(); return; }
  state.selected = picks;
  updateTally();
  if (state.country) await generate(state.country, true);
}

/* -- status -- */
function say(msg, isErr){
  const el = $('status');
  el.textContent = msg || '';
  el.classList.toggle('err', !!isErr);
}

/* -- previews -- */
function paintPreviews(){
  const grid = $('grid');
  const pal = currentPalette();
  grid.innerHTML = '';
  state.cards.forEach((card, i) => {
    const cell = document.createElement('div');
    cell.className = 'cell';
    const shot = document.createElement('div');
    shot.className = 'shot' + ((state.transparent || state.cardTransparent) ? ' alpha' : '');
    const cv = renderSingle(card, pal, state.transparent);
    cv.setAttribute('role','img');
    cv.setAttribute('aria-label', card.label + ' card');
    shot.appendChild(cv);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Download this card';
    btn.addEventListener('click', () => saveCanvas(cv, `card-${card.id}.png`));
    cell.append(shot, btn);
    grid.appendChild(cell);
  });
  $('empty').hidden = state.cards.length > 0;
  $('count').textContent = state.cards.length
    ? `${state.cards.length} ${state.cards.length===1?'card':'cards'} ready — sheet is ${SHEET_W} × ${SHEET_H} pixels`
    : 'No cards yet';
  $('dlEach').disabled = !state.cards.length;
  $('dlSheet').disabled = !state.cards.length;
  $('showText').disabled = !state.cards.length;
  if (!$('textpanel').hidden) $('statstext').value = statsText();
}

/* -- plain text -- */
/* Tab separated, so it reads as text and pastes into a spreadsheet as columns.
   The country name stays out of it, same as the cards. */
function statsText(){
  return state.cards.map(c => {
    if (c.kind === 'empty') return c.label + '\tNot reported';
    const value = [c.big, c.unit].filter(Boolean).join(' ');
    return c.label + '\t' + value + (c.detail ? '\t' + c.detail : '');
  }).join('\n');
}

/* -- saving -- */
function saveCanvas(cv, name){
  cv.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 4000);
  }, 'image/png');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* -- main flow -- */
async function generate(country, quiet){
  if (state.busy) return;
  state.busy = true;
  $('go').disabled = true;
  $('progress').hidden = false;
  if (!quiet) say('Fetching figures…');
  try{
    await ensureFonts();
    const cards = await buildCards(country, state.selected, (got, total) => {
      if (!quiet) say(`Loading country data, ${got} of ${total}\u2026`);
    });
    state.country = country;
    state.cards = cards;
    paintPreviews();
    const missing = cards.filter(c => c.kind === 'empty').length;
    say(missing
      ? `Cards drawn. ${missing} ${missing===1?'statistic is':'statistics are'} not reported for this country.`
      : 'Cards drawn.');
  } catch(err){
    console.error(err);
    say('Could not reach the World Bank data service. Check your connection and try again.', true);
  } finally {
    state.busy = false;
    $('go').disabled = false;
    $('progress').hidden = true;
  }
}

$('form').addEventListener('submit', async e => {
  e.preventDefault();
  const q = $('q').value.trim();
  if (!q || state.busy) return;
  $('go').disabled = true;
  $('progress').hidden = false;
  say(cache.atlas ? 'Looking it up…' : 'Loading the country data set, just this once…');
  let country = null, failure = null;
  try {
    country = await resolveCountry(q, (got, total) => say(`Loading country data, ${got} of ${total}\u2026`));
  } catch(err){ failure = err; console.error(err); }
  $('go').disabled = false;
  $('progress').hidden = true;
  if (failure){
    if (state.source === 'rest'){
      state.source = 'open';
      invalidateAtlas();
      paintSource();
      buildPicker();
      keySay(failure.hint || failure.message || 'The key request failed.', true);
      say('REST Countries did not answer, so the open data set is back in use. See the key panel for what went wrong.', true);
    } else {
      say(failure.hint || 'Could not load the country data set. Check your connection, then try again.', true);
    }
    return;
  }
  if (!country){
    say('No country matches that. Try the English name or an ISO code such as DE or DEU.', true);
    return;
  }
  $('q').value = '';                 // the answer never stays on screen
  await generate(country, false);
});

/* -- controls -- */
function markPreset(name){
  document.querySelectorAll('.seg button[data-preset]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.preset === name)));
}

document.querySelectorAll('.seg button[data-preset]').forEach(b => {
  b.addEventListener('click', () => {
    const p = PRESETS[b.dataset.preset];
    state.cardBg = p.bg; state.cardText = p.text;
    $('cardBg').value = p.bg; $('cardText').value = p.text;
    markPreset(b.dataset.preset);
    if (state.cards.length) paintPreviews();
  });
});

function onColour(){
  state.cardBg = $('cardBg').value;
  state.cardText = $('cardText').value;
  const match = Object.keys(PRESETS).find(k =>
    PRESETS[k].bg.toLowerCase() === state.cardBg.toLowerCase() &&
    PRESETS[k].text.toLowerCase() === state.cardText.toLowerCase());
  markPreset(match || null);
  if (state.cards.length) paintPreviews();
}
$('cardBg').addEventListener('input', onColour);
$('cardText').addEventListener('input', onColour);

$('alphaCard').addEventListener('change', e => {
  state.cardTransparent = e.target.checked;
  $('cardBg').disabled = e.target.checked;
  if (state.cards.length) paintPreviews();
});

$('alpha').addEventListener('change', e => {
  state.transparent = e.target.checked;
  if (state.cards.length) paintPreviews();
});

/* -- plain text panel -- */
$('showText').addEventListener('click', () => {
  const p = $('textpanel'), open = p.hidden;
  p.hidden = !open;
  $('showText').textContent = open ? 'Hide text' : 'Show as text';
  if (open){ $('statstext').value = statsText(); $('copystatus').textContent = ''; }
});

$('copyText').addEventListener('click', async () => {
  const text = statsText();
  const done = ok => { $('copystatus').textContent = ok
    ? 'Copied.' : 'Copying is blocked here — select the text above and copy it yourself.'; };
  try {
    if (navigator.clipboard && window.isSecureContext){
      await navigator.clipboard.writeText(text);
      done(true); return;
    }
    throw new Error('no clipboard');
  } catch(e){
    const ta = $('statstext');
    ta.value = text; ta.removeAttribute('readonly'); ta.focus(); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch(e2){ ok = false; }
    ta.setAttribute('readonly', 'readonly');
    done(ok);
  }
});

/* -- data source + API key -- */
function paintSource(){
  document.querySelectorAll('.seg button[data-source]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.source === state.source)));
  $('srcRest').disabled = !state.keyOk;
}

function keySay(msg, isErr){
  const el = $('keystatus');
  el.textContent = msg || '';
  el.classList.toggle('err', !!isErr);
}

async function useSource(next){
  if (next === state.source) return;
  if (next === 'rest' && !state.keyOk) return;
  state.source = next;
  invalidateAtlas();
  paintSource();
  buildPicker();
  if (!state.country){ say('Reference data switched. Look a country up to draw cards.'); return; }
  /* re-resolve the same country inside the new data set, by ISO code */
  const code = state.country.iso3 || state.country.iso2;
  let again = null;
  try { again = await resolveCountry(code, (g,t) => say(`Loading country data, ${g} of ${t}\u2026`)); }
  catch(err){ say(err.hint || 'Could not load that source.', true); return; }
  if (!again){ say('That country is not in this data set.', true); return; }
  await generate(again, false);
}

document.querySelectorAll('.seg button[data-source]').forEach(b => {
  b.addEventListener('click', () => useSource(b.dataset.source));
});

$('toggleKey').addEventListener('click', () => {
  const p = $('keypanel'), open = p.hidden;
  p.hidden = !open;
  $('toggleKey').setAttribute('aria-expanded', String(open));
  $('toggleKey').textContent = open ? 'Hide API key' : 'Add an API key';
});

$('checkKey').addEventListener('click', async () => {
  const key = $('apikey').value.trim();
  if (!key){ keySay('Paste a key first.', true); return; }
  $('checkKey').disabled = true;
  keySay('Checking\u2026');
  try {
    const total = await rcCheckKey(key);
    state.apiKey = key;
    state.keyOk = true;
    state.keyToken++;
    invalidateAtlas();
    keySay(`Key accepted. ${total} countries available.`);
    if ($('rememberKey').checked) store.set(KEY_STORE, key);
    paintSource();
    await useSource('rest');
  } catch(err){
    state.keyOk = false;
    state.apiKey = '';
    state.keyToken++;
    invalidateAtlas();
    paintSource();
    keySay(err.hint || err.message || 'The key could not be checked.', true);
    console.error(err);
  } finally {
    $('checkKey').disabled = false;
  }
});

$('forgetKey').addEventListener('click', async () => {
  state.apiKey = '';
  state.keyOk = false;
  state.keyToken++;
  $('apikey').value = '';
  $('rememberKey').checked = false;
  store.del(KEY_STORE);
  store.del('meridian.key');
  invalidateAtlas();
  paintSource();
  keySay('Key forgotten, here and in this browser.');
  if (state.source === 'rest'){
    state.source = 'open';
    paintSource();
    buildPicker();
    if (state.country){
      const code = state.country.iso3 || state.country.iso2;
      try {
        const again = await resolveCountry(code);
        if (again) { await generate(again, false); return; }
      } catch(e){ /* fall through to the plain notice */ }
    }
    say('Back on the open data set.');
  }
});

$('rememberKey').addEventListener('change', e => {
  if (e.target.checked){
    const key = $('apikey').value.trim();
    if (key && !store.set(KEY_STORE, key)){
      e.target.checked = false;
      keySay('This browser will not let the page store anything, so the key stays in memory only.', true);
    }
  } else {
    store.del(KEY_STORE);
  }
});

$('togglePicker').addEventListener('click', () => {
  const p = $('picker'), open = p.hidden;
  p.hidden = !open;
  $('togglePicker').setAttribute('aria-expanded', String(open));
  $('togglePicker').textContent = open ? 'Hide statistics' : 'Choose statistics';
});

$('resetPick').addEventListener('click', () => {
  state.selected = [...DEFAULTS];
  buildPicker();
  if (state.country) generate(state.country, true);
});

$('dlSheet').addEventListener('click', () => {
  const cv = renderSheet(state.cards, currentPalette(), state.transparent);
  saveCanvas(cv, 'geocards-sheet.png');
});

$('dlEach').addEventListener('click', async () => {
  const btn = $('dlEach');
  btn.disabled = true;
  for (const card of state.cards){
    saveCanvas(renderSingle(card, currentPalette(), state.transparent), `card-${card.id}.png`);
    await sleep(320);
  }
  btn.disabled = false;
});

/* startup */
if (!store.works()) $('rememberKey').disabled = true;
let saved = store.get(KEY_STORE);
if (!saved){                          // adopt a key saved under the previous name
  const legacy = store.get('meridian.key');
  if (legacy){ saved = legacy; store.set(KEY_STORE, legacy); store.del('meridian.key'); }
}
if (saved){
  $('apikey').value = saved;
  $('rememberKey').checked = true;
  $('keypanel').hidden = false;
  $('toggleKey').setAttribute('aria-expanded', 'true');
  $('toggleKey').textContent = 'Hide API key';
  keySay('A saved key is loaded. Check it to switch to REST Countries.');
}
paintSource();
buildPicker();
ensureFonts();
})();
