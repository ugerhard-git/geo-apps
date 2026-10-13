import { clamp, own } from "../../shared/util.js";
import { $, bindColour, progress, setSeg } from "../../shared/dom.js";
import { parseHex, safeColour } from "../../shared/colour.js";
import { cleanText, norm } from "../../shared/text.js";
import { CLDR_VERSION, NOT_A_COUNTRY } from "../../shared/cldr.js";

/* ═══════════════════════════════════════════════════════════
   Configuration
   ═══════════════════════════════════════════════════════════ */

const CDN = "https://cdn.jsdelivr.net/npm";

const URL_TERRITORY_INFO = `${CDN}/cldr-core@${CLDR_VERSION}/supplemental/territoryInfo.json`;
const URL_LANGUAGE_DATA = `${CDN}/cldr-core@${CLDR_VERSION}/supplemental/languageData.json`;
const URL_LANG_NAMES = `${CDN}/cldr-localenames-full@${CLDR_VERSION}/main/en/languages.json`;
const URL_TERR_NAMES = `${CDN}/cldr-localenames-full@${CLDR_VERSION}/main/en/territories.json`;
/*
  Locale and UDHR codes come out of downloaded JSON, so they are checked
  against their expected shape before being pasted into a path. Without this a
  tampered mirror could steer the request at a different file.
*/
const LOCALE_RE = /^[a-z]{2,3}(-[A-Za-z]{2,4})*$/;
const UDHR_RE = /^[a-z]{3}(_[a-z]{2,6})?$/;

function charactersUrl(locale) {
  if (!LOCALE_RE.test(locale)) throw new Error("unexpected locale code");
  return `${CDN}/cldr-misc-full@${CLDR_VERSION}/main/${locale}/characters.json`;
}
function udhrUrl(code) {
  if (!UDHR_RE.test(code)) throw new Error("unexpected UDHR code");
  return `${CDN}/udhr@6/declaration/${code}.html`;
}

const MIN_SHARE = 5; // percent of population, unless official
const MAX_LANGS = 4;
const SHEET_W = 2400;
const SHEET_H = 1600;
const LEGIBLE_PX = 34; // below this the sheet gets a warning
const MAX_CELLS = 150; // a sheet can't usefully show more than this
const MAX_SET = 8000; // hard ceiling on a parsed character set

/*
  Script detection by code point. Used for three things that differ by script:
  which font to load, whether the chart reads right to left, and whether case
  pairs make any sense.
*/
const SCRIPT_RANGES = [
  [
    "Latin",
    [
      [0x41, 0x24f],
      [0x1e00, 0x1eff],
      [0x250, 0x2af],
      [0x2b0, 0x2ff],
    ],
  ],
  [
    "Greek",
    [
      [0x370, 0x3ff],
      [0x1f00, 0x1fff],
    ],
  ],
  [
    "Cyrillic",
    [
      [0x400, 0x52f],
      [0x2de0, 0x2dff],
      [0xa640, 0xa69f],
    ],
  ],
  ["Armenian", [[0x530, 0x58f]]],
  ["Hebrew", [[0x590, 0x5ff]]],
  [
    "Arabic",
    [
      [0x600, 0x6ff],
      [0x750, 0x77f],
      [0x8a0, 0x8ff],
      [0xfb50, 0xfdff],
      [0xfe70, 0xfeff],
    ],
  ],
  ["Syriac", [[0x700, 0x74f]]],
  ["Thaana", [[0x780, 0x7bf]]],
  ["NKo", [[0x7c0, 0x7ff]]],
  ["Devanagari", [[0x900, 0x97f]]],
  ["Bengali", [[0x980, 0x9ff]]],
  ["Gurmukhi", [[0xa00, 0xa7f]]],
  ["Gujarati", [[0xa80, 0xaff]]],
  ["Oriya", [[0xb00, 0xb7f]]],
  ["Tamil", [[0xb80, 0xbff]]],
  ["Telugu", [[0xc00, 0xc7f]]],
  ["Kannada", [[0xc80, 0xcff]]],
  ["Malayalam", [[0xd00, 0xd7f]]],
  ["Sinhala", [[0xd80, 0xdff]]],
  ["Thai", [[0xe00, 0xe7f]]],
  ["Lao", [[0xe80, 0xeff]]],
  ["Tibetan", [[0xf00, 0xfff]]],
  ["Myanmar", [[0x1000, 0x109f]]],
  [
    "Georgian",
    [
      [0x10a0, 0x10ff],
      [0x1c90, 0x1cbf],
    ],
  ],
  ["Ethiopic", [[0x1200, 0x139f]]],
  ["Cherokee", [[0x13a0, 0x13ff]]],
  ["Khmer", [[0x1780, 0x17ff]]],
  ["Mongolian", [[0x1800, 0x18af]]],
  [
    "Hangul",
    [
      [0x1100, 0x11ff],
      [0x3130, 0x318f],
      [0xac00, 0xd7af],
    ],
  ],
  ["Hiragana", [[0x3040, 0x309f]]],
  ["Katakana", [[0x30a0, 0x30ff]]],
  [
    "Han",
    [
      [0x3400, 0x4dbf],
      [0x4e00, 0x9fff],
      [0xf900, 0xfaff],
    ],
  ],
];

