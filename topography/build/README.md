# Build pipeline for `sf-hills.html`

`../sf-hills.html` is generated. Edit `sf-hills.template.html`, then run:

```
node build-sf.mjs
```

That reads `dem.json` + `hills.json` + `hills-outside.json` + `streets.json`, matches each named hill to a summit in the
grid, and substitutes five placeholders in the template (`"__GRID__"`,
`"__DEM__"`, `"__HILLS__"`, `"__CIVIC__"`, `"__OUTSIDE__"`) to write `../sf-hills.html`. The elevation grid is
baked in as base64 Uint16 decimetres, so the artifact stays a single offline
file.

## Where the data came from

- `dem.json` — USGS 3DEP 10 m (NED) elevations sampled on a 260 × 294 lat/lon
  grid (~58 m spacing) over lat 37.66559–37.8180, lon −122.5250 to −122.3550,
  fetched through the public opentopodata.org API by `fetch-dem.mjs`. Re-running
  that script from scratch takes ~14 minutes and resumes from `dem-partial.json`
  if interrupted. The public API allows 1000 calls/day.

  The southern 70 rows were added afterwards by `extend-dem.mjs`, which fetches
  a strip at the existing spacing and prepends it, so the sheet clears San Bruno
  Mountain instead of stopping mid-slope at the county line. Set `ROWS` and run
  it again to extend further; `fetch-dem.mjs` still holds the original bounds.
- `hills-outside.json` — summits on the sheet but outside the city. The artifact
  draws them with a hollow mark and keeps them out of the roster, the count and
  the colour ramp, which is keyed to San Francisco's own high point so a
  1,319 ft neighbour does not wash the city down a shade.
- `hills.json` — hill names, neighbourhoods, published heights and seed
  coordinates. Heights and names come from Wikipedia's *List of hills in San
  Francisco*; coordinates from Wikipedia's coordinates API where the page is
  geotagged, otherwise from OpenStreetMap Nominatim.

- `streets.json` — 24 major arterials and freeways, 24 district label points
  and the city/county boundary, pulled from OpenStreetMap through the Overpass
  API by `fetch-streets.mjs` (a few seconds; re-run any time). Geometry is
  simplified with Douglas–Peucker at ~20 m. Each street keeps two forms: `seg`,
  every segment, for drawing, and `lines`, the longest stitched runs, for
  placing the name. Downtown Market Street alone is 200-odd OSM ways split at
  every junction, so no single stitched run covers a whole street. OSM data is
  ODbL — the artifact credits it in the footer.

## Why summit matching is not just "highest cell nearby"

The seed coordinates are a mix of true summits and neighbourhood centroids. A
plain nearest-maximum search fails in both directions — Billy Goat Hill climbs
onto Diamond Heights, Bernal Heights sits below its own park. `pickSummit`
instead scores every local maximum within 600 m by how close its height is to
the published figure, with distance as a tiebreaker. The artifact shows the grid
value as the headline number and states the published figure beside it, because
sources disagree about where a hill's summit is.

Sampling on a 58 m grid reads summits 1–3 % low against published spot heights
(Mount Davidson 929 ft vs 928 ft, Telegraph Hill 283 ft vs 284 ft). An earlier
94 m grid was 4–12 % low, which is why the finer sample exists.
