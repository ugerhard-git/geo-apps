import { $ } from "../../shared/dom.js";

/* ───────── product groups ─────────
   HS sections, in the OEC's order. Colors are hand-matched to the
   look of the site's treemaps — tweak any hex here and everything
   downstream follows. */
const SECTIONS = {
  1: ["Animal Products", "#c4636b"],
  2: ["Vegetable Products", "#7da544"],
  3: ["Animal & Vegetable Bi-Products", "#a7c957"],
  4: ["Foodstuffs", "#e8a33d"],
  5: ["Mineral Products", "#7b4b3a"],
  6: ["Chemical Products", "#db7093"],
  7: ["Plastics & Rubbers", "#8a6fb0"],
  8: ["Animal Hides", "#96455a"],
  9: ["Wood Products", "#b08968"],
  10: ["Paper Goods", "#cbb79a"],
  11: ["Textiles", "#6fa8a0"],
  12: ["Footwear & Headwear", "#d98282"],
  13: ["Stone & Glass", "#8fa6b2"],
  14: ["Precious Metals", "#e5c04b"],
  15: ["Metals", "#9aa3aa"],
  16: ["Machines", "#4a90c2"],
  17: ["Transportation", "#315f8c"],
  18: ["Instruments", "#79bccb"],
  19: ["Weapons", "#5e6b75"],
  20: ["Miscellaneous", "#b5afa6"],
  21: ["Arts & Antiques", "#4e8f87"],
};
const OTHER = ["Unclassified", "#c8cdd1"];

/* Offline country list, used only if the live list can't be fetched. */
const FALLBACK_COUNTRIES = `
afdza Algeria|afago Angola|afbfa Burkina Faso|afbwa Botswana|afcmr Cameroon|afcod DR Congo|afcog Congo|afciv Côte d'Ivoire|afegy Egypt|afeth Ethiopia|afgab Gabon|afgha Ghana|afken Kenya|aflby Libya|afmar Morocco|afmdg Madagascar|afmli Mali|afmoz Mozambique|afmus Mauritius|afnam Namibia|afnga Nigeria|afrwa Rwanda|afsen Senegal|afsdn Sudan|aftun Tunisia|aftza Tanzania|afuga Uganda|afzaf South Africa|afzmb Zambia|afzwe Zimbabwe|
asafg Afghanistan|asare United Arab Emirates|asarm Armenia|asaze Azerbaijan|asbgd Bangladesh|asbhr Bahrain|asbrn Brunei|aschn China|asgeo Georgia|ashkg Hong Kong|asidn Indonesia|asind India|asirn Iran|asirq Iraq|asisr Israel|asjor Jordan|asjpn Japan|askaz Kazakhstan|askgz Kyrgyzstan|askhm Cambodia|askor South Korea|askwt Kuwait|aslao Laos|aslbn Lebanon|aslka Sri Lanka|asmmr Myanmar|asmng Mongolia|asmys Malaysia|asnpl Nepal|asomn Oman|aspak Pakistan|asphl Philippines|asqat Qatar|assau Saudi Arabia|assgp Singapore|assyr Syria|astha Thailand|astjk Tajikistan|astkm Turkmenistan|astur Turkey|astwn Taiwan|asuzb Uzbekistan|asvnm Vietnam|asyem Yemen|
eualb Albania|euaut Austria|eubel Belgium|eubgr Bulgaria|eubih Bosnia and Herzegovina|eublr Belarus|euche Switzerland|eucze Czechia|eudeu Germany|eudnk Denmark|euesp Spain|euest Estonia|eufin Finland|eufra France|eugbr United Kingdom|eugrc Greece|euhrv Croatia|euhun Hungary|euirl Ireland|euisl Iceland|euita Italy|eultu Lithuania|eulux Luxembourg|eulva Latvia|eumda Moldova|eumkd North Macedonia|eumlt Malta|eumne Montenegro|eunld Netherlands|eunor Norway|eupol Poland|euprt Portugal|eurou Romania|eurus Russia|eusrb Serbia|eusvk Slovakia|eusvn Slovenia|euswe Sweden|euukr Ukraine|
nabhs Bahamas|nacan Canada|nacri Costa Rica|nacub Cuba|nadom Dominican Republic|nagtm Guatemala|nahnd Honduras|nahti Haiti|najam Jamaica|namex Mexico|nanic Nicaragua|napan Panama|naslv El Salvador|natto Trinidad and Tobago|nausa United States|
ocaus Australia|ocfji Fiji|ocncl New Caledonia|ocnzl New Zealand|ocpng Papua New Guinea|ocslb Solomon Islands|ocvut Vanuatu|ocwsm Samoa|
saarg Argentina|sabol Bolivia|sabra Brazil|sachl Chile|sacol Colombia|saecu Ecuador|saguy Guyana|saper Peru|sapry Paraguay|sasur Suriname|saury Uruguay|saven Venezuela`;