const RTL_SCRIPTS = new Set(["Arabic", "Hebrew", "Syriac", "Thaana", "NKo"]);

/* Google font family per script. Only what's on screen gets loaded. */
const SCRIPT_FONT = {
  Latin: "Noto Sans",
  Greek: "Noto Sans",
  Cyrillic: "Noto Sans",
  Armenian: "Noto Sans Armenian",
  Hebrew: "Noto Sans Hebrew",
  Arabic: "Noto Sans Arabic",
  Syriac: "Noto Sans Syriac",
  Thaana: "Noto Sans Thaana",
  NKo: "Noto Sans NKo",
  Devanagari: "Noto Sans Devanagari",
  Bengali: "Noto Sans Bengali",
  Gurmukhi: "Noto Sans Gurmukhi",
  Gujarati: "Noto Sans Gujarati",
  Oriya: "Noto Sans Oriya",
  Tamil: "Noto Sans Tamil",
  Telugu: "Noto Sans Telugu",
  Kannada: "Noto Sans Kannada",
  Malayalam: "Noto Sans Malayalam",
  Sinhala: "Noto Sans Sinhala",
  Thai: "Noto Sans Thai",
  Lao: "Noto Sans Lao",
  Tibetan: "Noto Serif Tibetan",
  Myanmar: "Noto Sans Myanmar",
  Georgian: "Noto Sans Georgian",
  Ethiopic: "Noto Sans Ethiopic",
  Cherokee: "Noto Sans Cherokee",
  Khmer: "Noto Sans Khmer",
  Mongolian: "Noto Sans Mongolian",
  Hangul: "Noto Sans KR",
  Hiragana: "Noto Sans JP",
  Katakana: "Noto Sans JP",
  Han: "Noto Sans SC",
};

/*
  BCP-47 to the UDHR file codes used by the udhr package. Only languages I can
  map with confidence appear here; anything missing gets an honest "no sourced
  sample text" rather than an invented sentence.
*/
const UDHR_CODE = {
  en: ["eng"],
  de: ["deu"],
  fr: ["fra"],
  es: ["spa"],
  it: ["ita"],
  pt: ["por"],
  nl: ["nld"],
  sv: ["swe"],
  da: ["dan"],
  fi: ["fin"],
  is: ["isl"],
  nb: ["nob"],
  nn: ["nno"],
  no: ["nob"],
  pl: ["pol"],
  cs: ["ces"],
  sk: ["slk"],
  hu: ["hun"],
  ro: ["ron"],
  bg: ["bul"],
  ru: ["rus"],
  uk: ["ukr"],
  be: ["bel"],
  sr: ["srp"],
  hr: ["hrv"],
  bs: ["bos"],
  sl: ["slv"],
  mk: ["mkd"],
  sq: ["als", "sqi"],
  el: ["ell"],
  tr: ["tur"],
  ar: ["arb"],
  he: ["heb"],
  fa: ["pes"],
  ur: ["urd"],
  hi: ["hnd", "hin"],
  bn: ["ben"],
  ta: ["tam"],
  te: ["tel"],
  ml: ["mal"],
  kn: ["kan"],
  gu: ["guj"],
  pa: ["pan"],
  mr: ["mar"],
  ne: ["nep"],
  si: ["snh"],
  th: ["tha"],
  lo: ["lao"],
  km: ["khm"],
  my: ["mya"],
  vi: ["vie"],
  id: ["ind"],
  ms: ["zlm", "mly"],
  tl: ["tgl"],
  ja: ["jpn"],
  ko: ["kkn", "kor"],
  zh: ["cmn_hans", "cmn_hant"],
  am: ["amh"],
  sw: ["swh"],
  zu: ["zul"],
  xh: ["xho"],
  af: ["afr"],
  yo: ["yor"],
  ig: ["ibo"],
  ha: ["hau"],
  so: ["som"],
  mn: ["khk"],
  ka: ["kat"],
  hy: ["hye"],
  az: ["azj"],
  kk: ["kaz"],
  uz: ["uzn"],
  ky: ["kir"],
  tg: ["tgk"],
  et: ["est"],
  lv: ["lvs", "lav"],
  lt: ["lit"],
  ga: ["gle"],
  cy: ["cym"],
  mt: ["mlt"],
  eu: ["eus"],
  ca: ["cat"],
  gl: ["glg"],
};

/* ═══════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════ */

function scriptOf(str) {
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp < 0x41) continue; // skip marks, digits, spacing
    for (const [name, ranges] of SCRIPT_RANGES) {
      for (const [lo, hi] of ranges) if (cp >= lo && cp <= hi) return name;
    }
  }
  return "Latin";
}

/* ═══════════════════════════════════════════════════════════
   UnicodeSet parsing

   CLDR writes exemplar sets as "[a á b c-f {ch} \\-]": space separated, with
   ranges, brace-wrapped multi-character sequences, backslash escapes and
   \uXXXX literals. Getting this wrong silently drops or invents letters, so
   it is parsed explicitly rather than by regex.
   ═══════════════════════════════════════════════════════════ */

