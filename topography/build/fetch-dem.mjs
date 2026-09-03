// Sample the USGS 10 m NED over San Francisco on a regular lat/lon grid.
// Public opentopodata.org: 100 locations per call, 1 call/sec, 1000 calls/day.
import fs from "node:fs";

const LAT0 = 37.7020, LAT1 = 37.8180;
const LON0 = -122.5250, LON1 = -122.3550;
const NX = 260, NY = 224;

const OUT = new URL("./dem.json", import.meta.url).pathname;
const CACHE = new URL("./dem-partial.json", import.meta.url).pathname;

const pts = [];
for (let j = 0; j < NY; j++) {
  const lat = LAT0 + (LAT1 - LAT0) * (j / (NY - 1));
  for (let i = 0; i < NX; i++) {
    const lon = LON0 + (LON1 - LON0) * (i / (NX - 1));
    pts.push([lat, lon]);
  }
}

let elev = new Array(pts.length).fill(null);
if (fs.existsSync(CACHE)) {
  const prev = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  if (prev.length === elev.length) elev = prev;
}

const CHUNK = 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchChunk(start) {
  const slice = pts.slice(start, start + CHUNK);
  const loc = slice.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join("|");
  const url = `https://api.opentopodata.org/v1/ned10m?locations=${loc}`;
  const res = await fetch(url, { headers: { "User-Agent": "claude-code-research/1.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  if (j.status !== "OK") throw new Error(`status ${j.status}: ${j.error || ""}`);
  j.results.forEach((r, k) => { elev[start + k] = r.elevation === null ? 0 : r.elevation; });
}

const total = Math.ceil(pts.length / CHUNK);
let done = 0;
for (let s = 0; s < pts.length; s += CHUNK) {
  done++;
  if (elev[s] !== null && elev[Math.min(s + CHUNK - 1, pts.length - 1)] !== null) continue;
  let tries = 0;
  for (;;) {
    try { await fetchChunk(s); break; }
    catch (e) {
      if (++tries > 5) throw new Error(`chunk ${s} failed: ${e.message}`);
      await sleep(3000 * tries);
    }
  }
  if (done % 20 === 0) {
    fs.writeFileSync(CACHE, JSON.stringify(elev));
    console.log(`${done}/${total}`);
  }
  await sleep(1100);
}

fs.writeFileSync(CACHE, JSON.stringify(elev));
fs.writeFileSync(OUT, JSON.stringify({ LAT0, LAT1, LON0, LON1, NX, NY, elev }));
console.log("done", pts.length, "points");