const els = {
  country: $("country"),
  countrySrc: $("countrySrc"),
  year: $("year"),
  token: $("token"),
  ratio: $("ratio"),
  width: $("width"),
  cutoff: $("cutoff"),
  cutoffVal: $("cutoffVal"),
  labels: $("labels"),
  hideAnswer: $("hideAnswer"),
  go: $("go"),
  dlPng: $("dlPng"),
  dlJpg: $("dlJpg"),
  dlSvg: $("dlSvg"),
  scale: $("scale"),
  stage: $("stage"),
  caption: $("caption"),
  msg: $("msg"),
  manualJson: $("manualJson"),
  useJson: $("useJson"),
  copyUrl: $("copyUrl"),
  openUrl: $("openUrl"),
  manualBox: $("manualBox"),
};

let current = null; // last rendered chart, for downloads
let lastData = null; // last fetched products, so controls redraw without refetching

/* ───────── year + cube ───────── */
const THIS_YEAR = new Date().getFullYear();
els.year.max = THIS_YEAR;
els.year.value = THIS_YEAR - 2;

/* BACI ships one dataset per HS revision; pick the one covering the year. */
function cubeFor(y) {
  if (y >= 2022) return "trade_i_baci_a_22";
  if (y >= 2017) return "trade_i_baci_a_17";
  if (y >= 2012) return "trade_i_baci_a_12";
  if (y >= 2007) return "trade_i_baci_a_07";
  if (y >= 2002) return "trade_i_baci_a_02";
  if (y >= 1996) return "trade_i_baci_a_96";
  return "trade_i_baci_a_92";
}

const API = "https://api-v2.oec.world/tesseract";
/* No cookies, no referrer (the token sits in the query string), no caching. */
const FETCH_OPTS = {
  credentials: "omit",
  referrerPolicy: "no-referrer",
  cache: "no-store",
  mode: "cors",
};
function tokenParam() {
  const t = els.token.value.trim();
  return t ? "&token=" + encodeURIComponent(t) : "";
}
function dataUrl(countryId, year) {
  return (
    API +
    "/data.jsonrecords" +
    "?cube=" +
    cubeFor(year) +
    "&drilldowns=HS4,Year,Exporter+Country" +
    "&measures=Trade+Value" +
    "&include=Exporter+Country:" +
    encodeURIComponent(countryId) +
    ";Year:" +
    year +
    "&limit=6000,0" +
    tokenParam()
  );
}

/* ───────── country list ───────── */
function parseFallback() {
  return FALLBACK_COUNTRIES.split("|")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.indexOf(" ");
      return { id: s.slice(0, i), name: s.slice(i + 1) };
    });
}
const ID_OK = /^[A-Za-z0-9_-]{2,16}$/; // shape of an OEC country id

function fillCountries(list, note) {
  // ids reach a URL and names reach the page, so both are checked first
  const clean = list
    .filter((c) => ID_OK.test(String(c.id)))
    .map((c) => ({ id: String(c.id), name: clip(c.name, 80) }))
    .slice(0, 1000)
    .sort((a, b) => a.name.localeCompare(b.name));

  els.country.replaceChildren();
  const frag = document.createDocumentFragment();
  for (const c of clean) frag.appendChild(new Option(c.name, c.id)); // text, not markup
  els.country.appendChild(frag);

  const pref = clean.find((c) => c.id === "eudeu") || clean[0];
  if (pref) els.country.value = pref.id;
  els.countrySrc.textContent = note;
}
async function loadCountries() {
  const url =
    API +
    "/members.jsonrecords?cube=" +
    cubeFor(+els.year.value) +
    "&level=Exporter+Country" +
    tokenParam();
  try {
    const r = await fetch(url, FETCH_OPTS);
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    const raw = j.data || j.members || j.values || [];
    const list = raw
      .map((m) => ({
        id: m.ID ?? m.id ?? m.key ?? m.Key,
        name: m.Label ?? m.label ?? m.name ?? m.caption ?? m.Name,
      }))
      .filter((c) => c.id && c.name);
    if (!list.length) throw new Error("empty");
    fillCountries(list, list.length + " countries, live from the OEC.");
  } catch (e) {
    fillCountries(parseFallback(), "Built-in list — the live one didn't load.");
  }
}