function readAtom(s, i) {
  if (s[i] === "\\") {
    const n = s[i + 1];
    if (n === "u" && /^[0-9a-f]{4}$/i.test(s.slice(i + 2, i + 6)))
      return { ch: String.fromCharCode(parseInt(s.slice(i + 2, i + 6), 16)), next: i + 6 };
    if (n === "U" && /^[0-9a-f]{8}$/i.test(s.slice(i + 2, i + 10)))
      return { ch: String.fromCodePoint(parseInt(s.slice(i + 2, i + 10), 16)), next: i + 10 };
    return { ch: n === undefined ? "\\" : n, next: i + 2 };
  }
  const cp = s.codePointAt(i);
  const ch = String.fromCodePoint(cp);
  return { ch, next: i + ch.length };
}

function parseUnicodeSet(raw) {
  let s = String(raw || "").trim();
  if (s.startsWith("[")) s = s.slice(1);
  if (s.endsWith("]")) s = s.slice(0, -1);

  const out = [];
  const seen = new Set();
  const push = (v) => {
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  };

  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (out.length >= MAX_SET) break;
    if (c === " " || c === "\t" || c === "\n") {
      i++;
      continue;
    }

    if (c === "{") {
      // a multi-character letter
      const end = s.indexOf("}", i);
      // An unterminated group would otherwise be read as separate letters,
      // inventing entries that aren't in the data. Refuse instead.
      if (end === -1) throw new Error("malformed character set: unterminated group");
      let inner = s.slice(i + 1, end),
        built = "",
        j = 0;
      while (j < inner.length) {
        const a = readAtom(inner, j);
        built += a.ch;
        j = a.next;
      }
      push(built);
      i = end + 1;
      continue;
    }

    const first = readAtom(s, i);
    i = first.next;

    if (s[i] === "-" && i + 1 < s.length && s[i + 1] !== " ") {
      // a range
      const last = readAtom(s, i + 1);
      i = last.next;
      const a = first.ch.codePointAt(0),
        b = last.ch.codePointAt(0);
      if (b >= a) {
        // CJK sets are written as single huge ranges, so expand them, but stop
        // at a ceiling rather than building a set of tens of thousands.
        for (let cp = a; cp <= b && out.length < MAX_SET; cp++) push(String.fromCodePoint(cp));
      } else {
        push(first.ch);
        push(last.ch);
      }
      continue;
    }
    push(first.ch);
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════
   Case handling
   ═══════════════════════════════════════════════════════════ */

/*
  Whether a letter has a distinct capital is decided per character rather than
  per script, because the exceptions matter: German ß has no single-character
  capital, and Turkish i must become İ, not I.
*/
function casePair(letter, locale) {
  let upper;
  try {
    upper = letter.toLocaleUpperCase(locale);
  } catch (e) {
    upper = letter.toUpperCase();
  }
  if (upper === letter) return { lower: letter, upper: null };
  if ([...upper].length > [...letter].length) return { lower: letter, upper: null }; // ß → SS
  return { lower: letter, upper };
}

/* ═══════════════════════════════════════════════════════════
   Fetching
   ═══════════════════════════════════════════════════════════ */

const cache = new Map();

async function getJson(url) {
  if (cache.has(url)) return cache.get(url);
  const r = await fetch(url);
  if (!r.ok) {
    const e = new Error("HTTP " + r.status);
    e.status = r.status;
    throw e;
  }
  const data = await r.json();
  cache.set(url, data);
  return data;
}

/* ═══════════════════════════════════════════════════════════
   CLDR model
   ═══════════════════════════════════════════════════════════ */

let TERRITORY_INFO = null,
  LANGUAGE_DATA = null,
  LANG_NAMES = {},
  TERR_NAMES = {};

async function loadCore() {
  const [ti, ld, ln, tn] = await Promise.all([
    getJson(URL_TERRITORY_INFO),
    getJson(URL_LANGUAGE_DATA),
    getJson(URL_LANG_NAMES),
    getJson(URL_TERR_NAMES),
  ]);
  TERRITORY_INFO = ti && ti.supplemental && ti.supplemental.territoryInfo;
  LANGUAGE_DATA = ld && ld.supplemental && ld.supplemental.languageData;
  LANG_NAMES =
    (ln.main &&
      ln.main.en &&
      ln.main.en.localeDisplayNames &&
      ln.main.en.localeDisplayNames.languages) ||
    {};
  TERR_NAMES =
    (tn.main &&
      tn.main.en &&
      tn.main.en.localeDisplayNames &&
      tn.main.en.localeDisplayNames.territories) ||
    {};
  if (!TERRITORY_INFO || !LANGUAGE_DATA)
    throw new Error("CLDR supplemental data was not in the expected shape");
}

function countryList() {
  const out = [];
  for (const code of Object.keys(TERRITORY_INFO)) {
    if (!/^[A-Z]{2}$/.test(code) || NOT_A_COUNTRY.has(code)) continue;
    const name = own(TERR_NAMES, code);
    if (typeof name !== "string") continue;
    out.push({ code, name });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/* Languages worth offering: anything widely spoken, plus anything official. */
function languagesFor(code) {
  const info = own(TERRITORY_INFO, code);
  const pops = info && info.languagePopulation;
  if (!pops) return [];
  const out = [];
  for (const lang of Object.keys(pops)) {
    const p = pops[lang];
    const share = parseFloat(p && p._populationPercent);
    const status = p && p._officialStatus;
    const official = status === "official" || status === "de_facto_official";
    if (!official && !(share >= MIN_SHARE)) continue;
    out.push({
      lang: lang.replace(/_/g, "-"),
      share: Number.isFinite(share) ? share : 0,
      official,
      status: status || "",
    });
  }
  return out.sort((a, b) => (b.official ? 1 : 0) - (a.official ? 1 : 0) || b.share - a.share);
}

function languageName(code) {
  const direct = own(LANG_NAMES, code) || own(LANG_NAMES, code.replace(/-/g, "_"));
  if (typeof direct === "string") return direct;
  const base = code.split("-")[0];
  const b = own(LANG_NAMES, base);
  return typeof b === "string" ? b : code;
}

/* A language may be written in more than one script; CLDR keeps those as
   separate locales, so offer each one that actually resolves. */
function scriptVariants(lang) {
  const base = lang.split("-")[0];
  const entry = own(LANGUAGE_DATA, base) || own(LANGUAGE_DATA, base + "-alt-secondary");
  const scripts =
    entry && typeof entry._scripts === "string" ? entry._scripts.trim().split(/\s+/) : [];
  const out = [lang];
  for (const sc of scripts.slice(1)) if (/^[A-Z][a-z]{3}$/.test(sc)) out.push(base + "-" + sc);
  return out;
}

/* ═══════════════════════════════════════════════════════════
   Building an alphabet
   ═══════════════════════════════════════════════════════════ */

async function buildAlphabet(locale) {
  const url = charactersUrl(locale);
  const data = await getJson(url);
  const main = data && data.main;
  const key = main && Object.keys(main)[0];
  const chars = key && main[key] && main[key].characters;
  if (!chars || typeof chars.exemplarCharacters !== "string")
    throw new Error("no exemplar characters for " + locale);

  const letters = parseUnicodeSet(chars.exemplarCharacters);
  const aux = typeof chars.auxiliary === "string" ? parseUnicodeSet(chars.auxiliary) : [];
  if (!letters.length) throw new Error("empty exemplar set for " + locale);

  const script = scriptOf(letters.slice(0, 40).join(""));
  const total = letters.length;
  return {
    locale,
    url,
    script,
    total,
    truncated: total > MAX_CELLS,
    rtl: RTL_SCRIPTS.has(script),
    name: languageName(locale),
    letters: letters.slice(0, MAX_CELLS).map((l) => casePair(l, locale)),
    aux: aux.slice(0, MAX_CELLS).map((l) => casePair(l, locale)),
    cldrVersion:
      (data.main[key].identity &&
        data.main[key].identity.version &&
        data.main[key].identity.version._cldrVersion) ||
      CLDR_VERSION,
  };
}

/* ═══════════════════════════════════════════════════════════
   Sample sentence (UDHR Article 1)
   ═══════════════════════════════════════════════════════════ */

async function sampleSentence(locale) {
  const base = locale.split("-")[0];
  const codes = own(UDHR_CODE, base);
  if (!codes) return null;

  for (const code of codes) {
    const url = udhrUrl(code);
    try {
      let html = cache.get("html:" + url);
      if (html === undefined) {
        const r = await fetch(url);
        if (!r.ok) continue;
        html = await r.text();
        cache.set("html:" + url, html);
      }
      // Parsed into a detached document and read as text only; nothing from
      // this file is ever inserted into the page as markup.
      const doc = new DOMParser().parseFromString(html, "text/html");
      const node = doc.querySelector("article p") || doc.querySelector("p");
      if (!node) continue;
      const full = cleanText(node.textContent, 400);
      if (!full) continue;
      const cut = full.search(/[.!?。！？۔।](\s|$)/);
      const text = cut > 20 ? full.slice(0, cut + 1) : full.slice(0, 180);
      return { text, url, code };
    } catch (e) {
      /* try the next candidate */
    }
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════
   Fonts
   ═══════════════════════════════════════════════════════════ */

const fontLink = document.createElement("link");
fontLink.rel = "stylesheet";
let loadedFamilies = new Set();

async function ensureFonts(families) {
  const wanted = new Set([...loadedFamilies, ...families]);
  if (wanted.size !== loadedFamilies.size) {
    loadedFamilies = wanted;
    const q = [...wanted]
      .map((f) => "family=" + encodeURIComponent(f).replace(/%20/g, "+") + ":wght@400;600")
      .join("&");
    fontLink.href = "https://fonts.googleapis.com/css2?" + q + "&display=swap";
    if (!fontLink.parentNode) document.head.appendChild(fontLink);
  }
  if (!document.fonts || !document.fonts.load) return;
  // Canvas silently substitutes a fallback if the face isn't ready, so wait.
  await Promise.all(
    [...families].flatMap((f) => [
      document.fonts.load(`400 100px "${f}"`).catch(() => {}),
      document.fonts.load(`600 100px "${f}"`).catch(() => {}),
    ]),
  );
}

/* ═══════════════════════════════════════════════════════════
   Drawing the sheet
   ═══════════════════════════════════════════════════════════ */

let lastWarning = "";

/*
  Unnamed by default, because naming the language gives the answer away when
  the sheet is used as a puzzle. The script name is withheld too — "Cyrillic"
  narrows it almost as much as the language would.
*/
/*
  The heading for an unnamed alphabet. "{n}" stands for its position; a
  template without it gets the number appended, and an empty one means no
  heading at all.
*/
function genericHeading(template, index) {
  const t = String(template || "").trim();
  if (!t) return "";
  return t.includes("{n}") ? t.split("{n}").join(String(index + 1)) : `${t} ${index + 1}`;
}

function headingFor(chart, index, showNames, total, generic) {
  const count = chart.truncated ? `${MAX_CELLS} of ${chart.total} characters` : "";
  const join = (rest) => (rest ? [rest, count].filter(Boolean).join(" · ") : count);
  if (showNames) return join(`${chart.name} · ${chart.script}`);
  // A lone unnamed alphabet needs no label; "Language 1" would only be noise.
  if (total === 1) return count;
  return join(genericHeading(generic, index));
}

function drawSheet(canvas, charts, opts) {
  canvas.width = SHEET_W;
  canvas.height = SHEET_H;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, SHEET_W, SHEET_H);

  if (!opts.transparent) {
    ctx.fillStyle = opts.bg;
    ctx.fillRect(0, 0, SHEET_W, SHEET_H);
  }
  ctx.fillStyle = opts.fg;

  const pad = 90;
  let top = pad,
    bottom = SHEET_H - pad;

  // Caption first: it reserves space the charts can't use.
  if (opts.caption) {
    const capPx = 54;
    ctx.font = `400 ${capPx}px "Newsreader", Georgia, serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let text = opts.caption,
      px = capPx;
    while (px > 26 && ctx.measureText(text).width > SHEET_W - pad * 2) {
      px -= 2;
      ctx.font = `400 ${px}px "Newsreader", Georgia, serif`;
    }
    if (opts.capTop) {
      ctx.fillText(text, SHEET_W / 2, top + px * 0.6);
      top += px * 1.9;
    } else {
      ctx.fillText(text, SHEET_W / 2, bottom - px * 0.6);
      bottom -= px * 1.9;
    }
  }

  /*
    With sentences on, one language's sentence ends up directly under the next
    one's heading, and the two read as a single block. Open a gutter between
    the bands so each language stays visually its own.
  */
  const gutter = charts.length < 2 ? 0 : opts.sentence ? Math.max(48, (bottom - top) * 0.05) : 16;
  const bandH = (bottom - top - gutter * (charts.length - 1)) / charts.length;
  let smallest = Infinity;

  charts.forEach((chart, idx) => {
    const bandTop = top + idx * (bandH + gutter);
    let y = bandTop;

    // Heading, where there is one. With none, the grid takes the space back.
    const heading = headingFor(chart, idx, opts.names, charts.length, opts.generic);
    if (heading) {
      const headPx = Math.min(44, Math.max(24, bandH * 0.11));
      ctx.font = `600 ${headPx}px "Public Sans", system-ui, sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.globalAlpha = 0.72;
      ctx.fillText(heading, pad, y + headPx);
      ctx.globalAlpha = 1;
      y += headPx * 1.75;
    }

    let gridBottom = bandTop + bandH - bandH * 0.06;
    let sentence = null;
    if (opts.sentence && chart.sentence) {
      sentence = chart.sentence;
      gridBottom -= Math.max(46, bandH * 0.24); // room for the label and the line
    }

    const items = opts.aux ? chart.letters.concat(chart.aux) : chart.letters;
    const cells = items.map((it) => (opts.pairs && it.upper ? it.upper + it.lower : it.lower));

    const size = drawGrid(ctx, cells, pad, y, SHEET_W - pad * 2, gridBottom - y, chart, opts);
    smallest = Math.min(smallest, size);

    if (sentence) {
      const sPx = Math.max(22, Math.min(40, bandH * 0.1));
      const labelPx = Math.max(15, Math.round(sPx * 0.52));
      const anchor = chart.rtl ? SHEET_W - pad : pad;
      const baseline = bandTop + bandH - bandH * 0.045;

      // Say what this line is, so it isn't mistaken for more of the alphabet.
      ctx.font = `600 ${labelPx}px "Public Sans", system-ui, sans-serif`;
      ctx.textAlign = chart.rtl ? "right" : "left";
      ctx.textBaseline = "alphabetic";
      ctx.direction = "ltr";
      ctx.globalAlpha = 0.55;
      ctx.fillText("Example sentence", anchor, baseline - sPx * 1.15);

      ctx.font = `400 ${sPx}px "${own(SCRIPT_FONT, chart.script) || "Noto Sans"}", sans-serif`;
      ctx.direction = chart.rtl ? "rtl" : "ltr";
      ctx.globalAlpha = 0.82;
      let t = sentence.text;
      while (t.length > 8 && ctx.measureText(t).width > SHEET_W - pad * 2) {
        t = t.slice(0, -2);
      }
      if (t !== sentence.text) t = t.replace(/\s+\S*$/, "") + "…";
      ctx.fillText(t, anchor, baseline);
      ctx.globalAlpha = 1;
      ctx.direction = "ltr";
    }
  });

  lastWarning =
    smallest < LEGIBLE_PX
      ? `Letters are down to about ${Math.round(smallest)} px. Fewer languages, or turning off loanword letters, will give them room.`
      : "";
  return smallest;
}

/*
  Choose the column count that makes the glyphs biggest, then draw. Returns the
  glyph size so the caller can tell the user when the sheet is overloaded.
*/
function drawGrid(ctx, cells, x, y, w, h, chart, opts) {
  if (!cells.length || h <= 0) return Infinity;
  const family = own(SCRIPT_FONT, chart.script) || "Noto Sans";
  const K = cells.length;

  const measureAt = (px, cols) => {
    ctx.font = `400 ${px}px "${family}", sans-serif`;
    let widest = 0;
    for (const c of cells) widest = Math.max(widest, ctx.measureText(c).width);
    return widest;
  };

  let best = { size: 0, cols: 1 };
  for (let cols = 1; cols <= K; cols++) {
    const rows = Math.ceil(K / cols);
    const cellW = w / cols,
      cellH = h / rows;
    const probe = 100;
    const widest = measureAt(probe, cols);
    const byWidth = widest > 0 ? (cellW * 0.82) / (widest / probe) : probe;
    const byHeight = cellH * 0.62;
    const size = Math.min(byWidth, byHeight);
    if (size > best.size) best = { size, cols, rows, cellW, cellH };
  }

  const { size, cols, rows, cellW, cellH } = best;
  ctx.font = `400 ${size}px "${family}", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.direction = chart.rtl ? "rtl" : "ltr";

  cells.forEach((cell, i) => {
    const r = Math.floor(i / cols);
    let c = i % cols;
    if (chart.rtl) c = cols - 1 - c; // right to left across the row
    const cx = x + c * cellW + cellW / 2;
    const cy = y + r * cellH + cellH / 2;
    ctx.fillText(cell, cx, cy);
  });
  ctx.direction = "ltr";
  return size;
}

/* ═══════════════════════════════════════════════════════════
   State and rendering
   ═══════════════════════════════════════════════════════════ */

let charts = []; // currently selected, built alphabets
let available = []; // {locale, name, official, share}
let busy = 0;

function note(msg, isErr) {
  const n = $("note");
  n.textContent = msg || "";
  n.style.borderLeftColor = isErr ? "var(--mark)" : "var(--rule)";
}

function currentOptions() {
  return {
    fg: safeColour($("fgColor").value, "#191b1c"),
    bg: safeColour($("bgColor").value, "#f7f5f0"),
    transparent: $("optTransparent").checked,
    aux: $("optAux").checked,
    sentence: $("optSentence").checked,
    pairs: $("optPairs").checked,
    caption: cleanText($("capText").value, 120),
    capTop: $("capTop").getAttribute("aria-pressed") === "true",
    names: $("optNames").checked,
    generic: cleanText($("genericLabel").value, 40),
  };
}

async function refresh() {
  const token = ++busy;
  if (!charts.length) {
    $("sheetWrap").hidden = true;
    $("empty").style.display = "block";
    $("sources").hidden = true;
    syncExportState();
    $("copyOut").hidden = true;
    return;
  }

  const opts = currentOptions();
  const families = new Set(charts.map((c) => own(SCRIPT_FONT, c.script) || "Noto Sans"));
  families.add("Newsreader");
  families.add("Public Sans");

  progress("Loading fonts", true);
  await ensureFonts(families);
  if (token !== busy) return;

  if (opts.sentence) {
    progress("Fetching sample text", true);
    for (const c of charts) {
      if (c.sentence === undefined) c.sentence = await sampleSentence(c.locale);
    }
    if (token !== busy) return;
  }
  progress(null);

  drawSheet($("sheet"), charts, opts);
  $("sheetWrap").hidden = false;
  $("empty").style.display = "none";
  syncExportState();

  const missing = opts.sentence ? charts.filter((c) => c.sentence === null).map((c) => c.name) : [];
  const big = charts.filter((c) => c.truncated);
  const han = big.filter(
    (c) => c.script === "Han" || c.script === "Hiragana" || c.script === "Katakana",
  );
  note(
    [
      han.length
        ? `${han.map((c) => c.name).join(" and ")} is not written with an alphabet. CLDR lists the characters in common use, and the sheet shows the first ${MAX_CELLS} of them as a sample.`
        : "",
      big.length && !han.length
        ? `${big.map((c) => c.name).join(", ")} has more characters than fit on a sheet; the first ${MAX_CELLS} are shown.`
        : "",
      lastWarning,
      missing.length
        ? `No sourced sample text exists for ${missing.join(", ")}, so none is shown.`
        : "",
    ]
      .filter(Boolean)
      .join(" "),
  );

  renderSources();
  updateCopy();
}

/* ═══════════════════════════════════════════════════════════
   Sources panel
   ═══════════════════════════════════════════════════════════ */

function renderSources() {
  const dl = $("sourceList");
  dl.replaceChildren();

  const row = (term, href, label) => {
    const dt = document.createElement("dt");
    dt.textContent = term;
    const dd = document.createElement("dd");
    const a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = label; // text, never markup
    dd.append(a);
    dl.append(dt, dd);
  };

  for (const c of charts) {
    row(`${c.name} — letters`, c.url, c.url.replace(CDN + "/", ""));
    if ($("optSentence").checked && c.sentence)
      row(`${c.name} — sample text`, c.sentence.url, c.sentence.url.replace(CDN + "/", ""));
  }
  row("Country to language mapping", URL_TERRITORY_INFO, URL_TERRITORY_INFO.replace(CDN + "/", ""));

  $("caveat").textContent =
    `CLDR ${CLDR_VERSION} records the characters used to write a language, which is not always ` +
    `the alphabet as taught in school — Spanish dropped ch and ll as separate letters in 2010, ` +
    `for instance, and CLDR does not adjudicate that. Sample text is Article 1 of the Universal ` +
    `Declaration of Human Rights, via the UDHR in Unicode project.`;
  $("sources").hidden = false;
}

/* ═══════════════════════════════════════════════════════════
   Text output
   ═══════════════════════════════════════════════════════════ */

function copyText() {
  const fmt = $("copyFormat").value;
  const opts = currentOptions();
  const blocks = charts.map((c, i) => {
    const items = opts.aux ? c.letters.concat(c.aux) : c.letters;
    // The copy format is its own choice; it doesn't follow the sheet's toggle.
    const lower = items.map((it) => it.lower);
    const upper = items.map((it) => it.upper || it.lower);
    const pairs = items.map((it) => (it.upper ? it.upper + it.lower : it.lower));
    const body =
      fmt === "pairs"
        ? pairs.join("  ")
        : fmt === "upper"
          ? upper.join(" ")
          : fmt === "comma"
            ? lower.join(", ")
            : fmt === "plain"
              ? lower.join("")
              : fmt === "lines"
                ? pairs.join("\n")
                : lower.join(" ");
    const label = opts.names ? `${c.name} (${c.script})` : genericHeading(opts.generic, i);
    return charts.length > 1 && label ? `${label}\n${body}` : body;
  });
  return blocks.join("\n\n");
}

function updateCopy() {
  const out = $("copyOut");
  out.value = copyText();
  out.hidden = false;
}

/* ═══════════════════════════════════════════════════════════
   Export
   ═══════════════════════════════════════════════════════════ */

function exportSheet(type, ext) {
  const canvas = document.createElement("canvas");
  const opts = currentOptions();
  if (type === "image/jpeg" && opts.transparent) opts.transparent = false; // JPEG has no alpha
  drawSheet(canvas, charts, opts);
  canvas.toBlob(
    (blob) => {
      if (!blob) {
        note("The browser refused to encode the image.", true);
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      let slug;
      if (opts.names) {
        slug = charts
          .map((c) => c.locale)
          .join("-")
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, "");
      } else {
        // The filename shouldn't give away what the sheet deliberately hides.
        let h = 0;
        const seed = charts.map((c) => c.locale).join("|");
        for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
        slug = h.toString(36).slice(0, 6);
      }
      a.href = url;
      a.download = `alphabet-${slug || "sheet"}.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    },
    type,
    0.95,
  );
}

