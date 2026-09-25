const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';

async function getTravelTime(from, to) {

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

    console.warn('[routing] OSRM request failed:', err.message);
    return null;
  }
}

module.exports = { getTravelTime, estimateDurationForMode, haversineDistanceMeters, isUnrealisticJump };

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
