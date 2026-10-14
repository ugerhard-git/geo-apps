/**
 * City dots — settings and fixed data.
 */

/** How many cities can be drawn, and the default. */
export const COUNT_MIN = 5;
export const COUNT_MAX = 300;
export const COUNT_DEFAULT = 40;

/*
  A city counts as part of the mainland when it lies within this many
  degrees of one of the mainland's landmasses (its bounding box). Coastal
  towns sit just outside a 1:50m coastline, and a small island town near the
  coast belongs with it.
*/
export const MAINLAND_SLACK_DEG = 0.35;
