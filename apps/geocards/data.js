/**
 * GeoCards — fetching and normalising country data: the open ISO 3166 set or
 * REST Countries, the CIA World Factbook archive, and the World Bank.
 */

/* ============================================================
 4. Data layer
 ============================================================ */
export const WB = "https://api.worldbank.org/v2";

/* Source A: the open ISO 3166 set. No key, no account, CORS wide open. */
export const ATLAS_MIRRORS = [
  "https://cdn.jsdelivr.net/gh/mledoze/countries@master/countries.json",
  "https://raw.githubusercontent.com/mledoze/countries/master/countries.json",
];

/* Source B: REST Countries v5. Needs the key the person supplies. */
export const RC = "https://api.restcountries.com/countries/v5";
export const RC_OMIT = "leaders,links,postal_code.regex,flag.colors.palette";
export const RC_PAGE = 100; // free-plan ceiling

export const cache = {
  atlas: null,
  index: null,
  builtFor: null,
  wbCountries: null,
  ind: new Map(),
  fb: new Map(),
  fbPaths: null,
};

/* Text that came off the network is never trusted as a message: it is
 stripped of control characters and clipped before it can reach the UI. */
export function safeMessage(v) {
  return (
    String(v == null ? "" : v)
      // eslint-disable-next-line no-control-regex -- removing control characters is the point
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
      .slice(0, 200)
      .trim()
  );
}

export const REQUEST_TIMEOUT = 30000;