/* ───────── fetching exports ───────── */
function fieldsOf(row) {
  const k = Object.keys(row);
  const find = (re) => k.find((x) => re.test(x));
  return {
    id: find(/^hs4 id$/i) || find(/hs4.*id/i) || find(/product.*id/i),
    name: find(/^hs4$/i) || find(/^product$/i) || find(/hs4/i),
    val: find(/trade value/i) || find(/value/i),
  };
}
const MAX_ROWS = 20000; // a response should never be able to hang the tab

function toProducts(json) {
  let rows = Array.isArray(json) ? json : json && (json.data || json.records);
  if (!Array.isArray(rows) || !rows.length) return [];
  if (rows.length > MAX_ROWS) rows = rows.slice(0, MAX_ROWS);
  const f = fieldsOf(rows[0]);
  if (!f.val) return [];
  return rows
    .map((r) => {
      const rawId = String(r[f.id] ?? "");
      /* OEC product ids are the section number glued onto the 4-digit HS code,
       so everything before the last four digits is the section. */
      let sec = parseInt(rawId.slice(0, Math.max(0, rawId.length - 4)), 10);
      if (!(sec >= 1 && sec <= 21)) sec = 0;
      return { name: clip(r[f.name] ?? rawId, 120), section: sec, value: Number(r[f.val]) || 0 };
    })
    .filter((p) => p.value > 0);
}

async function fetchYear(countryId, year) {
  const r = await fetch(dataUrl(countryId, year), FETCH_OPTS);
  if (!r.ok) throw new Error("The OEC returned " + r.status + " for " + year + ".");
  return toProducts(await r.json());
}

/* ───────── squarified treemap ───────── */
function worst(areas, side) {
  if (!areas.length) return Infinity;
  let sum = 0,
    mx = -Infinity,
    mn = Infinity;
  for (const a of areas) {
    sum += a;
    if (a > mx) mx = a;
    if (a < mn) mn = a;
  }
  if (sum <= 0 || mn <= 0) return Infinity;
  const s2 = sum * sum,
    l2 = side * side;
  return Math.max((l2 * mx) / s2, s2 / (l2 * mn));
}
function placeRow(row, x, y, w, h) {
  const sum = row.reduce((s, n) => s + n.area, 0);
  const rects = [];
  if (sum <= 0 || w <= 0 || h <= 0) return { rects, rest: { x, y, w, h } };
  if (w >= h) {
    // stack the row as a column on the left
    const rw = sum / h;
    let cy = y;
    for (const n of row) {
      const rh = n.area / rw;
      rects.push({ n, x, y: cy, w: rw, h: rh });
      cy += rh;
    }
    return { rects, rest: { x: x + rw, y, w: Math.max(0, w - rw), h } };
  }
  const rh = sum / w;
  let cx = x; // otherwise a strip across the top
  for (const n of row) {
    const rw = n.area / rh;
    rects.push({ n, x: cx, y, w: rw, h: rh });
    cx += rw;
  }
  return { rects, rest: { x, y: y + rh, w, h: Math.max(0, h - rh) } };
}
function squarify(nodes, x, y, w, h) {
  const out = [];
  const total = nodes.reduce((s, n) => s + n.value, 0);
  if (total <= 0 || w <= 0 || h <= 0) return out;
  const queue = nodes
    .slice()
    .sort((a, b) => b.value - a.value)
    .map((n) => ({ node: n, area: (n.value / total) * w * h }));
  let row = [];
  while (queue.length) {
    const side = Math.min(w, h);
    const next = queue[0];
    const a = row.map((n) => n.area);
    if (!row.length || worst(a, side) >= worst(a.concat(next.area), side)) {
      row.push(queue.shift());
    } else {
      const res = placeRow(row, x, y, w, h);
      out.push(...res.rects);
      ({ x, y, w, h } = res.rest);
      row = [];
    }
  }
  if (row.length) out.push(...placeRow(row, x, y, w, h).rects);
  return out;
}

