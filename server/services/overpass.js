// Overpass API fallback — builds a real-data itinerary when Gemini is unavailable.
//
// Flow:
//   1. Geocode the trip location from the user's description via Nominatim
//   2. Fetch tourist POIs within 5km via Overpass QL
//   3. Distribute into N days (up to 5 stops/day)
//   4. Return a structured itinerary marked isFallback: true
//
// The returned itinerary has the same shape as a Gemini-generated one,
// so the frontend renders it identically (with a warning banner on top).
//
// INTERVIEW NOTE: Overpass uses "around:RADIUS, LAT, LON" order —
// note that's LAT,LON for Overpass (unlike OSRM which uses LON,LAT).

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const { geocodePlace } = require('./geocode');

// ── Overpass QL query builder ──────────────────────────────────────
function buildQuery(lat, lon, radiusMeters = 5000) {
  // We query multiple tag types to get a diverse set of POIs.
  // "out center" returns the centroid for ways/relations (not just nodes).
  return `[out:json][timeout:30];
(
  nwr[tourism=attraction](around:${radiusMeters},${lat},${lon});
  nwr[tourism=museum](around:${radiusMeters},${lat},${lon});
  nwr[tourism=viewpoint](around:${radiusMeters},${lat},${lon});
  nwr[tourism=gallery](around:${radiusMeters},${lat},${lon});
  nwr[historic=monument](around:${radiusMeters},${lat},${lon});
  nwr[historic=castle](around:${radiusMeters},${lat},${lon});
  nwr[leisure=park][name](around:${radiusMeters},${lat},${lon});
  nwr[amenity=theatre](around:${radiusMeters},${lat},${lon});
);
out center 50;`;
}

// ── OSM tag → human-readable description ──────────────────────────
function tagsToDescription(tags) {
  if (tags.description) return tags.description;
  if (tags.tourism === 'museum') return `A museum worth exploring in the area.`;
  if (tags.tourism === 'attraction') return `A popular attraction in the area.`;
  if (tags.tourism === 'viewpoint') return `A scenic viewpoint with notable views.`;
  if (tags.tourism === 'gallery') return `An art gallery showcasing local works.`;
  if (tags.historic === 'castle') return `A historic castle with architectural significance.`;
  if (tags.historic === 'monument') return `A historic monument of cultural importance.`;
  if (tags.leisure === 'park') return `A park offering a relaxing green space.`;
  if (tags.amenity === 'theatre') return `A theatre for live performances.`;
  return 'A point of interest sourced from OpenStreetMap.';
}

// ── Estimate visit duration from OSM tags ─────────────────────────
function estimateDuration(tags) {
  if (tags.tourism === 'museum') return 90;
  if (tags.tourism === 'gallery') return 60;
  if (tags.historic === 'castle') return 75;
  if (tags.leisure === 'park') return 45;
  if (tags.tourism === 'viewpoint') return 30;
  return 45;
}

// ── Main fallback builder ──────────────────────────────────────────
async function buildFallbackItinerary(description, requestedDays = 3) {
  // Step 1: Geocode the destination from the full description string.
  // Nominatim is good at extracting a place from natural language.
  const location = await geocodePlace(description);
  if (!location) {
    throw new Error('Could not determine a trip location from the description for fallback');
  }

  const { lat, lon, displayName } = location;
  const cityName = displayName.split(',')[0];

  // Step 2: Fetch POIs from Overpass
  const query = buildQuery(lat, lon);
  const resp = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(35_000),
  });

  if (!resp.ok) {
    throw new Error(`Overpass API HTTP ${resp.status}`);
  }

  const data = await resp.json();
  const elements = data.elements || [];

  // Step 3: Filter to named elements with coordinates
  const pois = elements
    .filter(el => {
      const hasName = Boolean(el.tags?.name);
      const hasCoords = el.lat != null || el.center?.lat != null;
      return hasName && hasCoords;
    })
    .map(el => ({
      name: el.tags.name,
      lat: el.lat ?? el.center.lat,
      lon: el.lon ?? el.center.lon,
      tags: el.tags,
    }))
    // Remove duplicate names
    .filter((poi, idx, arr) => arr.findIndex(p => p.name === poi.name) === idx)
    .slice(0, requestedDays * 5);

  if (pois.length === 0) {
    throw new Error(`No named POIs found near "${cityName}" via Overpass`);
  }

  // Step 4: Distribute into days (up to 5 stops/day)
  const stopsPerDay = Math.max(2, Math.ceil(pois.length / requestedDays));
  const dayThemes = ['Discovering the Area', 'Culture & Highlights', 'Hidden Gems & Local Life'];
  const days = [];

  for (let d = 0; d < requestedDays; d++) {
    const dayStops = pois.slice(d * stopsPerDay, (d + 1) * stopsPerDay);
    if (dayStops.length === 0) continue;

    days.push({
      dayNumber: d + 1,
      title: dayThemes[d] ?? `Exploring ${cityName}`,
      stops: dayStops.map((poi, i) => ({
        id: `day${d + 1}-stop${i + 1}`,
        name: poi.name,
        description: tagsToDescription(poi.tags),
        suggestedDurationMinutes: estimateDuration(poi.tags),
        reason: 'Sourced from OpenStreetMap data (AI unavailable)',
        // Pre-fill coordinates — these stops are already geocoded from OSM
        lat: poi.lat,
        lon: poi.lon,
        verified: true,
        displayName: poi.name,
        travelToNext: null,
      })),
      tight: false,
      totalPlannedMinutes: dayStops.reduce((s, p) => s + estimateDuration(p.tags), 0),
    });
  }

  return {
    tripTitle: `Exploring ${cityName}`,
    days,
    isFallback: true,
    fallbackReason:
      'The AI service is currently unavailable. This itinerary was built from OpenStreetMap data and may be less personalised.',
  };
}

module.exports = { buildFallbackItinerary };