export async function getJSON(url, init, timeout) {
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout || REQUEST_TIMEOUT) : null;
  let r;
  try {
    r = await fetch(url, ctrl ? { ...(init || {}), signal: ctrl.signal } : init);
  } catch (e) {
    if (timer) clearTimeout(timer);
    const err = new Error(
      e && e.name === "AbortError"
        ? "The request took too long and was given up on."
        : "The request could not be made.",
    );
    err.aborted = e && e.name === "AbortError";
    throw err; // deliberately carries no URL
  }
  if (timer) clearTimeout(timer);
  if (!r.ok) {
    let msg = "HTTP " + r.status;
    try {
      const b = await r.json();
      if (b && b.errors && b.errors[0] && b.errors[0].message)
        msg = safeMessage(b.errors[0].message);
    } catch {
      /* no JSON error body; the status will do */
    }
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

/* --- REST Countries v5 ------------------------------------------------ */
export function rcInit(key) {
  return { headers: { Authorization: "Bearer " + key, Accept: "application/json" } };
}

export async function rcRequest(pathAndQuery, key) {
  try {
    return await getJSON(RC + pathAndQuery, rcInit(key));
  } catch (err) {
    if (err.status === 401)
      err.hint = "That key was not accepted. Check it for stray spaces, or generate a new one.";
    else if (err.status === 403)
      err.hint = "The key is valid but the account is blocked — usually the monthly request limit.";
    else if (err.status === 429)
      err.hint = "Too many requests in a short window. Wait a few seconds and try again.";
    else if (err.aborted)
      err.hint =
        "REST Countries did not answer in time. Try again, or switch back to the open data set.";
    else if (err.status === undefined)
      err.hint =
        "The browser blocked the request. Add this page\u2019s hostname to the key\u2019s allowed origins, and serve the page over http rather than opening the file directly.";
    throw err;
  }
}

export async function rcCheckKey(key) {
  const body = await rcRequest("?limit=1&response_fields=codes.alpha_2", key);
  const n = body && body.data && body.data.meta && body.data.meta.total;
  return typeof n === "number" ? n : 0;
}

export async function rcAll(key, onProgress) {
  const out = [];
  let offset = 0,
    total = Infinity,
    page = 0;
  while (offset < total && page < 12) {
    const body = await rcRequest(
      `?limit=${RC_PAGE}&offset=${offset}&response_fields_omit=${RC_OMIT}`,
      key,
    );
    const d = body && body.data;
    const objs = (d && d.objects) || [];
    out.push(...objs);
    total = (d && d.meta && d.meta.total) || out.length;
    offset += RC_PAGE;
    page++;
    if (onProgress) onProgress(out.length, total);
    if (!objs.length || !(d && d.meta && d.meta.more)) break;
  }
  return out;
}

/* --- normalising both sources into one shape -------------------------- */
export const str = (v) => (typeof v === "string" ? v : "");
export const arr = (v) => (Array.isArray(v) ? v : []);

export function fromOpen(r) {
  const names = r.name || {};
  const keys = [names.common, names.official, r.cca2, r.cca3, r.ccn3, r.cioc];
  const soft = [...arr(r.altSpellings)];
  Object.values(names.native || {}).forEach((n) => soft.push(n.common, n.official));
  Object.values(r.translations || {}).forEach((t) => soft.push(t.common, t.official));
  return {
    iso2: r.cca2,
    iso3: r.cca3,
    keys,
    soft,
    region: str(r.region),
    subregion: str(r.subregion),
    continents: arr(r.continents),
    landlocked: !!r.landlocked,
    borders: arr(r.borders),
    area: typeof r.area === "number" ? r.area : null,
    lat: (r.latlng || [])[0],
    lng: (r.latlng || [])[1],
    languages: Object.values(r.languages || {}),
    currencies: Object.entries(r.currencies || {}).map(([code, i]) => ({
      code,
      symbol: (i && i.symbol) || "",
      name: (i && i.name) || "",
    })),
    capitals: arr(r.capital),
    tlds: arr(r.tld),
    callingCode: r.idd && r.idd.root ? r.idd.root + ((r.idd.suffixes || [])[0] || "") : null,
    demonym: (r.demonyms && r.demonyms.eng && r.demonyms.eng.m) || null,
    population: null,
    sovereign: !!r.independent,
    unMember: !!r.unMember,
    unObserver: null,
    unGroup: str(r.unRegionalGroup) || null,
    disputed: null,
    dependency: null,
    dependencyType: null,
    timezones: null,
    drivingSide: null,
    carSigns: null,
    startOfWeek: null,
    measurement: null,
    temperature: null,
    numberFormat: null,
    governmentType: null,
    memberships: null,
    postalFormat: null,
    flagColor: null,
    academicYear: null,
    fiscalYear: null,
  };
}

export function fromRest(r) {
  const names = r.names || {},
    codes = r.codes || {};
  const keys = [
    names.common,
    names.official,
    codes.alpha_2,
    codes.alpha_3,
    codes.ccn3,
    codes.cioc,
    codes.fifa,
  ];
  const soft = [...arr(names.alternates)];
  Object.values(names.native || {}).forEach((n) => soft.push(n.common, n.official));
  Object.values(names.translations || {}).forEach((t) => soft.push(t.common, t.official));

  const langs = arr(r.languages)
    .map((l) =>
      typeof l === "string" ? l : str(l.name) || str(l.english) || str(l.native) || str(l.iso639_3),
    )
    .filter(Boolean);

  const rawCur = r.currencies;
  const currencies = Array.isArray(rawCur)
    ? rawCur.map((c) => ({
        code: str(c.code) || str(c.iso4217),
        symbol: str(c.symbol),
        name: str(c.name),
      }))
    : Object.entries(rawCur || {}).map(([code, i]) => ({
        code,
        symbol: (i && i.symbol) || "",
        name: (i && i.name) || "",
      }));

  const caps = arr(r.capitals)
    .map((c) => (typeof c === "string" ? c : str(c.name)))
    .filter(Boolean);
  const call = arr(r.calling_codes)[0];
  const cls = r.classification || {},
    mem = r.memberships || {};
  const date = r.date || {},
    nfmt = r.number_format || {},
    units = r.units || {};

  return {
    iso2: codes.alpha_2,
    iso3: codes.alpha_3,
    keys,
    soft,
    region: str(r.region),
    subregion: str(r.subregion),
    continents: arr(r.continents),
    landlocked: !!r.landlocked,
    borders: arr(r.borders),
    area: r.area && typeof r.area.kilometers === "number" ? r.area.kilometers : null,
    lat: r.coordinates && r.coordinates.lat,
    lng: r.coordinates && r.coordinates.lng,
    languages: langs,
    currencies,
    capitals: caps,
    tlds: arr(r.tlds),
    callingCode: call ? "+" + String(call).replace(/^\+/, "") : null,
    demonym: (r.demonyms && r.demonyms.eng && r.demonyms.eng.m) || null,
    population: typeof r.population === "number" ? r.population : null,
    sovereign: !!cls.sovereign,
    unMember: !!(cls.un_member || mem.un),
    unObserver: typeof cls.un_observer === "boolean" ? cls.un_observer : null,
    unGroup: null,
    disputed: typeof cls.disputed === "boolean" ? cls.disputed : null,
    dependency: typeof cls.dependency === "boolean" ? cls.dependency : null,
    dependencyType: str(cls.dependency_type) || null,
    timezones: arr(r.timezones).length ? arr(r.timezones) : null,
    drivingSide: (r.cars && str(r.cars.driving_side)) || null,
    carSigns: r.cars && arr(r.cars.signs).length ? arr(r.cars.signs) : null,
    startOfWeek: str(date.start_of_week) || null,
    measurement: str(units.measurement_system) || null,
    temperature: str(units.temperature_scale) || null,
    numberFormat:
      nfmt.decimal_separator != null
        ? { decimal: str(nfmt.decimal_separator), thousands: str(nfmt.thousands_separator) }
        : null,
    governmentType: str(r.government_type) || null,
    memberships: Object.keys(mem).length ? mem : null,
    postalFormat: (r.postal_code && str(r.postal_code.format)) || null,
    flagColor:
      (r.flag && r.flag.colors && (str(r.flag.colors.prominent) || str(r.flag.colors.dominant))) ||
      null,
    academicYear:
      date.academic_year_start && date.academic_year_start.month
        ? { month: date.academic_year_start.month, day: date.academic_year_start.day }
        : null,
    fiscalYear:
      date.fiscal_year_start &&
      date.fiscal_year_start.government &&
      date.fiscal_year_start.government.month
        ? {
            month: date.fiscal_year_start.government.month,
            day: date.fiscal_year_start.government.day,
          }
        : null,
  };
}

/* --- the working set -------------------------------------------------- */
export async function openAtlas() {
  let last = null;
  for (const url of ATLAS_MIRRORS) {
    try {
      const data = await getJSON(url, { headers: { Accept: "application/json" } });
      if (!Array.isArray(data) || !data.length) throw new Error("empty data set");
      return data.map(fromOpen);
    } catch (e) {
      last = e;
    }
  }
  throw last || new Error("no mirror reachable");
}

/**
 * @typedef {object} DataSource where the reference data comes from
 * @property {"open" | "rest"} source the open ISO set, or REST Countries
 * @property {string} apiKey the REST Countries key
 * @property {number} keyToken changes whenever the key does, so a cached set is rebuilt
 */

/**
 * The full country list from the chosen source, cached until the source changes.
 *
 * @param {DataSource} src
 * @param {(got: number, total: number) => void} [onProgress]
 */
export async function atlas(src, onProgress) {
  const want = src.source === "rest" ? "rest:" + src.keyToken : "open";
  if (cache.atlas && cache.builtFor === want) return cache.atlas;
  const list =
    src.source === "rest" ? (await rcAll(src.apiKey, onProgress)).map(fromRest) : await openAtlas();
  cache.atlas = list;
  cache.index = buildIndex(list);
  cache.builtFor = want;
  return list;
}

export function invalidateAtlas() {
  cache.atlas = null;
  cache.index = null;
  cache.builtFor = null;
}

/* --- name matching ---------------------------------------------------- */
export function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function buildIndex(list) {
  const idx = new Map();
  const add = (key, c) => {
    const k = norm(key);
    if (k && !idx.has(k)) idx.set(k, c);
  };
  list.forEach((c) => c.keys.forEach((k) => add(k, c))); // real names and codes win
  list.forEach((c) => c.soft.forEach((k) => add(k, c))); // then spellings and translations
  return idx;
}

export function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let carry = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, carry + (a[i - 1] === b[j - 1] ? 0 : 1));
      carry = t;
    }
  }
  return prev[b.length];
}

