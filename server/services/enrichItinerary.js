

const { geocodePlace } = require('./geocode');
const { getTravelTime, estimateDurationForMode, haversineDistanceMeters, isUnrealisticJump } = require('./routing');

function validateShape(data) {
  if (!data || typeof data !== 'object') return 'Response is not an object';
  if (typeof data.tripTitle !== 'string' || !data.tripTitle.trim()) return 'Missing or empty tripTitle';
  if (typeof data.region !== 'string' || !data.region.trim()) return 'Missing or empty region';
  if (!Array.isArray(data.days) || data.days.length === 0) return 'Missing or empty days array';

  for (let d = 0; d < data.days.length; d++) {
    const day = data.days[d];
    if (typeof day.dayNumber !== 'number') return `Day ${d}: missing dayNumber`;
    if (typeof day.title !== 'string') return `Day ${d}: missing title`;
    if (!Array.isArray(day.stops)) return `Day ${d}: missing stops array`;

    for (let s = 0; s < day.stops.length; s++) {
      const stop = day.stops[s];
      if (typeof stop.id !== 'string' || !stop.id.trim()) return `Day ${d} stop ${s}: missing id`;
      if (typeof stop.name !== 'string' || !stop.name.trim()) return `Day ${d} stop ${s}: missing name`;
      if (typeof stop.description !== 'string') return `Day ${d} stop ${s}: missing description`;
      if (typeof stop.suggestedDurationMinutes !== 'number') return `Day ${d} stop ${s}: missing suggestedDurationMinutes`;
    }
  }
  return null; // null = valid
}

const MAX_REALISTIC_MINUTES = 14 * 60; // 840 minutes

async function enrichItinerary(rawItinerary, transportMode = null) {

  const validationError = validateShape(rawItinerary);
  if (validationError) {
    const err = new Error(`Invalid itinerary from AI: ${validationError}`);
    err.isOutputError = true; // Signals to the route handler: don't fallback, show error
    throw err;
  }

  const enrichedDays = [];

  for (const day of rawItinerary.days) {
    const enrichedStops = [];

    for (const stop of day.stops) {
      let geocoded = null;

      const geocodeQuery = `${stop.name}, ${rawItinerary.region}`;
      try {
        geocoded = await geocodePlace(geocodeQuery);
      } catch (err) {
        console.warn(`[enrich] Geocode failed for "${geocodeQuery}": ${err.message}`);
      }

      enrichedStops.push({
        ...stop,
        lat: geocoded?.lat ?? null,
        lon: geocoded?.lon ?? null,
        verified: geocoded !== null,
        displayName: geocoded?.displayName ?? null,
        travelToNext: null, // filled in step 2
      });
    }

    for (let i = 0; i < enrichedStops.length - 1; i++) {
      const current = enrichedStops[i];
      const next = enrichedStops[i + 1];

      if (current.verified && next.verified) {

        current.travelToNext = await getTravelTime(
          { lat: current.lat, lon: current.lon },
          { lat: next.lat, lon: next.lon }
        );

        if (current.travelToNext && transportMode && transportMode !== 'Driving') {
          current.travelToNext = {
            ...current.travelToNext,
            durationSeconds: estimateDurationForMode(current.travelToNext.distanceMeters, transportMode),
            durationIsEstimate: true,
          };
        }
      }
    }

    let totalMinutes = 0;
    for (const stop of enrichedStops) {
      totalMinutes += stop.suggestedDurationMinutes || 0;
      if (stop.travelToNext?.durationSeconds) {
        totalMinutes += Math.round(stop.travelToNext.durationSeconds / 60);
      }
    }

    enrichedDays.push({
      ...day,
      stops: enrichedStops,
      tight: totalMinutes > MAX_REALISTIC_MINUTES,
      totalPlannedMinutes: totalMinutes,
    });
  }

  for (let d = 1; d < enrichedDays.length; d++) {
    const prevDayStops = enrichedDays[d - 1].stops.filter((s) => s.verified);
    const currDayStops = enrichedDays[d].stops.filter((s) => s.verified);
    if (prevDayStops.length === 0 || currDayStops.length === 0) continue;

    const from = prevDayStops[prevDayStops.length - 1];
    const to = currDayStops[0];

    let distanceMeters = null;
    let durationSeconds = null;
    let isStraightLine = false;

    const routed = await getTravelTime({ lat: from.lat, lon: from.lon }, { lat: to.lat, lon: to.lon });
    if (routed && transportMode !== 'Flying') {
      distanceMeters = routed.distanceMeters;
      durationSeconds = transportMode && transportMode !== 'Driving'
        ? estimateDurationForMode(routed.distanceMeters, transportMode)
        : routed.durationSeconds;
    } else {

      distanceMeters = haversineDistanceMeters({ lat: from.lat, lon: from.lon }, { lat: to.lat, lon: to.lon });
      durationSeconds = estimateDurationForMode(distanceMeters, transportMode || 'Driving');
      isStraightLine = true;
    }

    enrichedDays[d].transitionFromPrevious = {
      distanceMeters,
      durationSeconds,
      isEstimate: true,
      isStraightLine,
      isUnrealistic: isUnrealisticJump(distanceMeters, transportMode),
    };
  }

  return { ...rawItinerary, days: enrichedDays };
}

module.exports = { enrichItinerary, validateShape, computeOriginInfo };

async function computeOriginInfo(origin, enrichedItinerary, transportMode) {
  if (!origin || (!origin.label && (origin.lat == null || origin.lon == null))) return null;

  const firstStop = enrichedItinerary.days?.[0]?.stops?.find((s) => s.verified && s.lat != null);
  if (!firstStop) return null;

  let originLat = origin.lat;
  let originLon = origin.lon;
  let label = origin.label;

  if (originLat == null || originLon == null) {
    try {
      const geocoded = await geocodePlace(origin.label);
      if (!geocoded) return null;
      originLat = geocoded.lat;
      originLon = geocoded.lon;
      label = geocoded.displayName || origin.label;
    } catch {
      return null;
    }
  }

  const travel = await getTravelTime({ lat: originLat, lon: originLon }, { lat: firstStop.lat, lon: firstStop.lon });
  if (!travel) return null;

  const isNonDriving = transportMode && transportMode !== 'Driving';
  return {
    label: label || 'your starting point',
    firstStopId: firstStop.id,
    distanceMeters: travel.distanceMeters,
    durationSeconds: isNonDriving ? estimateDurationForMode(travel.distanceMeters, transportMode) : travel.durationSeconds,
    durationIsEstimate: Boolean(isNonDriving),
  };
}