/* ───────── drawing ───────── */
const SVGNS = "http://www.w3.org/2000/svg";
function el(tag, attrs) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}
/* Sections present, biggest first — shared by the treemap and the legend. */
function groupsOf(products) {
  const bySec = new Map();
  for (const p of products) {
    if (!bySec.has(p.section)) bySec.set(p.section, { section: p.section, value: 0, items: [] });
    const g = bySec.get(p.section);
    g.value += p.value;
    g.items.push(p);
  }
  return [...bySec.values()].sort((a, b) => b.value - a.value);
}

/* Total across everything the country exports, printed above the chart. */
function drawHeadline(svg, total, s, pad) {
  const fs = Math.round(34 * s),
    subFs = Math.round(15 * s);
  const amount = money(total);
  const base = pad + fs * 0.84;
  svg.appendChild(textEl(amount, pad, base, fs, "#16202a", 700));
  svg.appendChild(
    textEl(
      "total exports",
      pad + widthAt(svg, amount, fs, 700) + 10 * s,
      base,
      subFs,
      "#5d6b78",
      400,
    ),
  );
  return Math.round(base + fs * 0.32);
}

/* Product-group key across the foot of the chart. Wraps to as many rows as it needs. */
function drawLegend(svg, groups, W, H, s, pad) {
  const fs = Math.round(14 * s),
    chip = Math.round(12 * s);
  const inner = Math.round(8 * s),
    between = Math.round(22 * s),
    rowH = Math.round(21 * s);
  const items = groups.map((g) => {
    const [name, color] = SECTIONS[g.section] || OTHER;
    return { name, color, w: chip + inner + widthAt(svg, name, fs, 400) };
  });

  const maxW = W - 2 * pad;
  const rows = [[]];
  let used = 0;
  for (const it of items) {
    const row = rows[rows.length - 1];
    const need = it.w + (row.length ? between : 0);
    if (row.length && used + need > maxW) {
      rows.push([it]);
      used = it.w;
    } else {
      row.push(it);
      used += need;
    }
  }

  const topGap = Math.round(pad * 0.7);
  const height = rows.length * rowH + Math.round(pad * 0.8) + topGap;
  let y = H - height + topGap;
  for (const row of rows) {
    const top = y + (rowH - chip) / 2;
    let x = pad;
    for (const it of row) {
      svg.appendChild(
        el("rect", {
          x: x.toFixed(2),
          y: top.toFixed(2),
          width: chip,
          height: chip,
          rx: Math.round(2 * s),
          fill: it.color,
        }),
      );
      svg.appendChild(textEl(it.name, x + chip + inner, top + chip * 0.92, fs, "#46525d", 400));
      x += it.w + between;
    }
    y += rowH;
  }
  return height;
}

function drawChart(svg, products, grandTotal, W, H) {
  const s = W / 1200;
  const pad = Math.round(16 * s);
  svg.appendChild(el("rect", { x: 0, y: 0, width: W, height: H, fill: "#ffffff" }));

  const groups = groupsOf(products);
  const headerH = drawHeadline(svg, grandTotal, s, pad);
  const footerH = drawLegend(svg, groups, W, H, s, pad);

  const areaY = headerH,
    areaH = H - headerH - footerH;
  const boxes = [];
  if (areaH < 40) return boxes;

  const shown = products.reduce((a, p) => a + p.value, 0);
  for (const g of squarify(groups, pad, areaY, W - 2 * pad, areaH)) {
    const gap = 2;
    const bx = g.x + gap,
      by = g.y + gap,
      bw = Math.max(0, g.w - 2 * gap),
      bh = Math.max(0, g.h - 2 * gap);
    const [, color] = SECTIONS[g.n.node.section] || OTHER;
    for (const t of squarify(g.n.node.items, bx, by, bw, bh)) {
      const w = Math.max(0, t.w),
        h = Math.max(0, t.h);
      svg.appendChild(
        el("rect", {
          x: t.x.toFixed(2),
          y: t.y.toFixed(2),
          width: w.toFixed(2),
          height: h.toFixed(2),
          fill: color,
          stroke: "#ffffff",
          "stroke-width": 1.2,
        }),
      );
      boxes.push({
        x: t.x,
        y: t.y,
        w,
        h,
        color,
        name: t.n.node.name,
        share: t.n.node.value / shown,
      });
    }
  }
  return boxes;
}

