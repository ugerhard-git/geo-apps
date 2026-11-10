/**
 * Place-name endings — which endings make a country's place names typical,
 * worked out from GeoNames' list of places with at least 1,000 inhabitants.
 *
 * Pure functions, so they can be tested without a browser:
 *   mainWord      the word of a place name that carries its ending
 *   endingCounts  how many names end in each ending (2–6 letters)
 *   worldBaseline the same, for the whole world
 *   typicalEndings  a country's endings, by how much more it uses them
 *   pickTowns     a sample of real towns for the "Twelve towns" view
 *   splitEnding   a name split before its typical ending, for colouring it
 *
 * The idea: an ending is typical when a country uses it much more often than
 * the world as a whole. "-torp" is in 3% of Swedish place names and almost
 * nowhere else; "-on" is common everywhere and says nothing.
 */

/** @typedef {import("../../shared/geonames.js").City} City */

/**
 * @typedef {object} Ending
 * @property {string} text the ending, without the dash, in lower case
 * @property {number} count how many of the country's place names end in it
 */

/**
 * @typedef {object} Baseline
 * @property {Map<string, number>} counts names ending in each ending, worldwide
 * @property {number} total names, worldwide
 */

/** Endings are this many letters long, at least and at most. */
const MIN_LEN = 2;
const MAX_LEN = 6;

/**
 * Lower case, with Romanian ș and ț in one form (older data writes them with
 * a cedilla, ş and ţ), so the same ending is counted and found once.
 *
 * @param {string} text
 */
const fold = (text) => text.toLowerCase().replace(/ş/g, "ș").replace(/ţ/g, "ț");

/**
 * The word of a place name that carries its ending: the longest word, which
 * skips "Bad", "San", "Nowy" and "am Main" in favour of the name proper.
 * Lower case, so "Kraków" and "KRAKÓW" count as one.
 *
 * @param {string} name
 * @returns {string} "" when the name has no word of three letters or more
 */
export function mainWord(name) {
  const words = fold(String(name).normalize("NFC"))
    .split(/[\s\-–'’,.()/]+/)
    .filter((w) => /^\p{L}[\p{L}\p{M}]{2,}$/u.test(w));
  let best = "";
  for (const w of words) if (w.length > best.length) best = w;
  return best;
}

/**
 * Every ending of a word, from two letters up to six, leaving at least two
 * letters in front: "kraków" → "ów", "ków", "aków", "raków".
 *
 * @param {string} word
 * @returns {string[]}
 */
export function endingsOfWord(word) {
  const letters = [...word];
  /** @type {string[]} */
  const out = [];
  for (let n = MIN_LEN; n <= MAX_LEN && n <= letters.length - 2; n++)
    out.push(letters.slice(-n).join(""));
  return out;
}

/**
 * Each distinct main word once: districts or neighbours that share a name
 * ("Budapest XI. kerület" and the like) count as one place.
 *
 * @param {City[]} cities
 * @returns {string[]}
 */
export function distinctWords(cities) {
  const seen = new Set();
  for (const c of cities) {
    const w = mainWord(c.name || "");
    if (w) seen.add(w);
  }
  return [...seen];
}

/**
 * How many words end in each ending.
 *
 * @param {string[]} words
 * @returns {Map<string, number>}
 */
export function endingCounts(words) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const w of words) for (const e of endingsOfWord(w)) counts.set(e, (counts.get(e) || 0) + 1);
  return counts;
}

/**
 * The world's endings, to compare each country with.
 *
 * @param {Iterable<string[]>} wordLists each country's distinct main words
 * @returns {Baseline}
 */
export function worldBaseline(wordLists) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  let total = 0;
  for (const words of wordLists) {
    total += words.length;
    for (const [e, n] of endingCounts(words)) counts.set(e, (counts.get(e) || 0) + n);
  }
  return { counts, total };
}

