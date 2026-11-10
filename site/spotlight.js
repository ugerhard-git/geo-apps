/**
 * Overview page: which app is the app of the day, and which apps count as
 * new. Pure functions, so they can be tested without a browser.
 *
 * The app of the day comes from the date alone, so everyone sees the same app
 * on the same day. The apps are put in a fixed mixed order (by a hash of
 * their folder names) and each day takes the next one, so every app gets its
 * turn before any comes back, and two neighbours in the alphabet don't follow
 * each other.
 */

/** How long an app counts as new. */
export const NEW_DAYS = 21;

/**
 * The day as a whole number: days since 1 January 1970, by the calendar
 * where the visitor is (their midnight, not UTC's).
 *
 * @param {Date} date
 */
export const dayNumber = (date) =>
  Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);

/**
 * A small, stable hash of a text (FNV-1a), to mix up the order.
 *
 * @param {string} s
 */
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/**
 * The app of the day.
 *
 * @param {string[]} slugs every app's folder name (order doesn't matter)
 * @param {Date} date
 * @returns {string | null}
 */
export function appOfTheDay(slugs, date) {
  if (!slugs.length) return null;
  const order = [...slugs].sort((a, b) => hash(a) - hash(b) || a.localeCompare(b));
  return order[dayNumber(date) % order.length];
}

/**
 * Whether an app added on `added` (YYYY-MM-DD) is still new on `date`.
 *
 * @param {string} added
 * @param {Date} date
 */
export function isNew(added, date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(added || "");
  if (!m) return false;
  const age = dayNumber(date) - Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86_400_000);
  return age >= 0 && age < NEW_DAYS;
}