/**
 * Find a country by name, code or a near miss.
 *
 * @param {string} raw what was typed
 * @param {DataSource} src
 * @param {(got: number, total: number) => void} [onProgress]
 */
export async function resolveCountry(raw, src, onProgress) {
  const list = await atlas(src, onProgress);
  const q = norm(raw);
  if (!q) return null;

  const hit = cache.index.get(q);
  if (hit) return hit;

  const starts = [];
  for (const [key, c] of cache.index) if (key.startsWith(q)) starts.push([key, c]);
  if (starts.length) {
    starts.sort((a, b) => a[0].length - b[0].length);
    return starts[0][1];
  }
  for (const [key, c] of cache.index) if (key.includes(q)) return c;

  let best = null,
    bestD = 3;
  list.forEach((c) => {
    const d = editDistance(q, norm(c.keys[0]));
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  });
  return best;
}

/* --- CIA World Factbook -----------------------------------------------
 The CIA shut the Factbook down in February 2026 and the public-domain
 mirror stopped updating with it, so this is a frozen final edition.
 Mountains do not move; land-use percentages will slowly go stale.
 Files are named by old GEC codes in region folders, not ISO codes, so
 the tree listing gives the folder and the table below gives the code. */
export const FB_TREE =
  "https://api.github.com/repos/factbook/factbook.json/git/trees/master?recursive=1";
