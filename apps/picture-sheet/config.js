/**
 * Picture Sheet — limits. They keep a careless or hostile file from using up
 * the browser's memory: every picture is checked against them before it is
 * decoded (see files.js and pictures.js).
 */

/** Most pictures held at once. */
export const MAX_PICTURES = 60;
/** Most pictures on one sheet. */
export const MAX_ON_SHEET = 12;

/** Largest file accepted, in bytes. A 50-megapixel phone photo is about 25 MB. */
export const MAX_FILE_BYTES = 40 * 1024 * 1024;
/**
 * Most pixels a picture may have, read from its header before decoding. A
 * small file can declare an enormous image (a "decompression bomb"); decoding
 * 60 megapixels takes about 240 MB, which every current browser can spare.
 */
export const MAX_PIXELS = 60e6;
/** Longest side a picture may declare, in pixels. */
export const MAX_SIDE = 20_000;
/** How much of a file is read to find its size: JPEG puts it after the EXIF data. */
export const HEADER_BYTES = 1024 * 1024;

/**
 * Each picture is kept at most this long on its longest side: a 4K screenshot
 * keeps every pixel, so a small part cropped from it stays sharp. The copy is
 * kept compressed.
 */
export const KEEP_SIDE = 4096;
/** A picture, or the part cropped from it, is decoded for the sheet at most this long. */
export const SHEET_SIDE = 2000;
/** The cropping window shows the picture at most this long. */
export const CROP_VIEW_SIDE = 2000;
/** The smallest part that can be cropped, in the kept copy's pixels. */
export const MIN_CROP_PX = 16;
/** A part narrower or shorter than this may look blurry on a large sheet. */
export const BLURRY_PX = 300;
/** The thumbnails in the tray. */
export const THUMB_SIDE = 240;

/** Longest label under a picture, and the longest credit line. */
export const MAX_LABEL = 60;
export const MAX_CREDIT = 160;
