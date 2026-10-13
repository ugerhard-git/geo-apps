/**
 * Subdivision clouds — dropping a word every name repeats.
 *
 * Egypt's divisions all end in "Governorate", Nigeria's in "State", Russia's
 * in "Oblast" — a word that eats most of the tag while saying nothing. Some
 * countries carry it as a prefix instead: "Province of Buenos Aires".
 *
 * Pure functions, with unit tests in tests/unit/subdivisions.test.js.
 */

/** How many names must agree before a word counts as repeated. */
const AFFIX_SHARE = 0.6;
/** And how many names there must be at all. */
const AFFIX_MIN = 3;
/** Words left dangling once the affix is gone: "Province of Buenos Aires". */
const CONNECTORS = new Set(["of", "de", "del", "da", "du", "des", "della", "di", "the", "d"]);

/**
 * @typedef {object} Affix
 * @property {"prefix" | "suffix"} kind
 * @property {string} text e.g. "Autonomous Region"
 * @property {number} words how many words it is
 * @property {number} count how many names carry it
 */

/** @param {string} n */
const wordsOf = (n) => String(n).trim().split(/\s+/).filter(Boolean);

/**
 * The commonest run of `k` words at the start (or end) of the names.
 *
 * @param {string[]} names
 * @param {number} k
 * @param {boolean} fromEnd
 * @returns {{text: string, count: number} | null}
 */
function tally(names, k, fromEnd) {
  /** @type {Map<string, {text: string, count: number}>} */
  const counts = new Map();
  for (const n of names) {
    const w = wordsOf(n);
    if (w.length <= k) continue; // never swallow the whole name
    const part = fromEnd ? w.slice(w.length - k) : w.slice(0, k);
    const key = part.join(" ").toLowerCase();
    const got = counts.get(key) || { text: part.join(" "), count: 0 };
    got.count++;
    counts.set(key, got);
  }
  /** @type {{text: string, count: number} | null} */
  let best = null;
  for (const v of counts.values()) if (!best || v.count > best.count) best = v;
  return best;
}

/**
 * Find a word (or run of up to three) that most names share. The longest
 * repeated run wins, so "Autonomous Region" beats "Region".
 *
 * @param {string[]} names
 * @returns {Affix | null}
 */
export function detectAffix(names) {
  if (!Array.isArray(names) || names.length < AFFIX_MIN) return null;
  const need = Math.max(AFFIX_MIN, Math.ceil(names.length * AFFIX_SHARE));
  /** @type {Affix | null} */
  let best = null;
  for (const fromEnd of [true, false]) {
    for (let k = 3; k >= 1; k--) {
      const got = tally(names, k, fromEnd);
      if (!got || got.count < need) continue;
      /** @type {Affix} */
      const cand = {
        kind: fromEnd ? "suffix" : "prefix",
        text: got.text,
        words: k,
        count: got.count,
      };
      if (
        !best ||
        cand.words > best.words ||
        (cand.words === best.words && cand.count > best.count)
      )
        best = cand;
      break; // longest run for this side
    }
  }
  return best;
}

/**
 * Remove the affix from one name, along with any connector it leaves behind.
 *
 * @param {string} name
 * @param {Affix | null} affix
 * @returns {string}
 */
export function stripAffix(name, affix) {
  if (!affix) return name;
  const w = wordsOf(name);
  if (w.length <= affix.words) return name; // would leave nothing behind
  const part = (affix.kind === "suffix" ? w.slice(w.length - affix.words) : w.slice(0, affix.words))
    .join(" ")
    .toLowerCase();
  if (part !== affix.text.toLowerCase()) return name;
  let rest = affix.kind === "suffix" ? w.slice(0, w.length - affix.words) : w.slice(affix.words);
  // "Province of Buenos Aires" leaves a dangling "of"; so does the reverse.
  while (
    rest.length > 1 &&
    CONNECTORS.has(rest[affix.kind === "suffix" ? rest.length - 1 : 0].toLowerCase())
  )
    rest = affix.kind === "suffix" ? rest.slice(0, -1) : rest.slice(1);
  const out = rest.join(" ").replace(/^[\s,;:-]+|[\s,;:-]+$/g, "");
  return out || name;
}

/**
 * Strip the affix from every name. Shortening must not make two regions look
 * like the same one, so any name that would collide keeps its full form.
 *
 * @param {string[]} names
 * @param {Affix | null} affix
 * @returns {string[]}
 */
export function applyAffix(names, affix) {
  if (!affix) return names.map((n) => n);
  const stripped = names.map((n) => stripAffix(n, affix));
  /** @type {Map<string, number>} */
  const seen = new Map();
  for (const s of stripped) seen.set(s.toLowerCase(), (seen.get(s.toLowerCase()) || 0) + 1);
  return stripped.map((s, i) => ((seen.get(s.toLowerCase()) || 0) > 1 ? names[i] : s));
}
