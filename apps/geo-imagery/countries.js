/**
 * Geo imagery — country outlines from Natural Earth (TopoJSON), and which of
 * a country's landmasses count as its mainland.
 */

import { decimate, decodeArcs, distKm, mainlandSet as clusterMainland } from "../../shared/geo.js";

/* ═══════════════════════════════════════════════════════════
   TopoJSON decoding

   Arcs are decoded by shared/geo.js (decodeArcs), in-page rather than by a
   third-party library; see the comment there.
   ═══════════════════════════════════════════════════════════ */

/* Join a ring's arcs end to end; a negative index means "traverse backwards". */
export function stitch(arcIdx, arcs) {
  const ring = [];
  if (!Array.isArray(arcIdx)) return ring;
  for (const i of arcIdx) {
    if (!Number.isInteger(i)) continue;
    const arc = i < 0 ? arcs[~i] : arcs[i];
    if (!arc) continue;
    const pts = i < 0 ? arc.slice().reverse() : arc;
    ring.push(...(ring.length ? pts.slice(1) : pts));
  }
  return ring;
}

/*
  Turn a fetched topology into plain features, validating as we go. Anything
  malformed is dropped rather than trusted; this data arrives over the
  network and is never assumed to be well-formed.
*/
export function topoToFeatures(topo, objectName) {
  if (!topo || typeof topo !== "object") throw new Error("not an object");
  if (!Array.isArray(topo.arcs)) throw new Error("no arcs");
  const coll = topo.objects && topo.objects[objectName];
  if (!coll || !Array.isArray(coll.geometries)) throw new Error("no geometries");

  const arcs = decodeArcs(topo);
  const out = [];

  for (const g of coll.geometries) {
    if (!g || !Array.isArray(g.arcs)) continue;
    let coordinates;
    if (g.type === "Polygon") coordinates = g.arcs.map((r) => stitch(r, arcs));
    else if (g.type === "MultiPolygon")
      coordinates = g.arcs.map((p) => p.map((r) => stitch(r, arcs)));
    else continue;

    // Every ring needs at least a triangle's worth of real points.
    coordinates =
      g.type === "Polygon"
        ? [coordinates.filter((r) => r.length >= 4)]
        : coordinates.map((p) => p.filter((r) => r.length >= 4)).filter((p) => p.length);
    const polys = g.type === "Polygon" ? coordinates.filter((p) => p.length) : coordinates;
    if (!polys.length) continue;

    const rawName = g.properties && g.properties.name;
    const name = typeof rawName === "string" ? rawName.slice(0, 80).trim() : "";
    if (!name) continue;

    out.push({ properties: { name }, geometry: { type: "MultiPolygon", coordinates: polys } });
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════
   Country geometry
   ═══════════════════════════════════════════════════════════ */

export function ringArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i],
      q = ring[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  const meanLat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  return Math.abs(a / 2) * Math.cos((meanLat * Math.PI) / 180);
}

export function buildCountry(feature) {
  const g = feature.geometry;
  if (!g) return null;
  const raw =
    g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  if (!raw.length) return null;

  const polys = raw
    .map((rings) => {
      const outer = rings[0];
      const cx = outer.reduce((s, p) => s + p[0], 0) / outer.length;
      const cy = outer.reduce((s, p) => s + p[1], 0) / outer.length;
      const centroid = [cx, cy];
      const pts = decimate(outer, 40);
      const radius = pts.reduce((m, p) => Math.max(m, distKm(p, centroid)), 0);
      return { rings, area: ringArea(outer), pts, centroid, radius };
    })
    .sort((a, b) => b.area - a.area);

  return { name: feature.properties.name, polys, mainland: null };
}

/*
  Which landmasses count as "the mainland": start from the largest, then keep
  absorbing anything within CLUSTER_KM of what's already in. Chaining is what
  keeps Indonesia and the Philippines whole while leaving Hawaii, Svalbard and
  the Canaries out. Computed on demand and cached.
*/
export function mainlandSet(country) {
  if (!country.mainland) country.mainland = clusterMainland(country.polys);
  return country.mainland;
}
