/**
 * API keys, remembered once and shared by every app.
 *
 * All apps are served from the same origin (on GitHub Pages:
 * `https://<user>.github.io`), so they share the browser's `localStorage`.
 * A key saved here under a service name is therefore available to every app
 * that uses that service, and the overview page can list and forget them.
 *
 * Keys only ever live in the visitor's browser. They are never part of the
 * repository or the published site. Saving is always opt-in.
 *
 * To add a service, add an entry to {@link SERVICES} and use
 * `getKey("<id>")` / `saveKey("<id>", key)` in the app.
 *
 * @module shared/keys
 */

/**
 * @typedef {object} Service
 * @property {string} id short identifier used in the storage key
 * @property {string} name human-readable name
 * @property {string} url where to get a key
 * @property {string[]} usedBy app folders that use the key
 * @property {string[]} [legacyKeys] older storage keys to migrate from
 */

/** Every service any app stores a key for. */
export const SERVICES = /** @type {const} */ ({
  restcountries: {
    id: "restcountries",
    name: "REST Countries",
    url: "https://restcountries.com/",
    usedBy: ["geocards"],
    legacyKeys: ["geocards.key", "meridian.key"],
  },
});

const PREFIX = "geo-apps.key.";

/** @param {string} id */
const storageKey = (id) => PREFIX + id;

/**
 * Browser storage is optional: private windows and strict settings can block
 * it, so every access is guarded and failure means "nothing stored".
 */
const store = {
  /** @param {string} k */
  get(k) {
    try {
      return window.localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  /** @param {string} k @param {string} v */
  set(k, v) {
    try {
      window.localStorage.setItem(k, v);
      return true;
    } catch {
      return false;
    }
  },
  /** @param {string} k */
  del(k) {
    try {
      window.localStorage.removeItem(k);
    } catch {
      /* nothing to do */
    }
  },
};

/**
 * Keys for services the apps no longer use. They are deleted from the
 * visitor's browser the next time any app or the overview loads, so nothing
 * unused lingers there.
 */
const RETIRED = ["geo-apps.key.oec"];
for (const k of RETIRED) store.del(k);

/**
 * Whether this browser lets the page store anything at all.
 *
 * @returns {boolean}
 */
export function canRemember() {
  const probe = PREFIX + "__probe";
  if (!store.set(probe, "1")) return false;
  store.del(probe);
  return true;
}

/**
 * The saved key for a service, or `""`. Keys saved by older versions of the
 * apps are moved to the shared name the first time they are read.
 *
 * @param {keyof typeof SERVICES} id
 * @returns {string}
 */
export function getKey(id) {
  const saved = store.get(storageKey(id));
  if (saved) return saved;
  for (const legacy of SERVICES[id].legacyKeys || []) {
    const old = store.get(legacy);
    if (old) {
      store.set(storageKey(id), old);
      store.del(legacy);
      return old;
    }
  }
  return "";
}

/**
 * Remember a key for every app.
 *
 * @param {keyof typeof SERVICES} id
 * @param {string} key
 * @returns {boolean} `false` when the browser refused to store it
 */
export function saveKey(id, key) {
  return store.set(storageKey(id), key);
}

/**
 * Forget a service's key, including any copy under an older name.
 *
 * @param {keyof typeof SERVICES} id
 */
export function forgetKey(id) {
  store.del(storageKey(id));
  for (const legacy of SERVICES[id].legacyKeys || []) store.del(legacy);
}
