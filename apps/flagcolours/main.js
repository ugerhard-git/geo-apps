import { clamp, own } from "../../shared/util.js";
import { $, bindColour, note, progress, setSeg } from "../../shared/dom.js";
import { parseHex, safeColour } from "../../shared/colour.js";
import { bareName, cleanText, norm } from "../../shared/text.js";
import { frameSpec } from "../../shared/sheet.js";
import { getJson, WDQS } from "../../shared/net.js";
import { CLDR_VERSION, NOT_A_COUNTRY, URL_TERRITORIES } from "../../shared/cldr.js";
import { safeImageUrl } from "../../shared/commons.js";

/* ═══════════════════════════════════════════════════════════
   Configuration
   ═══════════════════════════════════════════════════════════ */

const CDN = "https://cdn.jsdelivr.net";

/*
  The flag is measured from a rendering this wide. Wide enough that a thin
  stripe or a small emblem is still several pixels across, small enough that
  counting every pixel stays instant.
*/
const SAMPLE_WIDTH = 900;

/* Below this a pixel is treated as not part of the flag at all: Nepal's
   pennant corners, and the soft edge of any flag with transparency. */
const ALPHA_FLOOR = 128;

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
  CD: ["drc", "congo kinshasa"],
  CG: ["congo brazzaville"],
  KR: ["south korea"],
  KP: ["north korea"],
  CH: ["schweiz"],
  DE: ["deutschland"],
};

/* ═══════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════ */

const hex = (r, g, b) =>
  "#" + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("");

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

/* ═══════════════════════════════════════════════════════════
   Finding the flag

   Wikidata says which file is a country's flag, so the filename is never
   guessed at. Commons then renders that file to a PNG of a chosen width,
   which keeps the flag's official proportions — Switzerland square, Qatar
   very wide — and avoids drawing SVG to a canvas at all.
   ═══════════════════════════════════════════════════════════ */

const ISO2 = /^[A-Z]{2}$/;

function flagQuery(iso2) {
  return `SELECT ?flag WHERE {
  ?country wdt:P297 "${iso2}" .
  ?country wdt:P41 ?flag .
}
LIMIT 4`;
}

/* "https://commons.wikimedia.org/wiki/Special:FilePath/Flag%20of%20Germany.svg" */
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

async function flagFileFor(iso2) {
  if (!ISO2.test(iso2)) return "";
  const url = WDQS + "?format=json&query=" + encodeURIComponent(flagQuery(iso2));
  const data = await getJson(url);
  const rows = (data && data.results && data.results.bindings) || [];
  for (const row of rows) {
    const title = fileTitleFromUrl(row.flag && row.flag.value);
    if (title) return title;
  }
  return "";
}

async function flagRendering(fileTitle) {
  const p = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    origin: "*",
    prop: "imageinfo",
    titles: fileTitle,
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: String(SAMPLE_WIDTH),
  });
  const data = await getJson(COMMONS_API + "?" + p.toString());
  const pages = data && data.query && data.query.pages;
  const page = Array.isArray(pages) ? pages[0] : null;
  const info = page && Array.isArray(page.imageinfo) ? page.imageinfo[0] : null;
  if (!info) return null;

  // The thumbnail is a PNG rendered by Commons at the file's own aspect
  // ratio, which is exactly what makes the percentages mean anything.
  const src = safeImageUrl(info.thumburl) || safeImageUrl(info.url);
  if (!src) return null;

  const ex = info.extmetadata || {};
  const val = (k) => {
    const f = own(ex, k);
    return f && typeof f.value === "string" ? f.value : "";
  };
  return {
    src,
    width: Number.isFinite(info.thumbwidth) ? info.thumbwidth : 0,
    height: Number.isFinite(info.thumbheight) ? info.thumbheight : 0,
    fullWidth: Number.isFinite(info.width) ? info.width : 0,
    fullHeight: Number.isFinite(info.height) ? info.height : 0,
    licence: cleanText(val("LicenseShortName").replace(/<[^>]*>/g, " "), 40),
    pageid: Number.isInteger(page.pageid) ? page.pageid : 0,
    title: cleanText(String(page.title || ""), 160),
  };
}

