// POST /api/plan
//
// Flow:
//   1. Validate request body
//   2. Call Gemini for a structured itinerary
//   3. Enrich: geocode stops + compute OSRM travel times + pacing check
//   4. On Gemini API failure (network/timeout/auth) → Overpass fallback
//   5. On bad Gemini output (malformed/wrong shape) → 422 error (no fallback)
//
// INTERVIEW NOTE: Why distinguish Gemini API failure vs bad output?
// The brief says: fall back to Overpass "if the Gemini call fails outright
// (timeout, provider down, rate-limited — not just malformed output)".
// We use err.isOutputError to tell these apart without a custom class.

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

  // ── Attempt 1: Gemini + enrichment ────────────────────────────
  try {
    console.log(`[plan] Generating itinerary for: "${trimmed.slice(0, 80)}..."`);
    const rawItinerary = await generateItinerary(trimmed);

    console.log(`[plan] Gemini returned ${rawItinerary.days?.length ?? 0} days — enriching...`);
    const enriched = await enrichItinerary(rawItinerary, transportMode || null);

    // Origin distance chip is optional and best-effort -- a failure here
    // (bad geocode, OSRM down) should never take down an otherwise-good
    // itinerary, hence the separate try/catch and null fallback.
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
    // Bad output from the model (wrong shape, empty, etc.)
    // Per the brief: show error + retry, do NOT fall back to Overpass.
    if (primaryErr.isOutputError) {
      console.error('[plan] Bad AI output:', primaryErr.message);
      return res.status(422).json({
        error: 'The AI returned an unexpected response format',
        detail: primaryErr.message,
      });
    }

    // Gemini is unavailable (timeout, network, auth, rate-limit).
    // Per the brief: fall back to Overpass — the app should never fully die.
    console.error('[plan] Gemini unavailable:', primaryErr.message);
    console.log('[plan] Attempting Overpass fallback...');

    try {
      const fallback = await buildFallbackItinerary(trimmed);
      console.log('[plan] Fallback succeeded ✓');
      return res.json({ itinerary: fallback });
    } catch (fallbackErr) {
      // Both failed — nothing more we can do
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
