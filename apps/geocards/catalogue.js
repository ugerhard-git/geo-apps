/**
 * GeoCards — the catalogue of every card on offer: where its data comes
 * from, how it is formatted and how it is ranked.
 */

import {
  fmtArea,
  fmtCount,
  fmtMoney,
  fmtNum,
  fmtPct,
  fmtPeople,
  fmtPerHead,
  nf,
  rankAmong,
} from "./format.js";
import {
  FB_EDITION,
  fbAmount,
  fbBorders,
  fbPoint,
  fbProse,
  fbReligions,
  fbReligionText,
  fbText,
} from "./data.js";

/* ============================================================
 5. Card catalogue
 ============================================================ */
export const ISO = "ISO 3166 reference data";
export const RCS = "REST Countries";
export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
export const MEMBER_LABELS = {
  un: "UN",
  eu: "EU",
  eurozone: "Eurozone",
  schengen: "Schengen",
  nato: "NATO",
  commonwealth: "Commonwealth",
  oecd: "OECD",
  g7: "G7",
  g20: "G20",
  brics: "BRICS",
  opec: "OPEC",
  african_union: "African Union",
  asean: "ASEAN",
  arab_league: "Arab League",
};
export const title = (s) =>
  String(s || "")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (m) => m.toUpperCase());

export function wbCard(ctx, code, c, fmt) {
  const set = ctx.wb.get(code);
  const row = set && set.byIso.get(c.iso3);
  if (!row) return null;
  return {
    ...fmt(row.value),
    rank: rankAmong(set.values, row.value),
    source: "World Bank, " + row.year,
  };
}

/* population: the reference set carries it under a key, otherwise the bank does */
export function populationOf(c, ctx) {
  if (c.population != null) {
    const all = ctx.atlas.map((y) => y.population).filter((v) => typeof v === "number");
    return { value: c.population, rank: rankAmong(all, c.population), source: ctx.refSource };
  }
  const set = ctx.wb.get("SP.POP.TOTL");
  const row = set && set.byIso.get(c.iso3);
  if (!row) return null;
  return {
    value: row.value,
    rank: rankAmong(set.values, row.value),
    source: "World Bank, " + row.year,
  };
}