/* ═══════════════════════════════════════════════════════════
   Measuring
   ═══════════════════════════════════════════════════════════ */

let tainted = false;

function loadImage(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("the flag image wouldn't load"));
    img.src = url;
  });
}

/*
  Every pixel, counted exactly. Anti-aliasing means a two-colour flag still
  produces thousands of distinct values along its edges, so the raw histogram
  is a starting point rather than an answer.
*/
function histogram(img) {
  const w = Math.max(1, img.naturalWidth || img.width);
  const h = Math.max(1, img.naturalHeight || img.height);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);

  let data;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch (e) {
    tainted = true;
    throw new Error("this browser wouldn't let the page read the flag's pixels");
  }

  const counts = new Map();
  let opaque = 0,
    clear = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < ALPHA_FLOOR) {
      clear++;
      continue;
    } // Nepal, and soft edges
    opaque++;
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return { counts, opaque, clear, width: w, height: h };
}

const unpack = (key) => [(key >> 16) & 255, (key >> 8) & 255, key & 255];
const dist2 = (a, b) => {
  const dr = a[0] - b[0],
    dg = a[1] - b[1],
    db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
};

/*
  The colours a person would say the flag is. Anything above the threshold
  anchors a slice; everything else joins whichever anchor it is closest to,
  which is what turns a million anti-aliased edge pixels back into two
  stripes. With folding off, colours that are distinct enough to be their own
  thing — an emblem's gold, say — keep their own slice.
*/
function quantise(hist, opts) {
  const total = hist.opaque;
  if (!total) return [];

  const entries = [...hist.counts.entries()].sort((a, b) => b[1] - a[1]);
  const minShare = opts.threshold; // a fraction, not a percent
  const anchorFloor = Math.max(1, Math.floor(total * minShare));

  const anchors = [];
  for (const [key, n] of entries) {
    if (anchors.length >= opts.maxSlices) break;
    if (n < anchorFloor) break;
    const rgb = unpack(key);
    // Two anchors this close are the same colour with different rounding.
    if (anchors.some((a) => dist2(a.rgb, rgb) < 200)) continue;
    anchors.push({ rgb, key, count: 0 });
  }
  // A flag whose colours all fall below the threshold still has colours.
  if (!anchors.length && entries.length) {
    const rgb = unpack(entries[0][0]);
    anchors.push({ rgb, key: entries[0][0], count: 0 });
  }

  const extras = [];
  const detailFloor = Math.max(1, Math.floor(total * minShare * 0.12));

  for (const [key, n] of entries) {
    const rgb = unpack(key);
    let best = 0,
      bestD = Infinity;
    for (let i = 0; i < anchors.length; i++) {
      const d = dist2(anchors[i].rgb, rgb);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    // Far from every anchor, big enough to matter, and the user wants detail:
    // this is emblem colour rather than an anti-aliased edge.
    if (
      !opts.fold &&
      bestD > 2600 &&
      n >= detailFloor &&
      extras.length + anchors.length < opts.maxSlices
    ) {
      extras.push({ rgb, key, count: n });
      continue;
    }
    anchors[best].count += n;
  }

  return [...anchors, ...extras]
    .filter((s) => s.count > 0)
    .map((s) => ({ colour: hex(...s.rgb), rgb: s.rgb, count: s.count, share: s.count / total }))
    .sort((a, b) => b.share - a.share);
}

/* ═══════════════════════════════════════════════════════════
   State
   ═══════════════════════════════════════════════════════════ */

let chosen = null,
  flagMeta = null,
  slices = [],
  measurement = null;
let busy = 0;

function quantiseOptions() {
  return {
    fold: $("optFold").checked,
    threshold: clamp(+$("threshold").value || 10, 1, 50) / 1000,
    maxSlices: clamp(+$("maxSlices").value || 10, 2, 20),
  };
}

function currentOptions() {
  return {
    fg: safeColour($("fgColor").value, "#e8ecf3"),
    bg: safeColour($("bgColor").value, "#101319"),
    transparent: $("optTransparent").checked,
    percent: $("optPercent").checked,
    hex: $("optHex").checked,
    ring: $("optRing").checked,
    country: $("optCountry").checked,
    start: clamp(+$("startAngle").value || 0, 0, 359),
    caption: cleanText($("capText").value, 120),
    capTop: $("capTop").getAttribute("aria-pressed") === "true",
  };
}

/* ═══════════════════════════════════════════════════════════
   Drawing
   ═══════════════════════════════════════════════════════════ */

/* Black text on a pale slice, white on a dark one. */
function readableOn(rgb) {
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  return L > 0.42 ? "#111111" : "#ffffff";
}

function drawSheet(canvas, opts) {
  const { W, H } = frameSpec();
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);
  if (!opts.transparent) {
    ctx.fillStyle = opts.bg;
    ctx.fillRect(0, 0, W, H);
  }

  const pad = Math.round(Math.min(W, H) * 0.06);
  let top = pad,
    bottom = H - pad;

  if (opts.caption) {
    const capPx = Math.round(H * 0.045);
    ctx.fillStyle = opts.fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let px = capPx;
    ctx.font = `600 ${px}px "Outfit", sans-serif`;
    while (px > 14 && ctx.measureText(opts.caption).width > W - pad * 2) {
      px -= 2;
      ctx.font = `600 ${px}px "Outfit", sans-serif`;
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
    ctx.font = `400 ${px}px "Outfit", sans-serif`;
    ctx.fillStyle = opts.fg;
    ctx.globalAlpha = 0.72;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(chosen.name, W / 2, bottom - px * 0.7);
    ctx.globalAlpha = 1;
    bottom -= px * 2.1;
  }

  if (!slices.length) return;

  const boxH = bottom - top,
    boxW = W - pad * 2;
  if (boxH < 30 || boxW < 30) return;
  const radius = Math.max(10, Math.min(boxW, boxH) / 2);
  const cx = W / 2,
    cy = top + boxH / 2;

  let angle = ((opts.start % 360) * Math.PI) / 180 - Math.PI / 2;
  const labelPx = clamp(Math.round(radius * 0.085), 11, 46);

  for (const s of slices) {
    const sweep = s.share * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, angle, angle + sweep);
    ctx.closePath();
    ctx.fillStyle = safeColour(s.colour, "#888888");
    ctx.fill();
    angle += sweep;
  }

  if (opts.ring) {
    // Punched out rather than painted over, so a transparent sheet stays
    // transparent in the middle.
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (!opts.transparent) {
      ctx.fillStyle = opts.bg;
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (opts.percent || opts.hex) {
    angle = ((opts.start % 360) * Math.PI) / 180 - Math.PI / 2;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const s of slices) {
      const sweep = s.share * Math.PI * 2;
      const mid = angle + sweep / 2;
      const r = opts.ring ? radius * 0.72 : radius * 0.62;
      const lines = [];
      if (opts.percent) lines.push(`${(s.share * 100).toFixed(1)}%`);
      if (opts.hex) lines.push(s.colour.toUpperCase());
      // A sliver has no room for a label; leaving it off beats overprinting.
      if (sweep > 0.16) {
        ctx.fillStyle = readableOn(s.rgb);
        lines.forEach((line, i) => {
          ctx.font = `${i === 0 ? 600 : 400} ${i === 0 ? labelPx : labelPx * 0.78}px "Outfit", sans-serif`;
          ctx.fillText(
            line,
            cx + Math.cos(mid) * r,
            cy + Math.sin(mid) * r + (i - (lines.length - 1) / 2) * labelPx * 1.05,
          );
        });
      }
      angle += sweep;
    }
  }
}

/* ═══════════════════════════════════════════════════════════
   Panels
   ═══════════════════════════════════════════════════════════ */

/*
  The flag itself, shown here and nowhere near the sheet. This panel is for
  whoever is building the puzzle, and seeing the source is the quickest way to
  tell that the right file was measured.
*/
function renderFlagShot() {
  const box = $("flagShot");
  box.replaceChildren();
  if (!flagMeta || !measurement) {
    box.hidden = true;
    return;
  }

  const img = document.createElement("img");
  img.src = flagMeta.src; // already host-checked
  img.alt = "";
  img.loading = "lazy";

  const cap = document.createElement("p");
  const ratio = measurement.height ? measurement.width / measurement.height : 0;
  cap.textContent =
    `Measured at ${measurement.width} × ${measurement.height}` +
    (ratio ? ` · ${ratio.toFixed(2)}:1` : "");

  box.append(img, cap);
  if (flagMeta.pageid) {
    const link = document.createElement("p");
    const a = document.createElement("a");
    a.href = `https://commons.wikimedia.org/w/index.php?curid=${flagMeta.pageid}`;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = "File page on Commons"; // text, never markup
    link.append(a);
    box.append(link);
  }
  box.hidden = false;
}

function renderSwatches() {
  $("swatchList").replaceChildren(
    ...slices.map((s) => {
      const wrap = document.createElement("div");
      wrap.className = "sw";
      const chip = document.createElement("i");
      chip.style.background = safeColour(s.colour, "#888888");
      const text = document.createElement("div");
      const pct = document.createElement("b");
      pct.textContent = `${(s.share * 100).toFixed(1)}%`;
      const code = document.createElement("span");
      code.textContent = s.colour.toUpperCase();
      text.append(pct, code);
      wrap.append(chip, text);
      return wrap;
    }),
  );
  renderFlagShot();
  $("breakdown").hidden = !slices.length;
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

  row("Which file is the flag", "https://query.wikidata.org/", "Wikidata, flag image property");
  if (flagMeta && flagMeta.pageid)
    row(
      "Flag image",
      `https://commons.wikimedia.org/w/index.php?curid=${flagMeta.pageid}`,
      `Wikimedia Commons${flagMeta.licence ? " · " + flagMeta.licence : ""} — file page`,
    );
  row("Country names", "https://cldr.unicode.org/", `Unicode CLDR ${CLDR_VERSION}`);

  const caveats = [];
  if (measurement) {
    caveats.push(
      `Measured from a ${measurement.width} × ${measurement.height} rendering, ` +
        `${measurement.opaque.toLocaleString()} pixels counted` +
        (measurement.clear
          ? `, ${measurement.clear.toLocaleString()} transparent ones left out`
          : "") +
        `, from ${measurement.distinct.toLocaleString()} distinct values.`,
    );
  }
  caveats.push(
    "The rendering keeps the flag's official proportions, so the shares are of the real flag rather than of a shape forced to a common aspect ratio.",
  );
  caveats.push(
    $("optFold").checked
      ? "Emblem and detail colours have been folded into the nearest main colour, so a coat of arms adds nothing of its own."
      : "Detail colours are shown separately where they are distinct and large enough, so an emblem contributes slices of its own.",
  );
  caveats.push(
    "Anti-aliasing along every edge produces shades that are in no sense flag colours; those are always assigned to the nearest real one.",
  );
  $("caveat").textContent = caveats.join(" ");
  $("sources").hidden = !slices.length;
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
  flagMeta = null;
  slices = [];
  measurement = null;
  $("country").value = c.name;
  matches = [];
  renderResults();
  note("");
  refresh();

  try {
    progress("Asking Wikidata which file is the flag", true);
    const fileTitle = await flagFileFor(c.code);
    if (!fileTitle) {
      note(`Wikidata has no flag image recorded for ${c.name}.`, true);
      return;
    }

    progress("Asking Commons to render it", true);
    flagMeta = await flagRendering(fileTitle);
    if (!flagMeta) {
      note("Commons couldn't render that file.", true);
      return;
    }

    progress("Counting pixels", true);
    const img = await loadImage(flagMeta.src);
    const hist = histogram(img);
    measurement = {
      width: hist.width,
      height: hist.height,
      opaque: hist.opaque,
      clear: hist.clear,
      distinct: hist.counts.size,
    };
    lastHistogram = hist;
    recompute();
  } catch (e) {
    note(
      (tainted
        ? "This browser wouldn't let the page read the flag's pixels. Serving the file over http://localhost rather than opening it directly usually fixes it. "
        : "Couldn't measure the flag: ") +
        cleanText(e && e.message, 80) +
        ".",
      true,
    );
  } finally {
    progress(null);
  }
}

let lastHistogram = null;

/* Re-slicing is instant, so the thresholds can be dragged freely. */
function recompute() {
  if (!lastHistogram) {
    slices = [];
    refresh();
    return;
  }
  slices = quantise(lastHistogram, quantiseOptions());
  const folded = measurement ? measurement.distinct - slices.length : 0;
  note(
    slices.length
      ? `${slices.length} ${slices.length === 1 ? "colour" : "colours"} from ` +
          `${measurement.distinct.toLocaleString()} distinct pixel values.`
      : "Nothing measurable in that flag.",
  );
  refresh();
}

/* ═══════════════════════════════════════════════════════════
   Refresh and export
   ═══════════════════════════════════════════════════════════ */

function refresh() {
  const token = ++busy;
  syncUI();
  if (!slices.length) {
    $("sheetWrap").hidden = true;
    $("empty").style.display = chosen ? "none" : "block";
    $("breakdown").hidden = true;
    $("sources").hidden = true;
    return;
  }
  try {
    drawSheet($("sheet"), currentOptions());
    if (token !== busy) return;
    $("sheetWrap").hidden = false;
    $("empty").style.display = "none";
    renderSwatches();
    renderSources();
  } catch (e) {
    note("Couldn't draw the chart: " + cleanText(e && e.message, 80), true);
  }
  syncUI();
}

function syncUI() {
  const ready = slices.length > 0 && !tainted;
  const transparent = $("optTransparent").checked;
  $("dlPng").disabled = !ready;
  $("dlJpg").disabled = !ready || transparent;
  $("dlJpg").title = transparent ? "JPEG cannot store transparency — export as PNG" : "";
  $("bgColor").disabled = transparent;
  $("bgHex").disabled = transparent;
  $("pngOnly").hidden = !transparent;
  $("revealTag").hidden = !$("optCountry").checked;
  $("hexTag").hidden = !$("optHex").checked;
  $("foldHint").hidden = false;
  $("thresholdOut").textContent = (clamp(+$("threshold").value, 1, 50) / 10).toFixed(1) + "%";
  $("maxSlicesOut").textContent = $("maxSlices").value;
  $("startOut").textContent = $("startAngle").value + "°";
}

function exportSheet(type, ext) {
  const opts = currentOptions();
  if (type === "image/jpeg" && opts.transparent) opts.transparent = false;
  try {
    const canvas = document.createElement("canvas");
    drawSheet(canvas, opts);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          note("The browser refused to encode the image.", true);
          return;
        }
        // The colour codes are as much of a giveaway as the name, so a sheet
        // showing either is named; otherwise the filename is a hash.
        let slug;
        if ((opts.country || opts.hex) && chosen) {
          slug = chosen.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");
        } else {
          let h = 0;
          const seed = slices.map((s) => s.colour + s.count).join("|");
          for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
          slug = h.toString(36).slice(0, 6);
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `flag-colours-${slug || "sheet"}.${ext}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      },
      type,
      0.95,
    );
  } catch (e) {
    note("Export failed: " + cleanText(e && e.message, 80), true);
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

let sliceTimer;
["threshold", "maxSlices"].forEach((id) =>
  $(id).addEventListener("input", () => {
    syncUI();
    clearTimeout(sliceTimer);
    sliceTimer = setTimeout(recompute, 120);
  }),
);
$("optFold").addEventListener("change", recompute);

let turnTimer;
$("startAngle").addEventListener("input", () => {
  syncUI();
  clearTimeout(turnTimer);
  turnTimer = setTimeout(refresh, 90);
});

["optPercent", "optHex", "optRing", "optCountry", "optTransparent"].forEach((id) =>
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
