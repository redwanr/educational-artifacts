// Extend dem.json southward by ROWS grid rows, keeping the existing lat/lon
// spacing exactly so the old and new samples share one grid. Written because
// the sheet was cut off at the bottom mid-slope: it now runs past San Bruno
// Mountain, the first summit south of the county line.
import fs from "node:fs";

const ROWS = 28;                       // run out past San Bruno Mtn's south flank
const F = new URL("./dem.json", import.meta.url).pathname;
const CACHE = new URL("./dem-extend-partial.json", import.meta.url).pathname;

const dem = JSON.parse(fs.readFileSync(F, "utf8"));
const { LAT0, LAT1, LON0, LON1, NX, NY, elev } = dem;
const dLat = (LAT1 - LAT0) / (NY - 1);
const newLat0 = LAT0 - ROWS * dLat;

const pts = [];
for (let j = 0; j < ROWS; j++) {
  const lat = newLat0 + j * dLat;
  for (let i = 0; i < NX; i++) pts.push([lat, LON0 + ((LON1 - LON0) * i) / (NX - 1)]);
}

let add = new Array(pts.length).fill(null);
if (fs.existsSync(CACHE)) {
  const prev = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  if (prev.length === add.length) add = prev;
}

const CHUNK = 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchChunk(start) {
  const slice = pts.slice(start, start + CHUNK);
  const loc = slice.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join("|");
  const res = await fetch(`https://api.opentopodata.org/v1/ned10m?locations=${loc}`, {
    headers: { "User-Agent": "claude-code-research/1.0" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  if (j.status !== "OK") throw new Error(`status ${j.status}: ${j.error || ""}`);
  j.results.forEach((r, k) => { add[start + k] = r.elevation === null ? 0 : r.elevation; });
}

const total = Math.ceil(pts.length / CHUNK);
let done = 0;
for (let s = 0; s < pts.length; s += CHUNK) {
  done++;
  if (add[s] !== null && add[Math.min(s + CHUNK - 1, pts.length - 1)] !== null) continue;
  let tries = 0;
  for (;;) {
    try { await fetchChunk(s); break; }
    catch (e) {
      if (++tries > 5) throw new Error(`chunk ${s} failed: ${e.message}`);
      await sleep(3000 * tries);
    }
  }
  if (done % 20 === 0) { fs.writeFileSync(CACHE, JSON.stringify(add)); console.log(`${done}/${total}`); }
  await sleep(1100);
}

fs.writeFileSync(CACHE, JSON.stringify(add));
fs.writeFileSync(F, JSON.stringify({
  LAT0: newLat0, LAT1, LON0, LON1, NX, NY: NY + ROWS,
  elev: add.concat(elev),                     // rows run south-first
}));

const M2FT = 3.280839895;
let hi = 0, hj = 0, hii = 0;
add.forEach((v, k) => { if (v > hi) { hi = v; hj = Math.floor(k / NX); hii = k % NX; } });
console.log(`added ${ROWS} rows, NY ${NY} -> ${NY + ROWS}, new LAT0 ${newLat0.toFixed(5)}`);
console.log(`highest new cell ${(hi * M2FT).toFixed(0)} ft at ` +
  `${(newLat0 + hj * dLat).toFixed(5)}, ${(LON0 + ((LON1 - LON0) * hii) / (NX - 1)).toFixed(5)}`);