export const CARDS = [
  /* --- People --- */
  {
    id: "population",
    label: "Population",
    group: "People",
    wb: "SP.POP.TOTL",
    kind: "stat",
    build: (c, x) => {
      const p = populationOf(c, x);
      return p ? { ...fmtPeople(p.value), rank: p.rank, source: p.source } : null;
    },
  },
  {
    id: "density",
    label: "Population density",
    group: "People",
    wb: "SP.POP.TOTL",
    kind: "stat",
    build: (c, x) => {
      const p = populationOf(c, x);
      if (!p || !c.area) return null;
      const v = p.value / c.area;
      const all = [];
      x.atlas.forEach((y) => {
        if (!y.area) return;
        const pop =
          y.population != null
            ? y.population
            : x.wb.get("SP.POP.TOTL") && (x.wb.get("SP.POP.TOTL").byIso.get(y.iso3) || {}).value;
        if (pop) all.push(pop / y.area);
      });
      return {
        ...fmtNum(v, "people per square kilometre", v < 10 ? 1 : 0),
        rank: rankAmong(all, v),
        source: p.source,
      };
    },
  },
  {
    id: "languages",
    label: "Official languages",
    group: "People",
    kind: "text",
    build: (c, x) => {
      const L = c.languages;
      if (!L.length) return null;
      if (L.length <= 2)
        return {
          big: L.join(" and "),
          unit: L.length === 1 ? "the one official language" : "the two official languages",
          detail: "",
          source: x.refSource,
        };
      return {
        big: String(L.length),
        unit: "official languages",
        detail: L.join(", "),
        source: x.refSource,
      };
    },
  },
  {
    id: "lifeexp",
    label: "Life expectancy at birth",
    group: "People",
    wb: "SP.DYN.LE00.IN",
    kind: "stat",
    build: (c, x) => wbCard(x, "SP.DYN.LE00.IN", c, (v) => fmtNum(v, "years")),
  },
  {
    id: "urban",
    label: "Living in urban areas",
    group: "People",
    wb: "SP.URB.TOTL.IN.ZS",
    kind: "stat",
    build: (c, x) => wbCard(x, "SP.URB.TOTL.IN.ZS", c, (v) => fmtPct(v, "of the population")),
  },
  {
    id: "fertility",
    label: "Births per woman",
    group: "People",
    wb: "SP.DYN.TFRT.IN",
    kind: "stat",
    build: (c, x) =>
      wbCard(x, "SP.DYN.TFRT.IN", c, (v) => fmtNum(v, "children, lifetime average", 2)),
  },
  {
    id: "popgrowth",
    label: "Annual population growth",
    group: "People",
    wb: "SP.POP.GROW",
    kind: "stat",
    build: (c, x) => wbCard(x, "SP.POP.GROW", c, (v) => fmtPct(v, "change per year")),
  },
  {
    id: "infant",
    label: "Infant mortality",
    group: "People",
    wb: "SP.DYN.IMRT.IN",
    kind: "stat",
    build: (c, x) =>
      wbCard(x, "SP.DYN.IMRT.IN", c, (v) => fmtNum(v, "deaths per 1,000 live births")),
  },

  /* --- Economy --- */
  {
    id: "gdp",
    label: "Gross domestic product",
    group: "Economy",
    wb: "NY.GDP.MKTP.CD",
    kind: "stat",
    build: (c, x) => wbCard(x, "NY.GDP.MKTP.CD", c, fmtMoney),
  },
  {
    id: "gdppc",
    label: "GDP per person",
    group: "Economy",
    wb: "NY.GDP.PCAP.CD",
    kind: "stat",
    build: (c, x) => wbCard(x, "NY.GDP.PCAP.CD", c, fmtPerHead),
  },
  {
    id: "gdpgrowth",
    label: "Annual GDP growth",
    group: "Economy",
    wb: "NY.GDP.MKTP.KD.ZG",
    kind: "stat",
    build: (c, x) => wbCard(x, "NY.GDP.MKTP.KD.ZG", c, (v) => fmtPct(v, "change per year")),
  },
  {
    id: "unemp",
    label: "Unemployment",
    group: "Economy",
    wb: "SL.UEM.TOTL.ZS",
    kind: "stat",
    build: (c, x) => wbCard(x, "SL.UEM.TOTL.ZS", c, (v) => fmtPct(v, "of the labour force")),
  },
  {
    id: "gini",
    label: "Income inequality",
    group: "Economy",
    wb: "SI.POV.GINI",
    kind: "stat",
    build: (c, x) =>
      wbCard(x, "SI.POV.GINI", c, (v) => fmtNum(v, "Gini index, 0 is perfect equality")),
  },
  {
    id: "health",
    label: "Spending on health",
    group: "Economy",
    wb: "SH.XPD.CHEX.GD.ZS",
    kind: "stat",
    build: (c, x) => wbCard(x, "SH.XPD.CHEX.GD.ZS", c, (v) => fmtPct(v, "of GDP")),
  },
  {
    id: "education",
    label: "Spending on education",
    group: "Economy",
    wb: "SE.XPD.TOTL.GD.ZS",
    kind: "stat",
    build: (c, x) => wbCard(x, "SE.XPD.TOTL.GD.ZS", c, (v) => fmtPct(v, "of GDP")),
  },
  {
    id: "military",
    label: "Spending on defence",
    group: "Economy",
    wb: "MS.MIL.XPND.GD.ZS",
    kind: "stat",
    build: (c, x) => wbCard(x, "MS.MIL.XPND.GD.ZS", c, (v) => fmtPct(v, "of GDP")),
  },
  {
    id: "tourism",
    label: "International visitors",
    group: "Economy",
    wb: "ST.INT.ARVL",
    kind: "stat",
    build: (c, x) => wbCard(x, "ST.INT.ARVL", c, (v) => fmtCount(v, "arrivals per year")),
  },
  {
    id: "currency",
    label: "Currency",
    group: "Economy",
    kind: "text",
    build: (c, x) => {
      const e = c.currencies;
      if (!e.length) return null;
      const f = e[0];
      return {
        big: (f.symbol ? f.symbol + " " : "") + f.code,
        unit:
          e.length > 1 ? "one of " + e.length + " currencies in use" : "the one currency in use",
        detail: "",
        source: x.refSource,
      };
    },
  },

  /* --- Land --- */
  {
    id: "area",
    label: "Land area",
    group: "Land",
    kind: "stat",
    build: (c, x) =>
      c.area == null
        ? null
        : { ...fmtArea(c.area), rank: rankAmong(x.area, c.area), source: x.refSource },
  },
  {
    id: "borders",
    label: "Countries it borders",
    group: "Land",
    kind: "stat",
    build: (c, x) => {
      const v = c.borders.length;
      return {
        ...fmtNum(v, v === 1 ? "land neighbour" : "land neighbours", 0),
        rank: rankAmong(x.bord, v),
        source: x.refSource,
      };
    },
  },
  {
    id: "longestborder",
    label: "Longest single land border",
    group: "Land",
    fb: true,
    kind: "stat",
    build: (c, x) => {
      const B = fbBorders(x.fb);
      if (!B) return null;
      const km = Math.max(...B.map((b) => b.km));
      return {
        ...fmtNum(
          km,
          B.length === 1 ? "kilometres, its only border" : "kilometres, with one neighbour",
          0,
        ),
        source: FB_EDITION,
      };
    },
  },
  {
    id: "shortestborder",
    label: "Shortest single land border",
    group: "Land",
    fb: true,
    kind: "stat",
    build: (c, x) => {
      const B = fbBorders(x.fb);
      if (!B) return null;
      const km = Math.min(...B.map((b) => b.km));
      return {
        ...fmtNum(
          km,
          B.length === 1 ? "kilometres, its only border" : "kilometres, with one neighbour",
          0,
        ),
        source: FB_EDITION,
      };
    },
  },
  {
    id: "region",
    label: "Continental region",
    group: "Land",
    kind: "category",
    build: (c, x) =>
      !c.region
        ? null
        : {
            big: c.region,
            unit: "",
            share: shareOf(x.atlas, (y) => y.region === c.region),
            source: x.refSource,
          },
  },
  {
    id: "subregion",
    label: "Sub-region",
    group: "Land",
    kind: "category",
    build: (c, x) =>
      !c.subregion
        ? null
        : {
            big: c.subregion,
            unit: "",
            share: shareOf(x.atlas, (y) => y.subregion === c.subregion),
            source: x.refSource,
          },
  },
  {
    id: "landlocked",
    label: "Access to the sea",
    group: "Land",
    kind: "category",
    build: (c, x) => ({
      big: c.landlocked ? "Landlocked" : "Has a coast",
      unit: "",
      share: shareOf(x.atlas, (y) => !!y.landlocked === !!c.landlocked),
      source: x.refSource,
    }),
  },
  {
    id: "timezones",
    label: "Time zones",
    group: "Land",
    kind: "text",
    needs: "rc",
    build: (c, x) => {
      const z = c.timezones;
      if (!z) return null;
      if (z.length === 1)
        return { big: z[0], unit: "the one time zone", detail: "", source: x.refSource };
      return {
        big: String(z.length),
        unit: "time zones",
        detail:
          z.slice(0, 6).join(", ") + (z.length > 6 ? ", and " + (z.length - 6) + " more" : ""),
        source: x.refSource,
      };
    },
  },

  /* --- Environment --- */
  {
    id: "forest",
    label: "Forest cover",
    group: "Environment",
    wb: "AG.LND.FRST.ZS",
    kind: "stat",
    build: (c, x) => wbCard(x, "AG.LND.FRST.ZS", c, (v) => fmtPct(v, "of the land area")),
  },
  {
    id: "co2",
    label: "Carbon dioxide per person",
    group: "Environment",
    wb: "EN.GHG.CO2.PC.CE.AR5",
    kind: "stat",
    build: (c, x) =>
      wbCard(x, "EN.GHG.CO2.PC.CE.AR5", c, (v) => fmtNum(v, "tonnes per person, per year", 2)),
  },
  {
    id: "internet",
    label: "People using the internet",
    group: "Environment",
    wb: "IT.NET.USER.ZS",
    kind: "stat",
    build: (c, x) => wbCard(x, "IT.NET.USER.ZS", c, (v) => fmtPct(v, "of the population")),
  },
  {
    id: "electricity",
    label: "Access to electricity",
    group: "Environment",
    wb: "EG.ELC.ACCS.ZS",
    kind: "stat",
    build: (c, x) => wbCard(x, "EG.ELC.ACCS.ZS", c, (v) => fmtPct(v, "of the population")),
  },

  /* --- Everyday life --- */
  {
    id: "driving",
    label: "Traffic drives on the",
    group: "Everyday life",
    kind: "category",
    needs: "rc",
    build: (c, x) => {
      const s = c.drivingSide;
      if (!s) return null;
      return {
        big: title(s),
        unit: "",
        share: shareOf(x.atlas, (y) => y.drivingSide === s),
        source: x.refSource,
      };
    },
  },
  {
    id: "startofweek",
    label: "The week starts on",
    group: "Everyday life",
    kind: "category",
    needs: "rc",
    build: (c, x) => {
      const d = c.startOfWeek;
      if (!d) return null;
      return {
        big: title(d),
        unit: "",
        share: shareOf(x.atlas, (y) => y.startOfWeek === d),
        source: x.refSource,
      };
    },
  },
  {
    id: "measurement",
    label: "System of measurement",
    group: "Everyday life",
    kind: "category",
    needs: "rc",
    build: (c, x) => {
      const m = c.measurement;
      if (!m) return null;
      return {
        big: title(m),
        unit: "",
        share: shareOf(x.atlas, (y) => y.measurement === m),
        source: x.refSource,
      };
    },
  },
  {
    id: "temperature",
    label: "Temperature is measured in",
    group: "Everyday life",
    kind: "category",
    needs: "rc",
    build: (c, x) => {
      const t = c.temperature;
      if (!t) return null;
      return {
        big: title(t),
        unit: "",
        share: shareOf(x.atlas, (y) => y.temperature === t),
        source: x.refSource,
      };
    },
  },
  {
    id: "numberformat",
    label: "A million and a half is written",
    group: "Everyday life",
    kind: "text",
    needs: "rc",
    build: (c, x) => {
      const f = c.numberFormat;
      if (!f) return null;
      const grouped = "1" + f.thousands + "500" + f.thousands + "000" + f.decimal + "50";
      return { big: grouped, unit: "local number formatting", detail: "", source: x.refSource };
    },
  },
  {
    id: "postal",
    label: "Postal codes look like",
    group: "Everyday life",
    kind: "text",
    needs: "rc",
    build: (c, x) => {
      const p = c.postalFormat;
      if (!p) return null;
      return { big: p, unit: "# stands for a digit", detail: "", source: x.refSource };
    },
  },
  {
    id: "academic",
    label: "The school year begins",
    group: "Everyday life",
    kind: "text",
    needs: "rc",
    build: (c, x) => {
      const a = c.academicYear;
      if (!a) return null;
      return {
        big: (a.day ? a.day + " " : "") + MONTHS[a.month - 1],
        unit: "start of the academic year",
        detail: "",
        source: x.refSource,
      };
    },
  },
  {
    id: "fiscal",
    label: "The fiscal year begins",
    group: "Everyday life",
    kind: "text",
    needs: "rc",
    build: (c, x) => {
      const f = c.fiscalYear;
      if (!f) return null;
      return {
        big: (f.day ? f.day + " " : "") + MONTHS[f.month - 1],
        unit: "government fiscal year",
        detail: "",
        source: x.refSource,
      };
    },
  },

  /* --- Standing --- */
  {
    id: "unmember",
    label: "United Nations seat",
    group: "Standing",
    kind: "category",
    build: (c, x) => ({
      big: c.unMember ? "A member state" : "Not a member",
      unit: "",
      share: shareOf(x.atlas, (y) => !!y.unMember === !!c.unMember),
      source: x.refSource,
    }),
  },
  {
    id: "ungroup",
    label: "UN regional group",
    group: "Standing",
    kind: "category",
    build: (c, x) =>
      !c.unGroup
        ? null
        : {
            big: c.unGroup,
            unit: "",
            share: shareOf(x.atlas, (y) => y.unGroup === c.unGroup),
            source: x.refSource,
          },
  },
  {
    id: "independent",
    label: "Sovereignty",
    group: "Standing",
    kind: "category",
    build: (c, x) => ({
      big: c.sovereign ? "A sovereign state" : "A dependent territory",
      unit: "",
      share: shareOf(x.atlas, (y) => !!y.sovereign === !!c.sovereign),
      source: x.refSource,
    }),
  },
  {
    id: "memberships",
    label: "International memberships",
    group: "Standing",
    kind: "text",
    needs: "rc",
    build: (c, x) => {
      const m = c.memberships;
      if (!m) return null;
      const on = Object.keys(MEMBER_LABELS)
        .filter((k) => m[k])
        .map((k) => MEMBER_LABELS[k]);
      if (!on.length)
        return {
          big: "None",
          unit: "of the blocs tracked here",
          detail: "",
          source: x.refSource,
        };
      if (on.length <= 2)
        return {
          big: on.join(" and "),
          unit: on.length === 1 ? "the one bloc it belongs to" : "the blocs it belongs to",
          detail: "",
          source: x.refSource,
        };
      return {
        big: String(on.length),
        unit: "blocs and treaty organisations",
        detail: on.join(", "),
        source: x.refSource,
      };
    },
  },
  {
    id: "government",
    label: "Form of government",
    group: "Standing",
    kind: "text",
    needs: "rc",
    build: (c, x) => {
      const g = c.governmentType;
      if (!g) return null;
      return { big: title(g), unit: "", detail: "", source: x.refSource };
    },
  },

  /* --- Elevation and terrain (Factbook) --- */
  {
    id: "meanelev",
    label: "Mean elevation",
    group: "Elevation and terrain",
    fb: true,
    kind: "stat",
    build: (c, x) => {
      const v = fbAmount(fbText(x.fb, "Geography", "Elevation", "mean elevation"), "m");
      return v == null ? null : { ...fmtNum(v, "metres above sea level", 0), source: FB_EDITION };
    },
  },
  {
    id: "highelev",
    label: "Highest point",
    group: "Elevation and terrain",
    fb: true,
    kind: "stat",
    build: (c, x) => {
      const p = fbPoint(fbText(x.fb, "Geography", "Elevation", "highest point"));
      return !p || p.metres == null
        ? null
        : { ...fmtNum(p.metres, "metres above sea level", 0), source: FB_EDITION };
    },
  },
  {
    id: "lowelev",
    label: "Lowest point",
    group: "Elevation and terrain",
    fb: true,
    kind: "stat",
    build: (c, x) => {
      const p = fbPoint(fbText(x.fb, "Geography", "Elevation", "lowest point"));
      return !p || p.metres == null
        ? null
        : {
            ...fmtNum(
              p.metres,
              p.metres === 0 ? "metres, at sea level" : "metres above sea level",
              0,
            ),
            source: FB_EDITION,
          };
    },
  },
  {
    id: "relief",
    label: "Height from lowest to highest",
    group: "Elevation and terrain",
    fb: true,
    kind: "stat",
    build: (c, x) => {
      const hi = fbPoint(fbText(x.fb, "Geography", "Elevation", "highest point"));
      const lo = fbPoint(fbText(x.fb, "Geography", "Elevation", "lowest point"));
      if (!hi || !lo || hi.metres == null || lo.metres == null) return null;
      return {
        ...fmtNum(hi.metres - lo.metres, "metres of vertical range", 0),
        source: FB_EDITION,
      };
    },
  },
  {
    id: "coastline",
    label: "Length of coastline",
    group: "Elevation and terrain",
    fb: true,
    kind: "stat",
    build: (c, x) => {
      const v = fbAmount(fbText(x.fb, "Geography", "Coastline"), "km");
      return v == null
        ? null
        : {
            ...fmtNum(v, v === 0 ? "kilometres, it is landlocked" : "kilometres", 0),
            source: FB_EDITION,
          };
    },
  },
  {
    id: "boundaries",
    label: "Length of land borders",
    group: "Elevation and terrain",
    fb: true,
    kind: "stat",
    build: (c, x) => {
      const v = fbAmount(fbText(x.fb, "Geography", "Land boundaries", "total"), "km");
      return v == null ? null : { ...fmtNum(v, "kilometres", 0), source: FB_EDITION };
    },
  },
  {
    id: "watershare",
    label: "Share of the territory that is water",
    group: "Elevation and terrain",
    fb: true,
    kind: "stat",
    build: (c, x) => {
      const tot = fbAmount(fbText(x.fb, "Geography", "Area", "total"), "sq km");
      const wat = fbAmount(fbText(x.fb, "Geography", "Area", "water"), "sq km");
      if (!tot || wat == null) return null;
      return { ...fmtPct((wat / tot) * 100, "of the total area"), source: FB_EDITION };
    },
  },
  {
    id: "terrain",
    label: "The lie of the land",
    group: "Elevation and terrain",
    fb: true,
    kind: "prose",
    build: (c, x) => {
      const t = fbProse(fbText(x.fb, "Geography", "Terrain"));
      return t ? { big: t, unit: "", source: FB_EDITION } : null;
    },
  },
  {
    id: "climate",
    label: "Climate",
    group: "Elevation and terrain",
    fb: true,
    kind: "prose",
    build: (c, x) => {
      const t = fbProse(fbText(x.fb, "Geography", "Climate"));
      return t ? { big: t, unit: "", source: FB_EDITION } : null;
    },
  },
  {
    id: "resources",
    label: "Natural resources",
    group: "Elevation and terrain",
    fb: true,
    kind: "prose",
    build: (c, x) => {
      const t = fbProse(fbText(x.fb, "Geography", "Natural resources"));
      return t ? { big: t, unit: "", source: FB_EDITION } : null;
    },
  },
  {
    id: "hazards",
    label: "Natural hazards",
    group: "Elevation and terrain",
    fb: true,
    kind: "prose",
    build: (c, x) => {
      const t = fbProse(fbText(x.fb, "Geography", "Natural hazards"));
      return t ? { big: t, unit: "", source: FB_EDITION } : null;
    },
  },

  /* --- more land and water, from the bank --- */
  {
    id: "rainfall",
    label: "Average yearly rainfall",
    group: "Environment",
    wb: "AG.LND.PRCP.MM",
    kind: "stat",
    build: (c, x) => wbCard(x, "AG.LND.PRCP.MM", c, (v) => fmtNum(v, "millimetres of depth", 0)),
  },
  {
    id: "lowland",
    label: "Land lying below five metres",
    group: "Environment",
    wb: "AG.LND.EL5M.ZS",
    kind: "stat",
    build: (c, x) => wbCard(x, "AG.LND.EL5M.ZS", c, (v) => fmtPct(v, "of the land area")),
  },
  {
    id: "lowpop",
    label: "People living below five metres",
    group: "Environment",
    wb: "EN.POP.EL5M.ZS",
    kind: "stat",
    build: (c, x) => wbCard(x, "EN.POP.EL5M.ZS", c, (v) => fmtPct(v, "of the population")),
  },
  {
    id: "protected",
    label: "Protected land",
    group: "Environment",
    wb: "ER.LND.PTLD.ZS",
    kind: "stat",
    build: (c, x) => wbCard(x, "ER.LND.PTLD.ZS", c, (v) => fmtPct(v, "of the land area")),
  },
  {
    id: "arable",
    label: "Arable land",
    group: "Environment",
    wb: "AG.LND.ARBL.ZS",
    kind: "stat",
    build: (c, x) => wbCard(x, "AG.LND.ARBL.ZS", c, (v) => fmtPct(v, "of the land area")),
  },
  {
    id: "agriland",
    label: "Agricultural land",
    group: "Environment",
    wb: "AG.LND.AGRI.ZS",
    kind: "stat",
    build: (c, x) => wbCard(x, "AG.LND.AGRI.ZS", c, (v) => fmtPct(v, "of the land area")),
  },
  {
    id: "freshwater",
    label: "Renewable fresh water",
    group: "Environment",
    wb: "ER.H2O.INTR.PC",
    kind: "stat",
    build: (c, x) =>
      wbCard(x, "ER.H2O.INTR.PC", c, (v) => fmtCount(v, "cubic metres per person, per year")),
  },
  {
    id: "irrigated",
    label: "Irrigated farmland",
    group: "Environment",
    wb: "AG.LND.IRIG.AG.ZS",
    kind: "stat",
    build: (c, x) => wbCard(x, "AG.LND.IRIG.AG.ZS", c, (v) => fmtPct(v, "of agricultural land")),
  },

  /* --- Belief (Factbook) --- */
  {
    id: "religion",
    label: "Largest religious group",
    group: "Belief",
    fb: true,
    kind: "text",
    build: (c, x) => {
      const R = fbReligions(fbReligionText(x.fb));
      if (!R) return null;
      const faiths = R.filter((r) => !r.none && !r.other);
      if (!faiths.length) return null;
      const top = faiths.reduce((a, b) => (b.pct > a.pct ? b : a));
      return {
        big: top.name,
        unit: nf(top.pct, 1) + "% of the population",
        detail: "",
        source: FB_EDITION,
      };
    },
  },
  {
    id: "religionshare",
    label: "Share in the largest religious group",
    group: "Belief",
    fb: true,
    kind: "stat",
    build: (c, x) => {
      const R = fbReligions(fbReligionText(x.fb));
      if (!R) return null;
      const faiths = R.filter((r) => !r.none && !r.other);
      if (!faiths.length) return null;
      const top = faiths.reduce((a, b) => (b.pct > a.pct ? b : a));
      return { ...fmtPct(top.pct, "belong to the single largest group"), source: FB_EDITION };
    },
  },
  {
    id: "noreligion",
    label: "People reporting no religion",
    group: "Belief",
    fb: true,
    kind: "stat",
    build: (c, x) => {
      const R = fbReligions(fbReligionText(x.fb));
      if (!R) return null;
      const none = R.filter((r) => r.none);
      if (!none.length) return null;
      const sum = none.reduce((a, r) => a + r.pct, 0);
      return { ...fmtPct(sum, "of the population"), source: FB_EDITION };
    },
  },
  {
    id: "faithcount",
    label: "Religious groups recorded",
    group: "Belief",
    fb: true,
    kind: "stat",
    build: (c, x) => {
      const R = fbReligions(fbReligionText(x.fb));
      if (!R) return null;
      const n = R.filter((r) => !r.none && !r.other).length;
      return n
        ? {
            ...fmtNum(n, n === 1 ? "group counted separately" : "groups counted separately", 0),
            source: FB_EDITION,
          }
        : null;
    },
  },
  {
    id: "religions",
    label: "Religious make-up",
    group: "Belief",
    fb: true,
    kind: "prose",
    build: (c, x) => {
      const raw = fbReligionText(x.fb);
      if (!raw) return null;
      const R = fbReligions(raw);
      const body = R ? R.map((r) => `${r.name} ${nf(r.pct, 1)}%`).join(", ") : fbProse(raw);
      return body ? { big: body, unit: "", source: FB_EDITION } : null;
    },
  },

  /* --- Gives it away --- */
  {
    id: "peakname",
    label: "Its highest point is called",
    group: "Gives it away",
    fb: true,
    kind: "text",
    reveals: true,
    build: (c, x) => {
      const p = fbPoint(fbText(x.fb, "Geography", "Elevation", "highest point"));
      return p && p.name
        ? {
            big: p.name,
            unit: p.metres != null ? nf(p.metres, 0) + " metres above sea level" : "",
            detail: "",
            source: FB_EDITION,
          }
        : null;
    },
  },
  {
    id: "lowname",
    label: "Its lowest point is called",
    group: "Gives it away",
    fb: true,
    kind: "text",
    reveals: true,
    build: (c, x) => {
      const p = fbPoint(fbText(x.fb, "Geography", "Elevation", "lowest point"));
      return p && p.name
        ? {
            big: p.name,
            unit: p.metres != null ? nf(p.metres, 0) + " metres above sea level" : "",
            detail: "",
            source: FB_EDITION,
          }
        : null;
    },
  },
  /* --- Gives it away --- */
  {
    id: "capital",
    label: "Capital city",
    group: "Gives it away",
    kind: "text",
    reveals: true,
    build: (c, x) => {
      const cap = c.capitals[0];
      return cap ? { big: cap, unit: "seat of government", detail: "", source: x.refSource } : null;
    },
  },
  {
    id: "demonym",
    label: "People from here are called",
    group: "Gives it away",
    kind: "text",
    reveals: true,
    build: (c, x) =>
      c.demonym ? { big: c.demonym, unit: "in English", detail: "", source: x.refSource } : null,
  },
  {
    id: "calling",
    label: "Telephone code",
    group: "Gives it away",
    kind: "text",
    reveals: true,
    build: (c, x) =>
      c.callingCode
        ? {
            big: c.callingCode,
            unit: "international dialling code",
            detail: "",
            source: x.refSource,
          }
        : null,
  },
  {
    id: "tld",
    label: "Internet domain",
    group: "Gives it away",
    kind: "text",
    reveals: true,
    build: (c, x) =>
      c.tlds[0]
        ? { big: c.tlds[0], unit: "top-level domain", detail: "", source: x.refSource }
        : null,
  },
  {
    id: "carsign",
    label: "Vehicle registration code",
    group: "Gives it away",
    kind: "text",
    reveals: true,
    needs: "rc",
    build: (c, x) =>
      c.carSigns && c.carSigns[0]
        ? {
            big: c.carSigns[0],
            unit: "the oval sticker on a car",
            detail: "",
            source: x.refSource,
          }
        : null,
  },
  {
    id: "flagcolour",
    label: "The flag is mostly",
    group: "Gives it away",
    kind: "swatch",
    reveals: true,
    needs: "rc",
    build: (c, x) =>
      c.flagColor
        ? {
            big: c.flagColor.toUpperCase(),
            unit: "the colour covering most of the flag",
            swatch: c.flagColor,
            source: x.refSource,
          }
        : null,
  },
  {
    id: "coords",
    label: "Position on the globe",
    group: "Gives it away",
    kind: "text",
    reveals: true,
    build: (c, x) => {
      if (typeof c.lat !== "number" || typeof c.lng !== "number") return null;
      return {
        big: `${Math.abs(c.lat).toFixed(1)}° ${c.lat >= 0 ? "N" : "S"}`,
        unit: `${Math.abs(c.lng).toFixed(1)}° ${c.lng >= 0 ? "E" : "W"}`,
        detail: "",
        source: x.refSource,
      };
    },
  },
];

export const DEFAULTS = ["population", "area", "gdppc", "lifeexp", "meanelev", "landlocked"];
export const GROUP_ORDER = [
  "People",
  "Belief",
  "Economy",
  "Land",
  "Elevation and terrain",
  "Environment",
  "Everyday life",
  "Standing",
  "Gives it away",
];

export function shareOf(all, pred) {
  return { n: all.filter(pred).length, total: all.length };
}
