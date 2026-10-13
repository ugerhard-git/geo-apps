import { clamp, own, rng } from "../../shared/util.js";
import { $, bindColour, note, progress, setSeg } from "../../shared/dom.js";
import { parseHex, safeColour } from "../../shared/colour.js";
import { bareName, cleanText, htmlToText, norm } from "../../shared/text.js";
import { frameSpec } from "../../shared/sheet.js";
import { getJson } from "../../shared/net.js";
import { CLDR_VERSION, NOT_A_COUNTRY, URL_TERRITORIES } from "../../shared/cldr.js";
import {
  classifyLicence,
  firstSafeImageUrl,
  safeImageUrl,
  widenThumb,
} from "../../shared/commons.js";

/* ═══════════════════════════════════════════════════════════
   Configuration
   ═══════════════════════════════════════════════════════════ */

const CDN = "https://cdn.jsdelivr.net";

/*
  Wikipedia's own categories rather than a Wikidata query.

  Wikidata holds the better-structured answer, but the query needed to reach
  it — matching endemism recorded against states and islands as well as
  countries — was expensive enough that the service abandoned it, and a
  refused request gives the browser no status to report. This asks a far
  simpler question of an API that the plates and road-sign apps already use
  from this machine: which articles are in "Endemic fauna of <country>".
*/
const WIKI_API = "https://en.wikipedia.org/w/api.php";

const MAX_SPECIES = 240;
const MAX_SELECTED = 12;
const THUMB_W = 400;
const FULL_W = 1100;

/* Countries with enough endemic animals to draw decoys from. */
const DECOY_POOL = [
  "MG",
  "NZ",
  "AU",
  "PH",
  "ID",
  "JP",
  "CU",
  "LK",
  "MX",
  "BR",
  "ZA",
  "PG",
  "SC",
  "MU",
  "JM",
];

const ALIASES = {
  US: ["usa", "america", "united states of america"],
  GB: ["britain", "great britain", "england", "scotland", "wales"],
  NL: ["holland"],
  MM: ["burma"],
  SZ: ["swaziland"],
  CI: ["ivory coast"],
  TR: ["turkey"],
  CV: ["cape verde"],
  TL: ["east timor"],
  AE: ["uae"],
  CD: ["drc"],
  KR: ["south korea"],
  KP: ["north korea"],
  DE: ["deutschland"],
};

/* ═══════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════
   Countries
   ═══════════════════════════════════════════════════════════ */

let COUNTRIES = [];

async function loadCountries() {
  const data = await getJson(URL_TERRITORIES);
  const t =
    data &&
    data.main &&
    data.main.en &&
    data.main.en.localeDisplayNames &&
    data.main.en.localeDisplayNames.territories;
  if (!t) throw new Error("unexpected territories data");

  const byCode = new Map();
  for (const key of Object.keys(t)) {
    const value = own(t, key);
    if (typeof value !== "string") continue;
    const code = key.split("-")[0];
    if (!/^[A-Z]{2}$/.test(code) || NOT_A_COUNTRY.has(code)) continue;
    const entry = byCode.get(code) || { code, name: "", alts: [] };
    if (key === code) entry.name = cleanText(value, 80);
    else entry.alts.push(cleanText(value, 80));
    byCode.set(code, entry);
  }
  COUNTRIES = [...byCode.values()]
    .filter((e) => e.name)
    .sort((a, b) => bareName(a.name).localeCompare(bareName(b.name)));
  if (!COUNTRIES.length) throw new Error("no countries returned");
}

const nameOf = (code) => {
  const c = COUNTRIES.find((x) => x.code === code);
  return c ? c.name : code;
};

/* ═══════════════════════════════════════════════════════════
   Which species are endemic
   ═══════════════════════════════════════════════════════════ */

async function wikiApi(params) {
  const p = new URLSearchParams({ format: "json", formatversion: "2", origin: "*", ...params });
  const r = await fetch(WIKI_API + "?" + p.toString());
  if (!r.ok) {
    const e = new Error("HTTP " + r.status);
    e.status = r.status;
    throw e;
  }
  const data = await r.json();
  if (data && data.error) throw new Error(String(data.error.code || "api error").slice(0, 60));
  return data;
}

