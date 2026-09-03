// Pull real geometry from OpenStreetMap (Overpass API) for three overlays:
//   - the San Francisco city/county boundary
//   - a short curated list of major arterials that divide the districts
//   - district (neighbourhood) label points
// Output: streets.json, consumed by build-sf.mjs.
import fs from "node:fs";

const BBOX = [37.7020, -122.5250, 37.8180, -122.3550]; // matches fetch-dem.mjs
const OUT = new URL("./streets.json", import.meta.url).pathname;

// Arterials chosen because each one separates districts a newcomer needs to
// tell apart. Kept short on purpose — this is a topo sheet, not a street map.
const ARTERIALS = [
  "Market Street", "Van Ness Avenue", "Geary Boulevard", "Divisadero Street",
  "19th Avenue", "Sunset Boulevard", "Lincoln Way", "Fulton Street",
  "Columbus Avenue", "Mission Street", "Cesar Chavez Street", "Portola Drive",
  "Great Highway", "The Embarcadero", "Bayshore Boulevard", "Sloat Boulevard",
  "Junipero Serra Boulevard", "3rd Street", "California Street", "Ocean Avenue",
];
const FREEWAYS = ["Southern Embarcadero Freeway", "James Lick Freeway", "Junipero Serra Freeway", "Bayshore Freeway"];

// District labels come from OSM's own `place` tiers: suburb and quarter are the
// coarse districts a newcomer needs; the neighbourhood tier below them (Cole
// Valley, Polk Gulch, Duboce Triangle…) is too fine for a topo sheet.
// Quarters that only subdivide a suburb already on the sheet are dropped.
const DISTRICT_TIERS = ["suburb", "quarter"];
const DISTRICT_DROP = new Set([
  "Inner Richmond", "Outer Richmond", "Inner Sunset", "Outer Sunset", "Parkside",
  "Civic Center", "Tenderloin", "Union Square",
]);

const EP = "https://overpass-api.de/api/interpreter";

async function overpass(q) {
  for (let t = 1; t <= 4; t++) {
    const res = await fetch(EP, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "claude-code-research/1.0",
        "Accept": "application/json",
      },
      body: new URLSearchParams({ data: q }),
    });
    if (res.ok) return res.json();
    await new Promise((r) => setTimeout(r, 4000 * t));
  }
  throw new Error("overpass failed");
}

const bb = BBOX.join(",");

// ---- 1. arterials + freeways -------------------------------------------------
const nameFilter = [...ARTERIALS, ...FREEWAYS]
  .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");
// Road classes only: the busway, cycleway and footway ways that carry the
// same street name would draw the line two or three times over. Tertiary and
// residential are needed because car-free downtown Market is tagged that way.
const roadQ = `[out:json][timeout:120];
way["highway"~"^(motorway|motorway_link|trunk|primary|secondary|tertiary|residential)$"]["name"~"^(${nameFilter})$"](${bb});
out geom;`;

// ---- 2. city boundary --------------------------------------------------------
const boundQ = `[out:json][timeout:120];
relation["boundary"="administrative"]["admin_level"="6"]["name"="San Francisco"];
out geom;`;

// ---- 3. district label points ------------------------------------------------
const distQ = `[out:json][timeout:120];
(
  node["place"~"^(${DISTRICT_TIERS.join("|")})$"](${bb});
  way["place"~"^(${DISTRICT_TIERS.join("|")})$"](${bb});
  relation["place"~"^(${DISTRICT_TIERS.join("|")})$"](${bb});
);
out center;`;

console.log("fetching roads…");
const roads = await overpass(roadQ);
await new Promise((r) => setTimeout(r, 2000));
console.log("fetching boundary…");
const bound = await overpass(boundQ);
await new Promise((r) => setTimeout(r, 2000));
console.log("fetching districts…");
const dist = await overpass(distQ);

// --- stitch way segments that share endpoints into long polylines -------------
const key = (p) => p[0].toFixed(6) + "," + p[1].toFixed(6);