/* ═══════════════════════════════════════════════════════════
   Country autocomplete
   ═══════════════════════════════════════════════════════════ */

let COUNTRIES = [],
  countryMatches = [],
  countryCursor = 0,
  chosenCountry = "";

/* Matches an English name or a two-letter code, code first. */
function searchCountries(q) {
  const n = norm(q);
  if (!n) return [];
  const scored = [];
  for (const c of COUNTRIES) {
    const name = norm(c.name),
      code = c.code.toLowerCase();
    let score = -1;
    if (n.length === 2 && code === n) score = 0;
    else if (name === n) score = 1;
    else if (name.startsWith(n)) score = 2;
    else if (code.startsWith(n) && n.length <= 2) score = 3;
    else if (name.includes(n)) score = 4;
    if (score >= 0) scored.push({ c, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.c.name.localeCompare(b.c.name))
    .slice(0, 9)
    .map((s) => s.c);
}

function renderCountryResults() {
  $("countryResults").replaceChildren(
    ...countryMatches.map((c, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.code = c.code;
      if (i === countryCursor) b.className = "on";
      const code = document.createElement("code");
      code.textContent = c.code; // text, never markup
      const name = document.createElement("span");
      name.textContent = c.name;
      b.append(code, name);
      return b;
    }),
  );
}

function pickCountry(c) {
  if (!c) return;
  chosenCountry = c.code;
  $("country").value = c.name;
  countryMatches = [];
  renderCountryResults();
  onCountryChange();
}

/* ═══════════════════════════════════════════════════════════
   Language picker
   ═══════════════════════════════════════════════════════════ */

async function onCountryChange() {
  const code = chosenCountry;
  charts = [];
  available = [];
  $("langs").replaceChildren();
  note("");
  await refresh();
  if (!code) return;

  progress("Looking up languages", true);
  const langs = languagesFor(code);
  const candidates = [];
  for (const entry of langs)
    for (const locale of scriptVariants(entry.lang))
      candidates.push({ locale, official: entry.official, share: entry.share });

  const probes = await Promise.all(
    candidates.map(async (c) => {
      try {
        const data = await getJson(charactersUrl(c.locale));
        const main = data && data.main;
        const key = main && Object.keys(main)[0];
        if (!key || !main[key].characters) return null;
        return {
          locale: c.locale,
          name: languageName(c.locale),
          official: c.official,
          share: c.share,
        };
      } catch (e) {
        return null;
      } // CLDR simply has no data for this locale
    }),
  );
  const found = probes.filter(Boolean);
  progress(null);

  available = found;
  if (!found.length) {
    note("CLDR has no character data for the languages it lists for this country.", true);
    return;
  }
  renderLangs();
  const first = found[0];
  await toggleLanguage(first.locale, true);
}

function renderLangs() {
  const box = $("langs");
  box.replaceChildren(
    ...available.map((a) => {
      const label = document.createElement("label");
      label.className = "lang";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.dataset.locale = a.locale;
      cb.checked = charts.some((c) => c.locale === a.locale);

      const name = document.createElement("b");
      name.textContent = a.name; // text, never markup

      label.append(cb, name);
      if (a.official) {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = "official";
        label.append(tag);
      }
      const share = document.createElement("em");
      share.textContent = a.share ? a.share.toFixed(0) + "%" : "";
      label.append(share);
      return label;
    }),
  );
  $("langCount").textContent = charts.length ? `${charts.length} of ${MAX_LANGS}` : "";
}

async function toggleLanguage(locale, on) {
  if (on) {
    if (charts.length >= MAX_LANGS) {
      note(`${MAX_LANGS} alphabets is as many as fit on one sheet legibly.`);
      renderLangs();
      return;
    }
    try {
      progress("Reading CLDR", true);
      const chart = await buildAlphabet(locale);
      charts.push(chart);
    } catch (e) {
      note(`CLDR has no usable letter list for ${languageName(locale)}.`, true);
    } finally {
      progress(null);
    }
  } else {
    charts = charts.filter((c) => c.locale !== locale);
  }
  renderLangs();
  await refresh();
}

/* ═══════════════════════════════════════════════════════════
   Wiring
   ═══════════════════════════════════════════════════════════ */

$("country").addEventListener("input", (e) => {
  countryMatches = searchCountries(e.target.value);
  countryCursor = 0;
  renderCountryResults();
});
$("country").addEventListener("keydown", (e) => {
  if (!countryMatches.length) return;
  if (e.key === "ArrowDown") {
    countryCursor = (countryCursor + 1) % countryMatches.length;
    renderCountryResults();
    e.preventDefault();
  }
  if (e.key === "ArrowUp") {
    countryCursor = (countryCursor - 1 + countryMatches.length) % countryMatches.length;
    renderCountryResults();
    e.preventDefault();
  }
  if (e.key === "Enter") {
    pickCountry(countryMatches[countryCursor]);
    e.preventDefault();
  }
  if (e.key === "Escape") {
    countryMatches = [];
    renderCountryResults();
  }
});
$("countryResults").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b) pickCountry(COUNTRIES.find((c) => c.code === b.dataset.code));
});

