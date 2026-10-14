/**
 * Export treemaps — pick a country and get its exports as a treemap, sized by
 * value and coloured by product group.
 *
 *   config.js  product groups (HS sections) and the OEC data source
 *   oec.js     the OEC API: country list and one country's exports
 *   countries.js  the picker's country list (CLDR names joined to OEC ids)
 *   treemap.js the squarified layout (pure)
 *   chart.js   drawing the SVG: headline, blocks, labels, legend
 *   main.js    this file: page state, rendering, downloads, wiring
 */

import { createCountryPicker } from "../../shared/country-picker.js";
import { $ } from "../../shared/dom.js";
import { canRemember, forgetKey, getKey, saveKey } from "../../shared/keys.js";
import { downloadBlob } from "../../shared/sheet.js";
import { addLabels, drawChart, el, money, resetMeasurements, SVGNS } from "./chart.js";
import { ID_OK } from "./config.js";
import { loadChoices } from "./countries.js";
import { clip, dataUrl, fetchYear, toProducts } from "./oec.js";

/** @typedef {import("./oec.js").Product} Product */
/** @typedef {import("./countries.js").Choice} Choice */

const els = {
  country: /** @type {HTMLInputElement} */ ($("country")),
  countrySrc: $("countrySrc"),
  year: /** @type {HTMLInputElement} */ ($("year")),
  token: /** @type {HTMLInputElement} */ ($("token")),
  rememberToken: /** @type {HTMLInputElement} */ ($("rememberToken")),
  ratio: /** @type {HTMLSelectElement} */ ($("ratio")),
  width: /** @type {HTMLSelectElement} */ ($("width")),
  cutoff: /** @type {HTMLInputElement} */ ($("cutoff")),
  cutoffVal: $("cutoffVal"),
  labels: /** @type {HTMLSelectElement} */ ($("labels")),
  hideAnswer: /** @type {HTMLInputElement} */ ($("hideAnswer")),
  go: /** @type {HTMLButtonElement} */ ($("go")),
  dlPng: /** @type {HTMLButtonElement} */ ($("dlPng")),
  dlJpg: /** @type {HTMLButtonElement} */ ($("dlJpg")),
  dlSvg: /** @type {HTMLButtonElement} */ ($("dlSvg")),
  scale: /** @type {HTMLSelectElement} */ ($("scale")),
  stage: $("stage"),
  caption: $("caption"),
  msg: $("msg"),
  manualJson: /** @type {HTMLTextAreaElement} */ ($("manualJson")),
  useJson: $("useJson"),
  copyUrl: $("copyUrl"),
  openUrl: $("openUrl"),
};

/** Every country on offer, and the one picked. */
let choices = /** @type {Choice[]} */ ([]);
let chosen = /** @type {Choice | null} */ (null);

/** The last rendered chart, for downloads. */
let current =
  /** @type {{svg: SVGElement, countryName: string, year: number, W: number, H: number} | null} */ (
    null
  );
/** The last fetched products, so the drawing controls can redraw without refetching. */
let lastData = /** @type {{products: Product[], countryName: string, year: number} | null} */ (
  null
);

const THIS_YEAR = new Date().getFullYear();
els.year.max = String(THIS_YEAR);
els.year.value = String(THIS_YEAR - 2);

/** The OEC token as typed, or "" for free access. */
const token = () => els.token.value.trim();

/* ═══════════════════════════════════════════════════════════
   Messages
   ═══════════════════════════════════════════════════════════ */

/**
 * Show a message under the chart. Messages can carry text from the API or
 * from pasted JSON, so they are assembled as text nodes and never parsed as
 * HTML.
 *
 * @param {"" | "info" | "err"} kind
 * @param {string} text "" clears the message
 * @param {string} [code] shown in monospace after `text`
 * @param {string} [tail] plain text after `code`
 */
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

/* ═══════════════════════════════════════════════════════════
   Country list
   ═══════════════════════════════════════════════════════════ */

const picker = createCountryPicker({
  items: () => choices,
  forms: (c) => [c.name, ...c.alts],
  code: (c) => c.code,
  label: (c) => c.name,
  onPick: (c) => {
    chosen = c;
    els.country.value = c.name;
    picker.close();
    setDownloads(false);
    generate();
  },
});

/** Typing after a pick means a new search, so the old pick no longer counts. */
els.country.addEventListener("input", () => {
  if (chosen && els.country.value !== chosen.name) chosen = null;
});

async function loadCountries() {
  const loaded = await loadChoices(+els.year.value, token());
  choices = loaded.choices;
  els.country.disabled = false;
  els.country.placeholder = `${choices.length} countries — name or code`;
  els.countrySrc.textContent = loaded.note;
}

/* ═══════════════════════════════════════════════════════════
   Rendering
   ═══════════════════════════════════════════════════════════ */

/**
 * Draw `products` into the stage and fill in the caption.
 *
 * @param {Product[]} products
 * @param {string} countryName
 * @param {number} year
 * @param {string} note shown as an info message; "" for none
 */
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

  // The SVG has to be on the page before any text can be measured.
  const svg = el("svg", { xmlns: SVGNS, viewBox: `0 0 ${W} ${H}`, width: W, height: H });
  els.stage.replaceChildren(svg);

  resetMeasurements();
  const boxes = drawChart(svg, kept, total, W, H);
  const named = addLabels(svg, boxes, els.labels.value);
  current = { svg, countryName, year, W, H };

  els.caption.replaceChildren();
  const strong = document.createElement("strong");
  strong.textContent = countryName; // country names come from the API
  els.caption.appendChild(strong);
  /** @param {string} t */
  const part = (t) => {
    const sp = document.createElement("span");
    sp.textContent = t;
    els.caption.appendChild(sp);
  };
  part(String(year));
  part(`${kept.length} of ${products.length} products shown`);
  if (els.labels.value !== "none") part(`${named} labeled`);
  part(`${money(total)} exported`);

  applyHide();
  setDownloads(true);
  say(note ? "info" : "", note || "");
}

