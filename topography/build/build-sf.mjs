// Bake the sampled USGS DEM + the hill roster into the artifact HTML.
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const PROJ = path.resolve(here, "..");            // topography/

const dem = JSON.parse(fs.readFileSync(path.join(here, "dem.json"), "utf8"));
const hills = JSON.parse(fs.readFileSync(path.join(here, "hills.json"), "utf8"));
const civic = JSON.parse(fs.readFileSync(path.join(here, "streets.json"), "utf8"));
// summits on the sheet but outside the city — shown, never counted
const outside = JSON.parse(fs.readFileSync(path.join(here, "hills-outside.json"), "utf8"));
const { LAT0, LAT1, LON0, LON1, NX, NY, elev } = dem;

const M_PER_DEG_LAT = 111320;
const M_PER_DEG_LON = 111320 * Math.cos(((LAT0 + LAT1) / 2) * Math.PI / 180);
const cellX = ((LON1 - LON0) / (NX - 1)) * M_PER_DEG_LON;
const cellY = ((LAT1 - LAT0) / (NY - 1)) * M_PER_DEG_LAT;

const at = (i, j) => elev[j * NX + i] ?? 0;
const toI = (lon) => ((lon - LON0) / (LON1 - LON0)) * (NX - 1);
const toJ = (lat) => ((lat - LAT0) / (LAT1 - LAT0)) * (NY - 1);
const toLon = (i) => LON0 + (i / (NX - 1)) * (LON1 - LON0);
const toLat = (j) => LAT0 + (j / (NY - 1)) * (LAT1 - LAT0);

const isLocalMax = (i, j) => {
  const h = at(i, j);
  for (let dj = -1; dj <= 1; dj++)
    for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= NX || jj >= NY) continue;
      if (at(ii, jj) > h) return false;
    }
  return true;
};

// Nearest true local maximum to a seed coordinate. A named hill is a summit,
// so requiring a local max stops a small knob (Billy Goat Hill, Tank Hill)
// from snapping onto the shoulder of the bigger massif next door. Falls back
// to the highest cell in a tight radius when the seed sits on a broad ridge.
function snap(lat, lon, radiusM, exclude = []) {
  const ci = toI(lon), cj = toJ(lat);
  const ri = Math.ceil(radiusM / cellX), rj = Math.ceil(radiusM / cellY);
  let peak = null, high = null;
  for (let j = Math.max(0, Math.round(cj - rj)); j <= Math.min(NY - 1, Math.round(cj + rj)); j++) {
    for (let i = Math.max(0, Math.round(ci - ri)); i <= Math.min(NX - 1, Math.round(ci + ri)); i++) {
      const dx = (i - ci) * cellX, dy = (j - cj) * cellY;
      const dist = Math.hypot(dx, dy);
      if (dist > radiusM) continue;
      if (exclude.some((e) => Math.hypot((i - e.i) * cellX, (j - e.j) * cellY) < e.sep)) continue;
      const h = at(i, j);
      if (!high || h > high.h) high = { i, j, h, dist };
      if (isLocalMax(i, j) && (!peak || dist < peak.dist)) peak = { i, j, h, dist };
    }
  }
  return peak || high;
}

const M2FT = 3.280839895;
const out = [];
const twin = hills.filter((h) => h.n.startsWith("Twin Peaks"));
const twinSeed = { lat: 37.75158628, lon: -122.44772151 };

