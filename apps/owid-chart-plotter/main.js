/**
 * OWID chart plotter — load any Our World in Data chart's CSV, pick countries
 * and years, and draw it as one of six chart types; export a PNG (without
 * country names, for quiz clues) or a trimmed CSV.
 *
 *   data.js        CSV → dataset, plus formatting helpers (pure)
 *   owid.js        slugs and fetching from ourworldindata.org
 *   charts.js      Chart.js config per chart type
 *   export-png.js  the 2400 × 1600 PNG
 *   checker.js     the "check every preset" tool
 *   main.js        this file: state, the form, rendering, wiring
 */

import { $ } from "../../shared/dom.js";
import { downloadBlob } from "../../shared/sheet.js";
import { setupPresetChecker } from "./checker.js";
import { buildConfig, isSingleYear, MAX_SERIES, PALETTE, TYPE_NAMES } from "./charts.js";
import { buildData, csvCell, fmt, safeName, series } from "./data.js";
import { renderExport } from "./export-png.js";
import { fetchCSV, splitSlug } from "./owid.js";

/** @typedef {import("./data.js").Dataset} Dataset */
/** @typedef {import("./charts.js").ChartType} ChartType */
/** @typedef {import("./charts.js").View} View */

/** @param {string} id */
const select = (id) => /** @type {HTMLSelectElement} */ ($(id));
/** @param {string} id */
const input = (id) => /** @type {HTMLInputElement} */ ($(id));
/** @param {string} id */
const button = (id) => /** @type {HTMLButtonElement} */ ($(id));

const els = {
  form: $("form"),
  preset: select("preset"),
  slug: input("slug"),
  load: button("load"),
  rows: $("rows"),
  valcol: select("valcol"),
  valcollbl: $("valcollbl"),
  search: input("search"),
  picker: $("picker"),
  chips: $("chips"),
  types: $("types"),
  y0: select("y0"),
  y1: select("y1"),
  yearhint: $("yearhint"),
  title: input("title"),
  scale: select("scale"),
  marks: select("marks"),
  names: select("names"),
  bg: select("bg"),
  status: $("status"),
  kicker: $("kicker"),
  ctitle: $("ctitle"),
  csub: $("csub"),
  stamp: $("stamp"),
  canvas: /** @type {HTMLCanvasElement} */ ($("chart")),
  png: button("png"),
  csv: button("csv"),
  paste: /** @type {HTMLTextAreaElement} */ ($("paste")),
  usepaste: button("usepaste"),
  usefile: button("usefile"),
  file: input("file"),
};

/* ═══════════════════════════════════════════════════════════
   State
   ═══════════════════════════════════════════════════════════ */

/** The loaded dataset. */
let data = /** @type {Dataset | null} */ (null);
/** The loaded CSV and its source, so the value-column picker can re-parse without re-fetching. */
let lastCsv = /** @type {{text: string, source: string} | null} */ (null);
/** Entity names to plot, in colour order. */
let picked = /** @type {string[]} */ ([]);
let type = /** @type {ChartType} */ ("line");
/** The on-screen Chart.js instance. */
let chart = /** @type {any} */ (null);

const yearFrom = () => parseInt(els.y0.value, 10);
const yearTo = () => parseInt(els.y1.value, 10);

/**
 * What the form currently asks for. A doughnut can't be log-scaled, so asking
 * for one switches the scale back to linear.
 *
 * @returns {View}
 */
function readView() {
  if (type === "donut" && els.scale.value === "log") els.scale.value = "linear";
  return {
    type,
    picked,
    y0: yearFrom(),
    y1: yearTo(),
    marks: els.marks.value === "on",
    scale: els.scale.value,
    names: els.names.value,
    bg: els.bg.value,
  };
}

/* ═══════════════════════════════════════════════════════════
   Status line
   ═══════════════════════════════════════════════════════════ */

/**
 * Built as text, never HTML: messages carry the slug the user typed and error
 * text that can quote CSV column names, neither of which is trustworthy markup.
 *
 * @param {"ok" | "err" | "load"} kind
 * @param {string} msg
 */