/*
  Wikipedia is inconsistent about the definite article, so both forms are
  tried. A category that does not exist simply returns nothing.
*/
function categoryCandidates(name) {
  const bare = String(name).replace(/^the\s+/i, "");
  const forms = [...new Set([name, bare, "the " + bare])];
  const out = [];
  for (const f of forms) out.push(`Category:Endemic fauna of ${f}`);
  for (const f of forms) out.push(`Category:Endemic animals of ${f}`);
  return out;
}

function memberTitles(data, kind) {
  const rows = data && data.query && data.query.categorymembers;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => r && typeof r.title === "string")
    .filter((r) => (kind === "subcat" ? /^Category:/.test(r.title) : !/^Category:/.test(r.title)))
    .map((r) => r.title);
}

async function categoryMembers(title, kind, limit) {
  const data = await wikiApi({
    action: "query",
    list: "categorymembers",
    cmtitle: title,
    cmtype: kind,
    cmlimit: String(limit || 500),
  });
  return memberTitles(data, kind);
}

/* Pages that are not a species: lists, overviews, the category's own prose. */
const NOT_A_SPECIES =
  /^(List of|Lists of|Fauna of|Wildlife of|Endemic|Index of|Outline of)\b|\b(disambiguation)\b/i;

/*
  The category, and one level of its subcategories when it is mostly made of
  them — the same shape as the road-sign categories, where the files live a
  level down from where you first look.
*/
async function endemicArticles(countryName) {
  const seen = new Set();
  const titles = [];
  const tried = [];
  const push = (t) => {
    if (seen.has(t) || NOT_A_SPECIES.test(t) || titles.length >= MAX_SPECIES) return;
    seen.add(t);
    titles.push(t);
  };

  let foundCategory = "";
  for (const cat of categoryCandidates(countryName)) {
    // Once a spelling has answered, the others are only wasted requests.
    if (titles.length || foundCategory) break;
    let pages = [];
    try {
      pages = await categoryMembers(cat, "page", 500);
    } catch (e) {
      tried.push(`${cat.replace("Category:", "")} → ${cleanText(e && e.message, 30)}`);
      continue;
    }
    if (!pages.length) {
      // An empty category may still have subcategories worth opening.
      let subs = [];
      try {
        subs = await categoryMembers(cat, "subcat", 50);
      } catch (e) {
        subs = [];
      }
      if (!subs.length) {
        tried.push(`${cat.replace("Category:", "")} → nothing`);
        continue;
      }
      foundCategory = cat;
      for (const sub of subs.slice(0, 24)) {
        if (titles.length >= MAX_SPECIES) break;
        try {
          (await categoryMembers(sub, "page", 200)).forEach(push);
        } catch (e) {
          /* skip */
        }
      }
      continue;
    }
    foundCategory = cat;
    pages.forEach(push);

    if (titles.length < 20) {
      let subs = [];
      try {
        subs = await categoryMembers(cat, "subcat", 50);
      } catch (e) {
        subs = [];
      }
      for (const sub of subs.slice(0, 24)) {
        if (titles.length >= MAX_SPECIES) break;
        try {
          (await categoryMembers(sub, "page", 200)).forEach(push);
        } catch (e) {
          /* skip */
        }
      }
    }
  }
  return { titles, tried, foundCategory };
}

/*
  Each article's lead image. pilicense=any matters: the default quietly omits
  images that are not freely licensed, which here would look like an article
  simply having no picture.
*/
async function leadImages(titles, homeCode) {
  const out = [];
  for (let i = 0; i < titles.length; i += 50) {
    let data;
    try {
      data = await wikiApi({
        action: "query",
        prop: "pageimages",
        pilicense: "any",
        piprop: "name",
        titles: titles.slice(i, i + 50).join("|"),
      });
    } catch (e) {
      continue;
    }

    const pages = data && data.query && data.query.pages;
    for (const page of Array.isArray(pages) ? pages : []) {
      const title = cleanText(String((page && page.title) || ""), 120);
      const file = cleanText(String((page && page.pageimage) || ""), 160);
      if (!title || !file) continue;
      out.push({
        qid: "W" + (Number.isInteger(page.pageid) ? page.pageid : 0),
        fileTitle: "File:" + file.replace(/_/g, " "),
        name: title,
        sci: "", // the article title is the name here
        via: "",
        home: homeCode,
        articleUrl: "https://en.wikipedia.org/wiki/" + encodeURIComponent(title.replace(/ /g, "_")),
      });
    }
  }
  return out;
}

