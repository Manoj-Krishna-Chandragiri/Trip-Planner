

const express = require('express');
const { generateItinerary } = require('../services/gemini');
const { enrichItinerary, computeOriginInfo } = require('../services/enrichItinerary');
const { buildFallbackItinerary } = require('../services/overpass');

const router = express.Router();

router.post('/', async (req, res) => {
  const { description, travelingFrom, originLat, originLon, transportMode } = req.body;

  if (!description || typeof description !== 'string' || !description.trim()) {
    return res.status(400).json({
      error: 'description is required and must be a non-empty string',
    });
  }

  const trimmed = description.trim();

  try {
    console.log(`[plan] Generating itinerary for: "${trimmed.slice(0, 80)}..."`);
    const rawItinerary = await generateItinerary(trimmed);

    console.log(`[plan] Gemini returned ${rawItinerary.days?.length ?? 0} days — enriching...`);
    const enriched = await enrichItinerary(rawItinerary, transportMode || null);

    if (travelingFrom || (originLat != null && originLon != null)) {
      try {
        enriched.originInfo = await computeOriginInfo(
          { label: travelingFrom, lat: originLat, lon: originLon },
          enriched,
          transportMode || null
        );
      } catch (originErr) {
        console.warn('[plan] Origin distance calculation failed:', originErr.message);
        enriched.originInfo = null;
      }
    }
    enriched.transportMode = transportMode || null;

    console.log('[plan] Done ✓');
    return res.json({ itinerary: enriched });

  } catch (primaryErr) {

    if (primaryErr.isOutputError) {
      console.error('[plan] Bad AI output:', primaryErr.message);
      return res.status(422).json({
        error: 'The AI returned an unexpected response format',
        detail: primaryErr.message,
      });
    }

    console.error('[plan] Gemini unavailable:', primaryErr.message);
    console.log('[plan] Attempting Overpass fallback...');

    try {
      const fallback = await buildFallbackItinerary(trimmed);
      console.log('[plan] Fallback succeeded ✓');
      return res.json({ itinerary: fallback });
    } catch (fallbackErr) {

      console.error('[plan] Fallback also failed:', fallbackErr.message);
      return res.status(502).json({
        error: 'Failed to generate itinerary',
        detail: primaryErr.message,
        fallbackError: fallbackErr.message,
      });
    }
  }
});

module.exports = router;
