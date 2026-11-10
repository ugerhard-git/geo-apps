/**
 * Day length — sunrise, sunset and twilight through a year, in a place's
 * local clock time.
 *
 * Pure functions, so they can be tested without a browser:
 *   sunEvents      sunrise, sunset and solar noon on one day, in UTC (NOAA's
 *                  solar equations), or whether the sun stays up or down
 *   utcOffset      a time zone's offset from UTC at one moment, from the
 *                  JavaScript runtime's own time-zone rules (summer time too)
 *   yearOfDays     every day of a year, in local clock time
 *   extremes       the longest and the shortest day
 *
 * NOAA's equations (the "General Solar Position Calculations" of NOAA's
 * Global Monitoring Laboratory) are accurate to about a minute away from the
 * poles, plenty for a chart of a year.
 */

/** The sun's centre this far below the horizon: sunrise and sunset (refraction and the sun's radius). */
export const SUNRISE_ZENITH = 90.833;
/** Civil twilight ends when the sun is 6° below the horizon. */
export const CIVIL_ZENITH = 96;

const RAD = Math.PI / 180;

/**
 * Sunrise, sunset and solar noon on one day, in minutes after midnight UTC.
 *
 * @param {number} lat degrees
 * @param {number} lon degrees, east positive
 * @param {number} dayOfYear 1 = 1 January
 * @param {number} zenith SUNRISE_ZENITH or CIVIL_ZENITH
 * @param {number} daysInYear 365 or 366
 * @returns {{rise: number, set: number, noon: number} | "day" | "night"}
 *   "day" when the sun never sinks that far, "night" when it never rises
 */
export function sunEvents(lat, lon, dayOfYear, zenith, daysInYear = 365) {
  const g = ((2 * Math.PI) / daysInYear) * (dayOfYear - 1);
  // The equation of time (minutes) and the sun's declination (radians).
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  const phi = lat * RAD;
  const cosHa =
    Math.cos(zenith * RAD) / (Math.cos(phi) * Math.cos(decl)) - Math.tan(phi) * Math.tan(decl);
  if (cosHa > 1) return "night";
  if (cosHa < -1) return "day";
  const ha = Math.acos(cosHa) / RAD;
  const noon = 720 - 4 * lon - eqTime;
  return { rise: noon - 4 * ha, set: noon + 4 * ha, noon };
}

/** One formatter per time zone: making them is slow, using them is fast. */
const formatters = new Map();

/**
 * A time zone's offset from UTC at one moment, in minutes (Madrid: 60 in
 * winter, 120 in summer).
 *
 * @param {string} tz IANA time zone
 * @param {number} utcMs the moment, as milliseconds since 1970 UTC
 */
export function utcOffset(tz, utcMs) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
    formatters.set(tz, f);
  }
  /** @type {Record<string, number>} */
  const p = {};
  for (const part of f.formatToParts(new Date(utcMs))) p[part.type] = Number(part.value);
  const local = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  // Rounded to whole minutes: the moment itself may have had seconds.
  return Math.round((local - Math.floor(utcMs / 60000) * 60000) / 60000);
}

/**
 * @typedef {object} Day
 * @property {number} day 0 = 1 January
 * @property {[number, number] | "day" | "night"} sun sunrise and sunset, in local
 *   hours after midnight (sunset can run past 24, sunrise below 0)
 * @property {[number, number] | "day" | "night"} twilight the same for civil twilight
 * @property {number} hours of daylight, 0–24
 */

/**
 * Every day of a year at one place, in its local clock time. Each sunrise
 * and sunset uses the time zone's offset at that very moment, so the jump
 * to summer time falls on the right morning.
 *
 * @param {{lat: number, lon: number, tz: string}} place
 * @param {number} year
 * @returns {Day[]}
 */
export function yearOfDays(place, year) {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = leap ? 366 : 365;
  const start = Date.UTC(year, 0, 1);
  /** @type {Day[]} */
  const out = [];
  for (let d = 0; d < days; d++) {
    const midnight = start + d * 86_400_000;
    /** @param {number} minutes after midnight UTC */
    const local = (minutes) => (minutes + utcOffset(place.tz, midnight + minutes * 60_000)) / 60;
    /** @param {ReturnType<typeof sunEvents>} e */
    const span = (e) =>
      typeof e === "string" ? e : /** @type {[number, number]} */ ([local(e.rise), local(e.set)]);
    const sun = sunEvents(place.lat, place.lon, d + 1, SUNRISE_ZENITH, days);
    out.push({
      day: d,
      sun: span(sun),
      twilight: span(sunEvents(place.lat, place.lon, d + 1, CIVIL_ZENITH, days)),
      // From the UTC times, so a change of clocks can't touch it.
      hours: sun === "day" ? 24 : sun === "night" ? 0 : (sun.set - sun.rise) / 60,
    });
  }
  return out;
}

/**
 * The longest and shortest day, in hours.
 *
 * @param {Day[]} days
 */
export function extremes(days) {
  const hours = days.map((d) => d.hours);
  return { longest: Math.max(...hours), shortest: Math.min(...hours) };
}

/**
 * Hours as a clock time: 21.17 → "21:10".
 *
 * @param {number} hours
 */
export function clockText(hours) {
  const total = Math.round(hours * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