async function endemicsOf(country) {
  const { titles, tried, foundCategory } = await endemicArticles(country.name);
  if (!titles.length) return { taxa: [], articles: 0, foundCategory, tried };
  const taxa = await leadImages(titles, country.code);
  // Keeping the article count apart from the photograph count is what lets
  // the app say which of the two is missing.
  return { taxa, articles: titles.length, foundCategory, tried };
}

/* ═══════════════════════════════════════════════════════════
   The photographs
   ═══════════════════════════════════════════════════════════ */

function fileTitleFromUrl(u) {
  const s = String(u || "");
  const m = /Special:FilePath\/(.+)$/.exec(s);
  if (!m) return "";
  let name;
  try {
    name = decodeURIComponent(m[1]);
  } catch (e) {
    name = m[1];
  }
  name = cleanText(name.replace(/_/g, " "), 160);
  return name ? "File:" + name : "";
}

async function photographs(taxa) {
  const byTitle = new Map(taxa.map((t) => [t.fileTitle, t]));
  const titles = [...byTitle.keys()];
  const out = [];

  for (let i = 0; i < titles.length; i += 50) {
    const p = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      origin: "*",
      prop: "imageinfo",
      titles: titles.slice(i, i + 50).join("|"),
      iiprop: "url|extmetadata|size|mime",
      iiurlwidth: String(THUMB_W),
    });
    let data;
    try {
      data = await getJson(COMMONS_API + "?" + p.toString());
    } catch (e) {
      continue;
    }

    const pages = data && data.query && data.query.pages;
    for (const page of Array.isArray(pages) ? pages : []) {
      const info = page && Array.isArray(page.imageinfo) ? page.imageinfo[0] : null;
      if (!info) continue;
      if (typeof info.mime === "string" && !/^image\//.test(info.mime)) continue;
      const pageid = Number.isInteger(page.pageid) && page.pageid > 0 ? page.pageid : null;
      if (!pageid) continue;

      const thumb = firstSafeImageUrl(info.thumburl, info.url);
      if (!thumb) continue;

      const taxon = byTitle.get(cleanText(String(page.title || ""), 160));
      if (!taxon) continue;

      const ex = info.extmetadata || {};
      const val = (k) => {
        const f = own(ex, k);
        return f && typeof f.value === "string" ? f.value : "";
      };

      out.push({
        ...taxon,
        pageid,
        thumb,
        full: widenThumb(thumb, info.width, FULL_W) || thumb,
        author: htmlToText(val("Artist"), 70),
        licence: classifyLicence(htmlToText(val("LicenseShortName"), 40), val("LicenseUrl")),
        describeUrl: `https://commons.wikimedia.org/w/index.php?curid=${pageid}`,
        keywords: norm([taxon.name, taxon.sci].join(" ")),
      });
    }
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════
   State
   ═══════════════════════════════════════════════════════════ */

let chosen = null;
let homeSpecies = [],
  decoySpecies = [],
  candidates = [],
  selected = [];
let busy = 0,
  relaxed = false,
  seed = 1,
  tainted = false;

function currentOptions() {
  return {
    fg: safeColour($("fgColor").value, "#e9efe2"),
    bg: safeColour($("bgColor").value, "#12170f"),
    at: safeColour($("atColor").value, "#8e9c82"),
    transparent: $("optTransparent").checked,
    names: $("optNames").checked,
    country: $("optCountry").checked,
    caption: cleanText($("capText").value, 120),
    capTop: $("capTop").getAttribute("aria-pressed") === "true",
  };
}

/* ═══════════════════════════════════════════════════════════
   Images
   ═══════════════════════════════════════════════════════════ */

let CORS_MODE = "unknown";
const imageCache = new Map();

function rawLoad(url, anonymous) {
  return new Promise((res, rej) => {
    const img = new Image();
    if (anonymous) img.crossOrigin = "anonymous";
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("image failed"));
    img.src = url;
  });
}