function setStatus(kind, msg) {
  els.status.className = "status" + (kind === "err" ? " err" : kind === "ok" ? " ok" : "");
  els.status.textContent = "";
  if (kind === "load") {
    const spin = document.createElement("span");
    spin.className = "spin";
    els.status.appendChild(spin);
  }
  els.status.appendChild(document.createTextNode(msg));
}

/* ═══════════════════════════════════════════════════════════
   Loading a dataset
   ═══════════════════════════════════════════════════════════ */

/**
 * Parse CSV text and make it the current dataset. Throws if it's unusable.
 *
 * @param {string} text
 * @param {string} sourceLabel
 * @param {string} [preferCol]
 */
function ingest(text, sourceLabel, preferCol) {
  const prevLabel = data ? data.fullLabel : null;
  const d = (data = buildData(text, sourceLabel, preferCol));
  lastCsv = { text, source: sourceLabel };
  renderValCol(d);
  els.rows.textContent = d.entities.length + " entities · " + d.years.length + " years";
  els.search.disabled = false;
  els.y0.disabled = false;
  els.y1.disabled = false;
  fillYears(d.years);
  renderPicker();
  // Adopt the new column's name as the title if the box is empty or still
  // holds the previous column's name (so switching column doesn't leave a
  // stale title).
  const t = els.title.value.trim();
  if (!t || t === prevLabel) els.title.value = d.fullLabel;
  // No default selection; anything already picked is kept if the new dataset has it too.
  picked = picked.filter((e) => d.byEntity.has(e));
  renderChips();
  draw();
  setStatus("ok", "Loaded " + d.entities.length + " entities from " + sourceLabel + ".");
}

/**
 * Fetch a dataset by reference ("slug", "slug?query#Column", or a grapher URL).
 *
 * @param {string} raw
 */
async function load(raw) {
  const { display, slug, colHint, base } = splitSlug(raw);
  if (!slug) {
    setStatus("err", "Enter a chart slug first.");
    return;
  }
  els.slug.value = display;
  // Keep the dropdown in sync when the reference matches a listed dataset.
  if ([...els.preset.options].some((o) => o.value === display)) els.preset.value = display;
  setStatus("load", "Fetching “" + base + "” from Our World in Data…");
  try {
    const text = await fetchCSV(slug);
    ingest(text, "ourworldindata.org/grapher/" + base, colHint);
  } catch (err) {
    setStatus(
      "err",
      "Could not load that dataset. " +
        /** @type {Error} */ (err).message +
        " If you are offline, or the browser blocked the request, use “Paste a CSV instead” at the bottom of the form.",
    );
  }
}

/**
 * The value-column picker only appears when the CSV genuinely offers a choice.
 *
 * @param {Dataset} d
 */
function renderValCol(d) {
  const choices = d.numericChoices;
  const show = choices.length > 1;
  els.valcol.style.display = show ? "" : "none";
  els.valcollbl.style.display = show ? "" : "none";
  if (!show) return;
  els.valcol.textContent = "";
  for (const name of choices) {
    const o = document.createElement("option");
    o.value = name;
    o.textContent = name;
    if (name === d.valColName) o.selected = true;
    els.valcol.appendChild(o);
  }
}

/**
 * Fill both year selects and default to 1950 – last year, as far as the data
 * reaches.
 *
 * @param {number[]} years ascending
 */
function fillYears(years) {
  const mkOptions = () => {
    const frag = document.createDocumentFragment();
    for (const y of years) {
      const o = document.createElement("option");
      o.value = String(y);
      o.textContent = String(y);
      frag.appendChild(o);
    }
    return frag;
  };
  els.y0.textContent = "";
  els.y0.appendChild(mkOptions());
  els.y1.textContent = "";
  els.y1.appendChild(mkOptions());
  const first = years[0];
  const last = years[years.length - 1];
  /** @param {number} target */
  const nearest = (target) =>
    years.reduce((b, y) => (Math.abs(y - target) < Math.abs(b - target) ? y : b), first);
  const wantFrom = 1950;
  const wantTo = new Date().getFullYear() - 1;
  els.y0.value = String(wantFrom <= first ? first : wantFrom >= last ? first : nearest(wantFrom));
  els.y1.value = String(wantTo >= last ? last : nearest(wantTo));
  if (yearTo() < yearFrom()) {
    els.y0.value = String(first);
    els.y1.value = String(last);
  }
}