function applyHide() {
  const hide = els.hideAnswer.checked || !current;
  els.caption.classList.toggle("hidden", hide);
}

/** Fetch the chosen country and year (stepping back up to six years) and draw it. */
async function generate() {
  const id = chosen ? chosen.oecId : "";
  const name = chosen ? chosen.name : "";
  const want = parseInt(els.year.value, 10);
  if (!id || !want) {
    say("err", "Pick a country from the list and a year first.");
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
    /** @type {Product[]} */
    let products = [];
    let used = want;
    let note = "";
    for (let y = want; y >= Math.max(1995, want - 6); y--) {
      products = await fetchYear(id, y, token());
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
      const e = /** @type {any} */ (err);
      say("err", clip(e.message || e, 300));
    }
  } finally {
    els.go.disabled = false;
    els.go.textContent = "Generate treemap";
  }
}

/* ═══════════════════════════════════════════════════════════
   Downloads
   ═══════════════════════════════════════════════════════════ */

/** @param {boolean} on */
function setDownloads(on) {
  els.dlPng.disabled = els.dlJpg.disabled = els.dlSvg.disabled = !on;
}

/** @param {SVGElement} svg */
function svgText(svg) {
  const clone = /** @type {SVGElement} */ (svg.cloneNode(true));
  clone.setAttribute("xmlns", SVGNS);
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
}

/**
 * "germany-exports-2023.png"
 *
 * @param {{countryName: string, year: number}} chart
 * @param {string} ext
 */
function fileName(chart, ext) {
  const slug =
    String(chart.countryName)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "country";
  return `${slug}-exports-${String(chart.year).replace(/\D/g, "")}.${ext}`;
}

function downloadSvg() {
  if (!current) return;
  downloadBlob(
    new Blob([svgText(current.svg)], { type: "image/svg+xml" }),
    fileName(current, "svg"),
  );
}

/**
 * PNG and JPG both go through a canvas; only the encoding differs. The white
 * backdrop matters for JPG, which has no transparency to fall back on.
 *
 * @param {"png" | "jpg"} kind
 */
function downloadRaster(kind) {
  if (!current) return;
  const chart = current;
  const k = parseInt(els.scale.value, 10);
  const blob = new Blob([svgText(chart.svg)], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = chart.W * k;
    c.height = chart.H * k;
    const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext("2d"));
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    const jpg = kind === "jpg";
    c.toBlob(
      (b) => {
        if (!b) return say("err", "The image couldn't be encoded. The SVG download still works.");
        downloadBlob(b, fileName(chart, jpg ? "jpg" : "png"));
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

/* ═══════════════════════════════════════════════════════════
   Loading data by hand, for when the browser blocks the API
   ═══════════════════════════════════════════════════════════ */

/** ~8 MB, far above any real response. */
const MAX_PASTE = 8e6;

const currentUrl = () => dataUrl(chosen ? chosen.oecId : "", parseInt(els.year.value, 10), token());

function warnIfToken() {
  if (token()) say("info", "That URL carries your API token — treat it like a password.");
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

els.useJson.onclick = () => {
  try {
    const raw = els.manualJson.value;
    if (raw.length > MAX_PASTE) throw new Error("That's too large to parse here.");
    const products = toProducts(JSON.parse(raw));
    if (!products.length) throw new Error("That response has no product rows in it.");
    render(
      products,
      chosen ? chosen.name : "Unknown",
      parseInt(els.year.value, 10),
      "Drawn from pasted data.",
    );
  } catch (e) {
    const err = /** @type {any} */ (e);
    say("err", "Couldn't read that: " + clip(err.message || err, 200));
  }
};

/* ═══════════════════════════════════════════════════════════
   The API token, shared with the other geo apps (see shared/keys.js)
   ═══════════════════════════════════════════════════════════ */

const saved = getKey("oec");
if (saved) {
  els.token.value = saved;
  els.rememberToken.checked = true;
}
if (!canRemember()) els.rememberToken.disabled = true;

function storeToken() {
  if (els.rememberToken.checked && token()) saveKey("oec", token());
  else forgetKey("oec");
}
els.rememberToken.onchange = storeToken;
els.token.addEventListener("change", () => {
  if (els.rememberToken.checked) storeToken();
});

/* ═══════════════════════════════════════════════════════════
   Wiring
   ═══════════════════════════════════════════════════════════ */

els.go.onclick = generate;
els.dlPng.onclick = () => downloadRaster("png");
els.dlJpg.onclick = () => downloadRaster("jpg");
els.dlSvg.onclick = downloadSvg;
els.hideAnswer.onchange = applyHide;
els.cutoff.oninput = () => {
  els.cutoffVal.textContent = parseFloat(els.cutoff.value).toFixed(2) + "%";
};

// These only change how the chart is drawn, so redraw the data already in hand.
const redraw = () => {
  if (lastData) render(lastData.products, lastData.countryName, lastData.year, "");
};
els.labels.onchange = redraw;
els.ratio.onchange = redraw;
els.width.onchange = redraw;
els.cutoff.onchange = redraw;

loadCountries();