async function loadImage(url) {
  if (imageCache.has(url)) return imageCache.get(url);
  let img;
  if (CORS_MODE === "none") img = await rawLoad(url, false);
  else {
    try {
      img = await rawLoad(url, true);
      CORS_MODE = "anonymous";
    } catch (e) {
      if (CORS_MODE === "anonymous") throw e;
      img = await rawLoad(url, false);
      CORS_MODE = "none";
      tainted = true;
    }
  }
  imageCache.set(url, img);
  return img;
}

/* ═══════════════════════════════════════════════════════════
   Drawing
   ═══════════════════════════════════════════════════════════ */

function chooseGrid(n, w, h, gap, extraPerCell) {
  let best = null;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cellW = (w - gap * (cols - 1)) / cols;
    const cellH = (h - gap * (rows - 1)) / rows;
    const photoH = cellH - extraPerCell;
    if (cellW <= 8 || photoH <= 8) continue;
    // Photographs read best near landscape; score cells by how close they get.
    const ratio = cellW / photoH;
    const score = Math.min(cellW, photoH) * (ratio > 0.6 && ratio < 2.2 ? 1 : 0.6);
    if (!best || score > best.score) best = { score, cols, rows, cellW, cellH, photoH };
  }
  return best;
}

async function drawSheet(canvas, opts) {
  const { W, H } = frameSpec();
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);
  if (!opts.transparent) {
    ctx.fillStyle = opts.bg;
    ctx.fillRect(0, 0, W, H);
  }

  const pad = Math.round(Math.min(W, H) * 0.055);
  let top = pad,
    bottom = H - pad;

  if (opts.caption) {
    const capPx = Math.round(H * 0.045);
    ctx.fillStyle = opts.fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let px = capPx;
    ctx.font = `600 ${px}px "Lora", Georgia, serif`;
    while (px > 14 && ctx.measureText(opts.caption).width > W - pad * 2) {
      px -= 2;
      ctx.font = `600 ${px}px "Lora", Georgia, serif`;
    }
    if (opts.capTop) {
      ctx.fillText(opts.caption, W / 2, top + px * 0.6);
      top += px * 1.9;
    } else {
      ctx.fillText(opts.caption, W / 2, bottom - px * 0.6);
      bottom -= px * 1.9;
    }
  }

  if (opts.country && chosen) {
    const px = Math.round(H * 0.03);
    ctx.font = `400 ${px}px "Inter", sans-serif`;
    ctx.fillStyle = opts.fg;
    ctx.globalAlpha = 0.72;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(chosen.name, W / 2, bottom - px * 0.7);
    ctx.globalAlpha = 1;
    bottom -= px * 2.1;
  }

  if (!selected.length) return;

  const ready = [];
  for (const rec of selected) {
    try {
      ready.push({ rec, img: await loadImage(rec.full) });
    } catch (e) {
      try {
        ready.push({ rec, img: await loadImage(rec.thumb) });
      } catch (e2) {
        /* skip */
      }
    }
  }
  if (!ready.length) return;

  const boxW = W - pad * 2,
    boxH = bottom - top;
  if (boxW < 40 || boxH < 40) return;
  const gap = Math.round(Math.min(boxW, boxH) * 0.025);

  const needsCredit = ready.some((r) => r.rec.licence.attribution);
  const labelPx = opts.names ? clamp(Math.round(boxH * 0.03), 12, 40) : 0;
  const credPx = needsCredit ? clamp(Math.round(boxH * 0.02), 9, 24) : 0;
  const extra = labelPx * 1.5 + credPx * 1.6;

  const best = chooseGrid(ready.length, boxW, boxH, gap, extra);
  if (!best) return;

  const gridH = best.rows * best.cellH + gap * (best.rows - 1);
  const yTop = top + Math.max(0, (boxH - gridH) / 2);

  ready.forEach(({ rec, img }, i) => {
    const r = Math.floor(i / best.cols),
      c = i % best.cols;
    const inRow = Math.min(best.cols, ready.length - r * best.cols);
    const rowW = inRow * best.cellW + gap * (inRow - 1);
    const x = pad + (boxW - rowW) / 2 + c * (best.cellW + gap);
    const y = yTop + r * (best.cellH + gap);

    // Cover the cell rather than letterbox it: a wildlife photograph with
    // bars around it looks like a mistake.
    const iw = img.naturalWidth || img.width || 1;
    const ih = img.naturalHeight || img.height || 1;
    const scale = Math.max(best.cellW / iw, best.photoH / ih);
    const dw = iw * scale,
      dh = ih * scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, best.cellW, best.photoH);
    ctx.clip();
    ctx.drawImage(img, x + (best.cellW - dw) / 2, y + (best.photoH - dh) / 2, dw, dh);
    ctx.restore();

    let ty = y + best.photoH;
    if (labelPx) {
      ctx.font = `italic 500 ${labelPx}px "Lora", Georgia, serif`;
      ctx.fillStyle = opts.fg;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      let line = rec.sci || rec.name;
      while (line.length > 6 && ctx.measureText(line).width > best.cellW) {
        line = line.slice(0, -2);
      }
      if (line !== (rec.sci || rec.name)) line = line.replace(/\s+\S*$/, "") + "…";
      ctx.fillText(line, x + best.cellW / 2, ty + labelPx * 0.25);
      ty += labelPx * 1.5;
    }
    if (credPx && rec.licence.attribution) {
      // The author and a permalink, never the file name: file names for
      // wildlife photographs routinely carry the place.
      const bits = [
        rec.author || "Wikimedia Commons",
        rec.licence.label,
        rec.describeUrl.replace(/^https:\/\//, ""),
      ].filter(Boolean);
      const full = bits.join(" · ");
      let line = full;
      ctx.font = `400 ${credPx}px "Inter", sans-serif`;
      ctx.fillStyle = opts.at;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      while (line.length > 12 && ctx.measureText(line).width > best.cellW) {
        line = line.slice(0, -2);
      }
      if (line !== full) line = line.replace(/\s+\S*$/, "") + "…";
      ctx.fillText(line, x + best.cellW / 2, ty + credPx * 0.2);
    }
  });
}

