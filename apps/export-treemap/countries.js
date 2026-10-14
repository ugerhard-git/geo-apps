/**
 * Export treemaps — the countries offered in the picker.
 *
 * Names come from the Unicode CLDR, like every other app's country search, so
 * "Czechia", "Czech Republic" and "CZ" all find the same place. Each one is
 * matched to its OEC id through the ISO alpha-3 code at the end of that id
 * ("eudeu" → DEU). OEC entries CLDR can't place are kept under the OEC's own
 * name, and if CLDR can't be reached at all the OEC list is used on its own.
 */

import { loadAlpha3, loadTerritories } from "../../shared/cldr.js";
import { ID_OK } from "./config.js";
import { clip, loadCountryList } from "./oec.js";

/**
 * @typedef {object} Choice
 * @property {string} code shown next to the name: ISO alpha-2, or alpha-3 for OEC-only entries
 * @property {string} name
 * @property {string[]} alts other names and codes the search answers to
 * @property {string} oecId e.g. "eudeu"
 */

/** @param {string} oecId */
const alpha3Of = (oecId) => oecId.slice(-3).toUpperCase();

/**
 * Join CLDR's names onto the OEC's country list.
 *
 * @param {Array<{id: unknown, name: unknown}>} oecList
 * @param {import("../../shared/cldr.js").Territory[] | null} territories
 * @param {Map<string, string> | null} alpha3 alpha-2 → alpha-3
 * @returns {Choice[]} sorted by name
 */
export function joinChoices(oecList, territories, alpha3) {
  /** @type {Map<string, {id: string, name: string}>} OEC entries by alpha-3 */
  const byA3 = new Map();
  for (const c of oecList) {
    const id = String(c.id);
    if (ID_OK.test(id)) byA3.set(alpha3Of(id), { id, name: clip(c.name, 80) });
  }

  /** @type {Choice[]} */
  const out = [];
  if (territories && alpha3) {
    for (const t of territories) {
      const a3 = alpha3.get(t.code);
      const oec = a3 && byA3.get(a3);
      if (!a3 || !oec) continue;
      byA3.delete(a3);
      const alts = [...t.alts, a3];
      if (oec.name && oec.name !== t.name) alts.push(oec.name);
      out.push({ code: t.code, name: t.name, alts, oecId: oec.id });
    }
  }
  // Whatever CLDR didn't cover (or everything, without CLDR).
  for (const [a3, oec] of byA3) {
    if (oec.name) out.push({ code: a3, name: oec.name, alts: [a3], oecId: oec.id });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Load everything the picker needs.
 *
 * @param {number} year picks the OEC dataset whose country list is used
 * @returns {Promise<{choices: Choice[], note: string}>}
 */
export async function loadChoices(year) {
  const [oec, cldr] = await Promise.all([
    loadCountryList(year),
    Promise.all([loadTerritories(), loadAlpha3()]).catch(() => null),
  ]);
  const choices = joinChoices(oec.list, cldr && cldr[0], cldr && cldr[1]);
  return { choices, note: oec.note };
}