export const FB_BASES = [
  "https://cdn.jsdelivr.net/gh/factbook/factbook.json@master/",
  "https://raw.githubusercontent.com/factbook/factbook.json/master/",
];
export const FB_FOLDERS = [
  "europe",
  "africa",
  "east-n-southeast-asia",
  "south-asia",
  "central-asia",
  "middle-east",
  "north-america",
  "central-america-n-caribbean",
  "south-america",
  "australia-oceania",
  "antarctica",
];
export const FB_EDITION = "CIA World Factbook, final edition";

export const FB_GEC = (() => {
  const m = new Map();
  "ABWaa,AFGaf,AGOao,AIAav,ALBal,ANDan,AREae,ARGar,ARMam,ASMaq,ATAay,ATFfs,ATGac,AUSas,AUTau,AZEaj,BDIby,BELbe,BENbn,BFAuv,BGDbg,BGRbu,BHRba,BHSbf,BIHbk,BLMtb,BLRbo,BLZbh,BMUbd,BOLbl,BRAbr,BRBbb,BRNbx,BTNbt,BVTbv,BWAbc,CAFct,CANca,CCKck,CHEsz,CHLci,CHNch,CIViv,CMRcm,CODcg,COGcf,COKcw,COLco,COMcn,CPVcv,CRIcs,CUBcu,CUWuc,CXRkt,CYMcj,CYPcy,CZEez,DEUgm,DJIdj,DMAdo,DNKda,DOMdr,DZAag,ECUec,EGYeg,ERIer,ESPsp,ESTen,ETHet,FINfi,FJIfj,FLKfk,FRAfr,FROfo,FSMfm,GABgb,GBRuk,GEOgg,GGYgk,GHAgh,GIBgi,GINgv,GMBga,GNBpu,GNQek,GRCgr,GRDgj,GRLgl,GTMgt,GUMgq,GUYgy,HKGhk,HMDhm,HNDho,HRVhr,HTIha,HUNhu,IDNid,IMNim,INDin,IOTio,IRLei,IRNir,IRQiz,ISLic,ISRis,ITAit,JAMjm,JEYje,JORjo,JPNja,KAZkz,KENke,KGZkg,KHMcb,KIRkr,KNAsc,KORks,KWTku,LAOla,LBNle,LBRli,LBYly,LCAst,LIEls,LKAce,LSOlt,LTUlh,LUXlu,LVAlg,MACmc,MAFrn,MARmo,MCOmn,MDAmd,MDGma,MDVmv,MEXmx,MHLrm,MKDmk,MLIml,MLTmt,MMRbm,MNEmj,MNGmg,MNPcq,MOZmz,MRTmr,MSRmh,MUSmp,MWImi,MYSmy,NAMwa,NCLnc,NERng,NFKnf,NGAni,NICnu,NIUne,NLDnl,NORno,NPLnp,NRUnr,NZLnz,OMNmu,PAKpk,PANpm,PCNpc,PERpe,PHLrp,PLWps,PNGpp,POLpl,PRIrq,PRKkn,PRTpo,PRYpa,PSEwe,PYFfp,QATqa,ROUro,RUSrs,RWArw,SAUsa,SDNsu,SENsg,SGPsn,SGSsx,SHNsh,SJMsv,SLBbp,SLEsl,SLVes,SMRsm,SOMso,SPMsb,SRBri,SSDod,STPtp,SURns,SVKlo,SVNsi,SWEsw,SWZwz,SXMnn,SYCse,SYRsy,TCAtk,TCDcd,TGOto,THAth,TJKti,TKLtl,TKMtx,TLStt,TONtn,TTOtd,TUNts,TURtu,TUVtv,TWNtw,TZAtz,UGAug,UKRup,UMIum,UNKkv,URYuy,USAus,UZBuz,VATvt,VCTvc,VENve,VGBvi,VIRvq,VNMvm,VUTnh,WLFwf,WSMws,XKXkv,YEMym,ZAFsf,ZMBza,ZWEzi"
    .split(",")
    .forEach((p) => m.set(p.slice(0, 3), p.slice(3)));
  return m;
})();