/* ───────── labels ─────────
   Text can only be measured once the SVG is on the page, so this runs
   after the chart is inserted. Anything that won't fit stays bare. */
const FONT = '"Inter","Helvetica Neue",Helvetica,Arial,sans-serif';
const REF = 100; // measure once at this size, scale linearly
const widthCache = new Map();

function measure(svg, str, weight) {
  const key = weight + "|" + str;
  if (widthCache.has(key)) return widthCache.get(key);
  let w;
  try {
    const t = el("text", {
      x: -9999,
      y: -9999,
      "font-family": FONT,
      "font-size": REF,
      "font-weight": weight,
      visibility: "hidden",
    });
    t.textContent = str;
    svg.appendChild(t);
    w = t.getComputedTextLength();
    svg.removeChild(t);
  } catch {
    w = 0;
  }
  if (!w) w = str.length * REF * 0.55; // rough fallback
  widthCache.set(key, w);
  return w;
}
const widthAt = (svg, s, fs, weight) => (measure(svg, s, weight || 600) * fs) / REF;

/* Greedy wrap. Returns null if a single word can't fit, or it needs too many lines. */
function wrapText(svg, str, maxW, fs, maxLines) {
  const words = str.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (widthAt(svg, word, fs) > maxW) return null;
    const test = line ? line + " " + word : word;
    if (widthAt(svg, test, fs) <= maxW) line = test;
    else {
      lines.push(line);
      line = word;
      if (lines.length > maxLines) return null;
    }
  }
  if (line) lines.push(line);
  return lines.length && lines.length <= maxLines ? lines : null;
}

/* White text on dark blocks, near-black on light ones. */
function inkFor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 150 ? "#1f2428" : "#ffffff";
}
function textEl(str, x, y, fs, fill, weight, opacity) {
  const t = el("text", {
    x: x.toFixed(2),
    y: y.toFixed(2),
    fill,
    "font-family": FONT,
    "font-size": fs,
    "font-weight": weight,
    "paint-order": "stroke",
  });
  if (opacity) t.setAttribute("opacity", opacity);
  t.textContent = str;
  return t;
}
function shareText(s) {
  const pct = s * 100;
  return (pct >= 10 ? pct.toFixed(0) : pct >= 1 ? pct.toFixed(1) : pct.toFixed(2)) + "%";
}

function addLabels(svg, boxes, mode) {
  if (mode === "none") return 0;
  const PAD = 5;
  let placed = 0;

  let defs = svg.querySelector("defs");
  if (!defs) {
    defs = el("defs");
    svg.insertBefore(defs, svg.firstChild);
  }

  boxes.forEach((b, i) => {
    const availW = (b.w - 2 * PAD) * 0.97; // margin, in case font metrics shift
    const availH = b.h - 2 * PAD;
    if (availW < 22 || availH < 10) return;

    const ink = inkFor(b.color);
    const start = Math.min(21, Math.max(8, Math.round(Math.sqrt(b.w * b.h) / 6)));

    for (let fs = start; fs >= 8; fs--) {
      const lines = wrapText(
        svg,
        b.name,
        availW,
        fs,
        Math.min(3, Math.floor(availH / (fs * 1.15))),
      );
      if (!lines) continue;

      const subFs = Math.max(7, Math.round(fs * 0.78));
      const wantSub = mode === "full" && widthAt(svg, shareText(b.share), subFs) <= availW;
      const needed = lines.length * fs * 1.16 + (wantSub ? subFs * 1.3 : 0);
      if (needed > availH) continue;

      // clip to the block so a label can never bleed into its neighbour
      const clipId = "lc" + i;
      const clip = el("clipPath", { id: clipId });
      clip.appendChild(el("rect", { x: b.x, y: b.y, width: b.w, height: b.h }));
      defs.appendChild(clip);
      const g = el("g", { "clip-path": `url(#${clipId})` });

      let y = b.y + PAD + fs * 0.9;
      for (const ln of lines) {
        g.appendChild(textEl(ln, b.x + PAD, y, fs, ink, 600));
        y += fs * 1.16;
      }
      if (wantSub)
        g.appendChild(
          textEl(shareText(b.share), b.x + PAD, y + subFs * 0.15, subFs, ink, 400, 0.78),
        );
      svg.appendChild(g);
      placed++;
      break;
    }
  });
  return placed;
}