/* ═══════════════════════════════════════════════════════════
   Country picker and chips

   Entity names come from the CSV, which may be pasted, uploaded or fetched
   from a slug the user supplies — so they are untrusted input, and these are
   built with DOM calls rather than innerHTML.
   ═══════════════════════════════════════════════════════════ */

function renderPicker() {
  if (!data) return;
  const q = els.search.value.trim().toLowerCase();
  const list = data.entities
    .filter((e) => !picked.includes(e) && (!q || e.toLowerCase().includes(q)))
    .slice(0, 300);
  els.picker.textContent = "";
  if (!list.length) {
    const empty = document.createElement("div");
    empty.style.cssText = "padding:9px;font-size:12.5px;color:var(--ink-soft)";
    empty.textContent = "No match.";
    els.picker.appendChild(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  for (const e of list) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.e = e;
    b.textContent = e;
    frag.appendChild(b);
  }
  els.picker.appendChild(frag);
}

/** One removable chip per picked entity, showing its latest value in range. */
function renderChips() {
  const d = data;
  if (!d) return;
  els.chips.textContent = "";
  const frag = document.createDocumentFragment();
  picked.forEach((e, i) => {
    const s = series(d, e, yearFrom(), yearTo());
    const last = s.length ? s[s.length - 1].v : null;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.style.setProperty("--c", PALETTE[i % PALETTE.length]);
    b.dataset.e = e;
    b.title = "Remove " + e;
    const val = document.createElement("b");
    val.textContent = last === null ? "–" : fmt(last);
    const x = document.createElement("i");
    x.textContent = "×";
    b.append(document.createTextNode(e + " "), val, document.createTextNode(" "), x);
    frag.appendChild(b);
  });
  els.chips.appendChild(frag);
  renderPicker();
}

/**
 * The entity named by the clicked button, if any.
 *
 * @param {Event} ev
 */
const clickedEntity = (ev) =>
  /** @type {HTMLElement | undefined} */ (
    /** @type {Element} */ (ev.target).closest("button[data-e]")
  )?.dataset.e;

/* ═══════════════════════════════════════════════════════════
   Drawing
   ═══════════════════════════════════════════════════════════ */

/** Redraw the chart and its headings from the form. */
function draw() {
  if (!data) return;
  if (chart) {
    chart.destroy();
    chart = null;
  }
  const t = els.title.value.trim() || data.fullLabel;
  const y0 = yearFrom();
  const y1 = yearTo();
  const single = isSingleYear(type);
  els.yearhint.textContent = single
    ? "This chart type uses the “To” year only: " + y1 + "."
    : type === "change"
      ? "Compares " + y0 + " with " + y1 + "."
      : "Range shown: " + y0 + "–" + y1 + ".";

  els.ctitle.textContent = t;
  els.kicker.textContent = TYPE_NAMES[type] + " · " + (single ? y1 : y0 + "–" + y1);
  els.csub.textContent = picked.length
    ? picked.join(" · ") + (data.unit ? "  —  measured in " + data.unit : "")
    : "Add at least one country in the form.";
  els.stamp.textContent = "Data: " + data.source;

  if (!picked.length) {
    els.png.disabled = els.csv.disabled = true;
    return;
  }
  els.png.disabled = els.csv.disabled = false;

  try {
    chart = new Chart(
      /** @type {CanvasRenderingContext2D} */ (els.canvas.getContext("2d")),
      buildConfig(data, readView(), 1),
    );
  } catch (err) {
    chart = null;
    els.png.disabled = els.csv.disabled = true;
    setStatus("err", "Could not draw this chart: " + /** @type {Error} */ (err).message);
  }
}

/* ═══════════════════════════════════════════════════════════
   Exports
   ═══════════════════════════════════════════════════════════ */

async function exportPng() {
  if (!data || !picked.length) return;
  const view = readView();
  els.png.disabled = true;
  const prevLabel = els.png.textContent;
  els.png.textContent = "Rendering…";
  try {
    const out = await renderExport({
      data,
      view,
      title: els.ctitle.textContent || "",
      stamp: els.stamp.textContent || "",
    });
    const name =
      safeName(els.slug.value) +
      "-" +
      type +
      "-2400x1600" +
      (view.bg === "transparent" ? "-transparent" : "") +
      ".png";
    out.toBlob((blob) => blob && downloadBlob(blob, name), "image/png");
    setStatus("ok", "Exported a 2400 × 1600 PNG with a " + view.bg + " background.");
  } catch (err) {
    setStatus("err", "Export failed: " + /** @type {Error} */ (err).message);
  } finally {
    els.png.disabled = false;
    els.png.textContent = prevLabel;
  }
}

/** The picked series over the chosen years, as Entity,Year,Value. */
function exportCsv() {
  const d = data;
  if (!d) return;
  const y0 = yearFrom();
  const y1 = yearTo();
  const lines = ["Entity,Year," + csvCell(d.fullLabel)];
  for (const e of picked)
    for (const p of series(d, e, y0, y1)) lines.push(csvCell(e) + "," + p.y + "," + p.v);
  downloadBlob(
    new Blob([lines.join("\n")], { type: "text/csv" }),
    safeName(els.slug.value) + "-" + y0 + "-" + y1 + ".csv",
  );
}

/* ═══════════════════════════════════════════════════════════
   Wiring
   ═══════════════════════════════════════════════════════════ */

els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  load(els.slug.value);
});
els.load.addEventListener("click", () => load(els.slug.value));
els.preset.addEventListener("change", () => {
  els.slug.value = els.preset.value;
  els.title.value = "";
  load(els.preset.value);
});
els.valcol.addEventListener("change", () => {
  if (lastCsv) ingest(lastCsv.text, lastCsv.source, els.valcol.value);
});

