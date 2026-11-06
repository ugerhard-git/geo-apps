/**
 * Geo imagery — presets: examples to start from. Used by shared/presets.js;
 * the first example is drawn on opening.
 *
 * Here a "look" is the imagery itself (night lights, relief, natural colour)
 * rather than a colour scheme: the picture is a satellite image. Countries are
 * named as Natural Earth names them, which is how this app finds them.
 */

/** @typedef {import("../../shared/presets.js").Example} Example */

/**
 * The imagery to choose from, as looks: the day or night button, then the
 * layer. Only layers that don't depend on a date, so a look always works.
 *
 * @type {Array<{id: string, name: string, night: boolean, layer: string}>}
 */
export const LOOKS = [
  { id: "lights", name: "Night lights", night: true, layer: "VIIRS_Black_Marble" },
  { id: "lights2012", name: "Night lights, 2012", night: true, layer: "VIIRS_CityLights_2012" },
  {
    id: "relief",
    name: "Relief, cloud-free",
    night: false,
    layer: "BlueMarble_ShadedRelief_Bathymetry",
  },
  {
    id: "natural",
    name: "Natural colour, cloud-free",
    night: false,
    layer: "BlueMarble_NextGeneration",
  },
];

/** @type {Example[]} */
export const EXAMPLES = [
  { id: "egypt", name: "Egypt — the Nile at night", look: "lights", country: "Egypt" },
  { id: "japan", name: "Japan — lit up", look: "lights", country: "Japan" },
  { id: "italy", name: "Italy — relief", look: "relief", country: "Italy" },
  { id: "iceland", name: "Iceland — natural colour", look: "natural", country: "Iceland" },
  { id: "chile", name: "Chile — relief", look: "relief", country: "Chile" },
];

/**
 * The controls for a look: day or night first (it decides the layer list),
 * then the layer.
 *
 * @param {{night: boolean, layer: string}} look
 */
export const lookToControls = (look) => ({
  press: [look.night ? "segNight" : "segDay"],
  set: { layer: look.layer },
});