/**
 * A country's typical endings, most telling first.
 *
 * An ending qualifies when at least 4 names (and 1.2% of them) end in it, and
 * the country uses it at least four times as often as the world. Endings are
 * ranked by count × log(how much more often), which favours endings that are
 * both common here and rare elsewhere.
 *
 * A cut-off ending is grown into the syllable most of its names share: "-rp"
 * becomes "-torp", and "-rg" in Germany splits into "-berg" and "-burg". Of
 * an ending and a longer or shorter form of it, only one is kept.
 *
 * @param {string[]} words the country's distinct main words
 * @param {Baseline} world
 * @param {number} limit at most this many
 * @returns {Ending[]}
 */
export function typicalEndings(words, world, limit) {
  const n = words.length;
  if (!n) return [];
  const counts = endingCounts(words);
  const minCount = Math.max(4, n * 0.012);
  /** @param {string} e @param {number} k */
  const lift = (e, k) => k / n / ((world.counts.get(e) || 1) / world.total);

  /**
   * @param {string} e
   * @param {number} k
   * @returns {Array<[string, number]>}
   */
  const grow = (e, k) => {
    const longer = [...counts]
      .filter(([x]) => [...x].length === [...e].length + 1 && x.endsWith(e))
      .sort((a, b) => b[1] - a[1]);
    if (longer[0] && longer[0][1] >= k * 0.7) return grow(longer[0][0], longer[0][1]);
    if (
      longer[1] &&
      [...e].length < 3 &&
      longer[0][1] + longer[1][1] >= k * 0.8 &&
      longer[1][1] >= k * 0.25
    )
      return [...grow(...longer[0]), ...grow(...longer[1])];
    return [[e, k]];
  };

  const ranked = [...counts]
    .filter(([e, k]) => k >= minCount && lift(e, k) >= 4)
    .sort((a, b) => b[1] * Math.log(lift(...b)) - a[1] * Math.log(lift(...a)))
    .flatMap(([e, k]) => grow(e, k))
    .filter(([e, k]) => k >= 4 && lift(e, k) >= 4);

  /** @type {Ending[]} */
  const chosen = [];
  for (const [text, count] of ranked) {
    const near = chosen.find((c) => c.text.endsWith(text) || text.endsWith(c.text));
    if (near) {
      // A longer form that still covers most of the places reads better.
      if ([...text].length > [...near.text].length && count >= near.count * 0.75) {
        near.text = text;
        near.count = count;
      }
      continue;
    }
    chosen.push({ text, count });
    if (chosen.length >= limit) break;
  }
  return chosen;
}

/**
 * A name split before its typical ending (the longest that fits), for
 * colouring the ending.
 *
 * @param {string} name
 * @param {Ending[]} endings
 * @returns {[string, string]} the name up to the ending, and the ending ("" for none)
 */
export function splitEnding(name, endings) {
  const whole = name.normalize("NFC");
  const lower = fold(whole);
  const hit = [...endings]
    .sort((a, b) => b.text.length - a.text.length)
    .find((e) => lower.endsWith(e.text) && lower.length > e.text.length);
  if (!hit) return [whole, ""];
  // Folding keeps every letter one character long, so the cut lines up.
  const at = whole.length - hit.text.length;
  return [whole.slice(0, at), whole.slice(at)];
}

/**
 * A sample of real place names: one word each (so they fit), from places
 * with at least `minPop` people, without the `skipLargest` biggest cities
 * (a capital would give the answer away).
 *
 * @param {City[]} cities largest first, as the loader sorts them
 * @param {number} n how many
 * @param {{minPop: number, skipLargest: number, random: () => number}} opts
 * @returns {string[]}
 */
export function pickTowns(cities, n, { minPop, skipLargest, random }) {
  const seen = new Set();
  const pool = cities.slice(skipLargest).filter((c) => {
    const name = c.name || "";
    if (c.pop < minPop || !/^\p{L}[\p{L}\p{M}'’]+$/u.test(name) || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
  // A partial shuffle: the first n of a random order.
  for (let i = 0; i < Math.min(n, pool.length); i++) {
    const j = i + Math.floor(random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n).map((c) => /** @type {string} */ (c.name));
}
