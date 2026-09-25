// Itinerary enrichment pipeline.
//
// Takes a raw Gemini itinerary (name/description/duration only) and:
//   1. Validates the shape (hand-rolled, no Zod)
//   2. Geocodes each stop via Nominatim (sequentially — rate limited)
//   3. Computes OSRM travel times between consecutive verified stops
//   4. Flags days where total planned time > 14 hours as "tight"
//
// Each step is independently fault-tolerant:
//   - Geocode failure → stop.verified = false (not an exception)
//   - OSRM failure → stop.travelToNext = null (not an exception)
//
// INTERVIEW NOTE: Why no Zod? A hand-rolled validator is ~20 lines,
// has zero dependencies, and every line is explainable in an interview.
// Zod adds ~30KB and a learning curve for diminishing returns here.

const { geocodePlace } = require('./geocode');
const { getTravelTime, estimateDurationForMode, haversineDistanceMeters, isUnrealisticJump } = require('./routing');

// ── Shape Validator ────────────────────────────────────────────────
// Returns a human-readable error string, or null if valid.
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

// A day is "tight" if total planned time (stops + travel) exceeds 14 hours.
// This is the pacing consistency check: audits the model's own schedule
// against real travel data.
const MAX_REALISTIC_MINUTES = 14 * 60; // 840 minutes

// ── Main enrichment function ───────────────────────────────────────
// transportMode is optional -- when provided and not 'Driving', OSRM's
// real distance is kept but duration is recalculated with a mode-typical
// speed (see routing.js for why: the public OSRM instance only serves
// the driving profile).
async function enrichItinerary(rawItinerary, transportMode = null) {
  // Validate shape before doing anything expensive
  const validationError = validateShape(rawItinerary);
  if (validationError) {
    const err = new Error(`Invalid itinerary from AI: ${validationError}`);
    err.isOutputError = true; // Signals to the route handler: don't fallback, show error
    throw err;
  }

  const enrichedDays = [];

  for (const day of rawItinerary.days) {
    const enrichedStops = [];

    // ── Step 1: Geocode all stops in this day ────────────────────
    // Sequential (not parallel) because of Nominatim's 1 req/sec limit.
    // The SerialQueue in geocode.js also enforces this globally, but
    // sequential calls here make the intent obvious.
    for (const stop of day.stops) {
      let geocoded = null;
      // A bare stop name (e.g. "Highway King Dhaba") is often too
      // ambiguous for Nominatim to resolve on its own, even when the
      // place is real. Appending the trip's region gives it the context
      // it needs — this is what data.region exists for.
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

    // ── Step 2: OSRM travel times between consecutive verified stops ──
    for (let i = 0; i < enrichedStops.length - 1; i++) {
      const current = enrichedStops[i];
      const next = enrichedStops[i + 1];

      if (current.verified && next.verified) {
        // getTravelTime never throws — returns null on any failure
        current.travelToNext = await getTravelTime(
          { lat: current.lat, lon: current.lon },
          { lat: next.lat, lon: next.lon }
        );

        // Real distance from OSRM is trustworthy regardless of mode;
        // duration only reflects car speeds, so re-estimate it for
        // anything other than driving.
        if (current.travelToNext && transportMode && transportMode !== 'Driving') {
          current.travelToNext = {
            ...current.travelToNext,
            durationSeconds: estimateDurationForMode(current.travelToNext.distanceMeters, transportMode),
            durationIsEstimate: true,
          };
        }
      }
    }

    // ── Step 3: Pacing check ──────────────────────────────────────
    // Sum stop durations + travel times to check if the day is realistic.
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

  // ── Cross-day geographic sanity check ──────────────────────────────
  // Per-day pacing (above) can't catch a day-to-day jump that's
  // geographically impossible -- e.g. "Day 2: Tokyo" -> "Day 3: Delhi"
  // with no travel accounted for. OSRM can't route across an ocean, so
  // it would just return null there, silently contributing zero minutes
  // to the pacing check and letting an impossible itinerary look fine.
  // Haversine (straight-line) distance works everywhere, including
  // across oceans, which is exactly the gap this closes.
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
      // No road route exists (likely overseas) or the mode is Flying,
      // where a straight-line distance is the more honest measure anyway.
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

// ── Origin-to-first-stop distance ────────────────────────────────────
// origin: { label, lat, lon } -- lat/lon are already known if the user
// granted geolocation (most accurate); otherwise only label is set and
// this geocodes it the same way stops are geocoded.
// Returns null (never throws) if origin wasn't provided, geocoding
// failed, or there's no verified first stop to measure to -- this is a
// nice-to-have chip, never a blocker for the itinerary itself.
async function computeOriginInfo(origin, enrichedItinerary, transportMode) {
  if (!origin || (!origin.label && (origin.lat == null || origin.lon == null))) return null;

  const firstStop = enrichedItinerary.days?.[0]?.stops?.find((s) => s.verified && s.lat != null);
  if (!firstStop) return null;

  let originLat = origin.lat;
  let originLon = origin.lon;
  let label = origin.label;

  // No precise coordinates yet (user typed a place name instead of using
  // geolocation) -- geocode it the same way every stop is geocoded.
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