export async function fbPaths() {
  if (cache.fbPaths) return cache.fbPaths;
  const m = new Map();
  try {
    const tree = await getJSON(FB_TREE);
    (tree.tree || []).forEach((n) => {
      const hit = /^([a-z-]+)\/([a-z]{2})\.json$/.exec(n.path || "");
      if (hit) m.set(hit[2], n.path);
    });
  } catch (e) {
    /* fall back to probing the folders below */
  }
  cache.fbPaths = m;
  return m;
}

export async function factbook(iso3) {
  if (cache.fb.has(iso3)) return cache.fb.get(iso3);
  const job = (async () => {
    const gec = FB_GEC.get(iso3);
    if (!gec) return null;
    const known = (await fbPaths()).get(gec);
    const tries = known ? [known] : FB_FOLDERS.map((f) => `${f}/${gec}.json`);
    for (const t of tries) {
      for (const base of FB_BASES) {
        try {
          return await getJSON(base + t);
        } catch {
          /* not on this mirror; try the next */
        }
      }
      if (!known) break; // probing every folder on both mirrors is not worth it
    }
    if (!known) {
      for (const t of tries) {
        try {
          return await getJSON(FB_BASES[0] + t);
        } catch {
          /* not in this folder; try the next */
        }
      }
    }
    return null;
  })();
  cache.fb.set(iso3, job);
  return job;
}

/* --- reading the Factbook's free text --------------------------------- */
export const fbText = (o, ...keys) => {
  let v = o;
  for (const k of keys) {
    if (!v || typeof v !== "object") return null;
    v = v[k];
  }
  if (v && typeof v.text === "string") return v.text;
  return typeof v === "string" ? v : null;
};

/* "Grossglockner 3,798 m" and "Laguna del Carbon -105 m" */
export function fbPoint(text) {
  const t = fbClip(text);
  if (!t) return null;
  const hit = /^(.{0,200}?)(-?[\d,]+(?:\.\d+)?)\s*m\b/.exec(t.trim());
  if (!hit) return null;
  const metres = Number(hit[2].replace(/,/g, ""));
  const name = hit[1].replace(/[,;:]\s*$/, "").trim();
  return { name: name || null, metres: isFinite(metres) ? metres : null };
}

/* "1,448 km", "0 km (landlocked)", "83,871 sq km", "NA" */
export function fbAmount(text, unit) {
  const t = fbClip(text);
  if (!t || /^\s*NA\b/i.test(t)) return null;
  const hit = new RegExp("(-?[\\d,]+(?:\\.\\d+)?)\\s*" + unit + "\\b").exec(t);
  if (!hit) return null;
  const n = Number(hit[1].replace(/,/g, ""));
  return isFinite(n) ? n : null;
}

/* Every field below is parsed from text fetched off the network, so each one
 is clipped first. The regexes backtrack, and an unbounded string from a
 compromised mirror would otherwise be able to hang the tab. */
