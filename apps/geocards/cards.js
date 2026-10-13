/**
 * GeoCards — assembling the data for each chosen card.
 */

import { atlas, factbook, FB_EDITION, indicator } from "./data.js";
import { CARDS, ISO, RCS } from "./catalogue.js";

/* ============================================================
 6. Assembling card data
 ============================================================ */
/**
 * Fetch what the chosen cards need and build each one.
 *
 * @param {any} country
 * @param {string[]} ids card ids, in sheet order
 * @param {import("./data.js").DataSource} src
 * @param {(got: number, total: number) => void} [onProgress]
 */
export async function buildCards(country, ids, src, onProgress) {
  const list = await atlas(src, onProgress);
  const defs = ids.map((id) => CARDS.find((c) => c.id === id)).filter(Boolean);

  const codes = [...new Set(defs.filter((d) => d.wb).map((d) => d.wb))];
  const wb = new Map();
  let fb = null;
  await Promise.all([
    ...codes.map(async (code) => {
      try {
        wb.set(code, await indicator(code));
      } catch (e) {
        /* card degrades to Not reported */
      }
    }),
    (async () => {
      if (!defs.some((d) => d.fb)) return;
      try {
        fb = await factbook(country.iso3);
      } catch (e) {
        fb = null;
      }
    })(),
  ]);

  const ctx = {
    atlas: list,
    wb,
    fb,
    refSource: src.source === "rest" ? RCS : ISO,
    area: list.map((c) => c.area).filter((v) => typeof v === "number" && v > 0),
    bord: list.map((c) => c.borders.length),
  };

  return defs.map((def) => {
    const base = { id: def.id, label: def.label, kind: def.kind };
    try {
      const f = def.build(country, ctx);
      return f
        ? { ...base, ...f }
        : {
            ...base,
            kind: "empty",
            source: def.wb ? "World Bank" : def.fb ? FB_EDITION : ctx.refSource,
          };
    } catch (e) {
      return { ...base, kind: "empty", source: "" };
    }
  });
}
