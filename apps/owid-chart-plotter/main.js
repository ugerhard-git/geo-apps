const PALETTE = ["#E4572E","#1F7A6C","#E0A32E","#4A5BA6","#B23A6B","#2F7FA8","#6F8F32","#8C5E58"];
const $ = id => document.getElementById(id);
const els = {};
["preset","slug","load","search","picker","chips","types","y0","y1","title","scale","marks","names","bg","status","kicker","ctitle","csub","stamp","png","csv","rows","paste","usepaste","usefile","file","yearhint","form",
 "checkrun","checkstop","checkprog","checkout","valcol","valcollbl"].forEach(k=>els[k]=$(k));

let DATA = null;        // {label, unit, byEntity:Map<string, Map<year,value>>, years:[], entities:[]}
let picked = [];        // entity names
let LAST_CSV = null;    // raw CSV of the loaded dataset, so the value-column
let LAST_SOURCE = "";   // picker can re-parse without re-fetching
let type = "line";
let chart = null;

/* ---------------- CSV parsing ---------------- */
function parseCSV(text){
  const rows=[]; let row=[], field="", q=false;
  text = text.replace(/^\uFEFF/,"");
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(q){
      if(c === '"'){ if(text[i+1]==='"'){field+='"';i++;} else q=false; }
      else field+=c;
    } else if(c === '"'){ q=true; }
    else if(c === ","){ row.push(field); field=""; }
    else if(c === "\n"){ row.push(field); field=""; rows.push(row); row=[]; }
    else if(c === "\r"){ /* skip */ }
    else field+=c;
  }
  if(field.length||row.length){ row.push(field); rows.push(row); }
  return rows.filter(r=>r.length>1 || (r[0]||"").trim()!=="");
}

const UNIT_WORDS = /^(years?|months?|days?|hours?|minutes?|percent|people|persons?|tonnes?|tons?|kg|kilograms?|grams?|litres?|liters?|kwh|mwh|twh|gwh|kcal|calories|deaths|births|cases|dollars?|usd|eur|hectares?)$/i;

function looksLikeUnit(s){
  const t = (s || "").trim();
  if(!t) return false;
  if(t === "%") return true;
  if(t.includes("%")) return true;          // "% of GDP", "annual %"
  if(/\bper\b/i.test(t)) return true;       // "per 1,000 people", "tonnes per hectare"
  return UNIT_WORDS.test(t);
}

// Pure: text -> data object. Throws on anything unusable.
// ingest() wires the result into the UI; the preset checker calls this directly,
// so the check exercises exactly the same parsing the app uses.
function buildData(text, sourceLabel, preferCol){
  const rows = parseCSV(text);
  if(rows.length < 2) throw new Error("That CSV has no data rows.");
  const head = rows[0].map(h=>h.trim());
  const iE = head.findIndex(h=>/^entity$/i.test(h));
  const iY = head.findIndex(h=>/^year$|^date$/i.test(h));
  const entityCol = iE >= 0 ? iE : 0;
  const yearCol   = iY >= 0 ? iY : 2;
  // Value column: the right-most column that actually holds numbers.
  // Some grapher exports append a text column (e.g. "World region according to OWID"),
  // so the last column is not reliably the value column.
  const numericCols = [];
  for(let c=0;c<head.length;c++){
    if(c===entityCol||c===yearCol) continue;
    if(/^code$/i.test(head[c])) continue;
    let filled=0, numeric=0;
    for(let r=1;r<rows.length;r++){
      const raw = (rows[r][c]||"").trim();
      if(raw === "") continue;
      filled++;
      if(Number.isFinite(Number(raw))) numeric++;
    }
    if(filled && numeric/filled >= 0.9) numericCols.push(c);
  }
  if(!numericCols.length){
    throw new Error("No numeric value column found in that CSV. Columns: " +
      head.filter((h,c)=>c!==entityCol && c!==yearCol && !/^code$/i.test(h)).join(", ") + ".");
  }
  // Default to the FIRST numeric column: OWID puts the chart's primary indicator
  // directly after Year, and anything further right is a secondary dimension (a
  // second indicator on scatter charts, "Population (historical)", a region name).
  // A caller can override that by name — exact match first, then case-insensitive,
  // then substring — which is how a multi-metric chart picks out one series.
  let valCol = numericCols[0];
  if(preferCol){
    const want = String(preferCol).trim();
    const lower = want.toLowerCase();
    const found =
      numericCols.find(c => head[c] === want) ??
      numericCols.find(c => head[c].toLowerCase() === lower) ??
      numericCols.find(c => head[c].toLowerCase().includes(lower));
    if(found !== undefined) valCol = found;
  }

  const byEntity = new Map(), yearSet = new Set();
  for(let r=1;r<rows.length;r++){
    const row = rows[r];
    const name = (row[entityCol]||"").trim();
    const year = parseInt(row[yearCol],10);
    const raw  = (row[valCol]||"").trim();
    if(!name || !Number.isFinite(year) || raw==="") continue;
    const v = Number(raw);
    if(!Number.isFinite(v)) continue;
    if(!byEntity.has(name)) byEntity.set(name, new Map());
    byEntity.get(name).set(year, v);
    yearSet.add(year);
  }
  if(!byEntity.size) throw new Error("No numeric values found in that CSV.");
  // OWID appends dimension suffixes such as " - Sex: both sexes - Age group: 18+ years".
  // Cut them off so the title and unit come out readable.
  const header = head[valCol].split(/\s+-\s+(?=[^-]*:)/)[0].trim();
  // A trailing parenthetical is often a unit — "(years)", "(% of GDP)" — but just as
  // often a qualifier: "(selected)", "(age-standardized)", "($3 a day)", "(Projected)".
  // Only strip it into the unit when it reads like a unit; otherwise leave it in the label.
  const unitM = header.match(/\(([^)]+)\)\s*$/);
  const unit = unitM && looksLikeUnit(unitM[1]) ? unitM[1].trim() : "";
  const label = (unit ? header.replace(/\s*\([^)]*\)\s*$/, "") : header).trim() || "Value";
  return {
    label,
    unit,
    fullLabel: header,
    byEntity,
    years: [...yearSet].sort((a,b)=>a-b),
    entities: [...byEntity.keys()].sort((a,b)=>a.localeCompare(b)),
    source: sourceLabel,
    // diagnostics for the preset checker and the value-column picker
    columns: head,
    valCol,
    valColName: head[valCol],
    numericChoices: numericCols.map(c => head[c]),
    otherNumeric: numericCols.filter(c => c !== valCol).map(c => head[c])
  };
}

