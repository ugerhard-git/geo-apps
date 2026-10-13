/**
 * Export treemaps — product groups and the OEC data source.
 */

/**
 * HS sections, in the OEC's order: name and colour. Colours are hand-matched
 * to the look of the OEC's own treemaps — tweak any hex here and everything
 * downstream follows.
 *
 * @type {Record<number, [string, string]>}
 */
export const SECTIONS = {
  1: ["Animal Products", "#c4636b"],
  2: ["Vegetable Products", "#7da544"],
  3: ["Animal & Vegetable Bi-Products", "#a7c957"],
  4: ["Foodstuffs", "#e8a33d"],
  5: ["Mineral Products", "#7b4b3a"],
  6: ["Chemical Products", "#db7093"],
  7: ["Plastics & Rubbers", "#8a6fb0"],
  8: ["Animal Hides", "#96455a"],
  9: ["Wood Products", "#b08968"],
  10: ["Paper Goods", "#cbb79a"],
  11: ["Textiles", "#6fa8a0"],
  12: ["Footwear & Headwear", "#d98282"],
  13: ["Stone & Glass", "#8fa6b2"],
  14: ["Precious Metals", "#e5c04b"],
  15: ["Metals", "#9aa3aa"],
  16: ["Machines", "#4a90c2"],
  17: ["Transportation", "#315f8c"],
  18: ["Instruments", "#79bccb"],
  19: ["Weapons", "#5e6b75"],
  20: ["Miscellaneous", "#b5afa6"],
  21: ["Arts & Antiques", "#4e8f87"],
};
/** @type {[string, string]} */
export const OTHER = ["Unclassified", "#c8cdd1"];

/** Offline country list ("<OEC id> <name>|…"), used only if the live list can't be fetched. */
export const FALLBACK_COUNTRIES = `
afdza Algeria|afago Angola|afbfa Burkina Faso|afbwa Botswana|afcmr Cameroon|afcod DR Congo|afcog Congo|afciv Côte d'Ivoire|afegy Egypt|afeth Ethiopia|afgab Gabon|afgha Ghana|afken Kenya|aflby Libya|afmar Morocco|afmdg Madagascar|afmli Mali|afmoz Mozambique|afmus Mauritius|afnam Namibia|afnga Nigeria|afrwa Rwanda|afsen Senegal|afsdn Sudan|aftun Tunisia|aftza Tanzania|afuga Uganda|afzaf South Africa|afzmb Zambia|afzwe Zimbabwe|
asafg Afghanistan|asare United Arab Emirates|asarm Armenia|asaze Azerbaijan|asbgd Bangladesh|asbhr Bahrain|asbrn Brunei|aschn China|asgeo Georgia|ashkg Hong Kong|asidn Indonesia|asind India|asirn Iran|asirq Iraq|asisr Israel|asjor Jordan|asjpn Japan|askaz Kazakhstan|askgz Kyrgyzstan|askhm Cambodia|askor South Korea|askwt Kuwait|aslao Laos|aslbn Lebanon|aslka Sri Lanka|asmmr Myanmar|asmng Mongolia|asmys Malaysia|asnpl Nepal|asomn Oman|aspak Pakistan|asphl Philippines|asqat Qatar|assau Saudi Arabia|assgp Singapore|assyr Syria|astha Thailand|astjk Tajikistan|astkm Turkmenistan|astur Turkey|astwn Taiwan|asuzb Uzbekistan|asvnm Vietnam|asyem Yemen|
eualb Albania|euaut Austria|eubel Belgium|eubgr Bulgaria|eubih Bosnia and Herzegovina|eublr Belarus|euche Switzerland|eucze Czechia|eudeu Germany|eudnk Denmark|euesp Spain|euest Estonia|eufin Finland|eufra France|eugbr United Kingdom|eugrc Greece|euhrv Croatia|euhun Hungary|euirl Ireland|euisl Iceland|euita Italy|eultu Lithuania|eulux Luxembourg|eulva Latvia|eumda Moldova|eumkd North Macedonia|eumlt Malta|eumne Montenegro|eunld Netherlands|eunor Norway|eupol Poland|euprt Portugal|eurou Romania|eurus Russia|eusrb Serbia|eusvk Slovakia|eusvn Slovenia|euswe Sweden|euukr Ukraine|
nabhs Bahamas|nacan Canada|nacri Costa Rica|nacub Cuba|nadom Dominican Republic|nagtm Guatemala|nahnd Honduras|nahti Haiti|najam Jamaica|namex Mexico|nanic Nicaragua|napan Panama|naslv El Salvador|natto Trinidad and Tobago|nausa United States|
ocaus Australia|ocfji Fiji|ocncl New Caledonia|ocnzl New Zealand|ocpng Papua New Guinea|ocslb Solomon Islands|ocvut Vanuatu|ocwsm Samoa|
saarg Argentina|sabol Bolivia|sabra Brazil|sachl Chile|sacol Colombia|saecu Ecuador|saguy Guyana|saper Peru|sapry Paraguay|sasur Suriname|saury Uruguay|saven Venezuela`;

/** The OEC's Tesseract API. */
export const API = "https://api-v2.oec.world/tesseract";

/** The shape of an OEC country id ("eudeu"); ids reach URLs, so they are checked. */
export const ID_OK = /^[A-Za-z0-9_-]{2,16}$/;

/** A response should never be able to hang the tab. */
export const MAX_ROWS = 20000;
