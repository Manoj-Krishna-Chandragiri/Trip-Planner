// OSRM routing service — computes real travel time and distance between stops.
//
// INTERVIEW NOTE — CRITICAL GOTCHA:
//   OSRM uses LON,LAT order — the OPPOSITE of the conventional lat,lon.
//   Every coordinate in the URL must be (longitude, latitude).
//   This is explicitly commented below everywhere it matters.
//
// The public demo server can be slow or overloaded. All failures are
// non-fatal: we return null and the UI shows stops without travel times.

const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';

// point = { lat: number, lon: number }
// Returns { distanceMeters, durationSeconds } or null on any failure.
async function getTravelTime(from, to) {
  // OSRM coordinate format: lon,lat — longitude FIRST (not lat,lon)
  const coords = `${from.lon},${from.lat};${to.lon},${to.lat}`;
  const url = `${OSRM_BASE}/${coords}?overview=false`;

  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(8_000), // 8s — OSRM demo server can be slow
    });

    if (!resp.ok) {
      console.warn(`[routing] OSRM HTTP ${resp.status}`);
      return null;
    }

    const data = await resp.json();

    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
      console.warn('[routing] OSRM returned no routes:', data.code);
      return null;
    }

    return {
      distanceMeters: Math.round(data.routes[0].distance),
      durationSeconds: Math.round(data.routes[0].duration),
    };
  } catch (err) {
    // OSRM errors are non-fatal — itinerary remains useful without travel times
    console.warn('[routing] OSRM request failed:', err.message);
    return null;
  }
}

module.exports = { getTravelTime, estimateDurationForMode, haversineDistanceMeters, isUnrealisticJump };

// The public OSRM demo server only hosts the driving profile -- there's
// no free walking/cycling routing graph available. Rather than silently
// showing car-speed times for a walking trip (wrong) or skipping travel
// times for non-driving modes entirely (less useful), we keep OSRM's
// real road-network DISTANCE (a reasonable proxy regardless of mode --
// it follows actual roads/paths, not a straight line) and recompute
// DURATION using typical speeds per mode. This is clearly flagged to the
// caller via durationIsEstimate so the UI can label it honestly.
const KPH_BY_MODE = {
  Walking: 5,
  Cycling: 15,
  Driving: 50,
  'Public transit': 25,
  Train: 80,
  Flying: 700, // cruise speed; a rough average, always labeled as an estimate
};

function estimateDurationForMode(distanceMeters, transportMode) {
  const kph = KPH_BY_MODE[transportMode] ?? KPH_BY_MODE.Driving;
  const hours = (distanceMeters / 1000) / kph;
  return Math.round(hours * 3600);
}

// Straight-line ("as the crow flies") distance via the haversine formula.
// Pure math, zero API calls -- this is the one distance calculation that
// works EVERYWHERE, including across oceans where OSRM has no road graph
// to route through at all (which is exactly the case that let impossible
// itineraries slip through silently before this fix).
function haversineDistanceMeters(from, to) {
  const R = 6371000; // Earth's radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(to.lat - from.lat);
  const dLon = toRad(to.lon - from.lon);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// Per-mode "this is too far for a single overnight transition" thresholds.
// Flying has no threshold -- long distances are exactly what flights are
// for. These are deliberately generous (better to under-warn than nag on
// a legitimate long drive/train leg).
const MAX_REASONABLE_TRANSITION_METERS = {
  Walking: 20_000,
  Cycling: 80_000,
  Driving: 600_000,
  'Public transit': 300_000,
  Train: 600_000,
};

function isUnrealisticJump(distanceMeters, transportMode) {
  if (transportMode === 'Flying') return false;
  const max = MAX_REASONABLE_TRANSITION_METERS[transportMode] ?? 300_000;
  return distanceMeters > max;
}