function ingest(text, sourceLabel, preferCol){
  const prevLabel = DATA ? DATA.fullLabel : null;
  DATA = buildData(text, sourceLabel, preferCol);
  LAST_CSV = text; LAST_SOURCE = sourceLabel;
  renderValCol();
  els.rows.textContent = DATA.entities.length + " entities · " + DATA.years.length + " years";
  els.search.disabled = false; els.y0.disabled = false; els.y1.disabled = false;
  fillYears(); renderPicker();
  // adopt the new column's name as the title if the box is empty or still holds
  // the previous column's name (so switching column doesn't leave a stale title)
  const t = els.title.value.trim();
  if(!t || t === prevLabel) els.title.value = DATA.fullLabel;
  // no default selection — the user picks the countries
  // (anything already picked is kept if the new dataset also has it)
  picked = picked.filter(e => DATA.byEntity.has(e));
  renderChips(); draw();
  setStatus("ok", "Loaded " + DATA.entities.length + " entities from " + sourceLabel + ".");
}

// The picker only appears when the CSV genuinely offers a choice.
function renderValCol(){
  const choices = DATA ? DATA.numericChoices : [];
  const show = choices.length > 1;
  els.valcol.style.display = show ? "" : "none";
  els.valcollbl.style.display = show ? "" : "none";
  if(!show) return;
  els.valcol.textContent = "";
  for(const name of choices){
    const o = document.createElement("option");
    o.value = name; o.textContent = name;
    if(name === DATA.valColName) o.selected = true;
    els.valcol.appendChild(o);
  }
}

function fillYears(){
  const mkOptions = () => {
    const frag = document.createDocumentFragment();
    for(const y of DATA.years){
      const o = document.createElement("option");
      o.value = String(y); o.textContent = String(y);
      frag.appendChild(o);
    }
    return frag;
  };
  els.y0.textContent = ""; els.y0.appendChild(mkOptions());
  els.y1.textContent = ""; els.y1.appendChild(mkOptions());
  const first = DATA.years[0], last = DATA.years[DATA.years.length-1];
  const nearest = target => DATA.years.reduce((b,y)=>
    Math.abs(y-target) < Math.abs(b-target) ? y : b, first);
  const wantFrom = 1950, wantTo = new Date().getFullYear() - 1;
  els.y0.value = wantFrom <= first ? first : wantFrom >= last ? first : nearest(wantFrom);
  els.y1.value = wantTo >= last ? last : nearest(wantTo);
  if(parseInt(els.y1.value,10) < parseInt(els.y0.value,10)){
    els.y0.value = first; els.y1.value = last;
  }
}

