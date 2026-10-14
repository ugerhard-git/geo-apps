/**
 * Climate charts — settings and fixed data.
 */

/** Open-Meteo's historical weather API: ERA5 reanalysis, free and keyless. */
export const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";

/** The standard climate normal period of the World Meteorological Organization. */
export const PERIOD = { from: 1991, to: 2020 };

/** Thirty years of four daily series is about 0.5 MB; refuse anything far larger. */
export const MAX_BYTES = 8 * 1024 * 1024;

/** A month's average needs at least this many years with that month complete. */
export const MIN_YEARS = 20;

/** How many of a country's largest towns are offered besides the capital. */
export const CITY_CHOICES = 30;

export const CREDIT = "Climate: Open-Meteo, ERA5 1991–2020 · CC BY 4.0";