/* ═══════════════════════════════════════════════════════════
   Panels
   ═══════════════════════════════════════════════════════════ */

function licenceAllowed(rec) {
  const mode = $("licFilter").value;
  if (mode === "all") return true;
  if (mode === "pd") return rec.licence.id === "pd";
  return rec.licence.id === "pd" || rec.licence.id === "by";
}

function renderGrid() {
  const q = norm($("filter").value);
  const list = candidates.filter(
    (r) => licenceAllowed(r) && (!q || (r.keywords || "").includes(q)),
  );
  const fromElsewhere = candidates.filter((r) => r.home !== (chosen ? chosen.code : "")).length;
  $("pickerCount").textContent =
    `${list.length} shown of ${candidates.length}` +
    (fromElsewhere ? ` · ${fromElsewhere} from elsewhere` : "") +
    ` · ${selected.length} of ${MAX_SELECTED} chosen`;

  $("grid").replaceChildren(
    ...list.map((rec) => {
      const tile = document.createElement("div");
      const isDecoy = chosen && rec.home !== chosen.code;
      tile.className = "tile" + (selected.includes(rec) ? " on" : "") + (isDecoy ? " decoy" : "");

      const thumb = document.createElement("div");
      thumb.className = "thumb";
      const img = document.createElement("img");
      img.src = rec.thumb;
      img.alt = "";
      img.loading = "lazy";
      thumb.append(img);
      thumb.addEventListener("click", () => toggleSelect(rec));

      const meta = document.createElement("div");
      meta.className = "meta";
      const name = document.createElement("b");
      name.textContent = rec.sci || rec.name; // text, never markup
      const common = document.createElement("span");
      common.textContent = rec.sci && rec.name !== rec.sci ? rec.name : "";

      const lic = document.createElement("span");
      lic.className =
        "lic " + (rec.licence.id === "pd" ? "pd" : rec.licence.id === "by" ? "by" : "sa");
      lic.textContent = rec.licence.label + (rec.licence.shareAlike ? " · share-alike" : "");

      meta.append(name);
      if (common.textContent) meta.append(common);
      if (isDecoy) {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = "from " + nameOf(rec.home);
        meta.append(tag);
      }
      const foot = document.createElement("div");
      foot.className = "row";
      const link = document.createElement("a");
      link.href = rec.describeUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "File page";
      link.className = "filelink";
      foot.append(lic, link);
      meta.append(foot);

      tile.append(thumb, meta);
      return tile;
    }),
  );
  $("picker").hidden = !candidates.length;
}

