/**
 * Tiny, dependency-free helpers used by almost every app.
 * @module shared/util
 */

/**
 * Read `obj[key]` only when it is the object's *own* property, so data from an
 * API can never reach `__proto__`, `constructor` and friends.
 *
 * @template T
 * @param {Record<string, T> | null | undefined} obj
 * @param {string} key
 * @returns {T | undefined}
 */
export const own = (obj, key) =>
  obj && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;

/**
 * Limit `value` to the range `[min, max]`.
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * A small, fast, seeded pseudo-random generator (xorshift32). The same seed
 * always gives the same sequence, which keeps "shuffle" buttons reproducible.
 *
 * @param {number} seed
 * @returns {() => number} a function returning numbers in `[0, 1)`
 */
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}