$("langs").addEventListener("change", (e) => {
  const cb = e.target.closest("input[type=checkbox]");
  if (cb) toggleLanguage(cb.dataset.locale, cb.checked);
});

let genericTimer;
$("genericLabel").addEventListener("input", () => {
  clearTimeout(genericTimer);
  genericTimer = setTimeout(refresh, 300);
});

["optAux", "optSentence", "optPairs", "optTransparent", "optNames"].forEach((id) =>
  $(id).addEventListener("change", () => {
    if (id === "optTransparent") syncExportState();
    refresh();
  }),
);

bindColour("fgColor", "fgHex", refresh);
bindColour("bgColor", "bgHex", refresh);

let capTimer;
$("capText").addEventListener("input", () => {
  $("capPosField").hidden = !cleanText($("capText").value, 120);
  clearTimeout(capTimer);
  capTimer = setTimeout(refresh, 300);
});
$("capTop").addEventListener("click", () => {
  setSeg($("capTop"), $("capBottom"));
  refresh();
});
$("capBottom").addEventListener("click", () => {
  setSeg($("capBottom"), $("capTop"));
  refresh();
});

/*
  Every path that changes what can be exported ends here, so JPG can't be
  re-enabled behind transparency's back.
*/
function syncExportState() {
  const ready = charts.length > 0;
  const transparent = $("optTransparent").checked;

  $("dlPng").disabled = !ready;
  $("copyBtn").disabled = !ready;
  $("dlJpg").disabled = !ready || transparent;
  $("dlJpg").title = transparent ? "JPEG cannot store transparency — export as PNG" : "";

  $("bgColor").disabled = transparent;
  $("bgHex").disabled = transparent;
  $("pngOnly").hidden = !transparent;
}

$("dlPng").addEventListener("click", () => exportSheet("image/png", "png"));
$("dlJpg").addEventListener("click", () => exportSheet("image/jpeg", "jpg"));

$("copyFormat").addEventListener("change", updateCopy);
$("copyBtn").addEventListener("click", async () => {
  const text = copyText();
  try {
    await navigator.clipboard.writeText(text);
    note("Copied.");
  } catch (e) {
    const out = $("copyOut");
    out.hidden = false;
    out.focus();
    out.select();
    note("Your browser blocked the clipboard — the text is selected below, press Ctrl/Cmd+C.");
  }
});

/* ═══════════════════════════════════════════════════════════
   Start-up
   ═══════════════════════════════════════════════════════════ */

syncExportState();
progress("Loading CLDR", true);
loadCore()
  .then(() => {
    COUNTRIES = countryList();
    const input = $("country");
    input.disabled = false;
    input.placeholder = `${COUNTRIES.length} countries — name or code`;
    input.focus();
    progress(null);
  })
  .catch((err) => {
    progress(null);
    note(
      "Couldn't load CLDR from jsDelivr: " +
        (err && err.message ? err.message : "unreachable") +
        ". Check your connection and reload.",
      true,
    );
  });