/* ───────── formatting ───────── */
function money(v) {
  const u = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "k"],
  ];
  for (const [n, s] of u) if (v >= n) return "$" + (v / n).toFixed(v / n < 10 ? 2 : 1) + s;
  return "$" + Math.round(v);
}
/* Messages can carry text from the API or from pasted JSON, so they are
   assembled as text nodes. Nothing here is ever parsed as HTML. */
function say(kind, text, code, tail) {
  els.msg.replaceChildren();
  if (!text) return;
  const box = document.createElement("div");
  box.className = "msg " + kind;
  box.append(String(text));
  if (code) {
    const c = document.createElement("code");
    c.textContent = String(code);
    box.append(c);
  }
  if (tail) box.append(String(tail));
  els.msg.appendChild(box);
}

/* Keep foreign strings short before they are shown anywhere. */
const clip = (v, n) => String(v ?? "").slice(0, n);

/* ───────── render pipeline ───────── */
function render(products, countryName, year, note) {
  lastData = { products, countryName, year };
  const total = products.reduce((s, p) => s + p.value, 0);
  const cut = parseFloat(els.cutoff.value) / 100;
  const kept = products.filter((p) => p.value / total >= cut);
  if (!kept.length) {
    say("err", "Every product fell below the cutoff. Lower it and try again.");
    return;
  }

  const W = parseInt(els.width.value, 10);
  const H = Math.round(W / parseFloat(els.ratio.value));

  // the SVG has to be on the page before any text can be measured
  const svg = el("svg", { xmlns: SVGNS, viewBox: `0 0 ${W} ${H}`, width: W, height: H });
  els.stage.replaceChildren(svg);

  widthCache.clear();
  const boxes = drawChart(svg, kept, total, W, H);
  const named = addLabels(svg, boxes, els.labels.value);
  current = { svg, countryName, year, W, H };

  els.caption.replaceChildren();
  const strong = document.createElement("strong");
  strong.textContent = countryName; // country names come from the API
  els.caption.appendChild(strong);
  const note2 = (t) => {
    const sp = document.createElement("span");
    sp.textContent = t;
    els.caption.appendChild(sp);
  };
  note2(String(year));
  note2(`${kept.length} of ${products.length} products shown`);
  if (els.labels.value !== "none") note2(`${named} labeled`);
  note2(`${money(total)} exported`);

  applyHide();
  setDownloads(true);
  say(note ? "info" : "", note || "");
}
function applyHide() {
  const hide = els.hideAnswer.checked || !current;
  els.caption.classList.toggle("hidden", hide);
}

async function generate() {
  const id = els.country.value;
  const name = els.country.selectedOptions[0]?.textContent || id;
  const want = parseInt(els.year.value, 10);
  if (!id || !want) {
    say("err", "Pick a country and a year first.");
    return;
  }
  if (!ID_OK.test(id)) {
    say("err", "That country id doesn't look valid, so nothing was requested.");
    return;
  }
  if (want < 1995 || want > THIS_YEAR) {
    say("err", `Pick a year between 1995 and ${THIS_YEAR}.`);
    return;
  }

  els.go.disabled = true;
  els.go.replaceChildren(
    Object.assign(document.createElement("span"), { className: "spinner" }),
    "Fetching…",
  );
  say("", "");

  try {
    let products = [],
      used = want,
      note = "";
    for (let y = want; y >= Math.max(1995, want - 6); y--) {
      products = await fetchYear(id, y);
      if (products.length) {
        used = y;
        break;
      }
    }
    if (!products.length)
      throw new Error(
        `No data for ${name} around ${want}. Try an earlier year, or add a token if you're after the newest data.`,
      );
    if (used !== want)
      note = `${want} isn't published yet for this country — showing ${used} instead.`;
    render(products, name, used, note);
  } catch (err) {
    const blocked = err instanceof TypeError; // fetch itself failed = network or CORS
    if (blocked) {
      say(
        "err",
        "The browser blocked the request. Two fixes: serve this file over a local server (",
        "python3 -m http.server",
        ") instead of opening it directly, or use “Load the data by hand” in the panel.",
      );
    } else {
      say("err", clip(err.message || err, 300));
    }
  } finally {
    els.go.disabled = false;
    els.go.textContent = "Generate treemap";
  }
}