export const FB_MAX_TEXT = 4000;
export const fbClip = (t) => (typeof t === "string" ? t.slice(0, FB_MAX_TEXT) : null);

/* prose fields carry trailing notes and estimate years that add nothing here.
 The bracket pattern matches a whole bracketed run in one go: two adjacent
 open-ended classes inside it would backtrack badly on an unclosed bracket. */
export function fbProse(text) {
  const t = fbClip(text);
  if (!t) return null;
  const clean = t
    .replace(/\s*\([^)]{0,300}?(?:\d{4}|est\.)[^)]{0,300}\)\s*/gi, " ")
    .replace(/\s*note\s*[-:][\s\S]*$/i, "")
    .replace(/\s+/g, " ")
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
export const FB_NONE =
  /^(none|unaffiliated|atheist|agnostic|no religion|non-?religious|irreligious|secular)\b/i;
export const FB_OTHER = /^(other|unspecified|unknown|no answer|various|several)\b/i;

export function fbReligions(text) {
  const clipped = fbClip(text);
  if (!clipped) return null;
  const cleaned = clipped
    .replace(/\s*note\s*[-:][\s\S]*$/i, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ");
  const out = [];
  cleaned.split(/[,;]/).forEach((part) => {
    const hit = /^\s*(.+?)\s+([\d.]+)(?:\s*[-–]\s*[\d.]+)?\s*%\s*$/.exec(part);
    if (!hit) return;
    const pct = Number(hit[2]);
    if (!isFinite(pct)) return;
    const name = hit[1]
      .trim()
      .replace(/^and\s+/i, "")
      .replace(/^[^A-Za-z]+/, "");
    if (name) out.push({ name, pct, none: FB_NONE.test(name), other: FB_OTHER.test(name) });
  });
  return out.length ? out : null;
}

export function fbReligionText(fb) {
  return (
    fbText(fb, "People and Society", "Religions") || fbText(fb, "People and Society", "Religion")
  );
}

/* "Austria 801 km; Belgium 133 km; Czechia 704 km" and the comma-separated
 variant. Splitting on the separator would be wrong: a thousands comma sits
 inside the figures ("Russia 2,511 km"), so instead every "name figure km"
 run is matched in place. Names may carry accents and apostrophes. */
export function fbBorderList(text) {
  const clipped = fbClip(text);
  if (!clipped) return null;
  const cleaned = clipped.replace(/\s*note\s*[-:][\s\S]*$/i, "").replace(/\([^)]*\)/g, " ");
  const out = [];
  const re = /([^\d;,()]{2,}?)\s+(\d[\d,]*(?:\.\d+)?)\s*km/g;
  let hit;
  while ((hit = re.exec(cleaned)) !== null) {
    const km = Number(hit[2].replace(/,/g, ""));
    if (!isFinite(km)) continue;
    const name = hit[1].replace(/^[^A-Za-zÀ-ÿ]+/, "").trim();
    if (name) out.push({ name, km });
  }
  return out.length ? out : null;
}

export function fbBorders(fb) {
  return fbBorderList(fbText(fb, "Geography", "Land boundaries", "border countries"));
}

/* --- World Bank ------------------------------------------------------- */
export async function wbCountrySet() {
  if (cache.wbCountries) return cache.wbCountries;
  const [, rows] = await getJSON(`${WB}/country?format=json&per_page=400`);
  cache.wbCountries = new Set(
    (rows || []).filter((r) => r.region && r.region.value !== "Aggregates").map((r) => r.id),
  );
  return cache.wbCountries;
}

export async function indicator(code) {
  if (cache.ind.has(code)) return cache.ind.get(code);
  const p = (async () => {
    const keep = await wbCountrySet();
    const [, rows] = await getJSON(
      `${WB}/country/all/indicator/${code}?format=json&mrnev=1&per_page=500`,
    );
    const byIso = new Map(),
      values = [];
    (rows || []).forEach((r) => {
      const iso = r.countryiso3code;
      if (!iso || !keep.has(iso) || r.value == null) return;
      byIso.set(iso, { value: Number(r.value), year: r.date });
      values.push(Number(r.value));
    });
    return { byIso, values };
  })();
  cache.ind.set(code, p);
  return p;
}