// slugs may now carry ?query and #Column, neither of which belongs in a filename
function safeName(v){
  // Strip the query/hash, reduce to a safe charset, then trim leading and trailing
  // dots and dashes so nothing like ".." or "-rf" survives into a download name.
  const s = String(v || "").split("?")[0].split("#")[0]
    .replace(/[^\w.-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return s || "owid";
}

/* ---------------- fetching ---------------- */
// A dataset reference is "slug", "slug?query", "slug#Column" or "slug?query#Column".
// OWID now merges related charts into one multi-metric chart (electricity-mix,
// energy-mix), selected by query params, so the query has to survive; the optional
// #Column says which value column to chart when the CSV carries several.
function splitSlug(value){
  const display = String(value || "").trim()
    .replace(/^https?:\/\/[^/]+\/grapher\//, "")
    .replace(/\/+$/, "");
  const hash = display.indexOf("#");
  const colHint = hash >= 0 ? decodeURIComponent(display.slice(hash + 1)) : "";
  const slug = hash >= 0 ? display.slice(0, hash) : display;
  return { display, slug, colHint, base: slug.split("?")[0] };
}

function csvUrls(slug){
  const q = slug.indexOf("?");
  const base = q >= 0 ? slug.slice(0, q) : slug;
  const extra = q >= 0 ? slug.slice(q + 1) : "";
  const root = "https://ourworldindata.org/grapher/" + base + ".csv";
  return [
    root + "?csvType=full&useColumnShortNames=false" + (extra ? "&" + extra : ""),
    extra ? root + "?" + extra : root
  ];
}

// Fetch a slug's CSV text, trying both URL forms. Throws with a readable message.
// A cross-origin error page (e.g. OWID's 404) is blocked by the browser before we
// can read its status, surfacing only as "Failed to fetch" — so a network-level
// rejection means EITHER the chart does not exist OR the request genuinely failed.
// Retry once before concluding anything, to rule out a transient hiccup.
async function fetchCSV(slug){
  let httpErr = null;
  const backoff = [700, 1800];   // three attempts in total
  for(let attempt = 0; attempt <= backoff.length; attempt++){
    for(const u of csvUrls(slug)){
      try{
        const res = await fetch(u);
        if(!res.ok){ httpErr = new Error("HTTP " + res.status + " — that slug is wrong."); continue; }
        return await res.text();
      }catch(e){ /* network-level rejection; fall through to retry */ }
    }
    if(httpErr) break;                                  // a real answer; retrying won't help
    if(attempt < backoff.length) await new Promise(r=>setTimeout(r, backoff[attempt]));
  }
  if(httpErr) throw httpErr;
  throw new Error("No CSV came back after 3 tries. OWID's error responses carry no CORS "
    + "headers, so the browser hides the status from us. Open ourworldindata.org/grapher/"
    + slug.split("?")[0] + " — it will be one of: the chart is gone (404); it redirects to a "
    + "merged chart, in which case copy the params from its Data URL (e.g. "
    + "“literacy?age_group=adult&sex=both”); or the page says the data cannot be "
    + "downloaded because of its licence, and no slug will help.");
}

async function load(raw){
  const { display, slug, colHint, base } = splitSlug(raw);
  if(!slug){ setStatus("err","Enter a chart slug first."); return; }
  els.slug.value = display;
  // keep the dropdown in sync when the reference matches a listed dataset
  if([...els.preset.options].some(o=>o.value===display)) els.preset.value = display;
  setStatus("load", "Fetching “" + base + "” from Our World in Data…");
  try{
    const text = await fetchCSV(slug);
    ingest(text, "ourworldindata.org/grapher/" + base, colHint);
  }catch(err){
    setStatus("err","Could not load that dataset. " + err.message +
      " If you are offline, or the browser blocked the request, use “Paste a CSV instead” at the bottom of the form.");
  }
}

els.valcol.addEventListener("change", ()=>{
  if(LAST_CSV) ingest(LAST_CSV, LAST_SOURCE, els.valcol.value);
});

/* ---------------- preset checker ----------------
   Walks every dataset in the dropdown, fetches it and runs the same buildData()
   the app uses, then reports what came back. Catches dead slugs after an OWID
   rename, and shows which column each dataset actually parses to so a silently
   wrong column is visible rather than plausible-looking. */
let checkAbort = false;

function ckRow(ok, name, slug, detail){
  const div = document.createElement("div");
  div.className = "ckrow " + (ok ? "ok" : "bad");
  const mark = document.createElement("div");
  mark.className = "ckmark";
  mark.textContent = ok ? "✓" : "✕";
  const body = document.createElement("div");
  const n = document.createElement("span"); n.className = "ckname"; n.textContent = name;
  const s = document.createElement("span"); s.className = "ckslug"; s.textContent = "  " + slug;
  const d = document.createElement("div"); d.className = "ckdetail"; d.textContent = detail;
  body.append(n, s, d);
  div.append(mark, body);
  return div;
}

async function runCheck(){
  const opts = [...els.preset.options].filter(o=>o.value);
  checkAbort = false;
  els.checkrun.disabled = true; els.checkstop.disabled = false;
  els.checkout.textContent = "";
  const summary = document.createElement("p");
  summary.className = "cksum";
  els.checkout.appendChild(summary);

  let pass = 0, fail = 0, done = 0;
  for(const o of opts){
    if(checkAbort) break;
    els.checkprog.textContent = (done+1) + " / " + opts.length + " — " + o.value;
    try{
      const ref = splitSlug(o.value);
      const text = await fetchCSV(ref.slug);
      const d = buildData(text, ref.slug, ref.colHint);
      const bits = [
        "→ " + d.fullLabel,
        d.unit ? "unit " + d.unit : "no unit",
        d.entities.length + " entities",
        d.years[0] + "–" + d.years[d.years.length-1]
      ];
      // more than one numeric column means the choice of column is a judgement call
      if(d.otherNumeric.length) bits.push("also numeric: " + d.otherNumeric.join(", "));
      els.checkout.appendChild(ckRow(true, o.textContent, o.value, bits.join(" · ")));
      pass++;
    }catch(err){
      els.checkout.appendChild(ckRow(false, o.textContent, o.value, err.message));
      fail++;
    }
    done++;
    summary.textContent = pass + " ok, " + fail + " failing, " + done + " of " + opts.length + " checked";
    await new Promise(r=>setTimeout(r, 400));   // be polite to OWID; these CSVs are large
  }

  summary.textContent = pass + " ok, " + fail + " failing" +
    (checkAbort ? " (stopped early at " + done + " of " + opts.length + ")" : "");
  els.checkprog.textContent = checkAbort ? "Stopped." : "Done.";
  els.checkrun.disabled = false; els.checkstop.disabled = true;
}

els.checkrun.addEventListener("click", runCheck);
els.checkstop.addEventListener("click", ()=>{ checkAbort = true; els.checkstop.disabled = true; });

function setStatus(kind, msg){
  els.status.className = "status" + (kind==="err"?" err":kind==="ok"?" ok":"");
  // Built as text, never HTML: msg carries the slug the user typed and error text
  // that can quote CSV column names, neither of which is trustworthy markup.
  els.status.textContent = "";
  if(kind === "load"){
    const spin = document.createElement("span");
    spin.className = "spin";
    els.status.appendChild(spin);
  }
  els.status.appendChild(document.createTextNode(msg));
}

/* ---------------- picker + chips ---------------- */
// Entity names come from the CSV, which may be pasted, uploaded or fetched from a
// slug the user supplies — so it is untrusted input. These are assembled with DOM
// calls rather than innerHTML so a name like `<img src=x onerror=...>` stays text.
function renderPicker(){
  const q = els.search.value.trim().toLowerCase();
  const list = DATA.entities.filter(e=>!picked.includes(e) && (!q || e.toLowerCase().includes(q))).slice(0,300);
  els.picker.textContent = "";
  if(!list.length){
    const empty = document.createElement("div");
    empty.style.cssText = "padding:9px;font-size:12.5px;color:var(--ink-soft)";
    empty.textContent = "No match.";
    els.picker.appendChild(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  for(const e of list){
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.e = e;
    b.textContent = e;
    frag.appendChild(b);
  }
  els.picker.appendChild(frag);
}
function renderChips(){
  els.chips.textContent = "";
  const frag = document.createDocumentFragment();
  picked.forEach((e,i)=>{
    const s = series(e);
    const last = s.length ? s[s.length-1].v : null;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.style.setProperty("--c", PALETTE[i%PALETTE.length]);
    b.dataset.e = e;
    b.title = "Remove " + e;
    const val = document.createElement("b");
    val.textContent = last === null ? "–" : fmt(last);
    const x = document.createElement("i");
    x.textContent = "×";
    b.append(document.createTextNode(e + " "), val, document.createTextNode(" "), x);
    frag.appendChild(b);
  });
  els.chips.appendChild(frag);
  renderPicker();
}
els.picker.addEventListener("click", e=>{
  const b=e.target.closest("button[data-e]"); if(!b) return;
  if(picked.length>=8){ setStatus("err","Eight series is the limit — remove one first."); return; }
  picked.push(b.dataset.e); renderChips(); draw();
});
els.chips.addEventListener("click", e=>{
  const b=e.target.closest("button[data-e]"); if(!b) return;
  picked = picked.filter(x=>x!==b.dataset.e); renderChips(); draw();
});
els.search.addEventListener("input", renderPicker);

/* ---------------- helpers ---------------- */
function series(e){
  const m = DATA.byEntity.get(e); if(!m) return [];
  const a=parseInt(els.y0.value,10), b=parseInt(els.y1.value,10);
  return [...m.entries()].filter(([y])=>y>=a&&y<=b).sort((x,y)=>x[0]-y[0]).map(([y,v])=>({y,v}));
}
function valueAt(e, year){
  const m = DATA.byEntity.get(e); if(!m) return null;
  if(m.has(year)) return m.get(year);
  let best=null,bd=Infinity;
  for(const [y,v] of m){ const d=Math.abs(y-year); if(d<bd && y<=year){bd=d;best=v;} }
  return best;
}
function fmt(v){
  const a=Math.abs(v);
  if(a>=1e9) return (v/1e9).toFixed(2)+"B";
  if(a>=1e6) return (v/1e6).toFixed(2)+"M";
  if(a>=1e4) return Math.round(v).toLocaleString("en-US");
  if(a>=100) return v.toFixed(0);
  if(a>=1) return v.toFixed(2);
  return v.toPrecision(3);
}

/* Draws each series name at its last data point, so the eye never leaves the line. */
const endLabels = {
  id: "endLabels",
  afterDatasetsDraw(c, args, opts){
    if(!opts || !opts.enabled) return;
    const k = opts.scale || 1;
    const ctx = c.ctx;
    ctx.save();
    ctx.font = `600 ${Math.round(13*k)}px 'Public Sans', sans-serif`;
    ctx.textBaseline = "middle";
    const placed = [];
    c.data.datasets.forEach((ds, di)=>{
      const meta = c.getDatasetMeta(di);
      if(meta.hidden) return;
      let last = null;
      for(let i=meta.data.length-1;i>=0;i--){
        const v = ds.data[i];
        if(v !== null && v !== undefined && !Number.isNaN(v)){ last = meta.data[i]; break; }
      }
      if(!last) return;
      const gap = Math.round(8*k), lh = Math.round(17*k);
      let y = last.y;
      while(placed.some(py=>Math.abs(py-y) < lh)) y += lh;   // nudge apart on collision
      y = Math.min(Math.max(y, c.chartArea.top + lh/2), c.chartArea.bottom - lh/2);
      placed.push(y);
      const text = ds.label;
      const w = ctx.measureText(text).width;
      let x = last.x + gap;
      if(x + w > c.width - Math.round(2*k)) x = last.x - gap - w;   // flip inside the frame
      ctx.fillStyle = opts.color || ds.borderColor || "#12233A";
      ctx.fillText(text, x, y);
    });
    ctx.restore();
  }
};
Chart.register(endLabels);

/* ---------------- drawing ---------------- */
const BASE_FONT = {family:"Public Sans"}; 
Chart.defaults.font.family = "Public Sans, system-ui, sans-serif";
Chart.defaults.color = "#4C6076";
Chart.defaults.borderColor = "rgba(18,35,58,.12)";

function draw(){
  if(!DATA) return;
  if(chart){ chart.destroy(); chart=null; }
  const t = els.title.value.trim() || DATA.fullLabel;
  const y0 = parseInt(els.y0.value,10), y1 = parseInt(els.y1.value,10);
  const single = (type==="rank"||type==="donut");
  els.yearhint.textContent = single
    ? "This chart type uses the “To” year only: " + y1 + "."
    : (type==="change" ? "Compares " + y0 + " with " + y1 + "." : "Range shown: " + y0 + "–" + y1 + ".");

  els.ctitle.textContent = t;
  els.kicker.textContent = ({line:"Trend lines",area:"Stacked area",bar:"Grouped bars",rank:"Ranking",donut:"Share of total",change:"Change"})[type]
    + " · " + (single ? y1 : y0+"–"+y1);
  els.csub.textContent = picked.length
    ? picked.join(" · ") + (DATA.unit ? "  —  measured in " + DATA.unit : "")
    : "Add at least one country in the form.";
  els.stamp.textContent = "Data: " + DATA.source;

  if(!picked.length){ els.png.disabled = els.csv.disabled = true; return; }
  els.png.disabled = els.csv.disabled = false;

  const ctx = $("chart").getContext("2d");
  try{
    chart = new Chart(ctx, buildConfig(1));
  }catch(err){
    chart = null;
    els.png.disabled = els.csv.disabled = true;
    setStatus("err", "Could not draw this chart: " + err.message);
  }
}

function buildConfig(k, hideNames){
  const y0 = parseInt(els.y0.value,10), y1 = parseInt(els.y1.value,10);
  const showPts = els.marks.value === "on";
  const F = n => Math.round(n*k);
  const scaleY = () => {
    const ttl = {display:!!DATA.unit, text:DATA.unit, font:{size:F(12),weight:"600"}};
    if(els.scale.value==="log") return {type:"logarithmic", title:ttl};
    return {beginAtZero: els.scale.value==="zero", title:ttl};
  };
  // legend | inline | off — exports always force "off" so no country name is drawn
  const nameMode = hideNames ? "off" : els.names.value;
  const lineish = (type==="line" || type==="area");
  const inline = nameMode==="inline" && lineish;
  const legend = {
    display: nameMode==="legend" && picked.length>1,
    position:"bottom",
    labels:{boxWidth:F(10),boxHeight:F(10),usePointStyle:true,pointStyle:"rect",padding:F(14),font:{size:F(12)}}
  };
  const tip = {callbacks:{label:c=>` ${c.dataset.label||c.label}: ${fmt(c.parsed.y ?? c.parsed)}`}};

  let cfg;

  if(type==="line" || type==="area"){
    const years = DATA.years.filter(y=>y>=y0&&y<=y1);
    cfg = {type:"line", data:{labels:years, datasets:picked.map((e,i)=>{
      const m = DATA.byEntity.get(e);
      return {label:e, data:years.map(y=>m.has(y)?m.get(y):null), spanGaps:true,
        borderColor:PALETTE[i%PALETTE.length],
        backgroundColor: type==="area" ? PALETTE[i%PALETTE.length]+"cc" : "transparent",
        fill: type==="area", borderWidth:2.2*k, tension:.18,
        pointRadius: showPts?2.6*k:0, pointHoverRadius:5*k, pointBackgroundColor:PALETTE[i%PALETTE.length]};
    })}, options:{maintainAspectRatio:false, interaction:{mode:"index",intersect:false},
      scales:{x:{grid:{display:false},ticks:{maxTicksLimit:12}}, y:{...scaleY(), stacked:type==="area"}},
      plugins:{legend, tooltip:tip}}};
  }

  if(type==="bar"){
    const step = Math.max(1, Math.ceil((y1-y0)/7));
    const years=[]; for(let y=y0;y<=y1;y+=step) years.push(y);
    if(years[years.length-1]!==y1) years.push(y1);
    cfg = {type:"bar", data:{labels:years.map(String), datasets:picked.map((e,i)=>({
      label:e, data:years.map(y=>valueAt(e,y)), backgroundColor:PALETTE[i%PALETTE.length], borderWidth:0, borderRadius:1
    }))}, options:{maintainAspectRatio:false,
      scales:{x:{grid:{display:false}}, y:scaleY()}, plugins:{legend, tooltip:tip}}};
  }

  if(type==="rank"){
    const rows = picked.map((e,i)=>({e, v:valueAt(e,y1), c:PALETTE[i%PALETTE.length]}))
      .filter(r=>r.v!==null).sort((a,b)=>b.v-a.v);
    cfg = {type:"bar", data:{labels:rows.map(r=>r.e), datasets:[{label:String(y1), data:rows.map(r=>r.v),
      backgroundColor:rows.map(r=>r.c), borderWidth:0, borderRadius:1}]},
      options:{indexAxis:"y", maintainAspectRatio:false,
        scales:{x:{...scaleY(), beginAtZero:els.scale.value!=="log"}, y:{grid:{display:false}}},
        plugins:{legend:{display:false}, tooltip:tip}}};
  }

  if(type==="donut"){
    const rows = picked.map((e,i)=>({e, v:valueAt(e,y1), c:PALETTE[i%PALETTE.length]}))
      .filter(r=>r.v!==null && r.v>0).sort((a,b)=>b.v-a.v);
    const total = rows.reduce((s,r)=>s+r.v,0);
    cfg = {type:"doughnut", data:{labels:rows.map(r=>r.e), datasets:[{data:rows.map(r=>r.v),
      backgroundColor:rows.map(r=>r.c), borderColor: k>1 && els.bg.value==="transparent" ? "rgba(0,0,0,0)" : "#fff", borderWidth:2*k}]},
      options:{maintainAspectRatio:false, cutout:"52%",
        plugins:{legend:{...legend, display:nameMode!=="off"}, tooltip:{callbacks:{label:c=>
          ` ${c.label}: ${fmt(c.parsed)} (${(c.parsed/total*100).toFixed(1)}% of selection)`}}}}};
    if(els.scale.value==="log") els.scale.value="linear";
  }

  if(type==="change"){
    const rows = picked.map((e,i)=>{
      const a=valueAt(e,y0), b=valueAt(e,y1);
      return {e, d:(a===null||b===null)?null:b-a, c:PALETTE[i%PALETTE.length]};
    }).filter(r=>r.d!==null).sort((a,b)=>b.d-a.d);
    cfg = {type:"bar", data:{labels:rows.map(r=>r.e), datasets:[{label:`Change ${y0} → ${y1}`,
      data:rows.map(r=>r.d), backgroundColor:rows.map(r=>r.d<0?"#B23A6B":r.c), borderWidth:0, borderRadius:1}]},
      options:{indexAxis:"y", maintainAspectRatio:false,
        scales:{x:{grid:{color:"rgba(18,35,58,.10)"}, title:{display:true,text:"Difference"+(DATA.unit?" ("+DATA.unit+")":"")}}, y:{grid:{display:false}}},
        plugins:{legend:{display:false}, tooltip:{callbacks:{label:c=>` ${c.label}: ${c.parsed.x>0?"+":""}${fmt(c.parsed.x)}`}}}}};
  }

  // scale tick fonts and disable animation for offscreen export renders
  cfg.options = cfg.options || {};
  if(k !== 1){ cfg.options.devicePixelRatio = 1; cfg.options.animation = false; }
  cfg.options.scales = cfg.options.scales || {};
  for(const ax of Object.values(cfg.options.scales)){
    ax.ticks = Object.assign({}, ax.ticks, {font:{size:F(11)}});
    if(ax.title) ax.title.font = {size:F(12), weight:"600"};
  }

  // country names: inline end labels, or hide the category axis that carries them
  cfg.options.plugins = cfg.options.plugins || {};
  cfg.options.plugins.endLabels = {enabled: inline, scale: k};
  if(inline){
    // leave room on the right for the labels
    const longest = picked.reduce((m,e)=>Math.max(m, e.length), 0);
    cfg.options.layout = {padding:{right: Math.round((longest*7.6 + 18) * k)}};
  }
  if(nameMode === "off" && (type==="rank" || type==="change")){
    cfg.options.scales.y = Object.assign({}, cfg.options.scales.y, {ticks:{display:false}});
  }
  return cfg;
}



/* ---------------- exports ---------------- */
const EXPORT_W = 2400, EXPORT_H = 1600;

els.png.addEventListener("click", async ()=>{
  if(!DATA || !picked.length) return;
  const mode = els.bg.value;
  const theme = mode === "ink"
    ? {bg:"#12233A", ink:"#F4F7FA", soft:"#93A7BA", rule:"#3A5170"}
    : {bg: mode==="white" ? "#FFFFFF" : mode==="paper" ? "#F4F7FA" : null,
       ink:"#12233A", soft:"#4C6076", rule:"#C3CFDA"};

  els.png.disabled = true;
  const prevLabel = els.png.textContent;
  els.png.textContent = "Rendering…";
  try{
    // layout of the 2400x1600 frame
    const pad = 96, footH = 120;
    const plotW = EXPORT_W - pad*2;

    // the final frame — created up front so its context can measure the title
    const out = document.createElement("canvas");
    out.width = EXPORT_W; out.height = EXPORT_H;
    const c = out.getContext("2d");

    // wrap the title to at most two lines; the header height follows from that
    const TITLE_PX = 76, TITLE_LH = 86;
    c.font = "600 " + TITLE_PX + "px 'Bricolage Grotesque', 'Public Sans', sans-serif";
    const words = els.ctitle.textContent.trim().split(/\s+/);
    const lines = [];
    let cur = "";
    for(const w of words){
      const test = cur ? cur + " " + w : w;
      if(c.measureText(test).width > plotW && cur){ lines.push(cur); cur = w; }
      else cur = test;
      if(lines.length === 2) break;
    }
    if(lines.length < 2 && cur) lines.push(cur);

    // subtitle carries the unit only — country names never reach the export
    const subText = DATA.unit ? "Measured in " + DATA.unit : "";
    const headH = pad + lines.length*TITLE_LH + (subText ? 44 : 0) + 40;
    const plotH = EXPORT_H - headH - footH;
    const k = plotH / 460;   // scale factor vs. the on-screen reference height

    // render the chart offscreen at full export size
    const off = document.createElement("canvas");
    off.width = plotW; off.height = plotH;
    const holder = document.createElement("div");
    holder.style.cssText = "position:fixed;left:-99999px;top:0;width:"+plotW+"px;height:"+plotH+"px";
    holder.appendChild(off); document.body.appendChild(holder);

    const cfg = buildConfig(k, true);   // true = no legend, no inline labels, no name axis
    cfg.options.responsive = false;
    if(mode === "ink"){
      cfg.options.color = theme.soft;
      for(const ax of Object.values(cfg.options.scales||{})){
        ax.ticks = Object.assign({}, ax.ticks, {color: theme.soft});
        if(ax.title) ax.title.color = theme.soft;
        ax.grid = Object.assign({}, ax.grid, {color:"rgba(244,247,250,.14)"});
      }
      cfg.options.plugins = cfg.options.plugins || {};
      if(cfg.options.plugins.legend) cfg.options.plugins.legend.labels =
        Object.assign({}, cfg.options.plugins.legend.labels, {color: theme.ink});
    }
    const tmp = new Chart(off.getContext("2d"), cfg);
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));

    // compose the final frame
    if(theme.bg){ c.fillStyle = theme.bg; c.fillRect(0,0,EXPORT_W,EXPORT_H); }

    c.textBaseline = "alphabetic";
    c.fillStyle = theme.ink;
    c.font = "600 " + TITLE_PX + "px 'Bricolage Grotesque', 'Public Sans', sans-serif";
    lines.forEach((ln,i)=>c.fillText(ln, pad, pad + 62 + i*TITLE_LH));

    if(subText){
      c.fillStyle = theme.soft;
      c.font = "400 26px 'Public Sans', sans-serif";
      c.fillText(subText, pad, pad + lines.length*TITLE_LH + 30);
    }

    c.drawImage(off, pad, headH);

    c.strokeStyle = theme.rule; c.lineWidth = 2;
    c.beginPath(); c.moveTo(pad, EXPORT_H - footH + 44); c.lineTo(EXPORT_W - pad, EXPORT_H - footH + 44); c.stroke();
    c.fillStyle = theme.soft; c.font = "400 24px 'IBM Plex Mono', monospace";
    c.fillText(els.stamp.textContent, pad, EXPORT_H - footH + 84);

    tmp.destroy(); holder.remove();

    out.toBlob(blob=>{
      const a = document.createElement("a");
      a.download = safeName(els.slug.value) + "-" + type + "-2400x1600" +
        (mode === "transparent" ? "-transparent" : "") + ".png";
      a.href = URL.createObjectURL(blob);
      a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href), 5000);
    }, "image/png");
    setStatus("ok", "Exported a 2400 × 1600 PNG with a " + mode + " background.");
  }catch(err){
    setStatus("err", "Export failed: " + err.message);
  }finally{
    els.png.disabled = false; els.png.textContent = prevLabel;
  }
});

// Excel, Sheets and LibreOffice treat a cell beginning with = + - @ (or a control
// character) as a formula and may execute it on open. Entity names and column
// headers come from the loaded CSV, so a hostile file could smuggle one through
// our export into the recipient's spreadsheet. Prefix those with an apostrophe.
function csvCell(v){
  let s = String(v);
  if(/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

els.csv.addEventListener("click", ()=>{
  const y0=parseInt(els.y0.value,10), y1=parseInt(els.y1.value,10);
  const lines = ["Entity,Year," + csvCell(DATA.fullLabel)];
  picked.forEach(e=>series(e).forEach(p=>lines.push(csvCell(e) + "," + p.y + "," + p.v)));
  const a=document.createElement("a");
  a.download=safeName(els.slug.value)+"-"+y0+"-"+y1+".csv";
  a.href=URL.createObjectURL(new Blob([lines.join("\n")],{type:"text/csv"}));
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 5000);
});

/* ---------------- wiring ---------------- */
els.form.addEventListener("submit", e=>{ e.preventDefault(); load(els.slug.value); });
els.load.addEventListener("click", ()=>load(els.slug.value));
els.preset.addEventListener("change", ()=>{ els.slug.value = els.preset.value; els.title.value=""; load(els.preset.value); });
els.types.addEventListener("click", e=>{
  const b=e.target.closest("button[data-t]"); if(!b) return;
  type=b.dataset.t;
  [...els.types.querySelectorAll("button")].forEach(x=>x.setAttribute("aria-pressed", String(x===b)));
  draw();
});
["y0","y1","scale","marks","names","bg"].forEach(k=>els[k].addEventListener("change", ()=>{
  if(k==="y0" && parseInt(els.y0.value)>parseInt(els.y1.value)) els.y1.value=els.y0.value;
  if(k==="y1" && parseInt(els.y1.value)<parseInt(els.y0.value)) els.y0.value=els.y1.value;
  draw();
}));
els.title.addEventListener("input", ()=>{ if(chart) draw(); });
els.usepaste.addEventListener("click", ()=>{
  try{ ingest(els.paste.value, "pasted CSV"); }
  catch(err){ setStatus("err", err.message); }
});
els.usefile.addEventListener("click", ()=>els.file.click());
els.file.addEventListener("change", ()=>{
  const f=els.file.files[0]; if(!f) return;
  const r=new FileReader();
  r.onload=()=>{ try{ ingest(String(r.result), f.name); }catch(err){ setStatus("err", err.message); } };
  r.readAsText(f);
});

load("life-expectancy");