/* ───────── downloads ───────── */
function svgText() {
  const clone = current.svg.cloneNode(true);
  clone.setAttribute("xmlns", SVGNS);
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
}
function fileName(ext) {
  const slug =
    String(current.countryName)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "country";
  return `${slug}-exports-${String(current.year).replace(/\D/g, "")}.${ext}`;
}
function saveBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function downloadSvg() {
  if (!current) return;
  saveBlob(new Blob([svgText()], { type: "image/svg+xml" }), fileName("svg"));
}
function setDownloads(on) {
  els.dlPng.disabled = els.dlJpg.disabled = els.dlSvg.disabled = !on;
}

/* PNG and JPG both go through a canvas; only the encoding differs.
   The white backdrop matters for JPG, which has no transparency to fall back on. */
function downloadRaster(kind) {
  if (!current) return;
  const k = parseInt(els.scale.value, 10);
  const blob = new Blob([svgText()], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = current.W * k;
    c.height = current.H * k;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    const jpg = kind === "jpg";
    c.toBlob(
      (b) => {
        if (!b) return say("err", "The image couldn't be encoded. The SVG download still works.");
        saveBlob(b, fileName(jpg ? "jpg" : "png"));
      },
      jpg ? "image/jpeg" : "image/png",
      jpg ? 0.92 : undefined,
    );
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    say("err", "The image couldn't be rendered. The SVG download still works.");
  };
  img.src = url;
}

/* ───────── manual data path ───────── */
function currentUrl() {
  return dataUrl(els.country.value, parseInt(els.year.value, 10));
}
function warnIfToken() {
  if (els.token.value.trim())
    say("info", "That URL carries your API token — treat it like a password.");
}
els.copyUrl.onclick = async () => {
  try {
    await navigator.clipboard.writeText(currentUrl());
    els.copyUrl.textContent = "Copied";
  } catch {
    els.manualJson.value = currentUrl();
    els.copyUrl.textContent = "URL put in the box";
  }
  warnIfToken();
  setTimeout(() => (els.copyUrl.textContent = "Copy query URL"), 1800);
};
els.openUrl.onclick = () => {
  warnIfToken();
  window.open(currentUrl(), "_blank", "noopener,noreferrer");
};
const MAX_PASTE = 8e6; // ~8 MB, far above any real response

els.useJson.onclick = () => {
  try {
    const raw = els.manualJson.value;
    if (raw.length > MAX_PASTE) throw new Error("That's too large to parse here.");
    const products = toProducts(JSON.parse(raw));
    if (!products.length) throw new Error("That response has no product rows in it.");
    render(
      products,
      els.country.selectedOptions[0]?.textContent || "Unknown",
      parseInt(els.year.value, 10),
      "Drawn from pasted data.",
    );
  } catch (e) {
    say("err", "Couldn't read that: " + clip(e.message || e, 200));
  }
};

/* ───────── wiring ───────── */
els.go.onclick = generate;
els.dlPng.onclick = () => downloadRaster("png");
els.dlJpg.onclick = () => downloadRaster("jpg");
els.dlSvg.onclick = downloadSvg;
els.hideAnswer.onchange = applyHide;
els.cutoff.oninput = () => {
  els.cutoffVal.textContent = parseFloat(els.cutoff.value).toFixed(2) + "%";
};
els.country.onchange = () => setDownloads(false);

/* these only change how the chart is drawn, so redraw the data already in hand */
const redraw = () => {
  if (lastData) render(lastData.products, lastData.countryName, lastData.year, "");
};
els.labels.onchange = redraw;
els.ratio.onchange = redraw;
els.width.onchange = redraw;
els.cutoff.onchange = redraw;
loadCountries();