// Seed coordinates are a mix of true summits and neighbourhood centroids, so
// a plain "highest cell nearby" lands on the wrong knob in both directions:
// Billy Goat Hill climbs onto Diamond Heights, Bernal Heights sits below its
// own park. The published height says which summit is meant — so score every
// local maximum in range on how well it matches that height, with distance
// only as a tiebreaker.
function pickSummit(h) {
  const ci = toI(h.lon), cj = toJ(h.lat);
  const R = 600;
  const ri = Math.ceil(R / cellX), rj = Math.ceil(R / cellY);
  let best = null;
  for (let j = Math.max(0, Math.round(cj - rj)); j <= Math.min(NY - 1, Math.round(cj + rj)); j++) {
    for (let i = Math.max(0, Math.round(ci - ri)); i <= Math.min(NX - 1, Math.round(ci + ri)); i++) {
      const dist = Math.hypot((i - ci) * cellX, (j - cj) * cellY);
      if (dist > R || !isLocalMax(i, j)) continue;
      const score = Math.abs(at(i, j) * M2FT - h.ft) + dist * 0.16;
      if (!best || score < best.score) best = { i, j, h: at(i, j), score };
    }
  }
  if (best) return best;
  const i = Math.round(ci), j = Math.round(cj);
  return { i, j, h: at(i, j) };
}

for (const h of hills) {
  if (h.n.startsWith("Twin Peaks")) continue;
  const s = pickSummit(h);
  out.push({ ...h, dlat: +toLat(s.j).toFixed(5), dlon: +toLon(s.i).toFixed(5), dft: Math.round(s.h * M2FT), dm: Math.round(s.h) });
}

// Twin Peaks: two summits from one seed — take the highest cell, then the
// highest cell at least 250 m away from it.
if (twin.length === 2) {
  const a = snap(twinSeed.lat, twinSeed.lon, 700);
  const b = snap(twinSeed.lat, twinSeed.lon, 700, [{ i: a.i, j: a.j, sep: 250 }]);
  const north = a.j > b.j ? a : b, south = a.j > b.j ? b : a;
  for (const h of twin) {
    const s = h.n.endsWith("North") ? north : south;
    out.push({ ...h, dlat: +toLat(s.j).toFixed(5), dlon: +toLon(s.i).toFixed(5), dft: Math.round(s.h * M2FT), dm: Math.round(s.h) });
  }
}

const outsideOut = outside.map((h) => {
  const s = pickSummit(h);
  return { ...h, dlat: +toLat(s.j).toFixed(5), dlon: +toLon(s.i).toFixed(5), dft: Math.round(s.h * M2FT), dm: Math.round(s.h) };
});

out.sort((a, b) => b.dft - a.dft);
console.log(out.concat(outsideOut).map((h) => `${h.dft.toString().padStart(4)} ft (pub ${h.ft})  ${h.n}`).join("\n"));

// grid -> base64 Uint16 in decimetres (0 = sea level / water)
const u16 = new Uint16Array(NX * NY);
for (let k = 0; k < u16.length; k++) u16[k] = Math.max(0, Math.round((elev[k] ?? 0) * 10));
const b64 = Buffer.from(u16.buffer).toString("base64");

// The overlay viewBox is 1000 units wide; its height follows the sheet's true
// aspect so a kilometre reads the same in both directions.
const VH = Math.round((1000 * (LAT1 - LAT0) * M_PER_DEG_LAT) / ((LON1 - LON0) * M_PER_DEG_LON));

const payload = {
  lat0: LAT0, lat1: LAT1, lon0: LON0, lon1: LON1, nx: NX, ny: NY,
  mPerDegLon: +M_PER_DEG_LON.toFixed(2), mPerDegLat: M_PER_DEG_LAT, vh: VH,
};

const tpl = fs.readFileSync(path.join(here, "sf-hills.template.html"), "utf8");
const html = tpl
  .replace('"__GRID__"', JSON.stringify(payload))
  .replace('"__DEM__"', JSON.stringify(b64))
  .replace('"__HILLS__"', JSON.stringify(out))
  .replace('"__CIVIC__"', JSON.stringify(civic))
  .replace('"__OUTSIDE__"', JSON.stringify(outsideOut));

fs.writeFileSync(path.join(PROJ, "sf-hills.html"), html);
console.log(`\nwrote sf-hills.html  (${(html.length / 1024).toFixed(0)} KB, dem ${(b64.length / 1024).toFixed(0)} KB)`);