function stitch(pieces) {
  const lines = pieces.map((p) => p.slice());
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let a = 0; a < lines.length; a++) {
      for (let b = a + 1; b < lines.length; b++) {
        const A = lines[a], B = lines[b];
        if (key(A[A.length - 1]) === key(B[0])) { lines[a] = A.concat(B.slice(1)); lines.splice(b, 1); merged = true; break outer; }
        if (key(A[A.length - 1]) === key(B[B.length - 1])) { lines[a] = A.concat(B.slice(0, -1).reverse()); lines.splice(b, 1); merged = true; break outer; }
        if (key(A[0]) === key(B[B.length - 1])) { lines[a] = B.concat(A.slice(1)); lines.splice(b, 1); merged = true; break outer; }
        if (key(A[0]) === key(B[0])) { lines[a] = A.slice().reverse().concat(B.slice(1)); lines.splice(b, 1); merged = true; break outer; }
      }
    }
  }
  return lines;
}

// Douglas–Peucker, tolerance in degrees.
function simplify(line, tol) {
  if (line.length < 3) return line;
  let maxD = 0, idx = 0;
  const [x1, y1] = line[0], [x2, y2] = line[line.length - 1];
  const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
  for (let i = 1; i < line.length - 1; i++) {
    const [px, py] = line[i];
    let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= tol) return [line[0], line[line.length - 1]];
  return simplify(line.slice(0, idx + 1), tol).slice(0, -1).concat(simplify(line.slice(idx), tol));
}

const byName = new Map();
for (const w of roads.elements) {
  if (!w.geometry || !w.tags?.name) continue;
  const pts = w.geometry.map((g) => [g.lon, g.lat]);
  if (!byName.has(w.tags.name)) byName.set(w.tags.name, { pieces: [], ref: null });
  const e = byName.get(w.tags.name);
  e.pieces.push(pts);
  if (!e.ref && w.tags.ref) e.ref = w.tags.ref.split(";")[0];
}

const TOL = 0.00022; // ~20 m — enough to keep street shape, drop node noise
const kmOf = (l) => {
  let m = 0;
  for (let i = 1; i < l.length; i++) m += Math.hypot((l[i][0] - l[i - 1][0]) * 88, (l[i][1] - l[i - 1][1]) * 111);
  return m;
};

const streets = [];
for (const [name, entry] of byName) {
  const isFwy = FREEWAYS.includes(name);
  const joined = stitch(entry.pieces).map((l) => simplify(l, TOL));
  // Downtown Market Street alone is 200-odd ways with junction splits, so a
  // single stitched run never covers a whole street. Draw every segment;
  // label off the longest stitched run.
  const seg = joined.filter((l) => kmOf(l) > 0.08);
  const lines = joined.filter((l) => kmOf(l) > 0.45).sort((a, b) => kmOf(b) - kmOf(a)).slice(0, 3);
  if (seg.length) streets.push({ n: name, fwy: isFwy, ref: entry.ref, seg, lines: lines.length ? lines : seg.slice(0, 1) });
}

const rel = bound.elements.find((e) => e.type === "relation");
let boundary = [];
if (rel) {
  const outers = rel.members.filter((m) => m.role === "outer" && m.geometry).map((m) => m.geometry.map((g) => [g.lon, g.lat]));
  boundary = stitch(outers).map((l) => simplify(l, 0.00035)).sort((a, b) => b.length - a.length).slice(0, 4);
}

const districts = dist.elements
  .filter((e) => e.tags?.name && !DISTRICT_DROP.has(e.tags.name))
  .map((e) => ({
    n: e.tags.name,
    tier: e.tags.place === "suburb" ? 0 : 1,
    lon: e.center ? e.center.lon : e.lon,
    lat: e.center ? e.center.lat : e.lat,
  }))
  .filter((d) => d.lon != null && d.lat >= BBOX[0] && d.lat <= BBOX[2] && d.lon >= BBOX[1] && d.lon <= BBOX[3])
  .sort((a, b) => a.tier - b.tier);

// de-dupe districts by name, keep the first
const seen = new Set();
const dOut = districts.filter((d) => (seen.has(d.n) ? false : (seen.add(d.n), true)));

fs.writeFileSync(OUT, JSON.stringify({ streets, boundary, districts: dOut }));
console.log(`streets: ${streets.length} named (${streets.map((s) => s.n).join(", ")})`);
console.log(`boundary rings: ${boundary.length}, districts: ${dOut.length}`);
console.log(`wrote streets.json (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
