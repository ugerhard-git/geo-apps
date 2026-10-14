/**
 * GeoCards — choosing which statistics go on the sheet.
 *
 * Two parts, both in the sidebar:
 *   "On the sheet"  the chosen statistics, numbered in sheet order, each with
 *                   a remove button
 *   the catalogue   one collapsible group per theme ("People 3 of 8"), with a
 *                   checkbox per statistic
 *
 * Order matters: cards appear on the sheet in the order they were chosen, so
 * a newly ticked statistic goes to the end of the list.
 *
 * The catalogue is built once per `set()` and then only updated in place, so
 * ticking a box never replaces it — keyboard focus stays where it was.
 */

import { CARDS, GROUP_ORDER } from "./catalogue.js";

/** @typedef {(typeof CARDS)[number]} CardDef */

/**
 * The small markers after a statistic's name.
 *
 * @param {CardDef} c
 * @param {boolean} usable
 * @returns {HTMLElement[]}
 */
function markers(c, usable) {
  /** @type {HTMLElement[]} */
  const out = [];
  /**
   * @param {string} cls
   * @param {string} text
   * @param {string} title
   */
  const mark = (cls, text, title) => {
    const i = document.createElement("i");
    i.className = "mark " + cls;
    i.textContent = text;
    i.title = title;
    out.push(i);
  };
  if (c.reveals) mark("dot", "", "Gives the country away");
  if (c.fb) mark("frozen", "2026", "From the final CIA World Factbook edition, frozen in 2026");
  if (!usable) mark("key", "key", "Needs a REST Countries API key");
  return out;
}

/**
 * @param {string} label
 * @param {() => void} onClick
 */
function textButton(label, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.chosen the "On the sheet" list
 * @param {HTMLElement} opts.groups where the catalogue groups go
 * @param {(c: CardDef) => boolean} opts.isAvailable false for statistics that need an API key
 * @param {(selected: string[]) => void} opts.onChange called with the new selection, in sheet order
 */
export function createStatsPicker({ chosen, groups, isAvailable, onChange }) {
  /** @type {string[]} */
  let selected = [];
  const byId = new Map(CARDS.map((c) => [c.id, c]));
  /** Checkboxes by statistic id, and the "n of m" counters by group. */
  const boxes = new Map();
  const counts = new Map();

  /** @param {string[]} next */
  function commit(next) {
    selected = next;
    renderChosen();
    sync();
    onChange(selected);
  }

  /** @param {string} id @param {boolean} on */
  function toggle(id, on) {
    const has = selected.includes(id);
    if (on && !has) commit([...selected, id]);
    if (!on && has) commit(selected.filter((x) => x !== id));
  }

  function renderChosen() {
    if (!selected.length) {
      const li = document.createElement("li");
      li.className = "none";
      li.textContent = "Nothing yet. Tick statistics below.";
      chosen.replaceChildren(li);
      return;
    }
    chosen.replaceChildren(
      ...selected.map((id) => {
        const c = byId.get(id);
        const li = document.createElement("li");
        if (!c) return li;
        const name = document.createElement("span");
        name.className = "name";
        name.textContent = c.label;
        const remove = textButton("×", () => toggle(id, false));
        remove.className = "remove";
        remove.setAttribute("aria-label", "Remove " + c.label);
        li.append(name, ...markers(c, isAvailable(c)), remove);
        return li;
      }),
    );
  }

  /** Bring the checkboxes and group counts in line with `selected`. */
  function sync() {
    for (const [id, box] of boxes) box.checked = selected.includes(id);
    for (const [g, el] of counts) {
      const items = CARDS.filter((c) => c.group === g);
      const n = items.filter((c) => selected.includes(c.id)).length;
      el.textContent = `${n} of ${items.length}`;
      el.classList.toggle("some", n > 0);
    }
  }

  function buildGroups() {
    // Keep whichever groups were open across a rebuild.
    const open = new Set(
      [...groups.querySelectorAll("details[open]")].map((d) => d.getAttribute("data-group")),
    );
    boxes.clear();
    counts.clear();
    const sections = GROUP_ORDER.map((g) => {
      const items = CARDS.filter((c) => c.group === g);
      if (!items.length) return null;

      const det = document.createElement("details");
      det.className = "group";
      det.setAttribute("data-group", g);
      det.open = open.has(g);

      const sum = document.createElement("summary");
      const name = document.createElement("span");
      name.textContent = g;
      const count = document.createElement("span");
      count.className = "count";
      counts.set(g, count);
      sum.append(name, count);

      const actions = document.createElement("div");
      actions.className = "group-actions";
      actions.append(
        textButton("Select all", () => {
          const add = items.filter(isAvailable).map((c) => c.id);
          commit([...selected, ...add.filter((id) => !selected.includes(id))]);
        }),
        textButton("Clear", () => commit(selected.filter((id) => byId.get(id)?.group !== g))),
      );

      const list = document.createElement("ul");
      list.className = "checks";
      for (const c of items) {
        const ok = isAvailable(c);
        const box = document.createElement("input");
        box.type = "checkbox";
        box.disabled = !ok;
        box.addEventListener("change", () => toggle(c.id, box.checked));
        boxes.set(c.id, box);
        const text = document.createElement("span");
        text.textContent = c.label;
        const lab = document.createElement("label");
        lab.append(box, text, ...markers(c, ok));
        const li = document.createElement("li");
        li.append(lab);
        list.append(li);
      }

      det.append(sum, actions, list);
      return det;
    });
    groups.replaceChildren(...sections.filter((s) => s !== null));
  }

  return {
    /**
     * Show a selection without reporting it back: on start-up, after a reset,
     * or when the data source changes which statistics are available.
     *
     * @param {string[]} next
     */
    set(next) {
      selected = [...next];
      buildGroups();
      renderChosen();
      sync();
    },
  };
}