els.picker.addEventListener("click", (ev) => {
  const e = clickedEntity(ev);
  if (!e) return;
  if (picked.length >= MAX_SERIES) {
    setStatus("err", "Eight series is the limit — remove one first.");
    return;
  }
  picked.push(e);
  renderChips();
  draw();
});
els.chips.addEventListener("click", (ev) => {
  const e = clickedEntity(ev);
  if (!e) return;
  picked = picked.filter((x) => x !== e);
  renderChips();
  draw();
});
els.search.addEventListener("input", renderPicker);

els.types.addEventListener("click", (e) => {
  const b = /** @type {HTMLElement | null} */ (
    /** @type {Element} */ (e.target).closest("button[data-t]")
  );
  if (!b) return;
  type = /** @type {ChartType} */ (b.dataset.t);
  for (const x of els.types.querySelectorAll("button"))
    x.setAttribute("aria-pressed", String(x === b));
  draw();
});

els.y0.addEventListener("change", () => {
  if (yearFrom() > yearTo()) els.y1.value = els.y0.value;
  draw();
});
els.y1.addEventListener("change", () => {
  if (yearTo() < yearFrom()) els.y0.value = els.y1.value;
  draw();
});
for (const el of [els.scale, els.marks, els.names, els.bg]) el.addEventListener("change", draw);
els.title.addEventListener("input", () => {
  if (chart) draw();
});

els.png.addEventListener("click", exportPng);
els.csv.addEventListener("click", exportCsv);

els.usepaste.addEventListener("click", () => {
  try {
    ingest(els.paste.value, "pasted CSV");
  } catch (err) {
    setStatus("err", /** @type {Error} */ (err).message);
  }
});
els.usefile.addEventListener("click", () => els.file.click());
els.file.addEventListener("change", () => {
  const f = els.file.files?.[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      ingest(String(r.result), f.name);
    } catch (err) {
      setStatus("err", /** @type {Error} */ (err).message);
    }
  };
  r.readAsText(f);
});

setupPresetChecker({
  preset: els.preset,
  run: button("checkrun"),
  stop: button("checkstop"),
  progress: $("checkprog"),
  out: $("checkout"),
});

load("life-expectancy");
