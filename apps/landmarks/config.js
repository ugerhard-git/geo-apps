/**
 * Landmarks — settings.
 */

/** Most photographs on one sheet. */
export const MAX_SELECTED = 6;

/*
  Render widths: a small one for the gallery, a large one only for the photos
  on the sheet. Both are among Wikimedia's standard thumbnail widths, which
  are pre-rendered and cached; other widths are rendered on request, slowly.
*/
export const THUMB_W = 330;
export const FULL_W = 1280;

/** How many other photographs to offer from a landmark's Commons category. */
export const ALT_PHOTOS = 30;

/** Limits on a data file, well above what the data script writes. */
export const MAX_ITEMS = 200;
