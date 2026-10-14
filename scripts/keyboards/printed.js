/**
 * Keyboard layouts — what Windows' own data leaves out.
 *
 * Chinese, Japanese and Korean are typed through an input method, so their
 * Windows layouts are plain US Latin. Their keyboards are printed with a
 * second set of characters, which is exactly what makes them recognisable.
 * These are fixed, standard assignments, entered by hand:
 *
 *   Korean   Dubeolsik (KS X 5002), the standard Hangul layout
 *   Japanese JIS X 6002 kana, on the JIS keyboard (with its own Latin symbols)
 *   Taiwan   Zhuyin (Bopomofo), standard (Dai-chien) arrangement
 *   Hong Kong Cangjie radicals
 *
 * Each table gives position → native characters, "base" or "base shift".
 */

/** Hangul, Dubeolsik. Shift doubles five consonants and two vowels. */
export const HANGUL = {
  D01: "ㅂ ㅃ", D02: "ㅈ ㅉ", D03: "ㄷ ㄸ", D04: "ㄱ ㄲ", D05: "ㅅ ㅆ",
  D06: "ㅛ", D07: "ㅕ", D08: "ㅑ", D09: "ㅐ ㅒ", D10: "ㅔ ㅖ",
  C01: "ㅁ", C02: "ㄴ", C03: "ㅇ", C04: "ㄹ", C05: "ㅎ",
  C06: "ㅗ", C07: "ㅓ", C08: "ㅏ", C09: "ㅣ",
  B01: "ㅋ", B02: "ㅌ", B03: "ㅊ", B04: "ㅍ", B05: "ㅠ", B06: "ㅜ", B07: "ㅡ",
}; // prettier-ignore

/** Kana, JIS. Shift gives the small kana and the Japanese punctuation. */
export const KANA = {
  E01: "ぬ", E02: "ふ", E03: "あ ぁ", E04: "う ぅ", E05: "え ぇ", E06: "お ぉ",
  E07: "や ゃ", E08: "ゆ ゅ", E09: "よ ょ", E10: "わ を", E11: "ほ", E12: "へ", E13: "ー",
  D01: "た", D02: "て", D03: "い ぃ", D04: "す", D05: "か", D06: "ん",
  D07: "な", D08: "に", D09: "ら", D10: "せ", D11: "゛", D12: "゜ 「",
  C01: "ち", C02: "と", C03: "し", C04: "は", C05: "き", C06: "く",
  C07: "ま", C08: "の", C09: "り", C10: "れ", C11: "け", C12: "む 」",
  B01: "つ っ", B02: "さ", B03: "そ", B04: "ひ", B05: "こ", B06: "み",
  B07: "も", B08: "ね 、", B09: "る 。", B10: "め ・", B11: "ろ",
}; // prettier-ignore

/** The JIS keyboard's Latin legends, which differ from US: base and shift. */
export const JIS_LATIN = {
  E01: "1 !", E02: '2 "', E03: "3 #", E04: "4 $", E05: "5 %", E06: "6 &",
  E07: "7 '", E08: "8 (", E09: "9 )", E10: "0", E11: "- =", E12: "^ ~", E13: "¥ |",
  D01: "q Q", D02: "w W", D03: "e E", D04: "r R", D05: "t T", D06: "y Y",
  D07: "u U", D08: "i I", D09: "o O", D10: "p P", D11: "@ `", D12: "[ {",
  C01: "a A", C02: "s S", C03: "d D", C04: "f F", C05: "g G", C06: "h H",
  C07: "j J", C08: "k K", C09: "l L", C10: "; +", C11: ": *", C12: "] }",
  B01: "z Z", B02: "x X", B03: "c C", B04: "v V", B05: "b B", B06: "n N",
  B07: "m M", B08: ", <", B09: ". >", B10: "/ ?", B11: "\\ _",
}; // prettier-ignore

/** Zhuyin (Bopomofo), with the four tone marks on the number row. */
export const ZHUYIN = {
  E01: "ㄅ", E02: "ㄉ", E03: "ˇ", E04: "ˋ", E05: "ㄓ", E06: "ˊ", E07: "˙",
  E08: "ㄚ", E09: "ㄞ", E10: "ㄢ", E11: "ㄦ",
  D01: "ㄆ", D02: "ㄊ", D03: "ㄍ", D04: "ㄐ", D05: "ㄔ", D06: "ㄗ", D07: "ㄧ",
  D08: "ㄛ", D09: "ㄟ", D10: "ㄣ",
  C01: "ㄇ", C02: "ㄋ", C03: "ㄎ", C04: "ㄑ", C05: "ㄕ", C06: "ㄘ", C07: "ㄨ",
  C08: "ㄜ", C09: "ㄠ", C10: "ㄤ",
  B01: "ㄈ", B02: "ㄌ", B03: "ㄏ", B04: "ㄒ", B05: "ㄖ", B06: "ㄙ", B07: "ㄩ",
  B08: "ㄝ", B09: "ㄡ", B10: "ㄥ",
}; // prettier-ignore

/** Cangjie radicals, one per letter key. */
export const CANGJIE = {
  D01: "手", D02: "田", D03: "水", D04: "口", D05: "廿", D06: "卜", D07: "山",
  D08: "戈", D09: "人", D10: "心",
  C01: "日", C02: "尸", C03: "木", C04: "火", C05: "土", C06: "竹", C07: "十",
  C08: "大", C09: "中",
  B01: "重", B02: "難", B03: "金", B04: "女", B05: "月", B06: "弓", B07: "一",
}; // prettier-ignore

/**
 * Layouts printed beside a Latin layout other than US: the Maghreb's Arabic
 * AZERTY carries French letters.
 *
 * @type {Record<string, string>}
 */
export const LATIN_BESIDE = { "ar-azerty": "fr" };

/**
 * The hand-made layouts: an id, a name, the layout whose Latin legends they
 * share (or JIS_LATIN), the printed table, and the keyboard's shape.
 *
 * @type {Array<{id: string, name: string, latin: string | Record<string, string>, printed: Record<string, string>, shape: "ansi" | "jis"}>}
 */
export const PRINTED = [
  { id: "ko-dubeolsik", name: "Korean (Dubeolsik)", latin: "en", printed: HANGUL, shape: "ansi" },
  { id: "ja-jis", name: "Japanese (JIS kana)", latin: JIS_LATIN, printed: KANA, shape: "jis" },
  { id: "zh-zhuyin", name: "Chinese (Zhuyin)", latin: "en", printed: ZHUYIN, shape: "ansi" },
  { id: "zh-cangjie", name: "Chinese (Cangjie)", latin: "en", printed: CANGJIE, shape: "ansi" },
];
