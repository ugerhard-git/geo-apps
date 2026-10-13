/**
 * Alphabets — the letters of a country's languages, from CLDR, on a quiz
 * sheet or as copyable text.
 *
 * Flow: pick a country → CLDR lists the languages spoken there and which have
 * character data → tick up to four → each is drawn as a grid of letters,
 * optionally with a sample sentence → export or copy.
 */

import { safeColour } from "../../shared/colour.js";
import { createCountryPicker } from "../../shared/country-picker.js";
import { $, bindColour, debounce, isPressed, progress, setSeg } from "../../shared/dom.js";
import { canvasToBlob, downloadBlob, hashSlug } from "../../shared/sheet.js";
import { cleanText, norm } from "../../shared/text.js";
import { CLDR_VERSION } from "../../shared/cldr.js";
import {
  buildAlphabet,
  countryList,
  hasCharacters,
  languageName,
  languagesFor,
  loadCore,
  sampleSentence,
  scriptVariants,
} from "./cldr-data.js";
import { MAX_CELLS, MAX_LANGS, NPM_CDN, URL_TERRITORY_INFO } from "./config.js";
import { ensureFonts } from "./fonts.js";
import { drawSheet, fontFor, genericHeading } from "./render.js";

/** @typedef {import("./cldr-data.js").Alphabet} Alphabet */

/* ═══════════════════════════════════════════════════════════
   State
   ═══════════════════════════════════════════════════════════ */

/** @type {Array<{code: string, name: string}>} */
let COUNTRIES = [];
/** ISO code of the chosen country, or "". */
let chosenCountry = "";
/** @type {Alphabet[]} the alphabets on the sheet */
let charts = [];
/** @type {Array<{locale: string, name: string, official: boolean, share: number}>} languages on offer */
let available = [];
/** Incremented by every redraw, so a slow one can tell it has been overtaken. */
let busy = 0;

/**
 * This app's note box marks errors with its border colour rather than a class.
 *
 * @param {string} [msg]
 * @param {boolean} [isErr]
 */
function note(msg, isErr) {
  const n = $("note");
  n.textContent = msg || "";
  n.style.borderLeftColor = isErr ? "var(--mark)" : "var(--rule)";
}

/** @returns {import("./render.js").SheetOptions} */
function currentOptions() {
  return {
    fg: safeColour($("fgColor").value, "#191b1c"),
    bg: safeColour($("bgColor").value, "#f7f5f0"),
    transparent: $("optTransparent").checked,
    aux: $("optAux").checked,
    sentence: $("optSentence").checked,
    pairs: $("optPairs").checked,
    caption: cleanText($("capText").value, 120),
    capTop: isPressed("capTop"),
    names: $("optNames").checked,
    generic: cleanText($("genericLabel").value, 40),
  };
}

/* ═══════════════════════════════════════════════════════════
   Refresh
   ═══════════════════════════════════════════════════════════ */

/** Load what the sheet needs (fonts, sample text), then redraw it. */
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
  const families = new Set(charts.map((c) => fontFor(c.script)));
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
  const { warning } = drawSheet($("sheet"), charts, opts);
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
      warning,
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
  /**
   * @param {string} term
   * @param {string} href
   * @param {string} label
   */
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
  /** @param {string} url */
  const short = (url) => url.replace(NPM_CDN + "/", "");
  for (const c of charts) {
    row(`${c.name} — letters`, c.url, short(c.url));
    if ($("optSentence").checked && c.sentence)
      row(`${c.name} — sample text`, c.sentence.url, short(c.sentence.url));
  }
  row("Country to language mapping", URL_TERRITORY_INFO, short(URL_TERRITORY_INFO));
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

/**
 * The alphabets as plain text, in the format chosen under "Copy as text".
 *
 * @returns {string}
 */
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

/**
 * @param {string} type MIME type
 * @param {string} ext file extension
 */
async function exportSheet(type, ext) {
  const canvas = document.createElement("canvas");
  const opts = currentOptions();
  if (type === "image/jpeg" && opts.transparent) opts.transparent = false; // JPEG has no alpha
  drawSheet(canvas, charts, opts);
  const blob = await canvasToBlob(canvas, type);
  if (!blob) {
    note("The browser refused to encode the image.", true);
    return;
  }
  // The filename shouldn't give away what the sheet deliberately hides.
  const slug = opts.names
    ? charts
        .map((c) => c.locale)
        .join("-")
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "")
    : hashSlug(charts.map((c) => c.locale).join("|"));
  downloadBlob(blob, `alphabet-${slug || "sheet"}.${ext}`);
}

/* ═══════════════════════════════════════════════════════════
   Country picking
   ═══════════════════════════════════════════════════════════ */

const picker = createCountryPicker({
  items: () => COUNTRIES,
  forms: (c) => [c.name],
  code: (c) => c.code,
  label: (c) => c.name,
  normalise: norm,
  onPick: (c) => {
    if (!c) return;
    chosenCountry = c.code;
    $("country").value = c.name;
    picker.close();
    onCountryChange();
  },
});

/* ═══════════════════════════════════════════════════════════
   Language picker
   ═══════════════════════════════════════════════════════════ */

/** List the chosen country's languages that CLDR has letters for, and show the first. */
async function onCountryChange() {
  const code = chosenCountry;
  charts = [];
  available = [];
  $("langs").replaceChildren();
  note("");
  await refresh();
  if (!code) return;
  progress("Looking up languages", true);
  const candidates = [];
  for (const entry of languagesFor(code))
    for (const locale of scriptVariants(entry.lang))
      candidates.push({ locale, official: entry.official, share: entry.share });
  const probes = await Promise.all(
    candidates.map(async (c) =>
      (await hasCharacters(c.locale))
        ? { locale: c.locale, name: languageName(c.locale), official: c.official, share: c.share }
        : null,
    ),
  );
  const found = probes.filter((p) => p !== null);
  progress(null);
  available = found;
  if (!found.length) {
    note("CLDR has no character data for the languages it lists for this country.", true);
    return;
  }
  renderLangs();
  await toggleLanguage(found[0].locale, true);
}

/** The language checkboxes. */
function renderLangs() {
  $("langs").replaceChildren(
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

/**
 * Add or remove a language's alphabet.
 *
 * @param {string} locale
 * @param {boolean} on
 */
async function toggleLanguage(locale, on) {
  if (on) {
    if (charts.length >= MAX_LANGS) {
      note(`${MAX_LANGS} alphabets is as many as fit on one sheet legibly.`);
      renderLangs();
      return;
    }
    try {
      progress("Reading CLDR", true);
      charts.push(await buildAlphabet(locale));
    } catch {
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

$("langs").addEventListener("change", (/** @type {Event} */ e) => {
  const cb = /** @type {HTMLElement} */ (e.target).closest("input[type=checkbox]");
  if (cb) toggleLanguage(/** @type {HTMLInputElement} */ (cb).dataset.locale || "", cb.checked);
});

$("genericLabel").addEventListener("input", debounce(refresh, 300));

for (const id of ["optAux", "optSentence", "optPairs", "optTransparent", "optNames"])
  $(id).addEventListener("change", () => {
    if (id === "optTransparent") syncExportState();
    refresh();
  });

bindColour("fgColor", "fgHex", refresh);
bindColour("bgColor", "bgHex", refresh);

const refreshAfterCaption = debounce(refresh, 300);
$("capText").addEventListener("input", () => {
  $("capPosField").hidden = !cleanText($("capText").value, 120);
  refreshAfterCaption();
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
  } catch {
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