function toggleSelect(rec) {
  const at = selected.indexOf(rec);
  if (at >= 0) selected.splice(at, 1);
  else if (selected.length >= MAX_SELECTED) {
    note(`${MAX_SELECTED} is as many as fit on one sheet.`);
    return;
  } else selected.push(rec);
  renderGrid();
  refresh();
}

function renderSources() {
  const dl = $("sourceList");
  dl.replaceChildren();
  const row = (term, href, label) => {
    const dt = document.createElement("dt");
    dt.textContent = term;
    const dd = document.createElement("dd");
    if (href) {
      const a = document.createElement("a");
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = label; // text, never markup
      dd.append(a);
    } else dd.textContent = label;
    dl.append(dt, dd);
  };

  row(
    "Which species are endemic",
    "https://en.wikipedia.org/wiki/Category:Endemic_fauna_by_country",
    "English Wikipedia, endemic-fauna categories, CC BY-SA 4.0",
  );
  selected.forEach((rec, i) => {
    row(
      `Photograph ${i + 1}`,
      rec.describeUrl,
      `${rec.licence.label}${rec.author ? " · " + rec.author : ""} — file page`,
    );
  });
  row("Country names", "https://cldr.unicode.org/", `Unicode CLDR ${CLDR_VERSION}`);

  const caveats = [
    "Membership of Wikipedia's endemic-fauna categories is an editorial judgement by its contributors rather than a derived fact, so coverage is uneven: a country may have endemic species that are not categorised, and a species absent here is not evidence it does not exist.",
    "Only articles carrying a lead photograph can appear, which skews the result towards vertebrates. A country's endemic species are in reality mostly insects, snails and other invertebrates, few of which are illustrated.",
    "Pages that are lists or overviews rather than single species are left out by their titles, which is a rule of thumb rather than a guarantee.",
  ];
  const decoys = candidates.filter((r) => chosen && r.home !== chosen.code);
  if (decoys.length)
    caveats.push(
      `${decoys.length} species on offer are endemic to other countries and are marked as such in the picker; they are there to make the sheet a question rather than a recognition test.`,
    );
  $("caveat").textContent = caveats.join(" ");
  $("sources").hidden = !selected.length;
}

/* ═══════════════════════════════════════════════════════════
   Country picking
   ═══════════════════════════════════════════════════════════ */

let matches = [],
  cursor = 0;

