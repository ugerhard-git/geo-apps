/**
 * Climate charts — monthly climate normals from Open-Meteo's daily history.
 *
 * Open-Meteo has no monthly endpoint, so thirty years of daily values are
 * fetched once per place and averaged here: temperatures as the mean of the
 * daily values, precipitation as the mean of each year's monthly total.
 *
 * The response is untrusted: its size is capped, every series is checked to
 * be an array of the expected length holding numbers or nulls, and dates
 * must have the expected form.
 */

import { fetchBytes } from "../../shared/net.js";
import { cleanText } from "../../shared/text.js";
import { ARCHIVE_URL, MAX_BYTES, MIN_YEARS, PERIOD } from "./config.js";

/**
 * @typedef {object} Normals
 * @property {Array<number | null>} mean monthly mean temperature, °C (index 0 = January)
 * @property {Array<number | null>} high mean daily maximum, °C
 * @property {Array<number | null>} low mean daily minimum, °C
 * @property {Array<number | null>} precip mean monthly total, mm
 * @property {number | null} elevation of the grid point, metres
 */

const SERIES = [
  "temperature_2m_mean",
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_sum",
];

/**
 * The request for a place. Coordinates are numbers checked here, so nothing
 * else can end up in the query string.
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {string}
 */
export function archiveUrl(lat, lon) {
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) throw new Error("bad coordinates");
  const q = new URLSearchParams({
    latitude: lat.toFixed(3),
    longitude: lon.toFixed(3),
    start_date: `${PERIOD.from}-01-01`,
    end_date: `${PERIOD.to}-12-31`,
    daily: SERIES.join(","),
    timezone: "GMT",
  });
  return `${ARCHIVE_URL}?${q}`;
}

/** @param {unknown} v */
const numOrNull = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Average thirty years of daily values into twelve months.
 *
 * @param {any} data parsed Open-Meteo response
 * @returns {Normals}
 * @throws when the response does not have the expected shape
 */
export function normalsFrom(data) {
  const daily = data && data.daily;
  const time = daily && daily.time;
  if (!Array.isArray(time) || time.length > 40 * 366) throw new Error("unexpected response");
  /** @type {Record<string, unknown[]>} */
  const cols = {};
  for (const s of SERIES) {
    const col = daily[s];
    if (!Array.isArray(col) || col.length !== time.length) throw new Error("unexpected response");
    cols[s] = col;
  }

  // Per month: sums and counts of the daily temperatures, and per year-month the rain.
  const tSum = [new Float64Array(12), new Float64Array(12), new Float64Array(12)];
  const tN = [new Uint32Array(12), new Uint32Array(12), new Uint32Array(12)];
  /** @type {Map<number, {sum: number, n: number, days: number}>} key: year*12 + month */
  const rain = new Map();
  for (let i = 0; i < time.length; i++) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof time[i] === "string" ? time[i] : "");
    if (!m) continue;
    const year = +m[1];
    const month = +m[2] - 1;
    if (month < 0 || month > 11) continue;
    for (let k = 0; k < 3; k++) {
      const v = numOrNull(cols[SERIES[k]][i]);
      if (v !== null && v > -90 && v < 60) {
        tSum[k][month] += v;
        tN[k][month]++;
      }
    }
    const key = year * 12 + month;
    const r = rain.get(key) || {
      sum: 0,
      n: 0,
      days: new Date(Date.UTC(year, month + 1, 0)).getUTCDate(),
    };
    const p = numOrNull(cols.precipitation_sum[i]);
    if (p !== null && p >= 0 && p < 2000) {
      r.sum += p;
      r.n++;
    }
    rain.set(key, r);
  }

  const minDays = MIN_YEARS * 28;
  const temp = (/** @type {number} */ k) =>
    Array.from({ length: 12 }, (_, mo) => (tN[k][mo] >= minDays ? tSum[k][mo] / tN[k][mo] : null));
  const pSum = new Float64Array(12);
  const pYears = new Uint32Array(12);
  for (const [key, r] of rain) {
    if (r.n < r.days) continue; // only complete months count towards a total
    pSum[key % 12] += r.sum;
    pYears[key % 12]++;
  }
  const elevation = numOrNull(data.elevation);
  return {
    mean: temp(0),
    high: temp(1),
    low: temp(2),
    precip: Array.from({ length: 12 }, (_, mo) =>
      pYears[mo] >= MIN_YEARS ? pSum[mo] / pYears[mo] : null,
    ),
    elevation: elevation !== null && elevation > -500 && elevation < 9000 ? elevation : null,
  };
}

/** @type {Map<string, Promise<Normals>>} one request per place per visit */
const cache = new Map();

/**
 * Climate normals for a place.
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<Normals>}
 */
export function loadNormals(lat, lon) {
  const url = archiveUrl(lat, lon);
  let job = cache.get(url);
  if (!job) {
    job = fetchArchive(url);
    cache.set(url, job);
    job.catch(() => cache.delete(url)); // a failure can be retried
  }
  return job;
}

/** @param {string} url */
async function fetchArchive(url) {
  let bytes;
  try {
    bytes = await fetchBytes(url, MAX_BYTES, () => {});
  } catch (e) {
    const status = e && /** @type {any} */ (e).status;
    if (status === 429)
      throw new Error("Open-Meteo is limiting requests — try again in a minute", { cause: e });
    throw e;
  }
  const data = JSON.parse(new TextDecoder().decode(bytes));
  if (data && data.error)
    throw new Error(cleanText(data.reason, 120) || "Open-Meteo refused the request");
  return normalsFrom(data);
}

/**
 * Yearly figures for the footnote: mean temperature and total precipitation.
 *
 * @param {Normals} n
 * @returns {{mean: number | null, precip: number | null}}
 */
export function annual(n) {
  const days = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (n.mean.some((v) => v === null) || n.precip.some((v) => v === null))
    return { mean: null, precip: null };
  const mean = n.mean.reduce((s, v, i) => s + /** @type {number} */ (v) * days[i], 0) / 365.25;
  const precip = n.precip.reduce((s, v) => s + /** @type {number} */ (v), 0);
  return { mean, precip };
}
