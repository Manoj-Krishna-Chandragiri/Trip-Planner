

const express = require('express');
const { generateRefinement } = require('../services/gemini');
const { geocodePlace } = require('../services/geocode');
const { getTravelTime } = require('../services/routing');

const router = express.Router();

function applyOps(itinerary, ops) {

  const result = JSON.parse(JSON.stringify(itinerary));

  for (const op of ops) {
    const day = result.days.find(d => d.dayNumber === op.dayNumber);
    if (!day) {
      console.warn(`[refine] Op references missing dayNumber ${op.dayNumber} — skipping`);
      continue;
    }

    if (op.op === 'remove') {
      day.stops = day.stops.filter(s => s.id !== op.stopId);

    } else if (op.op === 'replace' && op.newStop) {
      const idx = day.stops.findIndex(s => s.id === op.stopId);
      if (idx !== -1) {
        day.stops[idx] = { ...op.newStop, verified: false, travelToNext: null };
      }

    } else if (op.op === 'add' && op.newStop) {
      const newStop = { ...op.newStop, verified: false, travelToNext: null };
      if (op.afterStopId) {
        const idx = day.stops.findIndex(s => s.id === op.afterStopId);

        day.stops.splice(idx !== -1 ? idx + 1 : day.stops.length, 0, newStop);
      } else {
        day.stops.push(newStop);
      }
    }
  }

  return result;
}

router.post('/', async (req, res) => {
  const { currentItinerary, refinementRequest } = req.body;

  if (!currentItinerary || !refinementRequest || typeof refinementRequest !== 'string') {
    return res.status(400).json({
      error: 'currentItinerary and refinementRequest are required',
    });
  }

  try {
    console.log(`[refine] Request: "${refinementRequest.slice(0, 80)}"`);
    const diff = await generateRefinement(currentItinerary, refinementRequest.trim());
    const ops = diff.ops || [];

    console.log(`[refine] Got ${ops.length} ops — applying...`);
    let updated = applyOps(currentItinerary, ops);

    for (const day of updated.days) {
      for (const stop of day.stops) {
        if (!stop.verified && stop.lat == null) {
          try {
            const geo = await geocodePlace(`${stop.name}, ${updated.region}`);
            if (geo) {
              stop.lat = geo.lat;
              stop.lon = geo.lon;
              stop.verified = true;
              stop.displayName = geo.displayName;
            }
          } catch (_) {
            stop.verified = false;
          }
        }
      }
    }

    return res.json({ itinerary: updated, ops });

  } catch (err) {
    console.error('[refine] Error:', err.message);
    return res.status(502).json({ error: 'Refinement failed', detail: err.message });
  }
});

module.exports = router;