function searchCountries(q) {
  const n = norm(q);
  if (!n) return [];
  const scored = [];
  for (const c of COUNTRIES) {
    const forms = [c.name, ...(c.alts || []), ...(own(ALIASES, c.code) || [])]
      .filter(Boolean)
      .map(bareName);
    const code = c.code.toLowerCase();
    let score = -1;
    if (n.length === 2 && code === n) score = 0;
    else if (forms.includes(n)) score = 1;
    else if (forms.some((f) => f.startsWith(n))) score = 2;
    else if (code.startsWith(n) && n.length <= 2) score = 3;
    else if (forms.some((f) => f.includes(n))) score = 4;
    if (score >= 0) scored.push({ c, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.c.name.localeCompare(b.c.name))
    .slice(0, 9)
    .map((s) => s.c);
}

function renderResults() {
  $("countryResults").replaceChildren(
    ...matches.map((c, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.code = c.code;
      if (i === cursor) b.className = "on";
      const code = document.createElement("code");
      code.textContent = c.code; // text, never markup
      const label = document.createElement("span");
      label.textContent = c.name; // text, never markup
      b.append(code, label);
      return b;
    }),
  );
}

async function pickCountry(c) {
  if (!c) return;
  chosen = c;
  homeSpecies = [];
  decoySpecies = [];
  candidates = [];
  selected = [];
  relaxed = false;
  $("country").value = c.name;
  matches = [];
  renderResults();
  $("grid").replaceChildren();
  note("");
  refresh();

  try {
    progress(`Looking up what lives only in ${c.name}`, true);
    const got = await endemicsOf(c);
    relaxed = got.relaxed;

    if (!got.taxa.length) {
      if (got.articles) {
        // The category exists; its articles simply carry no lead photograph.
        note(
          `Wikipedia lists ${got.articles} endemic species for ${c.name} in ` +
            `"${got.foundCategory.replace("Category:", "")}", but none of their articles ` +
            "carries a photograph, so there is nothing to put on a sheet.",
          true,
        );
      } else {
        const detail = got.tried && got.tried.length ? " Tried: " + got.tried.join("; ") + "." : "";
        note(
          `Wikipedia has no endemic-fauna category for ${c.name}.` +
            detail +
            " Endemism is concentrated in islands and the megadiverse countries; " +
            "most of continental Europe genuinely has none at species level.",
          true,
        );
      }
      return;
    }

    progress(`Fetching ${got.taxa.length} photographs from Commons`, true);
    homeSpecies = await photographs(got.taxa);
    if (!homeSpecies.length) {
      note(
        "Species were found for this country, but none of their photographs could be used.",
        true,
      );
      return;
    }
    await rebuildCandidates();
  } catch (e) {
    note("Couldn't look up endemic species: " + cleanText(e && e.message, 90) + ".", true);
  } finally {
    progress(null);
  }
}

/* Species from elsewhere, so the sheet asks a question rather than testing
   recognition. They come from other countries' endemic lists, which means
   everything on the sheet looks equally exotic. */
async function rebuildCandidates() {
  decoySpecies = [];
  if ($("optDecoys").checked && chosen) {
    const want = clamp(+$("decoyShare").value || 2, 1, 4);
    const pool = DECOY_POOL.filter((code) => code !== chosen.code);
    // A proper shuffle: sorting by a random comparator is both biased and
    // inconsistent, which some engines object to.
    const rand = rng(seed + chosen.code.charCodeAt(0));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const picks = pool.slice(0, Math.min(3, want + 1));
    for (const code of picks) {
      progress(`Fetching species from ${nameOf(code)} to mix in`, true);
      try {
        const other = COUNTRIES.find((x) => x.code === code);
        if (!other) continue;
        const got = await endemicsOf(other);
        decoySpecies.push(...(await photographs(got.taxa.slice(0, 12))));
      } catch (e) {
        /* a decoy source that fails is not worth stopping for */
      }
    }
    progress(null);
  }

  candidates = [...homeSpecies, ...decoySpecies];
  const fromHere = homeSpecies.length;
  note(
    `${fromHere} endemic to ${chosen ? chosen.name : "here"}` +
      (decoySpecies.length ? `, plus ${decoySpecies.length} from elsewhere` : "") +
      (relaxed
        ? ". The animals-only check didn't complete, so other kingdoms may be included."
        : "."),
  );
  renderGrid();
  refresh();
}

/* ═══════════════════════════════════════════════════════════
   Refresh and export
   ═══════════════════════════════════════════════════════════ */

async function refresh() {
  const token = ++busy;
  syncUI();
  if (!selected.length) {
    $("sheetWrap").hidden = true;
    $("empty").style.display = candidates.length ? "none" : "block";
    $("sources").hidden = true;
    return;
  }
  try {
    await drawSheet($("sheet"), currentOptions());
    if (token !== busy) return;
    $("sheetWrap").hidden = false;
    $("empty").style.display = "none";
    if (tainted)
      note(
        "This browser wouldn't let the page read Wikimedia's images back, so export is unavailable. Serving the file over http://localhost rather than opening it directly usually fixes it.",
        true,
      );
    renderSources();
  } catch (e) {
    note("Couldn't draw the sheet: " + cleanText(e && e.message, 80), true);
  }
  syncUI();
}

function syncUI() {
  const ready = selected.length > 0 && !tainted;
  const transparent = $("optTransparent").checked;
  $("dlPng").disabled = !ready;
  $("dlJpg").disabled = !ready || transparent;
  $("dlJpg").title = transparent ? "JPEG cannot store transparency — export as PNG" : "";
  $("bgColor").disabled = transparent;
  $("bgHex").disabled = transparent;
  $("pngOnly").hidden = !transparent;
  $("revealTag").hidden = !$("optCountry").checked;
  $("nameTag").hidden = !$("optNames").checked;
  $("decoyCountField").hidden = !$("optDecoys").checked;
  const share = clamp(+$("decoyShare").value || 2, 1, 4);
  $("decoyShareOut").textContent = ["a few", "half", "most", "nearly all"][share - 1];
}

async function exportSheet(type, ext) {
  const opts = currentOptions();
  if (type === "image/jpeg" && opts.transparent) opts.transparent = false;
  progress("Rendering for export", true);
  try {
    const canvas = document.createElement("canvas");
    await drawSheet(canvas, opts);
    const blob = await new Promise((res) => canvas.toBlob(res, type, 0.95));
    if (!blob) {
      note("The browser refused to encode the image.", true);
      return;
    }

    // A scientific name identifies the country as surely as its own name, so
    // printing names counts as revealing.
    let slug;
    if ((opts.country || opts.names) && chosen) {
      slug = chosen.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    } else {
      let h = 0;
      const sig = selected.map((r) => r.qid).join("|");
      for (let i = 0; i < sig.length; i++) h = (h * 31 + sig.charCodeAt(i)) >>> 0;
      slug = h.toString(36).slice(0, 6);
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `endemics-${slug || "sheet"}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (e) {
    note("Export failed: " + cleanText(e && e.message, 80), true);
  } finally {
    progress(null);
  }
}

/* ═══════════════════════════════════════════════════════════
   Wiring
   ═══════════════════════════════════════════════════════════ */

$("country").addEventListener("input", (e) => {
  matches = searchCountries(e.target.value);
  cursor = 0;
  renderResults();
});
$("country").addEventListener("keydown", (e) => {
  if (!matches.length) return;
  if (e.key === "ArrowDown") {
    cursor = (cursor + 1) % matches.length;
    renderResults();
    e.preventDefault();
  }
  if (e.key === "ArrowUp") {
    cursor = (cursor - 1 + matches.length) % matches.length;
    renderResults();
    e.preventDefault();
  }
  if (e.key === "Enter") {
    pickCountry(matches[cursor]);
    e.preventDefault();
  }
  if (e.key === "Escape") {
    matches = [];
    renderResults();
  }
});
$("countryResults").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b) pickCountry(COUNTRIES.find((c) => c.code === b.dataset.code));
});

$("licFilter").addEventListener("change", () => {
  selected = selected.filter(licenceAllowed);
  renderGrid();
  refresh();
});

let filterTimer;
$("filter").addEventListener("input", () => {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(renderGrid, 150);
});

$("optDecoys").addEventListener("change", () => {
  syncUI();
  if (homeSpecies.length) rebuildCandidates();
});
$("decoyShare").addEventListener("change", () => {
  syncUI();
  if (homeSpecies.length && $("optDecoys").checked) rebuildCandidates();
});
$("decoyShare").addEventListener("input", syncUI);

["optNames", "optCountry", "optTransparent"].forEach((id) =>
  $(id).addEventListener("change", () => {
    syncUI();
    refresh();
  }),
);

$("frame").addEventListener("change", () => {
  $("customSize").hidden = $("frame").value !== "custom";
  refresh();
});
let sizeTimer;
["customW", "customH"].forEach((id) =>
  $(id).addEventListener("input", () => {
    clearTimeout(sizeTimer);
    sizeTimer = setTimeout(refresh, 400);
  }),
);

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

bindColour("fgColor", "fgHex", refresh);
bindColour("bgColor", "bgHex", refresh);
bindColour("atColor", "atHex", refresh);

$("dlPng").addEventListener("click", () => exportSheet("image/png", "png"));
$("dlJpg").addEventListener("click", () => exportSheet("image/jpeg", "jpg"));

/* ═══════════════════════════════════════════════════════════
   Start-up
   ═══════════════════════════════════════════════════════════ */

$("capPosField").hidden = !cleanText($("capText").value, 120);
syncUI();
progress("Loading the country list", true);
loadCountries()
  .then(() => {
    const input = $("country");
    input.disabled = false;
    input.placeholder = `${COUNTRIES.length} countries — name or code`;
    input.focus();
    progress(null);
  })
  .catch((err) => {
    progress(null);
    note(
      "Couldn't load the country list: " +
        cleanText(err && err.message, 70) +
        ". Check your connection and reload.",
      true,
    );
  });
