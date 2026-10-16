/**
 * OWID chart plotter — finding a ready-made chart.
 *
 * Two ways in, both built on the list in presets.js:
 *   - a search box with a dropdown of matches, driven by the mouse or the
 *     arrow keys; with nothing typed it shows every chart, by group;
 *   - a "Browse all" window showing every chart at once, by group, with its
 *     source and years, for looking around and getting ideas.
 *
 * Everything is built with DOM calls and textContent.
 */

import { GROUPS, searchPresets } from "./presets.js";

/** @typedef {import("./presets.js").Preset} Preset */

/** @param {Preset} p */
const metaLine = (p) => [p.source, p.years].filter(Boolean).join(" · ");

/**
 * @param {string} tag
 * @param {string} [cls]
 * @param {string} [text]
 */
function make(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text) el.textContent = text;
  return el;
}

/**
 * The presets in group order, each group with its heading.
 *
 * @param {Preset[]} list
 * @returns {Array<{group: string, presets: Preset[]}>}
 */
function byGroup(list) {
  return GROUPS.map((group) => ({ group, presets: list.filter((p) => p.group === group) })).filter(
    (g) => g.presets.length,
  );
}

/**
 * The search box and its dropdown.
 *
 * @param {object} els
 * @param {HTMLInputElement} els.input
 * @param {HTMLElement} els.list
 * @param {(preset: Preset) => void} onPick
 */
export function setupPresetSearch({ input, list }, onPick) {
  /** @type {Preset[]} */
  let shown = [];
  let active = -1;
  let open = false;
  // Right after opening, the box still holds the current chart's name; the
  // whole list shows until the user types.
  let showAll = false;

  function close() {
    open = false;
    list.textContent = "";
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }

  function render() {
    open = true;
    list.textContent = "";
    const query = showAll ? "" : input.value;
    shown = searchPresets(query);
    if (!shown.length) {
      list.append(
        make(
          "p",
          "pnone",
          "No ready-made chart matches. Try another word, or paste a chart's address below.",
        ),
      );
      input.setAttribute("aria-expanded", "true");
      return;
    }
    // With nothing typed, the whole list by group; otherwise matches, best first.
    const sections = query.trim() ? [{ group: "", presets: shown }] : byGroup(shown);
    shown = sections.flatMap((s) => s.presets);
    let i = 0;
    for (const { group, presets } of sections) {
      if (group) list.append(make("h4", "pgroup", group));
      for (const p of presets) {
        const b = make("button", "preset");
        b.type = "button";
        b.id = "preset-" + i;
        b.setAttribute("role", "option");
        b.tabIndex = -1;
        b.append(make("span", "pname", p.name));
        const meta = [query.trim() ? p.group : "", metaLine(p)].filter(Boolean).join(" · ");
        if (meta) b.append(make("span", "pmeta", meta));
        const index = i;
        // mousedown, not click: picking must happen before the input's blur closes the list.
        b.addEventListener("mousedown", (e) => {
          e.preventDefault();
          pick(index);
        });
        list.append(b);
        i++;
      }
    }
    setActive(query.trim() ? 0 : -1);
    input.setAttribute("aria-expanded", "true");
  }

  /** @param {number} i */
  function setActive(i) {
    active = i;
    list.querySelectorAll(".preset").forEach((b, j) => b.classList.toggle("on", j === i));
    const el = i >= 0 ? list.querySelector("#preset-" + i) : null;
    if (el) {
      input.setAttribute("aria-activedescendant", el.id);
      el.scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  }

  /** @param {number} i */
  function pick(i) {
    const p = shown[i];
    if (!p) return;
    input.value = p.name;
    close();
    onPick(p);
  }

  // Scrolling the list with the mouse must not take the focus from the box.
  list.addEventListener("mousedown", (e) => e.preventDefault());
  function openAll() {
    input.select();
    showAll = true;
    render();
  }
  input.addEventListener("focus", openAll);
  // A click into the box when the list is closed (after a pick) opens it again.
  input.addEventListener("click", () => {
    if (!open) openAll();
  });
  input.addEventListener("input", () => {
    showAll = false;
    render();
  });
  input.addEventListener("blur", close);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return render();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive(Math.max(0, Math.min(shown.length - 1, active + step)));
    } else if (e.key === "Enter") {
      // Enter here picks a chart; it must not submit the form.
      e.preventDefault();
      if (open && active >= 0) pick(active);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      close();
    }
  });
}

/**
 * The "Browse all" window.
 *
 * @param {object} els
 * @param {HTMLButtonElement} els.open the button that opens it
 * @param {HTMLDialogElement} els.dialog
 * @param {HTMLInputElement} els.filter
 * @param {HTMLElement} els.body
 * @param {HTMLButtonElement} els.close
 * @param {(preset: Preset) => void} onPick
 */
export function setupPresetBrowser({ open, dialog, filter, body, close }, onPick) {
  function render() {
    body.textContent = "";
    const found = searchPresets(filter.value);
    if (!found.length) {
      body.append(make("p", "pnone", "No ready-made chart matches."));
      return;
    }
    // Group order even when filtering: this window is for looking around.
    for (const { group, presets } of byGroup(found)) {
      const section = make("section", "bgroup");
      section.append(make("h3", "", group));
      const grid = make("div", "bgrid");
      for (const p of presets) {
        const b = make("button", "bcard");
        b.type = "button";
        b.append(make("span", "pname", p.name));
        const meta = metaLine(p);
        if (meta) b.append(make("span", "pmeta", meta));
        b.addEventListener("click", () => {
          dialog.close();
          onPick(p);
        });
        grid.append(b);
      }
      section.append(grid);
      body.append(section);
    }
  }

  open.addEventListener("click", () => {
    filter.value = "";
    render();
    dialog.showModal();
    filter.focus();
  });
  filter.addEventListener("input", render);
  close.addEventListener("click", () => dialog.close());
  // A click on the dimmed backdrop (the dialog element itself) closes it too.
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
}
