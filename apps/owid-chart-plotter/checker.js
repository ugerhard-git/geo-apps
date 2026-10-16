/**
 * OWID chart plotter — the preset checker.
 *
 * Walks every dataset in the dropdown, fetches it and runs the same
 * buildData() the app uses, then reports what came back. Catches dead slugs
 * after an OWID rename, and shows which column each dataset actually parses
 * to, so a silently wrong column is visible rather than plausible-looking.
 */

import { buildData } from "./data.js";
import { fetchCSV, splitSlug } from "./owid.js";

/**
 * @param {boolean} ok
 * @param {string} name
 * @param {string} slug
 * @param {string} detail
 */
function ckRow(ok, name, slug, detail) {
  const div = document.createElement("div");
  div.className = "ckrow " + (ok ? "ok" : "bad");
  const mark = document.createElement("div");
  mark.className = "ckmark";
  mark.textContent = ok ? "✓" : "✕";
  const body = document.createElement("div");
  const n = document.createElement("span");
  n.className = "ckname";
  n.textContent = name;
  const s = document.createElement("span");
  s.className = "ckslug";
  s.textContent = "  " + slug;
  const d = document.createElement("div");
  d.className = "ckdetail";
  d.textContent = detail;
  body.append(n, s, d);
  div.append(mark, body);
  return div;
}

/**
 * Wire the checker's buttons.
 *
 * @param {object} els
 * @param {import("./presets.js").Preset[]} els.presets the charts to check
 * @param {HTMLButtonElement} els.run
 * @param {HTMLButtonElement} els.stop
 * @param {HTMLElement} els.progress
 * @param {HTMLElement} els.out
 */
export function setupPresetChecker({ presets, run, stop, progress, out }) {
  let abort = false;

  async function runCheck() {
    const opts = presets;
    abort = false;
    run.disabled = true;
    stop.disabled = false;
    out.textContent = "";
    const summary = document.createElement("p");
    summary.className = "cksum";
    out.appendChild(summary);

    let pass = 0;
    let fail = 0;
    let done = 0;
    for (const o of opts) {
      if (abort) break;
      progress.textContent = done + 1 + " / " + opts.length + " — " + o.slug;
      try {
        const ref = splitSlug(o.slug);
        const text = await fetchCSV(ref.slug);
        const d = buildData(text, ref.slug, ref.colHint);
        const bits = [
          "→ " + d.fullLabel,
          d.unit ? "unit " + d.unit : "no unit",
          d.entities.length + " entities",
          d.years[0] + "–" + d.years[d.years.length - 1],
        ];
        // More than one numeric column means the choice of column is a judgement call.
        if (d.otherNumeric.length) bits.push("also numeric: " + d.otherNumeric.join(", "));
        out.appendChild(ckRow(true, o.name, o.slug, bits.join(" · ")));
        pass++;
      } catch (err) {
        out.appendChild(ckRow(false, o.name, o.slug, /** @type {Error} */ (err).message));
        fail++;
      }
      done++;
      summary.textContent =
        pass + " ok, " + fail + " failing, " + done + " of " + opts.length + " checked";
      await new Promise((r) => setTimeout(r, 400)); // be polite to OWID; these CSVs are large
    }

    summary.textContent =
      pass +
      " ok, " +
      fail +
      " failing" +
      (abort ? " (stopped early at " + done + " of " + opts.length + ")" : "");
    progress.textContent = abort ? "Stopped." : "Done.";
    run.disabled = false;
    stop.disabled = true;
  }

  run.addEventListener("click", runCheck);
  stop.addEventListener("click", () => {
    abort = true;
    stop.disabled = true;
  });
}
